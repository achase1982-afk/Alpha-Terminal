import { useState, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";

export function useBrokerConnect() {
  const accessToken = useTerminalStore((s) => s.accessToken);
  const [isNavigating, setIsNavigating] = useState(false);

  const connect = useCallback(() => {
    setIsNavigating(true);
    window.location.href = "/api/auth/schwab";
  }, []);

  void accessToken;

  return { connect, isNavigating };
}
