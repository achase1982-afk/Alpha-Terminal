/**
 * useStreamingQuotes — connects to the API server's SSE endpoint and feeds
 * live quote data into the Zustand store's streamPrices map.
 *
 * This hook lives at the app root (Terminal.tsx) so that a single
 * EventSource is shared across all components.  Components read from
 * streamPrices directly and only re-render when their specific symbol
 * changes — the chart, options tab, and AI tab are never touched.
 *
 * EventSource reconnects automatically on network drop (browser built-in).
 * We call POST /api/stream/start to (re)initialise the server-side WS
 * whenever the access token changes.
 */

import { useEffect, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import type { LiveQuote } from "@/lib/store";

const API_BASE = "/api";

export function useStreamingQuotes() {
  const {
    accessToken,
    symbol,
    tickerTapeSymbols,
    macroSymbols,
    setStreamQuote,
    setStreamConnected,
  } = useTerminalStore();

  const esRef       = useRef<EventSource | null>(null);
  const tokenRef    = useRef<string | null>(null);

  // ── Derive the full symbol list to subscribe ──────────────────────────────
  function allSymbols(active: string, tape: string[], macro: string[]): string[] {
    return [...new Set([active, ...tape, ...macro].map(s => s.toUpperCase()))];
  }

  // ── Start / restart the server-side Schwab Streamer WS ───────────────────
  async function startServerStream(token: string) {
    const symbols = allSymbols(symbol, tickerTapeSymbols, macroSymbols);
    try {
      await fetch(`${API_BASE}/stream/start`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ accessToken: token, symbols }),
      });
    } catch (err) {
      console.warn("[streaming] startServerStream failed:", err);
    }
  }

  // ── Inform server of additional symbols added later ───────────────────────
  async function addServerSymbols(symbols: string[]) {
    try {
      await fetch(`${API_BASE}/stream/symbols`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ symbols }),
      });
    } catch {
      // non-critical
    }
  }

  // ── Open (or re-open) the SSE connection ──────────────────────────────────
  function openEventSource() {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(`${API_BASE}/stream/quotes`);
    esRef.current = es;

    es.addEventListener("quote", (e) => {
      try {
        const q = JSON.parse((e as MessageEvent).data) as LiveQuote;
        setStreamQuote(q);
      } catch {
        // malformed — ignore
      }
    });

    es.addEventListener("heartbeat", () => {
      setStreamConnected(true);
    });

    es.onopen  = () => setStreamConnected(true);
    es.onerror = () => {
      setStreamConnected(false);
      // EventSource auto-reconnects; we don't need manual retry here
    };
  }

  // ── Effect: start server stream when token arrives / changes ─────────────
  useEffect(() => {
    if (!accessToken) {
      // Token gone — close SSE but leave server stream running
      // (it will stop itself once no clients remain for >60s)
      setStreamConnected(false);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      tokenRef.current = null;
      return;
    }

    const isNewToken = accessToken !== tokenRef.current;
    tokenRef.current = accessToken;

    // Always open/re-open the SSE connection on token change
    openEventSource();

    if (isNewToken) {
      void startServerStream(accessToken);
    }

    return () => {
      // cleanup handled by the token-change branch above
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // ── Effect: subscribe server to newly added symbols ───────────────────────
  useEffect(() => {
    if (!accessToken) return;
    const extras = allSymbols(symbol, tickerTapeSymbols, macroSymbols);
    void addServerSymbols(extras);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tickerTapeSymbols.join(","), macroSymbols.join(",")]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);
}
