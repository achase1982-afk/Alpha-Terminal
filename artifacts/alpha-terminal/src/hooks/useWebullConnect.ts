import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";

export interface WebullStatus {
  configured: boolean;
  connected: boolean;
  status: string;
  expiresAt?: number;
}

const REQUEST_TIMEOUT_MS = 15_000;
const CLERK_TOKEN_TIMEOUT_MS = 3_000;
const STATUS_POLL_MS = 10_000;
const APPROVAL_WINDOW_MS = 5 * 60 * 1000;

async function webullRequest(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetchWithAuth(path, {
      ...init,
      signal: controller.signal,
      clerkTokenTimeoutMs: CLERK_TOKEN_TIMEOUT_MS,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

export function useWebullConnect() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [status, setStatus] = useState<WebullStatus | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const refreshAccounts = useSchwabAccountStore((s) => s.refreshAccounts);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (mountedRef.current) setIsConnecting(false);
  }, []);

  const fetchStatus = useCallback(async (): Promise<WebullStatus | null> => {
    try {
      const res = await webullRequest("/api/auth/webull/status");
      if (!res.ok) return null;
      const next = (await res.json()) as WebullStatus;
      if (!mountedRef.current) return next;
      setStatus(next);
      if (next.connected) await refreshAccounts(true);
      return next;
    } catch {
      return null;
    }
  }, [refreshAccounts]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current != null) {
        window.clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);

  const startPolling = useCallback(
    (expiresAt?: number) => {
      if (pollTimerRef.current != null) {
        window.clearTimeout(pollTimerRef.current);
      }
      const deadline = Math.min(
        expiresAt ?? Date.now() + APPROVAL_WINDOW_MS,
        Date.now() + APPROVAL_WINDOW_MS,
      );

      const poll = async () => {
        const next = await fetchStatus();
        if (!mountedRef.current) return;
        if (
          next?.connected ||
          next?.status === "EXPIRED" ||
          next?.status === "INVALID" ||
          Date.now() >= deadline
        ) {
          stopPolling();
          return;
        }
        pollTimerRef.current = window.setTimeout(poll, STATUS_POLL_MS);
      };

      pollTimerRef.current = window.setTimeout(poll, STATUS_POLL_MS);
    },
    [fetchStatus, stopPolling],
  );

  const connect = useCallback(async () => {
    if (isConnecting) return null;
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setIsConnecting(true);
    try {
      const res = await webullRequest("/api/auth/webull/connect", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        expiresAt?: number;
      };
      if (!res.ok || !data.status) {
        setIsConnecting(false);
        return data;
      }
      if (!mountedRef.current) return data;
      const next: WebullStatus = {
        configured: true,
        connected: data.status === "NORMAL",
        status: data.status,
        expiresAt: data.expiresAt,
      };
      setStatus(next);
      if (next.connected) {
        await refreshAccounts(true);
        setIsConnecting(false);
      } else if (next.status === "PENDING") {
        startPolling(next.expiresAt);
      } else {
        setIsConnecting(false);
      }
      return data;
    } catch {
      setIsConnecting(false);
      return null;
    }
  }, [isConnecting, refreshAccounts, startPolling]);

  return {
    connect,
    fetchStatus,
    isConnecting,
    isConnected: status?.connected === true,
    status: status?.status ?? "NONE",
  };
}