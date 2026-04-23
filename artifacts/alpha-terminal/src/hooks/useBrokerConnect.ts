import { useState, useCallback, useEffect, useRef } from "react";
import { useTerminalStore } from "@/lib/store";

const NAVIGATION_TIMEOUT_MS = 90_000;

export function useBrokerConnect() {
  const accessToken = useTerminalStore((s) => s.accessToken);
  const traderAccessToken = useTerminalStore((s) => s.traderAccessToken);
  const [isNavigating, setIsNavigating] = useState(false);
  const oauthWindowRef = useRef<Window | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    setIsNavigating(false);
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    try { oauthWindowRef.current?.close(); } catch {}
    oauthWindowRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    setIsNavigating(true);
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setIsNavigating(false);
      oauthWindowRef.current = null;
      timeoutRef.current = null;
    }, NAVIGATION_TIMEOUT_MS);

    // Open the popup SYNCHRONOUSLY inside the click handler so iOS/desktop
    // popup blockers treat it as user-initiated. We point at about:blank
    // first, then redirect once we've fetched the OAuth URL. If the open
    // call is blocked, w === null and we fall back to same-tab navigation.
    const w = window.open("about:blank", "_blank", "noopener=no,noreferrer=no");
    oauthWindowRef.current = w;

    try {
      const res = await fetch("/api/auth/trader-url", { credentials: "include" });
      const data = await res.json();
      if (!data?.url) {
        try { w?.close(); } catch {}
        oauthWindowRef.current = null;
        setIsNavigating(false);
        if (timeoutRef.current != null) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        return;
      }
      if (w && !w.closed) {
        try { w.location.replace(data.url); } catch {
          window.location.href = data.url;
        }
      } else {
        // Popup was blocked — fall back to a full-page nav. The trader-callback
        // success page detects same-tab and redirects to "/" instead of trying
        // to call window.close().
        window.location.href = data.url;
      }
    } catch {
      try { w?.close(); } catch {}
      oauthWindowRef.current = null;
      setIsNavigating(false);
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, []);

  // Token arrived → tear everything down.
  useEffect(() => {
    if (!isNavigating) return;
    if (accessToken || traderAccessToken) reset();
  }, [isNavigating, accessToken, traderAccessToken, reset]);

  // PWA returned to foreground → if the OAuth popup is now closed and no
  // token arrived (e.g. user dismissed without finishing), reset state so
  // the button becomes tappable again.
  useEffect(() => {
    if (!isNavigating) return;
    const onVisible = () => {
      if (document.hidden) return;
      window.setTimeout(() => {
        if (oauthWindowRef.current?.closed) {
          setIsNavigating(false);
          oauthWindowRef.current = null;
          if (timeoutRef.current != null) {
            window.clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        }
      }, 1500);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [isNavigating]);

  // Tear down on unmount.
  useEffect(() => () => {
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
  }, []);

  return { connect, isNavigating };
}
