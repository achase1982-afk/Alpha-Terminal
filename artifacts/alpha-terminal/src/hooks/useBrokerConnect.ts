import { useState, useCallback } from "react";
import { useGetAuthUrl } from "@workspace/api-client-react";
import { useTerminalStore } from "@/lib/store";

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
      if (!url) return;

      // Open Schwab OAuth in a *new* tab/window instead of a top-level
      // navigation on this tab. Two reasons:
      //   1) iOS in-app browsers (Slack, Messages, SFSafariViewController,
      //      etc.) routinely evict/partition cookies and storage when this
      //      tab navigates off-domain to schwab.com, which destroys the
      //      Clerk session and bounces the user back to the login screen
      //      after Schwab redirects them back — the "Schwab → login loop".
      //      Keeping this tab parked at the SPA preserves the Clerk session.
      //   2) When the user returns to this tab, PendingSessionLoader
      //      already re-polls /api/auth/server-tokens on `visibilitychange`,
      //      so the link completes automatically without a re-sign-in.
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        // Pop-up blocked (rare on a direct user click, but possible in some
        // in-app browsers). Fall back to the legacy same-tab navigation so
        // the user can still complete linking — the schwab_linked banner +
        // server-side token persistence will catch them on the way back.
        window.location.href = url;
      }
    } catch {
      // silently reset on failure
    } finally {
      setTimeout(() => setIsNavigating(false), 120);
    }
  }, [authUrlData, refetchAuthUrl]);

  return { connect, isNavigating };
}
