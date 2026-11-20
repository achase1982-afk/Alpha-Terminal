import { useCallback, useEffect, useState } from "react";
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
const STATUS_POLL_MS = 2_500;
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
  const refreshAccounts = useSchwabAccountStore((s) => s.refreshAccounts);

  const fetchStatus = useCallback(async (): Promise<WebullStatus | null> => {
    try {
      const res = await webullRequest("/api/auth/webull/status");
      if (!res.ok) return null;
      const next = (await res.json()) as WebullStatus;
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
    if (status && status.status !== "PENDING") {
      setIsConnecting(false);
    }
  }, [status?.status]);

  // A created token remains PENDING until the user approves Webull's 2FA
  // prompt. Keep the button in its active state and poll through that window
  // instead of snapping back to an apparently inert "Connect Webull" button.
  useEffect(() => {
    if (status?.status !== "PENDING") return;

    setIsConnecting(true);
    let cancelled = false;
    let timer: number | null = null;
    const deadline = Math.min(
      status.expiresAt ?? Date.now() + APPROVAL_WINDOW_MS,
      Date.now() + APPROVAL_WINDOW_MS,
    );

    const poll = async () => {
      const next = await fetchStatus();
      if (cancelled) return;
      if (next?.connected) {
        setIsConnecting(false);
        return;
      }
      if (
        next?.status === "EXPIRED" ||
        next?.status === "INVALID" ||
        Date.now() >= deadline
      ) {
        setIsConnecting(false);
        return;
      }
      timer = window.setTimeout(poll, STATUS_POLL_MS);
    };

    timer = window.setTimeout(poll, STATUS_POLL_MS);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [fetchStatus, status?.expiresAt, status?.status]);

  const connect = useCallback(async () => {
    if (isConnecting) return null;
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
      } else if (next.status !== "PENDING") {
        setIsConnecting(false);
      }
      return data;
    } catch {
      setIsConnecting(false);
      return null;
    }
  }, [isConnecting, refreshAccounts]);

  return {
    connect,
    fetchStatus,
    isConnecting,
    isConnected: status?.connected === true,
  };
}