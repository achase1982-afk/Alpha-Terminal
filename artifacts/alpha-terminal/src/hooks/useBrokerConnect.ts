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
      setTimeout(() => {
        window.location.href = url;
      }, 120);
    } catch {
      // silently reset on failure
    } finally {
      setTimeout(() => setIsNavigating(false), 120);
    }
  }, [authUrlData, refetchAuthUrl]);

  return { connect, isNavigating };
}
