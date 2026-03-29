import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";
import type { LiveQuote } from "@/lib/store";

const API_BASE = "/api";
const LIVE_THRESHOLD_MS = 10_000;

export function useMarketStream() {
  const {
    accessToken,
    symbol,
    tickerTapeSymbols,
    macroSymbols,
    setStreamQuote,
    setStreamStatus,
  } = useTerminalStore();

  const mergeTick = useOptionsStreamStore((s) => s.mergeTick);
  const esRef = useRef<EventSource | null>(null);
  const tokenRef = useRef<string | null>(null);
  const lastTickRef = useRef<number>(0);
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function allSymbols(): string[] {
    return [
      ...new Set(
        [symbol, ...tickerTapeSymbols, ...macroSymbols].map((s) =>
          s.toUpperCase()
        )
      ),
    ];
  }

  async function startServerStream(token: string) {
    try {
      await fetch(`${API_BASE}/stream/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, symbols: allSymbols() }),
      });
    } catch (err) {
      console.warn("[stream] startServerStream failed:", err);
    }
  }

  async function addServerSymbols(symbols: string[]) {
    try {
      await fetch(`${API_BASE}/stream/symbols`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
    } catch {}
  }

  function markTick() {
    lastTickRef.current = Date.now();
    const cur = useTerminalStore.getState().streamStatus;
    if (cur !== "live") setStreamStatus("live");
  }

  function startLivenessCheck() {
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    liveTimerRef.current = setInterval(() => {
      if (!esRef.current) return;
      const age = Date.now() - lastTickRef.current;
      if (age > LIVE_THRESHOLD_MS && useTerminalStore.getState().streamStatus === "live") {
        setStreamStatus("connecting");
      }
    }, 5_000);
  }

  function openEventSource() {
    esRef.current?.close();
    esRef.current = null;
    setStreamStatus("connecting");

    const es = new EventSource(`${API_BASE}/stream/quotes`);
    esRef.current = es;

    es.addEventListener("quote", (e) => {
      try {
        const q = JSON.parse((e as MessageEvent).data) as LiveQuote;
        setStreamQuote(q);
        markTick();
      } catch {}
    });

    es.addEventListener("optionQuote", (e) => {
      try {
        const tick = JSON.parse((e as MessageEvent).data) as OptionTick;
        mergeTick(tick);
        markTick();
      } catch {}
    });

    es.addEventListener("heartbeat", () => {});

    es.onopen = () => {
      setStreamStatus("connecting");
    };

    es.onerror = () => {
      setStreamStatus("connecting");
    };

    startLivenessCheck();
  }

  useEffect(() => {
    if (!accessToken) {
      setStreamStatus("offline");
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

  useEffect(() => {
    if (!accessToken) return;
    void addServerSymbols(allSymbols());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tickerTapeSymbols.join(","), macroSymbols.join(",")]);

  useEffect(() => {
    function handleVisibility() {
      if (!accessToken) return;
      if (document.hidden) {
        esRef.current?.close();
        esRef.current = null;
        if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
        setStreamStatus("offline");
      } else if (!esRef.current) {
        openEventSource();
        void startServerStream(accessToken);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
      esRef.current = null;
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    };
  }, []);

  const subscribeOptionSymbols = useCallback(
    async (symbols: string[]) => {
      if (!symbols.length) return;
      try {
        await fetch(`${API_BASE}/stream/option-symbols`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols }),
        });
      } catch {}
    },
    []
  );

  return { subscribeOptionSymbols };
}
