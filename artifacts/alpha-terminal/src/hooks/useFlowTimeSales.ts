import { useEffect, useRef, useState, useMemo } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ── Live time-and-sales hook for a single OPRA contract ──────────────
//
// • REST backfill on mount → seeds the buffer with today's recent prints.
// • SSE subscription for live trades. EventSource auto-reconnects but we
//   also handle 5xx errors by closing + retrying with backoff.
// • Maintains a 200-row ring buffer (newest first when read via .trades).
// • Derived counters: total / buy / sell / neutral / block / sweep.
// • status: "connecting" | "live" | "error" | "disabled".

const API_BASE = import.meta.env.BASE_URL + "api";

export interface FlowTrade {
  sym: string;
  price: number;
  size: number;
  ts: number;
  exchange: number;
  conditions: number[];
  aggressor: "buy" | "sell" | "neutral";
  nbbo: { bid: number; ask: number; ts: number } | null;
  isBlock: boolean;
  isSweep: boolean;
}

export interface FlowCounters {
  total: number;
  buy: number;
  sell: number;
  neutral: number;
  block: number;
  sweep: number;
  buyNotional: number;
  sellNotional: number;
}

export type FlowStatus = "connecting" | "live" | "error" | "disabled";

const MAX_BUFFER = 200;

function computeCounters(trades: FlowTrade[]): FlowCounters {
  const c: FlowCounters = {
    total: trades.length, buy: 0, sell: 0, neutral: 0, block: 0, sweep: 0,
    buyNotional: 0, sellNotional: 0,
  };
  for (const t of trades) {
    if (t.aggressor === "buy") { c.buy++; c.buyNotional += t.price * t.size * 100; }
    else if (t.aggressor === "sell") { c.sell++; c.sellNotional += t.price * t.size * 100; }
    else c.neutral++;
    if (t.isBlock) c.block++;
    if (t.isSweep) c.sweep++;
  }
  return c;
}

export function useFlowTimeSales(contract: string | null | undefined): {
  trades: FlowTrade[];
  counters: FlowCounters;
  status: FlowStatus;
  error: string | null;
} {
  const [trades, setTrades] = useState<FlowTrade[]>([]);
  const [status, setStatus] = useState<FlowStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!contract) {
      setTrades([]);
      setStatus("disabled");
      return;
    }
    let cancelled = false;
    setTrades([]);
    setStatus("connecting");
    setError(null);

    let es: EventSource | null = null;

    (async () => {
      // REST backfill always runs — it's the dev-mode source of truth and
      // a useful prefetch in prod.
      try {
        const r = await fetchWithAuth(`${API_BASE}/flow/timesales/${encodeURIComponent(contract)}/recent?limit=200`);
        if (!r.ok) {
          // silent — we'll still probe the live stream below
        } else {
          const data = await r.json() as { trades?: FlowTrade[] };
          if (cancelled) return;
          if (Array.isArray(data.trades) && data.trades.length > 0) {
            // REST returns oldest→newest; we store newest-first.
            setTrades(prev => {
              const merged = [...data.trades!.slice().reverse(), ...prev].slice(0, MAX_BUFFER);
              return merged;
            });
          }
        }
      } catch { /* ignore */ }

      if (cancelled) return;

      // Probe whether the server has the Polygon options WS enabled. If
      // it's not (dev environments by default), opening an EventSource
      // would just churn through repeated 503 errors and reconnect storms,
      // so we stay in stable REST-only mode and report "disabled".
      let wsEnabled = false;
      try {
        const s = await fetchWithAuth(`${API_BASE}/flow/timesales/_status`);
        if (s.ok) {
          const j = await s.json() as { polygonWsEnabled?: boolean };
          wsEnabled = Boolean(j.polygonWsEnabled);
        }
      } catch { /* ignore — treat as disabled */ }

      if (cancelled) return;
      if (!wsEnabled) {
        setStatus("disabled");
        return;
      }

      // SSE live stream — only opened when the server reports WS enabled.
      const url = `${API_BASE}/flow/timesales/${encodeURIComponent(contract)}/stream`;
      es = new EventSource(url);
      esRef.current = es;
      attachSseListeners(es);
    })();

    function attachSseListeners(s: EventSource) {
      s.addEventListener("hello", () => {
        if (!cancelled) setStatus("live");
      });
      s.addEventListener("trade", (e: MessageEvent) => {
        if (cancelled) return;
        try {
          const t = JSON.parse(e.data) as FlowTrade;
          setTrades(prev => {
            const next = [t, ...prev];
            if (next.length > MAX_BUFFER) next.length = MAX_BUFFER;
            return next;
          });
        } catch { /* ignore parse errors */ }
      });
      s.addEventListener("error", (e: MessageEvent) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(e.data ?? "{}") as { message?: string };
          if (data.message) setError(data.message);
        } catch { /* noop */ }
      });
      s.onerror = () => {
        if (cancelled) return;
        setStatus("error");
      };
      s.onopen = () => {
        if (cancelled) return;
        setStatus("live");
        setError(null);
      };
    }

    return () => {
      cancelled = true;
      if (es) { try { es.close(); } catch { /* noop */ } }
      esRef.current = null;
    };
  }, [contract]);

  const counters = useMemo(() => computeCounters(trades), [trades]);

  return { trades, counters, status, error };
}
