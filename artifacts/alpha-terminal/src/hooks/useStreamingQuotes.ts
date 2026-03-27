/**
 * useStreamingQuotes — connects to the API server's SSE endpoint and feeds
 * live quote data into the Zustand store's streamPrices map.
 *
 * Lives at the app root (Terminal.tsx) — one EventSource per session.
 * Components use useQuote() which reads streamPrices directly and only
 * re-renders when their specific symbol changes.
 *
 * IMPORTANT: streamConnected is set to TRUE only when a real Schwab tick
 * arrives (event: quote), NOT when the SSE HTTP connection opens.
 * The SSE always connects instantly to our own server — that says nothing
 * about whether Schwab's WS is alive and producing data.
 *
 * EventSource auto-reconnects on drop; POST /api/stream/start restarts
 * the server-side Schwab WS whenever the access token changes.
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

  const esRef    = useRef<EventSource | null>(null);
  const tokenRef = useRef<string | null>(null);

  // ── Full symbol list: active + tape + macro cards ─────────────────────────
  function allSymbols(): string[] {
    return [...new Set(
      [symbol, ...tickerTapeSymbols, ...macroSymbols].map(s => s.toUpperCase())
    )];
  }

  // ── Tell the server to (re)start its Schwab WS with this token ────────────
  async function startServerStream(token: string) {
    try {
      await fetch(`${API_BASE}/stream/start`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ accessToken: token, symbols: allSymbols() }),
      });
    } catch (err) {
      console.warn("[streaming] startServerStream failed:", err);
    }
  }

  // ── Tell the server about additional symbols (non-blocking) ───────────────
  async function addServerSymbols(symbols: string[]) {
    try {
      await fetch(`${API_BASE}/stream/symbols`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ symbols }),
      });
    } catch {
      // best-effort
    }
  }

  // ── Open (or reopen) the SSE connection ──────────────────────────────────
  function openEventSource() {
    esRef.current?.close();
    esRef.current = null;

    const es = new EventSource(`${API_BASE}/stream/quotes`);
    esRef.current = es;

    es.addEventListener("quote", (e) => {
      try {
        const q = JSON.parse((e as MessageEvent).data) as LiveQuote;
        setStreamQuote(q);
        // Only mark stream as connected once REAL Schwab data lands.
        // This is the gate that prevents REST from being disabled prematurely.
        setStreamConnected(true);
      } catch {
        // malformed frame — ignore
      }
    });

    // Heartbeat = SSE pipeline is alive, but Schwab WS may still be logging in.
    // Do NOT set streamConnected here — REST must stay active until quotes flow.
    es.addEventListener("heartbeat", () => {
      // intentionally no-op for connection state
    });

    // onopen fires immediately when the HTTP stream to our API server opens.
    // This does NOT mean Schwab WS is connected — do NOT gate REST on this.
    es.onopen = () => {
      // intentionally no-op
    };

    es.onerror = () => {
      // SSE dropped — clear live flag so REST resumes for all symbols
      setStreamConnected(false);
    };
  }

  // ── Effect: token change → restart server WS + SSE ───────────────────────
  useEffect(() => {
    if (!accessToken) {
      setStreamConnected(false);
      esRef.current?.close();
      esRef.current = null;
      tokenRef.current = null;
      return;
    }

    const isNewToken = accessToken !== tokenRef.current;
    tokenRef.current = accessToken;

    openEventSource();

    if (isNewToken) {
      void startServerStream(accessToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // ── Effect: new symbols added → push them to the server subscription ──────
  useEffect(() => {
    if (!accessToken) return;
    void addServerSymbols(allSymbols());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tickerTapeSymbols.join(","), macroSymbols.join(",")]);

  // ── Visibility change: pause SSE when tab is hidden, resume when visible ──
  useEffect(() => {
    function handleVisibility() {
      if (!accessToken) return;
      if (document.hidden) {
        esRef.current?.close();
        esRef.current = null;
        setStreamConnected(false);
      } else if (!esRef.current) {
        openEventSource();
        void startServerStream(accessToken);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);
}
