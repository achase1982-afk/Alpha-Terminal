import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { SpxKeepawayStats } from "@workspace/order-ticket-math";

export function useSpxKeepawayStats(enabled: boolean): SpxKeepawayStats | null {
  const [stats, setStats] = useState<SpxKeepawayStats | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStats(null);
      return;
    }
    let cancelled = false;
    void fetchWithAuth("/api/market/spx-keepaway-stats")
      .then((r) => (r.ok ? r.json() : { stats: null }))
      .then((j: { stats?: SpxKeepawayStats | null }) => {
        if (!cancelled) setStats(j.stats ?? null);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return stats;
}