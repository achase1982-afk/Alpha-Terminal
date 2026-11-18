import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTerminalStore } from "@/lib/store";
import type { SpxKeepawayStats } from "@workspace/order-ticket-math";

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
    const load = (attempt: number) => {
      void fetchWithAuth("/api/market/spx-keepaway-stats")
        .then((r) => (r.ok ? r.json() : { stats: null }))
        .then((j: { stats?: SpxKeepawayStats | null }) => {
          if (cancelled) return;
          const next = j.stats ?? null;
          setStats(next);
          if (next == null && attempt < 2) {
            window.setTimeout(() => load(attempt + 1), 1200);
          }
        })
        .catch(() => {
          if (!cancelled && attempt < 2) {
            window.setTimeout(() => load(attempt + 1), 1200);
          } else if (!cancelled) {
            setStats(null);
          }
        });
    };
    load(0);
    return () => {
      cancelled = true;
    };
  }, [enabled, accessToken]);

  return stats;
}