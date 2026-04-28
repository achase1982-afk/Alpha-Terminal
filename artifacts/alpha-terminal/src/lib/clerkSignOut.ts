/**
 * Client-only `signOut` (even with `redirectUrl`) can leave a SPA on the
 * `SignedIn` tree in PWA/standalone or embedded WebViews — session is gone but
 * React does not remount. After `signOut` finishes, force a full load of the
 * app origin so `SignedOut` + SignIn show reliably.
 */
function signOutTargetUrl(): string {
  const path = import.meta.env.BASE_URL || "/";
  const u = new URL(path, window.location.origin);
  u.searchParams.set("_clerk_signout", String(Date.now()));
  return u.href;
}

type ClerkSignOut = (opts?: { redirectUrl?: string | null }) => Promise<unknown>;

/**
 * Do not `await` Clerk's `signOut` — it waits on network IO and causes a
 * noticeable ~0.5–1s delay before `location.replace`. Firing sign-out and
 * navigating in the same turn keeps the handoff feeling instant; the new
 * document load still lands on `SignedOut` with a clean session.
 */
export function signOutWithFullNavigation(signOut: ClerkSignOut): void {
  if (import.meta.env.VITE_DEV_BYPASS_AUTH === "true") return;
  const target = signOutTargetUrl();
  try {
    void signOut({ redirectUrl: target });
  } catch {
    // ignore
  }
  window.location.replace(target);
}
