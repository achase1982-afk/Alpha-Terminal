import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.js";
import { logFailure } from "./telemetry.js";
import { emitPortfolioError } from "./portfolioWsErrorHub.js";

const TOKEN_FILE = path.join(process.cwd(), ".data", "schwab-tokens.json");
const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 30_000;
const MAX_RETRIES = 3;

interface StoredTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  generation: number;
}

interface TokenFile {
  market?: StoredTokenSet;
  trader?: StoredTokenSet;
}

let store: TokenFile = {};
let marketTimer: ReturnType<typeof setTimeout> | null = null;
let traderTimer: ReturnType<typeof setTimeout> | null = null;
let onTokenRefreshed: ((kind: "market" | "trader", accessToken: string) => void) | null = null;
let dbStoreReady = false;

const refreshInFlight = new Map<string, Promise<boolean>>();

/** True after this process has had a persisted token set for the kind (init load, store, or successful refresh). */
const authEstablishedInProcess: Record<"market" | "trader", boolean> = {
  market: false,
  trader: false,
};

function markAuthEstablished(kind: "market" | "trader") {
  authEstablishedInProcess[kind] = true;
}

function maybeEmitAuthExpired(kind: "market" | "trader", payload: Record<string, unknown>) {
  if (!authEstablishedInProcess[kind]) return;
  emitPortfolioError({ code: "AUTH_EXPIRED", kind, ...payload });
}

function ensureDir() {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadFromDisk(): TokenFile {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
      return JSON.parse(raw) as TokenFile;
    }
  } catch (err) {
    logger.warn({ err }, "TokenStore: failed to read token file, starting fresh");
  }
  return {};
}

function saveToDisk() {
  try {
    ensureDir();
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    logger.error({ err }, "TokenStore: failed to write token file");
  }
}

async function ensureDbStore() {
  if (dbStoreReady) return true;
  try {
    const { db, sql } = await import("@workspace/db");
    await db.execute(sql`
      create table if not exists schwab_tokens (
        kind text primary key,
        access_token text not null,
        refresh_token text not null,
        expires_at bigint not null,
        generation integer not null default 0,
        updated_at timestamp not null default now()
      )
    `);
    dbStoreReady = true;
    return true;
  } catch (err) {
    logger.warn({ err }, "TokenStore: DB token store unavailable");
    return false;
  }
}

async function loadFromDb(): Promise<TokenFile> {
  if (!(await ensureDbStore())) return {};
  try {
    const { db, sql } = await import("@workspace/db");
    const result = await db.execute(sql`
      select kind, access_token, refresh_token, expires_at, generation
      from schwab_tokens
      where kind in ('market', 'trader')
    `);
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    const next: TokenFile = {};
    for (const row of rows) {
      const kind = row.kind === "market" || row.kind === "trader" ? row.kind : null;
      const accessToken = typeof row.access_token === "string" ? row.access_token : "";
      const refreshToken = typeof row.refresh_token === "string" ? row.refresh_token : "";
      const expiresAt = Number(row.expires_at);
      const generation = Number(row.generation ?? 0);
      if (!kind || !accessToken || !refreshToken || !Number.isFinite(expiresAt)) continue;
      next[kind] = { accessToken, refreshToken, expiresAt, generation };
    }
    return next;
  } catch (err) {
    logger.warn({ err }, "TokenStore: failed to load tokens from DB");
    return {};
  }
}

async function persistKindToDb(kind: "market" | "trader") {
  if (!(await ensureDbStore())) return;
  try {
    const { db, sql } = await import("@workspace/db");
    const tokenSet = store[kind];
    if (!tokenSet) {
      await db.execute(sql`delete from schwab_tokens where kind = ${kind}`);
      return;
    }
    await db.execute(sql`
      insert into schwab_tokens (kind, access_token, refresh_token, expires_at, generation, updated_at)
      values (${kind}, ${tokenSet.accessToken}, ${tokenSet.refreshToken}, ${tokenSet.expiresAt}, ${tokenSet.generation}, now())
      on conflict (kind) do update set
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        generation = excluded.generation,
        updated_at = now()
    `);
  } catch (err) {
    logger.error({ err, kind }, "TokenStore: failed to persist tokens to DB");
  }
}

function persistKind(kind: "market" | "trader") {
  saveToDisk();
  void persistKindToDb(kind);
}

function basicAuth(key: string, secret: string): string {
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

/** When market and trader share one Schwab OAuth grant, keep both slots in sync. */
function mirrorLinkedTokenKind(
  sourceKind: "market" | "trader",
  previousRefreshToken: string,
  next: StoredTokenSet,
) {
  const otherKind = sourceKind === "market" ? "trader" : "market";
  const other = store[otherKind];
  if (!other || other.refreshToken !== previousRefreshToken) return;
  store[otherKind] = {
    ...next,
    generation: (other.generation ?? 0) + 1,
  };
  persistKind(otherKind);
  clearTimer(otherKind);
}

function refreshFlightKey(kind: "market" | "trader"): string {
  const tokenSet = store[kind];
  if (!tokenSet?.refreshToken) return kind;
  const otherKind = kind === "market" ? "trader" : "market";
  const other = store[otherKind];
  if (other?.refreshToken === tokenSet.refreshToken) {
    return `linked:${tokenSet.refreshToken}`;
  }
  return kind;
}

async function doRefresh(
  kind: "market" | "trader",
  retryCount: number = 0
): Promise<boolean> {
  const tokenSet = store[kind];
  if (!tokenSet?.refreshToken) {
    logger.warn("TokenStore: no %s refresh token available", kind);
    logger.info(
      { ts: Date.now(), kind, attempt: retryCount + 1, outcome: "failure", reason: "no_refresh_token", refreshTokenPersisted: false },
      "[SCHWAB_TOKEN] refresh outcome",
    );
    maybeEmitAuthExpired(kind, { reason: "no_refresh_token" });
    return false;
  }

  const generationBefore = tokenSet.generation ?? 0;

  const appKey = process.env.SCHWAB_TRADER_APP_KEY;
  const appSecret = process.env.SCHWAB_TRADER_APP_SECRET;

  if (!appKey || !appSecret) {
    logger.error("TokenStore: missing credentials for %s refresh", kind);
    logger.info(
      { ts: Date.now(), kind, attempt: retryCount + 1, outcome: "failure", reason: "missing_app_credentials", refreshTokenPersisted: false },
      "[SCHWAB_TOKEN] refresh outcome",
    );
    emitPortfolioError({ code: "AUTH_EXPIRED", kind, reason: "missing_app_credentials" });
    return false;
  }

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", tokenSet.refreshToken);

  logger.info(
    { ts: Date.now(), kind, attempt: retryCount + 1 },
    "[SCHWAB_TOKEN] refresh attempt",
  );
  logger.info("TokenStore: refreshing %s access token (attempt %d)", kind, retryCount + 1);

  try {
    const res = await fetch(SCHWAB_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: basicAuth(appKey, appSecret),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const text = await res.text();

    if (!res.ok) {
      logger.error({ status: res.status, body: text.slice(0, 300) }, "TokenStore: %s refresh failed", kind);
      logger.info(
        {
          ts: Date.now(),
          kind,
          attempt: retryCount + 1,
          outcome: "failure",
          httpStatus: res.status,
          refreshTokenPersisted: false,
        },
        "[SCHWAB_TOKEN] refresh outcome",
      );
      emitPortfolioError({ code: "AUTH_EXPIRED", kind, httpStatus: res.status });
      void logFailure("SCHWAB_API", "CRITICAL", `OAuth ${kind} token refresh failed (HTTP ${res.status})`, { kind, status: res.status, body: text.slice(0, 300) });

      const currentGen = store[kind]?.generation ?? 0;
      if (currentGen > generationBefore) {
        logger.info("TokenStore: %s store was updated by another refresh — skipping clear", kind);
        logger.info(
          { ts: Date.now(), kind, attempt: retryCount + 1, outcome: "superseded_by_concurrent_refresh", refreshTokenPersisted: false },
          "[SCHWAB_TOKEN] refresh outcome",
        );
        return false;
      }

      if (res.status === 401 || res.status === 400) {
        const errorBody = text.toLowerCase();
        if (
          errorBody.includes("expired") ||
          errorBody.includes("invalid_grant") ||
          errorBody.includes("revoked") ||
          errorBody.includes("unsupported_token_type") ||
          errorBody.includes("refresh_token_authentication_error") ||
          errorBody.includes("failed refresh token authentication")
        ) {
          logger.warn("TokenStore: %s refresh token expired/revoked — clearing", kind);
          void logFailure("SCHWAB_API", "CRITICAL", `OAuth ${kind} refresh token expired/revoked — clearing`, { kind, errorBody: text.slice(0, 300) });
          store[kind] = undefined;
          persistKind(kind);
          maybeEmitAuthExpired(kind, { reason: "refresh_token_revoked_or_expired" });
          return false;
        }
      }

      if (retryCount < MAX_RETRIES) {
        logger.info("TokenStore: will retry %s refresh in %ds", kind, RETRY_DELAY_MS / 1000);
        scheduleRefreshWithDelay(kind, RETRY_DELAY_MS);
      }
      return false;
    }

    const data = JSON.parse(text) as Record<string, unknown>;
    const newAccess = data["access_token"] as string;
    const newRefresh = (data["refresh_token"] as string) ?? tokenSet.refreshToken;
    const expiresIn = (data["expires_in"] as number) ?? 1800;

    const previousRefreshToken = tokenSet.refreshToken;
    const refreshTokenRotated = newRefresh !== previousRefreshToken;
    const updated: StoredTokenSet = {
      accessToken: newAccess,
      refreshToken: newRefresh,
      expiresAt: Date.now() + expiresIn * 1000,
      generation: generationBefore + 1,
    };
    store[kind] = updated;
    persistKind(kind);
    mirrorLinkedTokenKind(kind, previousRefreshToken, updated);
    markAuthEstablished(kind);

    logger.info(
      {
        ts: Date.now(),
        kind,
        attempt: retryCount + 1,
        outcome: "success",
        refreshTokenRotated,
        refreshTokenPersistedToStorage: true,
        expiresInSec: expiresIn,
      },
      "[SCHWAB_TOKEN] refresh outcome",
    );
    logger.info("TokenStore: %s token refreshed, expires in %ds", kind, expiresIn);

    scheduleRefresh(kind);

    if (onTokenRefreshed) {
      onTokenRefreshed(kind, newAccess);
    }

    return true;
  } catch (err) {
    logger.error({ err }, "TokenStore: %s refresh network error", kind);
    logger.info(
      {
        ts: Date.now(),
        kind,
        attempt: retryCount + 1,
        outcome: "failure",
        reason: "network_error",
        error: String(err),
        refreshTokenPersisted: false,
      },
      "[SCHWAB_TOKEN] refresh outcome",
    );
    emitPortfolioError({ code: "AUTH_EXPIRED", kind, reason: "network_error" });
    void logFailure("SCHWAB_API", "ERROR", `OAuth ${kind} token refresh network error`, { kind, error: String(err) });
    if (retryCount < MAX_RETRIES) {
      logger.info("TokenStore: will retry %s refresh in %ds", kind, RETRY_DELAY_MS / 1000);
      scheduleRefreshWithDelay(kind, RETRY_DELAY_MS);
    }
    return false;
  }
}

async function refreshTokenSet(kind: "market" | "trader"): Promise<boolean> {
  const flightKey = refreshFlightKey(kind);
  const inFlight = refreshInFlight.get(flightKey);
  if (inFlight) {
    logger.info("TokenStore: %s refresh already in progress — reusing", kind);
    logger.info(
      { ts: Date.now(), kind, outcome: "reused_in_flight_promise" },
      "[SCHWAB_TOKEN] refresh attempt",
    );
    return inFlight;
  }
  const p = doRefresh(kind);
  refreshInFlight.set(flightKey, p);
  try {
    return await p;
  } finally {
    refreshInFlight.delete(flightKey);
  }
}

function clearTimer(kind: "market" | "trader") {
  if (kind === "market" && marketTimer) { clearTimeout(marketTimer); marketTimer = null; }
  if (kind === "trader" && traderTimer) { clearTimeout(traderTimer); traderTimer = null; }
}

function scheduleRefreshWithDelay(kind: "market" | "trader", delayMs: number) {
  clearTimer(kind);
  const timer = setTimeout(() => {
    void refreshTokenSet(kind);
  }, delayMs);
  if (kind === "market") marketTimer = timer;
  else traderTimer = timer;
}

function scheduleRefresh(kind: "market" | "trader") {
  clearTimer(kind);

  const tokenSet = store[kind];
  if (!tokenSet?.expiresAt) return;

  const otherKind = kind === "market" ? "trader" : "market";
  const other = store[otherKind];
  if (
    kind === "trader" &&
    other?.refreshToken &&
    other.refreshToken === tokenSet.refreshToken
  ) {
    return;
  }

  const delay = Math.max(tokenSet.expiresAt - Date.now() - REFRESH_BUFFER_MS, 10_000);

  logger.info("TokenStore: scheduling %s refresh in %ds", kind, Math.round(delay / 1000));

  const timer = setTimeout(() => {
    void refreshTokenSet(kind);
  }, delay);

  if (kind === "market") marketTimer = timer;
  else traderTimer = timer;
}

export function setTokenRefreshCallback(cb: (kind: "market" | "trader", accessToken: string) => void) {
  onTokenRefreshed = cb;
}

export function storeTokens(
  kind: "market" | "trader",
  accessToken: string,
  refreshToken: string,
  expiresIn: number = 1800
) {
  const prevGen = store[kind]?.generation ?? 0;
  store[kind] = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    generation: prevGen + 1,
  };
  persistKind(kind);
  scheduleRefresh(kind);
  markAuthEstablished(kind);
  logger.info("TokenStore: stored %s tokens (expires in %ds)", kind, expiresIn);

  if (onTokenRefreshed) {
    onTokenRefreshed(kind, accessToken);
  }
}

export function getTokens(kind: "market" | "trader"): StoredTokenSet | undefined {
  return store[kind];
}

export function getAccessToken(kind: "market" | "trader"): string | null {
  return store[kind]?.accessToken ?? null;
}

export function getValidAccessToken(kind: "market" | "trader"): string | null {
  const ts = store[kind];
  if (!ts?.accessToken) return null;
  if (ts.expiresAt && Date.now() >= ts.expiresAt) return null;
  return ts.accessToken;
}

export function getBestAccessToken(): string | null {
  return getValidAccessToken("market") ?? getValidAccessToken("trader") ?? getAccessToken("market") ?? getAccessToken("trader");
}

export function getRefreshToken(kind: "market" | "trader"): string | null {
  return store[kind]?.refreshToken ?? null;
}

export function clearTokens(kind: "market" | "trader") {
  clearTimer(kind);
  store[kind] = undefined;
  persistKind(kind);
  authEstablishedInProcess[kind] = false;
  logger.info("TokenStore: cleared %s tokens", kind);
}

export function hasValidTokens(kind: "market" | "trader"): boolean {
  const ts = store[kind];
  if (!ts?.accessToken || !ts?.refreshToken) return false;
  return true;
}

export async function initTokenStore() {
  const dbStore = await loadFromDb();
  const diskStore = loadFromDisk();
  store = {
    ...diskStore,
    ...dbStore,
  };
  if (dbStore.market || dbStore.trader) {
    logger.info({
      market: !!dbStore.market,
      trader: !!dbStore.trader,
    }, "TokenStore: loaded persisted tokens from DB");
  }

  if (store.market?.refreshToken) {
    logger.info("TokenStore: found persisted market tokens");
    markAuthEstablished("market");
    const isExpired = store.market.expiresAt < Date.now();
    if (isExpired) {
      logger.info("TokenStore: market access token expired, refreshing now");
      await refreshTokenSet("market");
    } else {
      scheduleRefresh("market");
    }
  }

  if (store.trader?.refreshToken) {
    const linkedToMarket =
      store.market?.refreshToken != null &&
      store.trader.refreshToken === store.market.refreshToken;
    logger.info("TokenStore: found persisted trader tokens");
    markAuthEstablished("trader");
    const isExpired = store.trader.expiresAt < Date.now();
    if (isExpired && !linkedToMarket) {
      logger.info("TokenStore: trader access token expired, refreshing now");
      await refreshTokenSet("trader");
    } else if (!linkedToMarket) {
      scheduleRefresh("trader");
    }
  }
}

export async function forceRefresh(kind: "market" | "trader"): Promise<boolean> {
  return refreshTokenSet(kind);
}
