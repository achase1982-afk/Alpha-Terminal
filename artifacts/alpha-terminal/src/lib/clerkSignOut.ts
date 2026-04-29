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
 * **Await** `signOut` before `location.replace()`. Firing `void signOut()` and
 * navigating in the same synchronous turn can cancel the in-flight sign-out
 * (page unload) so the session cookie is never cleared — the UI stays on the
 * signed-in shell until a full app restart.
 *
 * Callers should use **`useAuth().signOut`**: it waits for `clerkLoaded` before
 * running sign out. `useClerk().signOut` can return immediately (queued only)
 * if Clerk is not ready yet, which also looked like a no-op.
 */
export async function signOutWithFullNavigation(signOut: ClerkSignOut): Promise<void> {
  if (import.meta.env.VITE_DEV_BYPASS_AUTH === "true") return;
  const target = signOutTargetUrl();
  try {
    await signOut({ redirectUrl: target });
  } catch {
    // Still try to show the sign-in surface.
  }
  window.location.replace(target);
}
