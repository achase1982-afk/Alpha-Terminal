const isProd = process.env.NODE_ENV === "production";

/** Brokerage (app 1) redirect — also used for app 2 (same Schwab portal registration). */
export function getSchwabBrokerageRedirectUri(): string {
  const dev = process.env.SCHWAB_TRADER_REDIRECT_URI?.trim() ?? "";
  const prod = process.env.SCHWAB_TRADER_REDIRECT_URI_PROD?.trim() ?? "";
  if (isProd) return prod || dev;
  return dev || prod;
}

export function schwabBrokerageCallbackPath(): string {
  return "/api/auth/trader-callback";
}