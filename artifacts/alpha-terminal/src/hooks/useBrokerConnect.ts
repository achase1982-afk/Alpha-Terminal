import { useState, useCallback, useEffect, useRef } from "react";
import { useTerminalStore } from "@/lib/store";

const NAVIGATION_TIMEOUT_MS = 90_000;
const RETURN_RESET_DELAY_MS = 4_000;

/**
 * Pre-fetches the Schwab OAuth URL so the connect button can be rendered as a
 * real `<a target="_blank" href={url}>`. iOS PWAs in standalone mode treat
 * that as the canonical "open external link" gesture and present the page in
 * an in-app browser overlay (real Safari engine) instead of unloading the PWA.
 *
 * Why not `window.open(...)` from a click handler?
 *   In iOS PWA standalone mode, `window.open("about:blank", "_blank")`
 *   returns null (treated as a popup), which forces a full-page same-tab
 *   navigation and destroys the PWA's mounted state, safe-area insets, and
 *   layout. The pre-fetched-URL + real-anchor approach keeps the PWA mounted
 *   underneath the overlay and lets `traderSuccessPage` self-close cleanly.
 *
 * The OAuth URL contains a server-signed state with a TTL, so we refetch
 * whenever the PWA becomes visible again (cheap, idempotent).
 */
export function useBrokerConnect() {
  const accessToken = useTerminalStore((s) => s.accessToken);
  const traderAccessToken = useTerminalStore((s) => s.traderAccessToken);
  const [oauthUrl, setOauthUrl] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const fetchInFlightRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  const refreshUrl = useCallback(async () => {
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    try {
      const res = await fetch("/api/auth/trader-url", { credentials: "include" });
      const data = await res.json();
      if (data?.url) setOauthUrl(data.url);
    } catch {
      /* leave previous url in place */
    } finally {
      fetchInFlightRef.current = false;
    }
  }, []);

  // Prefetch on mount.
  useEffect(() => {
    refreshUrl();
  }, [refreshUrl]);

  // Refresh URL whenever PWA becomes visible — state TTL may have expired
  // while the user was elsewhere.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) refreshUrl();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshUrl]);

  /** Call from the anchor's onClick to flip the loading state. Do NOT
   * preventDefault — the browser must follow the href to open the in-app
   * browser overlay. */
  const onClick = useCallback(() => {
    setIsNavigating(true);
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setIsNavigating(false);
      timeoutRef.current = null;
    }, NAVIGATION_TIMEOUT_MS);
  }, []);

  // Token arrived → tear down loading state and refresh the URL for next time.
  useEffect(() => {
    if (!isNavigating) return;
    if (accessToken || traderAccessToken) {
      setIsNavigating(false);
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      refreshUrl();
    }
  }, [isNavigating, accessToken, traderAccessToken, refreshUrl]);

  // PWA returned to foreground → clear loading state shortly after.
  // PendingSessionLoader has a parallel visibilitychange handler that pulls
  // the token from /trader-pending-session; the token effect above will then
  // tear this down faster. The 4s fallback covers the case where the user
  // dismissed the overlay without finishing.
  useEffect(() => {
    if (!isNavigating) return;
    const onVisible = () => {
      if (document.hidden) return;
      window.setTimeout(() => {
        setIsNavigating(false);
        if (timeoutRef.current != null) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
      }, RETURN_RESET_DELAY_MS);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isNavigating]);

  // Cleanup on unmount.
  useEffect(
    () => () => {
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  return { oauthUrl, isNavigating, onClick };
}
