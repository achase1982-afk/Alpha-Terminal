import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.js";

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

const refreshInFlight: Record<string, Promise<boolean> | null> = {
  market: null,
  trader: null,
};

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

function basicAuth(key: string, secret: string): string {
  return "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
}

async function doRefresh(
  kind: "market" | "trader",
  retryCount: number = 0
): Promise<boolean> {
  const tokenSet = store[kind];
  if (!tokenSet?.refreshToken) {
    logger.warn("TokenStore: no %s refresh token available", kind);
    return false;
  }

  const generationBefore = tokenSet.generation ?? 0;

  const isMarket = kind === "market";
  const appKey = process.env[isMarket ? "SCHWAB_APP_KEY" : "SCHWAB_TRADER_APP_KEY"];
  const appSecret = process.env[isMarket ? "SCHWAB_APP_SECRET" : "SCHWAB_TRADER_APP_SECRET"];

  if (!appKey || !appSecret) {
    logger.error("TokenStore: missing credentials for %s refresh", kind);
    return false;
  }

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", tokenSet.refreshToken);

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

      const currentGen = store[kind]?.generation ?? 0;
      if (currentGen > generationBefore) {
        logger.info("TokenStore: %s store was updated by another refresh — skipping clear", kind);
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
          store[kind] = undefined;
          saveToDisk();
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

    store[kind] = {
      accessToken: newAccess,
      refreshToken: newRefresh,
      expiresAt: Date.now() + expiresIn * 1000,
      generation: generationBefore + 1,
    };
    saveToDisk();

    logger.info("TokenStore: %s token refreshed, expires in %ds", kind, expiresIn);

    scheduleRefresh(kind);

    if (onTokenRefreshed) {
      onTokenRefreshed(kind, newAccess);
    }

    return true;
  } catch (err) {
    logger.error({ err }, "TokenStore: %s refresh network error", kind);
    if (retryCount < MAX_RETRIES) {
      logger.info("TokenStore: will retry %s refresh in %ds", kind, RETRY_DELAY_MS / 1000);
      scheduleRefreshWithDelay(kind, RETRY_DELAY_MS);
    }
    return false;
  }
}

async function refreshTokenSet(kind: "market" | "trader"): Promise<boolean> {
  if (refreshInFlight[kind]) {
    logger.info("TokenStore: %s refresh already in progress — reusing", kind);
    return refreshInFlight[kind]!;
  }
  const p = doRefresh(kind);
  refreshInFlight[kind] = p;
  try {
    return await p;
  } finally {
    refreshInFlight[kind] = null;
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
  saveToDisk();
  scheduleRefresh(kind);
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
  saveToDisk();
  logger.info("TokenStore: cleared %s tokens", kind);
}

export function hasValidTokens(kind: "market" | "trader"): boolean {
  const ts = store[kind];
  if (!ts?.accessToken || !ts?.refreshToken) return false;
  return true;
}

export async function initTokenStore() {
  store = loadFromDisk();

  if (store.market?.refreshToken) {
    logger.info("TokenStore: found persisted market tokens");
    const isExpired = store.market.expiresAt < Date.now();
    if (isExpired) {
      logger.info("TokenStore: market access token expired, refreshing now");
      await refreshTokenSet("market");
    } else {
      scheduleRefresh("market");
    }
  }

  if (store.trader?.refreshToken) {
    logger.info("TokenStore: found persisted trader tokens");
    const isExpired = store.trader.expiresAt < Date.now();
    if (isExpired) {
      logger.info("TokenStore: trader access token expired, refreshing now");
      await refreshTokenSet("trader");
    } else {
      scheduleRefresh("trader");
    }
  }
}

export async function forceRefresh(kind: "market" | "trader"): Promise<boolean> {
  return refreshTokenSet(kind);
}
