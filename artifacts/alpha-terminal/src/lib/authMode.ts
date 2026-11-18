/** Clerk login wall off — honors `VITE_AUTH_DISABLED` and legacy `VITE_DEV_BYPASS_AUTH`. */
export function isAuthDisabled(): boolean {
  const v = import.meta.env.VITE_AUTH_DISABLED;
  if (v === "1" || v === "true") return true;
  return import.meta.env.VITE_DEV_BYPASS_AUTH === "true";
}