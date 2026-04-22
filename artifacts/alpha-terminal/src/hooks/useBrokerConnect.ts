import { useState, useCallback } from "react";
import { useGetAuthUrl } from "@workspace/api-client-react";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Hand the popup a hint cookie so the server-side callback knows to render
// the auto-close HTML (instead of redirecting). Scoped to /api/auth so it
// never leaks to other parts of the SPA.
function markPopupMode() {
  try {
    document.cookie = "schwab_oauth_mode=popup; Path=/api/auth; Max-Age=600; SameSite=Lax";
  } catch {
    // ignore cookie failures — server falls back to redirect path
  }
}

async function rehydrateFromServer() {
  const setTokens = useTerminalStore.getState().setTokens;
  const setTraderTokens = useTerminalStore.getState().setTraderTokens;
  try {
    const res = await fetchWithAuth("/api/auth/server-tokens");
    if (!res.ok) return;
    const data = (await res.json()) as {
      market?: { accessToken: string; refreshToken: string } | null;
      trader?: { accessToken: string; refreshToken: string } | null;
    };
    const tok = data.trader ?? data.market;
    if (tok?.accessToken) {
      setTokens(tok.accessToken, tok.refreshToken || "");
      setTraderTokens(tok.accessToken, tok.refreshToken || "");
    }
  } catch {
    // PendingSessionLoader's visibilitychange handler will retry.
  }
}

export function useBrokerConnect() {
  const accessToken = useTerminalStore((s) => s.accessToken);
  const { data: authUrlData, refetch: refetchAuthUrl } = useGetAuthUrl({
    query: { enabled: !accessToken },
  });
  const [isNavigating, setIsNavigating] = useState(false);

  const connect = useCallback(async () => {
    setIsNavigating(true);
    try {
      let url = authUrlData?.url || "";
      if (!url) {
        const result = await refetchAuthUrl();
        url = result.data?.url || "";
      }
      if (!url) {
        setIsNavigating(false);
        return;
      }

      // Open Schwab OAuth in a popup opened by THIS JavaScript context. On
      // iOS PWA the new window still lives in Safari (cross-origin nav can't
      // stay inside the PWA — Apple OS restriction), but because *we* opened
      // it via window.open, the success page is allowed to call
      // window.close() on it. That's the difference between the popup path
      // and a plain `location.href` navigation: with location.href, iOS
      // spawns a tab the PWA doesn't own and refuses to let any script
      // close it, leaving the user staring at a Clerk login page with no
      // way back.
      markPopupMode();
      const popup = window.open(
        url,
        "schwab-oauth",
        "width=600,height=800,menubar=no,toolbar=no,location=yes,status=no",
      );

      if (!popup) {
        // Popup blocker engaged — fall back to same-tab nav so the user
        // can still complete the link. This path will land back on the SPA
        // root after the callback redirects.
        window.location.href = url;
        return;
      }

      // Poll for popup closure, then pull the freshly-stored tokens from
      // the server so the UI flips to CONNECTED without waiting for the
      // visibilitychange poll.
      const pollMs = 500;
      const maxWaitMs = 5 * 60 * 1000;
      const startedAt = Date.now();
      const interval = window.setInterval(async () => {
        if (popup.closed) {
          window.clearInterval(interval);
          await rehydrateFromServer();
          setIsNavigating(false);
        } else if (Date.now() - startedAt > maxWaitMs) {
          window.clearInterval(interval);
          setIsNavigating(false);
        }
      }, pollMs);
    } catch {
      setIsNavigating(false);
    }
  }, [authUrlData, refetchAuthUrl]);

  return { connect, isNavigating };
}
