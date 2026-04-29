/**
 * Client-only `signOut` (even with `redirectUrl`) can leave a SPA on the
 * `SignedIn` tree in PWA/standalone or embedded WebViews — session is gone but
 * React does not remount. After `signOut` finishes, force a full load of the
 * app origin so `SignedOut` + SignIn show reliably.
 */

const TRANSITION_ID = "alpha-clerk-signout-transition";

/**
 * Synchronous, full-viewport screen so the first frame after tap is never the
 * idle app — enterprise UX: the user always sees the system working instantly.
 * Survives React unmounts (direct `document.body` node).
 */
export function showClerkSignOutTransition(): void {
  if (typeof document === "undefined" || import.meta.env.VITE_DEV_BYPASS_AUTH === "true") return;
  if (document.getElementById(TRANSITION_ID)) return;

  const el = document.createElement("div");
  el.id = TRANSITION_ID;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-busy", "true");
  el.style.cssText = [
    "box-sizing:border-box",
    "position:fixed",
    "inset:0",
    "z-index:2147483646",
    "background:#0a0a0a",
    "color:#e4e4e7",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "user-select:none",
    "-webkit-user-select:none",
  ].join(";");
  const inner = document.createElement("p");
  inner.textContent = "Signing out";
  inner.style.cssText = [
    "margin:0",
    "font-family:system-ui,Segoe UI,sans-serif",
    "font-size:11px",
    "font-weight:600",
    "letter-spacing:0.16em",
    "text-transform:uppercase",
    "color:rgba(255,255,255,0.9)",
  ].join(";");
  el.appendChild(inner);
  document.body.appendChild(el);
}

function signOutTargetUrl(): string {
  const path = import.meta.env.BASE_URL || "/";
  const u = new URL(path, window.location.origin);
  u.searchParams.set("_clerk_signout", String(Date.now()));
  return u.href;
}

export type ClerkSignOut = (opts?: { redirectUrl?: string }) => Promise<unknown>;

/**
 * 1) Show the transition **synchronously** (same event turn as the click) so
 *    there is no "dead" UI while Clerk revokes the session.
 * 2) **Await** `signOut` so navigation does not cancel the in-flight sign-out
 *    (session cookie not cleared, stuck signed in until app restart).
 * 3) Use **`useAuth().signOut`**: it waits for `clerkLoaded` before calling
 *    the real `signOut`; `useClerk().signOut` can queue a no-op if not ready.
 *
 * The only unavoidable gap is server round-trip time, but it is never silent:
 * the transition layer is on screen for that work.
 */
export async function signOutWithFullNavigation(signOut: ClerkSignOut): Promise<void> {
  if (import.meta.env.VITE_DEV_BYPASS_AUTH === "true") return;
  showClerkSignOutTransition();
  const target = signOutTargetUrl();
  try {
    await signOut({ redirectUrl: target });
  } catch {
    // Still navigate to the sign-in surface.
  }
  window.location.replace(target);
}
