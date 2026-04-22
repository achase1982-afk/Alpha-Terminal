import { useState, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";

export function useBrokerConnect() {
  const accessToken = useTerminalStore((s) => s.accessToken);
  const [isNavigating, setIsNavigating] = useState(false);

  const connect = useCallback(async () => {
    setIsNavigating(true);
    const res = await fetch("/api/auth/trader-url", { credentials: "include" });
    const data = await res.json();
    if (!data?.url) return;
    window.location.href = data.url;
  }, []);

  void accessToken;

  return { connect, isNavigating };
}
