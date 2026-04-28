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

export async function signOutWithFullNavigation(signOut: ClerkSignOut): Promise<void> {
  if (import.meta.env.VITE_DEV_BYPASS_AUTH === "true") return;
  const target = signOutTargetUrl();
  try {
    await signOut({ redirectUrl: target });
  } catch {
    // Clear session if possible, then still hard-navigate
  }
  window.location.replace(target);
}
