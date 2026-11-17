const isProd = process.env.NODE_ENV === "production";

/** Production default when env redirect vars are unset (matches Schwab portal registration). */
export const SCHWAB_PRODUCTION_TRADER_CALLBACK =
  "https://alpha-terminal-production-f297.up.railway.app/api/auth/trader-callback";

/** Brokerage (app 1) and app 2 share one Schwab redirect URI. */
export function getSchwabBrokerageRedirectUri(): string {
  const dev = process.env.SCHWAB_TRADER_REDIRECT_URI?.trim() ?? "";
  const prod = process.env.SCHWAB_TRADER_REDIRECT_URI_PROD?.trim() ?? "";
  if (isProd) return prod || dev || SCHWAB_PRODUCTION_TRADER_CALLBACK;
  return dev || prod || SCHWAB_PRODUCTION_TRADER_CALLBACK;
}

export function schwabBrokerageCallbackPath(): string {
  return "/api/auth/trader-callback";
}