import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";
import type { LiveQuote } from "@/lib/store";

const API_BASE = "/api";

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
      const res = await fetch(`${API_BASE}/stream/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token, symbols: allSymbols() }),
      });
      if (!res.ok) {
        console.warn("[stream] startServerStream HTTP", res.status);
      }
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

  function openEventSource() {
    esRef.current?.close();
    esRef.current = null;
    setStreamStatus("connecting");

    const es = new EventSource(`${API_BASE}/stream/quotes`);
    esRef.current = es;

    es.addEventListener("streamerStatus", (e) => {
      try {
        const { status } = JSON.parse((e as MessageEvent).data) as { status: string };
        if (status === "connected") {
          setStreamStatus("live");
        } else if (status === "rejected") {
          setStreamStatus("offline");
          console.warn("[stream] Schwab streamer LOGIN rejected — re-authentication may be needed");
        } else if (status === "connecting") {
          setStreamStatus("connecting");
        } else if (status === "disconnected") {
          setStreamStatus("connecting");
        }
      } catch {}
    });

    es.addEventListener("quote", (e) => {
      try {
        const q = JSON.parse((e as MessageEvent).data) as LiveQuote;
        setStreamQuote(q);
      } catch {}
    });

    es.addEventListener("optionQuote", (e) => {
      try {
        const tick = JSON.parse((e as MessageEvent).data) as OptionTick;
        mergeTick(tick);
      } catch {}
    });

    es.addEventListener("heartbeat", () => {});

    es.onopen = () => {};

    es.onerror = () => {
      setStreamStatus("connecting");
    };
  }

  useEffect(() => {
    if (!accessToken) {
      setStreamStatus("offline");
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    openEventSource();
    void startServerStream(accessToken);

    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
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
