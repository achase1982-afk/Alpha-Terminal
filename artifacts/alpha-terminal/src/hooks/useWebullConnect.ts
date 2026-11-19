import { useCallback, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";

export interface WebullStatus {
  configured: boolean;
  connected: boolean;
  status: string;
}

export function useWebullConnect() {
  const [isConnecting, setIsConnecting] = useState(false);
  const refreshAccounts = useSchwabAccountStore((s) => s.refreshAccounts);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const res = await fetchWithAuth("/api/auth/webull/connect", { method: "POST" });
      const data = (await res.json()) as { status?: string };
      if (res.ok && data.status) {
        await refreshAccounts();
      }
      return data;
    } finally {
      setIsConnecting(false);
    }
  }, [refreshAccounts]);

  const fetchStatus = useCallback(async (): Promise<WebullStatus> => {
    const res = await fetchWithAuth("/api/auth/webull/status");
    if (!res.ok) {
      return { configured: false, connected: false, status: "NONE" };
    }
    return (await res.json()) as WebullStatus;
  }, []);

  return { connect, fetchStatus, isConnecting };
}