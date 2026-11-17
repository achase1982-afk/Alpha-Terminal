import crypto from "node:crypto";
import { getSchwabBrokerageRedirectUri, schwabBrokerageCallbackPath } from "./schwabOAuthRedirect.js";

const SCHWAB_AUTH_BASE = "https://api.schwabapi.com/v1/oauth/authorize";

export function deskSchwab2AppKey(): string {
  return process.env.SCHWAB_APP_KEY_2?.trim() ?? "";
}

export function deskSchwab2AppSecret(): string {
  return process.env.SCHWAB_APP_SECRET_2?.trim() ?? "";
}

export function deskSchwab2Configured(): boolean {
  return Boolean(deskSchwab2AppKey() && deskSchwab2AppSecret());
}

/** App 2 uses the same registered callback URL as app 1 (state distinguishes apps). */
export function getSchwab2RedirectUri(): string {
  return getSchwabBrokerageRedirectUri();
}

export function schwab2ExpectedCallbackPath(): string {
  return schwabBrokerageCallbackPath();
}

function stateSecret(): string {
  return deskSchwab2AppSecret() || process.env.SESSION_SECRET || "dev-schwab2-state-secret";
}

const STATE_TTL_MS = 30 * 60 * 1000;

export type Schwab2OAuthStateKind = "standalone" | "after_brokerage";

export function signSchwab2State(kind: Schwab2OAuthStateKind = "standalone"): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const ts = Date.now().toString(36);
  const prefix = kind === "after_brokerage" ? "schwab2b_" : "schwab2_";
  const payload = `${prefix}${nonce}.${ts}`;
  const mac = crypto.createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 32);
  return `${payload}.${mac}`;
}

export function verifySchwab2State(state: string | undefined): boolean {
  if (!state || typeof state !== "string") return false;
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [noncePart, ts, mac] = parts;
  if ((!noncePart?.startsWith("schwab2_") && !noncePart?.startsWith("schwab2b_")) || !ts || !mac) return false;
  const payload = `${noncePart}.${ts}`;
  const expected = crypto.createHmac("sha256", stateSecret()).update(payload).digest("hex").slice(0, 32);
  let macBuf: Buffer;
  let expBuf: Buffer;
  try {
    macBuf = Buffer.from(mac, "hex");
    expBuf = Buffer.from(expected, "hex");
  } catch {
    return false;
  }
  if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) return false;
  const issuedAt = parseInt(ts, 36);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > STATE_TTL_MS) return false;
  return true;
}

export function schwab2StateAfterBrokerage(state: string | undefined): boolean {
  if (!state) return false;
  return state.split(".")[0]?.startsWith("schwab2b_") ?? false;
}

export function buildSchwab2AuthorizeUrl(
  kind: Schwab2OAuthStateKind = "standalone",
): { url: string; redirectUri: string } | null {
  const appKey = deskSchwab2AppKey();
  const redirectUri = getSchwab2RedirectUri();
  if (!appKey || !redirectUri) return null;
  const state = signSchwab2State(kind);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: appKey,
    redirect_uri: redirectUri,
    state,
  });
  return { url: `${SCHWAB_AUTH_BASE}?${params.toString()}`, redirectUri };
}