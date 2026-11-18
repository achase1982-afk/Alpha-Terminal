/**
 * When true, Clerk session auth is off for the main `/api` app routes.
 * Honors `AUTH_DISABLED` (preferred) and legacy `DEV_BYPASS_AUTH`.
 */
export function isAuthDisabled(): boolean {
  const authDisabled = process.env.AUTH_DISABLED;
  if (authDisabled === "true" || authDisabled === "1") return true;
  return process.env.DEV_BYPASS_AUTH === "true";
}