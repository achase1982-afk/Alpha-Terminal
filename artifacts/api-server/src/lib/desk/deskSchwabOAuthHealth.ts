import { getTokens, hasValidTokens } from "../tokenStore.js";
import { deskSchwab2Configured } from "./deskSchwab2OAuth.js";
import { getSchwab2TokenMeta } from "./deskSchwab2TokenStore.js";

export type DeskSchwabOAuthHealth = {
  app1: {
    connected: boolean;
    access_token_expires_at: number | null;
    refresh_token_issued_at: number | null;
    refresh_token_expires_at: number | null;
  };
  app2: {
    configured: boolean;
    connected: boolean;
    access_token_expires_at: number | null;
    refresh_token_issued_at: number | null;
    refresh_token_expires_at: number | null;
  };
};

export function buildDeskSchwabOAuthHealth(): DeskSchwabOAuthHealth {
  const mkt = hasValidTokens("market") ? getTokens("market") : undefined;
  const trd = hasValidTokens("trader") ? getTokens("trader") : undefined;
  const anchor = trd ?? mkt;
  const schwab2 = getSchwab2TokenMeta();
  return {
    app1: {
      connected: Boolean(anchor?.refreshToken),
      access_token_expires_at: anchor?.expiresAt ?? null,
      refresh_token_issued_at: anchor?.refreshIssuedAt ?? null,
      refresh_token_expires_at: anchor?.refreshExpiresAt ?? null,
    },
    app2: {
      configured: deskSchwab2Configured(),
      connected: schwab2.has_tokens,
      access_token_expires_at: schwab2.access_token_expires_at,
      refresh_token_issued_at: schwab2.refresh_token_issued_at,
      refresh_token_expires_at: schwab2.refresh_token_expires_at,
    },
  };
}
