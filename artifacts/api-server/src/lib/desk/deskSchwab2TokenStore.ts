import { logger } from "../logger.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotAuthorized,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { deskSchwab2AppKey, deskSchwab2AppSecret, deskSchwab2Configured } from "./deskSchwab2OAuth.js";

const SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token";
const DB_KIND = "schwab2";
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const EXPIRING_SOON_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StoredTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  generation: number;
  refreshIssuedAt?: number;
  refreshExpiresAt?: number;
};

let tokenSet: StoredTokenSet | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let refreshFailureCount = 0;
let tokensDead = false;
let dbReady = false;

function basicAuth(key: string, secret: string): string {
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

async function ensureDb(): Promise<boolean> {
  if (dbReady) return true;
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
    await db.execute(sql`
      alter table schwab_tokens add column if not exists refresh_issued_at bigint
    `);
    await db.execute(sql`
      alter table schwab_tokens add column if not exists refresh_expires_at bigint
    `);
    dbReady = true;
    return true;
  } catch (err) {
    logger.warn({ err }, "Schwab2TokenStore: DB unavailable");
    return false;
  }
}

async function loadFromDb(): Promise<StoredTokenSet | undefined> {
  if (!(await ensureDb())) return undefined;
  try {
    const { db, sql } = await import("@workspace/db");
    const result = await db.execute(sql`
      select access_token, refresh_token, expires_at, generation, refresh_issued_at, refresh_expires_at
      from schwab_tokens where kind = ${DB_KIND}
    `);
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    const row = rows[0];
    if (!row) return undefined;
    const accessToken = typeof row.access_token === "string" ? row.access_token : "";
    const refreshToken = typeof row.refresh_token === "string" ? row.refresh_token : "";
    const expiresAt = Number(row.expires_at);
    if (!accessToken || !refreshToken || !Number.isFinite(expiresAt)) return undefined;
    return {
      accessToken,
      refreshToken,
      expiresAt,
      generation: Number(row.generation ?? 0),
      ...(Number(row.refresh_issued_at) > 0 ? { refreshIssuedAt: Number(row.refresh_issued_at) } : {}),
      ...(Number(row.refresh_expires_at) > 0 ? { refreshExpiresAt: Number(row.refresh_expires_at) } : {}),
    };
  } catch (err) {
    logger.warn({ err }, "Schwab2TokenStore: load failed");
    return undefined;
  }
}

async function persistToDb(): Promise<void> {
  if (!(await ensureDb())) return;
  try {
    const { db, sql } = await import("@workspace/db");
    if (!tokenSet) {
      await db.execute(sql`delete from schwab_tokens where kind = ${DB_KIND}`);
      return;
    }
    await db.execute(sql`
      insert into schwab_tokens (kind, access_token, refresh_token, expires_at, generation, refresh_issued_at, refresh_expires_at, updated_at)
      values (${DB_KIND}, ${tokenSet.accessToken}, ${tokenSet.refreshToken}, ${tokenSet.expiresAt}, ${tokenSet.generation}, ${tokenSet.refreshIssuedAt ?? null}, ${tokenSet.refreshExpiresAt ?? null}, now())
      on conflict (kind) do update set
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        generation = excluded.generation,
        refresh_issued_at = excluded.refresh_issued_at,
        refresh_expires_at = excluded.refresh_expires_at,
        updated_at = now()
    `);
  } catch (err) {
    logger.error({ err }, "Schwab2TokenStore: persist failed");
  }
}

function backoffDelayMs(attempt: number): number {
  const exp = Math.min(5_000 * 2 ** Math.min(Math.max(attempt, 0), 6), MAX_BACKOFF_MS);
  return exp + Math.floor(Math.random() * 1_000);
}

function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleRefresh(): void {
  clearRefreshTimer();
  if (!tokenSet?.expiresAt) return;
  const delay = Math.max(tokenSet.expiresAt - Date.now() - REFRESH_BUFFER_MS, 10_000);
  refreshTimer = setTimeout(() => {
    void refreshSchwab2AccessToken();
  }, delay);
  refreshTimer.unref?.();
}

function syncSchwab2HealthFromTokens(): void {
  if (!deskSchwab2Configured()) return;
  if (!tokenSet?.refreshToken) {
    deskMarkFeedNotAuthorized("schwab2_rest", "schwab2_oauth_required", "schwab_rest_2");
    return;
  }
  if (tokenSet.expiresAt > Date.now()) {
    deskTouchFeed("schwab2_rest", Date.now(), "schwab_rest_2");
  }
}

function responseLooksLikeDeadGrant(status: number, body: string): boolean {
  if (status !== 400 && status !== 401) return false;
  return /invalid_grant|expired|refresh token/i.test(body);
}

async function markSchwab2TokensDead(reason: string): Promise<void> {
  tokensDead = true;
  refreshFailureCount = 0;
  tokenSet = undefined;
  clearRefreshTimer();
  await persistToDb();
  deskMarkFeedAuthError("schwab2_rest", reason, "schwab_rest_2");
  logger.warn({ reason }, "Schwab2TokenStore: tokens cleared (dead refresh grant)");
}

async function doRefresh(retryCount: number): Promise<boolean> {
  if (tokensDead || !tokenSet?.refreshToken) return false;

  const appKey = deskSchwab2AppKey();
  const appSecret = deskSchwab2AppSecret();
  if (!appKey || !appSecret) return false;

  const generationBefore = tokenSet.generation;

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", tokenSet.refreshToken);

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
      logger.error({ status: res.status, body: text.slice(0, 300) }, "Schwab2TokenStore: refresh failed");
      if (responseLooksLikeDeadGrant(res.status, text)) {
        await markSchwab2TokensDead(`refresh_http_${res.status}_invalid_grant`);
        return false;
      }
      if (res.status >= 500) {
        deskMarkFeedError("schwab2_rest", `refresh_upstream_${res.status}`, "schwab_rest_2");
      } else {
        deskMarkFeedAuthError("schwab2_rest", `refresh_http_${res.status}`, "schwab_rest_2");
      }
      const retriable =
        generationBefore === (tokenSet?.generation ?? 0) &&
        (res.status === 400 || res.status === 401 || res.status >= 500);
      if (retriable) {
        refreshFailureCount = retryCount + 1;
        const delay = backoffDelayMs(retryCount);
        clearRefreshTimer();
        refreshTimer = setTimeout(() => {
          void refreshSchwab2AccessToken();
        }, delay);
        refreshTimer.unref?.();
      }
      return false;
    }

    const data = JSON.parse(text) as Record<string, unknown>;
    const newAccess = data["access_token"] as string;
    const expiresIn = (data["expires_in"] as number) ?? 1800;
    const newRefresh =
      typeof data["refresh_token"] === "string" && data["refresh_token"]
        ? data["refresh_token"]
        : tokenSet.refreshToken;

    tokenSet = {
      accessToken: newAccess,
      refreshToken: newRefresh,
      expiresAt: Date.now() + expiresIn * 1000,
      generation: generationBefore + 1,
      refreshIssuedAt: tokenSet.refreshIssuedAt,
      refreshExpiresAt: tokenSet.refreshExpiresAt,
    };
    await persistToDb();
    refreshFailureCount = 0;
    tokensDead = false;
    scheduleRefresh();
    syncSchwab2HealthFromTokens();
    return true;
  } catch (err) {
    logger.error({ err }, "Schwab2TokenStore: refresh network error");
    refreshFailureCount = retryCount + 1;
    const delay = backoffDelayMs(retryCount);
    clearRefreshTimer();
    refreshTimer = setTimeout(() => {
      void refreshSchwab2AccessToken();
    }, delay);
    refreshTimer.unref?.();
    return false;
  }
}

export async function refreshSchwab2AccessToken(): Promise<boolean> {
  if (tokensDead) return false;
  if (refreshInFlight) return refreshInFlight;
  const attempt = refreshFailureCount;
  refreshInFlight = doRefresh(attempt);
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function initSchwab2TokenStore(): Promise<void> {
  if (!deskSchwab2Configured()) return;
  tokenSet = await loadFromDb();
  if (!tokenSet?.refreshToken) {
    deskMarkFeedNotAuthorized("schwab2_rest", "schwab2_oauth_required", "schwab_rest_2");
    return;
  }
  const expiring = tokenSet.expiresAt - Date.now() <= EXPIRING_SOON_MS;
  if (expiring) {
    await refreshSchwab2AccessToken();
  } else {
    scheduleRefresh();
    syncSchwab2HealthFromTokens();
  }
}

export async function storeSchwab2Tokens(
  accessToken: string,
  refreshToken: string,
  expiresIn = 1800,
  opts?: { newGrant?: boolean },
): Promise<void> {
  tokensDead = false;
  refreshFailureCount = 0;
  const now = Date.now();
  const prevGen = tokenSet?.generation ?? 0;
  tokenSet = {
    accessToken,
    refreshToken,
    expiresAt: now + expiresIn * 1000,
    generation: prevGen + 1,
    refreshIssuedAt: opts?.newGrant ? now : tokenSet?.refreshIssuedAt,
    refreshExpiresAt: opts?.newGrant ? now + REFRESH_TOKEN_TTL_MS : tokenSet?.refreshExpiresAt,
  };
  await persistToDb();
  scheduleRefresh();
  syncSchwab2HealthFromTokens();
  logger.info("Schwab2TokenStore: stored tokens (expires in %ds)", expiresIn);
}

export function isSchwab2TokenStoreDead(): boolean {
  return tokensDead;
}

export function hasSchwab2Tokens(): boolean {
  return !tokensDead && Boolean(tokenSet?.accessToken && tokenSet.refreshToken);
}

export function getSchwab2AccessToken(): string | null {
  return tokenSet?.accessToken ?? null;
}

export async function getSchwab2ValidAccessToken(): Promise<string | null> {
  if (!tokenSet?.accessToken) return null;
  if (tokenSet.expiresAt - Date.now() <= EXPIRING_SOON_MS) {
    const ok = await refreshSchwab2AccessToken();
    if (!ok) return null;
  }
  return tokenSet?.accessToken ?? null;
}

export function resetSchwab2TokenStoreForTests(): void {
  tokenSet = undefined;
  tokensDead = false;
  refreshFailureCount = 0;
  clearRefreshTimer();
  refreshInFlight = null;
}

export type Schwab2TokenMeta = {
  has_tokens: boolean;
  access_token_expires_at: number | null;
  refresh_token_expires_at: number | null;
  refresh_token_issued_at: number | null;
};

export function getSchwab2TokenMeta(): Schwab2TokenMeta {
  if (!tokenSet?.refreshToken) {
    return {
      has_tokens: false,
      access_token_expires_at: null,
      refresh_token_expires_at: null,
      refresh_token_issued_at: null,
    };
  }
  return {
    has_tokens: true,
    access_token_expires_at: tokenSet.expiresAt ?? null,
    refresh_token_expires_at: tokenSet.refreshExpiresAt ?? null,
    refresh_token_issued_at: tokenSet.refreshIssuedAt ?? null,
  };
}
