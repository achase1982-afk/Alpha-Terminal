import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { LiveQuote } from "@/lib/store";

const API_BASE = "/api";
const REJECTED_RETRY_DELAY = 3_000;
const MAX_REJECTED_RETRIES = 3;
const WS_RECONNECT_BASE = 1_000;
const WS_RECONNECT_MAX = 30_000;
const WS_MAX_FAILURES_BEFORE_POLL = 3;
const POLL_INTERVAL = 2_000;

let _getClerkToken: (() => Promise<string | null>) | null = null;

export function setWsTokenGetter(fn: () => Promise<string | null>) {
  _getClerkToken = fn;
}

async function refreshAndRetry(retryCount: number): Promise<boolean> {
  if (retryCount >= MAX_REJECTED_RETRIES) {
    console.warn("[stream] Max rejected retries reached — giving up");
    return false;
  }

  const state = useTerminalStore.getState();
  const { refreshToken, traderRefreshToken } = state;

  let traderOk = false;
  if (traderRefreshToken) {
    try {
      const res = await fetchWithAuth("/api/auth/trader-refresh", {
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
      const res = await fetchWithAuth("/api/auth/refresh", {
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
    state.clearTokens();
    state.clearTraderTokens();
    return false;
  }

  return true;
}

function buildWsUrl(clerkToken: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/prices?clerk_token=${encodeURIComponent(clerkToken)}`;
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
  const rejectedRetries = useRef(0);
  const symDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);
  const startDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(WS_RECONNECT_BASE);
  const mountedRef = useRef(true);
  const wsFailCount = useRef(0);
  const usingPollRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsEverConnected = useRef(false);

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
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const res = await fetchWithAuth(`${API_BASE}/stream/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: marketToken,
          traderAccessToken: traderToken,
          symbols: allSymbols(),
        }),
      });
      if (!res.ok) {
        startedRef.current = false;
      }
    } catch {
      startedRef.current = false;
    }
  }

  async function addServerSymbols(symbols: string[]) {
    try {
      await fetchWithAuth(`${API_BASE}/stream/symbols`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols }),
      });
    } catch {}
  }

  function handleSnapshot(data: { quotes?: LiveQuote[]; status?: string }) {
    if (data.status === "rejected") {
      setStreamStatus("offline");
      const attempt = rejectedRetries.current;
      rejectedRetries.current++;
      setTimeout(() => void refreshAndRetry(attempt), REJECTED_RETRY_DELAY);
      return;
    }
    if (data.quotes && data.quotes.length > 0) {
      setStreamStatus("live");
      rejectedRetries.current = 0;
      for (const q of data.quotes) {
        setStreamQuote(q);
      }
    } else if (data.status === "connecting") {
      setStreamStatus("connecting");
    } else if (data.status === "disconnected") {
      setStreamStatus("offline");
    }
  }

  function startPolling() {
    if (pollTimerRef.current) return;
    usingPollRef.current = true;
    console.info("[stream] Falling back to snapshot polling");

    async function poll() {
      if (!mountedRef.current) return;
      try {
        const res = await fetchWithAuth(`${API_BASE}/stream/snapshot`);
        if (res.ok) {
          const data = await res.json() as { quotes?: LiveQuote[]; status?: string; optionQuotes?: Record<string, unknown>[] };
          handleSnapshot(data);
          if (data.optionQuotes) {
            for (const oq of data.optionQuotes) {
              mergeTick(oq);
            }
          }
        }
      } catch {}
    }

    void poll();
    pollTimerRef.current = setInterval(() => void poll(), POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    usingPollRef.current = false;
  }

  const connectWs = useCallback(async () => {
    if (usingPollRef.current) return;

    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!_getClerkToken) return;
    const token = await _getClerkToken();
    if (!token || !mountedRef.current) return;

    const url = buildWsUrl(token);

    setStreamStatus("connecting");

    const socket = new WebSocket(url);
    wsRef.current = socket;

    const openTimeout = setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        socket.close();
      }
    }, 5_000);

    socket.onopen = () => {
      clearTimeout(openTimeout);
      reconnectDelayRef.current = WS_RECONNECT_BASE;
      wsFailCount.current = 0;
      wsEverConnected.current = true;
    };

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { event: string; data: unknown };
        const { event, data } = msg;

        if (event === "snapshot") {
          handleSnapshot(data as { quotes: LiveQuote[]; status?: string });
        } else if (event === "quote") {
          setStreamStatus("live");
          rejectedRetries.current = 0;
          setStreamQuote(data as LiveQuote);
        } else if (event === "optionQuote") {
          mergeTick(data as Record<string, unknown>);
        } else if (event === "streamerStatus") {
          const st = data as { status?: string };
          if (st.status === "connected") {
            setStreamStatus("live");
          } else if (st.status === "disconnected") {
            setStreamStatus("connecting");
          } else if (st.status === "rejected") {
            setStreamStatus("offline");
            const attempt = rejectedRetries.current;
            rejectedRetries.current++;
            setTimeout(() => void refreshAndRetry(attempt), REJECTED_RETRY_DELAY);
          }
        }
      } catch {}
    };

    socket.onclose = () => {
      clearTimeout(openTimeout);
      wsRef.current = null;
      if (!mountedRef.current) return;

      wsFailCount.current++;
      if (wsFailCount.current >= WS_MAX_FAILURES_BEFORE_POLL && !wsEverConnected.current) {
        startPolling();
        return;
      }

      setStreamStatus("connecting");
      scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
  }, [setStreamQuote, setStreamStatus, mergeTick]);

  function scheduleReconnect() {
    if (reconnectTimerRef.current) return;
    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 2, WS_RECONNECT_MAX);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      void connectWs();
    }, delay);
  }

  function cleanupWs() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  function cleanupAll() {
    cleanupWs();
    stopPolling();
  }

  useEffect(() => {
    mountedRef.current = true;
    void connectWs();

    return () => {
      mountedRef.current = false;
      cleanupAll();
    };
  }, [connectWs]);

  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) {
        return;
      }
      if (usingPollRef.current) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        cleanupWs();
        void connectWs();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [connectWs]);

  const streamKey = `${accessToken || ""}|${traderAccessToken || ""}`;

  useEffect(() => {
    if (!accessToken) return;

    if (startDebounceRef.current) clearTimeout(startDebounceRef.current);
    startDebounceRef.current = setTimeout(() => {
      startedRef.current = false;
      void startServerStream(accessToken, traderAccessToken);
      void addServerSymbols(allSymbols());
    }, 300);

    return () => {
      if (startDebounceRef.current) clearTimeout(startDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamKey]);

  useEffect(() => {
    if (symDebounceRef.current) clearTimeout(symDebounceRef.current);
    symDebounceRef.current = setTimeout(() => {
      void addServerSymbols(allSymbols());
    }, 250);
    return () => {
      if (symDebounceRef.current) clearTimeout(symDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tickerTapeSymbols.join(","), macroSymbols.join(",")]);

  const subscribeEquitySymbols = useCallback(
    async (symbols: string[]) => {
      if (!symbols.length) return;
      void addServerSymbols(symbols.map((s) => s.toUpperCase()));
    },
    []
  );

  const subscribeOptionSymbols = useCallback(
    async (symbols: string[]) => {
      if (!symbols.length) return;
      try {
        await fetchWithAuth(`${API_BASE}/stream/option-symbols`, {
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
