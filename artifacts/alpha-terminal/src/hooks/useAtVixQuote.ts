import { useEffect, useState } from "react";
import { useQuote } from "@/hooks/useQuote";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

type RestQuote = {
  last?: number | null;
  lastPrice?: number | null;
  bid?: number | null;
  ask?: number | null;
};

/** SPX header VIX: Schwab stream first, REST quote (incl. Tradier-backed desk) when stream is quiet. */
export function useAtVixQuote(enabled: boolean): number | null {
  const { data: stream } = useQuote("$VIX");
  const streamLast = stream?.last ?? stream?.regularLast ?? null;
  const [fallback, setFallback] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (streamLast != null && Number.isFinite(streamLast)) {
      setFallback(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        let res = await fetchWithAuth("/api/market/quote?symbol=%24VIX", { clerkTokenTimeoutMs: 2_500 });
        if (!res.ok) res = await fetch("/api/market/quote?symbol=%24VIX");
        if (!res.ok) return;
        const j = (await res.json()) as RestQuote;
        const last = j.last ?? j.lastPrice ?? null;
        if (!cancelled && last != null && Number.isFinite(last)) setFallback(last);
      } catch {
        /* ignore */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled, streamLast]);

  return streamLast ?? fallback;
}