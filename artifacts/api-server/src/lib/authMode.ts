/**
 * When true, Clerk session auth is off for the main `/api` app routes.
 * Honors `AUTH_DISABLED` (preferred) and legacy `DEV_BYPASS_AUTH`.
 */
export function isAuthDisabled(): boolean {
  const authDisabled = process.env.AUTH_DISABLED;
  if (authDisabled === "true" || authDisabled === "1") return true;
  return process.env.DEV_BYPASS_AUTH === "true";
}

/** Explicit opt-in: manual Schwab orders while `AUTH_DISABLED` (reviewer / public URL). */
export function isOrdersAllowWithoutAuth(): boolean {
  const v = process.env.ORDERS_ALLOW_WITHOUT_AUTH;
  return v === "true" || v === "1";
}