import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTerminalStore } from "@/lib/store";
import type { SpxKeepawayStats } from "@workspace/order-ticket-math";

const POLL_MS = 60_000;

export function useSpxKeepawayStats(enabled: boolean): SpxKeepawayStats | null {
  const [stats, setStats] = useState<SpxKeepawayStats | null>(null);
  const accessToken = useTerminalStore((s) => s.accessToken ?? s.traderAccessToken);

  useEffect(() => {
    if (!enabled) {
      setStats(null);
      return;
    }
    if (!accessToken) {
      return;
    }
    let cancelled = false;
    const load = () => {
      void fetchWithAuth("/api/market/spx-keepaway-stats")
        .then((r) => (r.ok ? r.json() : { stats: null }))
        .then((j: { stats?: SpxKeepawayStats | null }) => {
          if (!cancelled) setStats(j.stats ?? null);
        })
        .catch(() => {
          if (!cancelled) setStats(null);
        });
    };
    load();
    const intervalId = window.setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled, accessToken]);

  return stats;
}