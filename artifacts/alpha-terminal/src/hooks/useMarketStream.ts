import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";
import type { LiveQuote } from "@/lib/store";

const API_BASE = "/api";
const REJECTED_RETRY_DELAY = 3_000;
const MAX_REJECTED_RETRIES = 3;

async function refreshAndRetry(retryCount: number): Promise<boolean> {
  if (retryCount >= MAX_REJECTED_RETRIES) {
    console.warn("[stream] Max rejected retries reached — giving up");
    return false;
  }

  const state = useTerminalStore.getState();
  const { refreshToken, traderRefreshToken } = state;

  console.info("[stream] Attempting token refresh after streamer rejection (attempt %d)", retryCount + 1);

  let traderOk = false;
  if (traderRefreshToken) {
    try {
      const res = await fetch("/api/auth/trader-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: traderRefreshToken }),
      });
      if (res.ok) {
        const data = await res.json() as { accessToken?: string; refreshToken?: string };
        if (data.accessToken) {
          state.setTraderTokens(data.accessToken, data.refreshToken ?? traderRefreshToken);
          traderOk = true;
        }
      }
    } catch {}
  }

  let marketOk = false;
  if (refreshToken) {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (res.ok) {
        const data = await res.json() as { accessToken?: string; refreshToken?: string };
        if (data.accessToken) {
          state.setTokens(data.accessToken, data.refreshToken ?? refreshToken);
          marketOk = true;
        }
      }
    } catch {}
  }

  if (!marketOk && !traderOk) {
    console.warn("[stream] Token refresh failed — clearing auth");
    state.clearTokens();
    state.clearTraderTokens();
    return false;
  }

  return true;
}

export function useMarketStream() {
  const {
    accessToken,
    traderAccessToken,
    symbol,
    tickerTapeSymbols,
    macroSymbols,
    setStreamQuote,
    setStreamStatus,
  } = useTerminalStore();

  const mergeTick = useOptionsStreamStore((s) => s.mergeTick);
  const esRef = useRef<EventSource | null>(null);
  const rejectedRetries = useRef(0);
  const symDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function allSymbols(): string[] {
    return [
      ...new Set(
        [symbol, ...tickerTapeSymbols, ...macroSymbols].map((s) =>
          s.toUpperCase()
        )
      ),
    ];
  }

  async function startServerStream(marketToken: string, traderToken: string | null) {
    try {
      const res = await fetch(`${API_BASE}/stream/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: marketToken,
          traderAccessToken: traderToken,
          symbols: allSymbols(),
        }),
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
          rejectedRetries.current = 0;
        } else if (status === "rejected") {
          setStreamStatus("offline");
          console.warn("[stream] Schwab streamer LOGIN rejected — attempting token refresh");
          const attempt = rejectedRetries.current;
          rejectedRetries.current++;
          setTimeout(() => void refreshAndRetry(attempt), REJECTED_RETRY_DELAY);
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
      es.close();
      esRef.current = null;
      setTimeout(() => {
        if (!esRef.current && accessToken) {
          openEventSource();
        }
      }, 2_000);
    };
  }

  const streamKey = `${accessToken || ""}|${traderAccessToken || ""}`;

  useEffect(() => {
    if (!accessToken) {
      setStreamStatus("offline");
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    rejectedRetries.current = 0;
    openEventSource();
    void startServerStream(accessToken, traderAccessToken);

    const watchdog = setInterval(() => {
      const es = esRef.current;
      if (!es || es.readyState === EventSource.CLOSED) {
        openEventSource();
      }
    }, 5_000);

    return () => {
      clearInterval(watchdog);
      esRef.current?.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey]);

  useEffect(() => {
    if (!accessToken) return;
    if (symDebounceRef.current) clearTimeout(symDebounceRef.current);
    symDebounceRef.current = setTimeout(() => {
      void addServerSymbols(allSymbols());
    }, 250);
    return () => {
      if (symDebounceRef.current) clearTimeout(symDebounceRef.current);
    };
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
        void startServerStream(accessToken, traderAccessToken);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey]);

  const subscribeEquitySymbols = useCallback(
    async (symbols: string[]) => {
      if (!symbols.length || !accessToken) return;
      void addServerSymbols(symbols.map((s) => s.toUpperCase()));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken]
  );

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

  return { subscribeOptionSymbols, subscribeEquitySymbols };
}
