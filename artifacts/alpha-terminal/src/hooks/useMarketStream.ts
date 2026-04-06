import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";
import { useDepthStore, type DepthBook } from "@/lib/depth-store";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { fetchWithAuth, getClerkToken } from "@/lib/fetchWithAuth";
import type { LiveQuote, LiveNewsItem } from "@/lib/store";

const API_BASE = "/api";
const WS_RECONNECT_BASE = 1_000;
const WS_RECONNECT_MAX = 30_000;
const REJECTED_RETRY_DELAY = 3_000;
const MAX_REJECTED_RETRIES = 3;


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
        const data = (await res.json()) as {
          accessToken?: string;
          refreshToken?: string;
        };
        if (data.accessToken) {
          state.setTraderTokens(
            data.accessToken,
            data.refreshToken ?? traderRefreshToken
          );
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
        const data = (await res.json()) as {
          accessToken?: string;
          refreshToken?: string;
        };
        if (data.accessToken) {
          state.setTokens(
            data.accessToken,
            data.refreshToken ?? refreshToken
          );
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

function buildWsUrl(clerkToken: string | null): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const base = `${proto}//${window.location.host}/api/ws/prices`;
  if (clerkToken) {
    return `${base}?clerk_token=${encodeURIComponent(clerkToken)}`;
  }
  return base;
}

export function useMarketStream() {
  const {
    accessToken,
    traderAccessToken,
    symbol,
    tickerTapeSymbols,
    macroSymbols,
    setStreamQuote,
    setStreamQuotes,
    setStreamStatus,
    addLiveNews,
  } = useTerminalStore();

  const mergeTick = useOptionsStreamStore((s) => s.mergeTick);
  const setDepthBook = useDepthStore((s) => s.setBook);
  const setDepthBooks = useDepthStore((s) => s.setBooks);
  const setPortfolioAccount = usePortfolioStreamStore((s) => s.setAccount);
  const setPortfolioOrders = usePortfolioStreamStore((s) => s.setOrders);
  const rejectedRetries = useRef(0);
  const symDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);
  const startDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(WS_RECONNECT_BASE);
  const tokenReadyRef = useRef(false);

  const watchlist = useTerminalStore((s) => s.watchlists[s.activeWatchlistId]?.symbols ?? []);

  function allSymbols(): string[] {
    return [
      ...new Set(
        [symbol, ...tickerTapeSymbols, ...macroSymbols, ...watchlist].map((s) =>
          s.toUpperCase()
        )
      ),
    ];
  }

  async function startServerStream(
    marketToken: string,
    traderToken: string | null
  ) {
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

  const connectWs = useCallback(async () => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    if (!mountedRef.current) return;

    const clerkToken = await getClerkToken();
    const url = buildWsUrl(clerkToken);
    setStreamStatus("connecting");

    const socket = new WebSocket(url);
    wsRef.current = socket;

    const openTimeout = setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        socket.close();
      }
    }, 10_000);

    socket.onopen = () => {
      clearTimeout(openTimeout);
      reconnectDelayRef.current = WS_RECONNECT_BASE;
      (window as any).__alphaWs = socket;
      console.log("[ws] connected to /api/ws/prices");
    };

    socket.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as {
          event: string;
          data: Record<string, unknown>;
        };

        if (msg.event === "snapshot") {
          const raw = msg.data;
          const quotes: LiveQuote[] = Array.isArray(raw)
            ? raw
            : (raw as { quotes?: LiveQuote[] }).quotes ?? [];
          const status = Array.isArray(raw) ? undefined : (raw as { status?: string }).status;
          if (status === "rejected") {
            setStreamStatus("offline");
            const attempt = rejectedRetries.current;
            rejectedRetries.current++;
            setTimeout(() => void refreshAndRetry(attempt), REJECTED_RETRY_DELAY);
            return;
          }
          if (quotes.length > 0) {
            setStreamStatus("live");
            rejectedRetries.current = 0;
            if (quotes.length === 1) setStreamQuote(quotes[0]);
            else setStreamQuotes(quotes);
          } else if (status === "connecting") {
            setStreamStatus("connecting");
          } else if (status === "disconnected") {
            setStreamStatus("offline");
          }
        } else if (msg.event === "quote") {
          setStreamStatus("live");
          rejectedRetries.current = 0;
          setStreamQuote(msg.data as unknown as LiveQuote);
        } else if (msg.event === "optionQuote") {
          mergeTick(msg.data as unknown as OptionTick);
        } else if (msg.event === "depth") {
          setDepthBook(msg.data as unknown as DepthBook);
        } else if (msg.event === "depthSnapshot") {
          setDepthBooks(msg.data as unknown as DepthBook[]);
        } else if (msg.event === "ibNews") {
          addLiveNews(msg.data as unknown as LiveNewsItem);
        } else if (msg.event === "portfolioAccount") {
          setPortfolioAccount(msg.data as any);
        } else if (msg.event === "portfolioOrders") {
          setPortfolioOrders(msg.data as any);
        } else if (msg.event === "streamerStatus") {
          const s = (msg.data as { status?: string }).status;
          if (s === "connected") setStreamStatus("live");
          else if (s === "rejected") setStreamStatus("offline");
          else if (s === "connecting") setStreamStatus("connecting");
          else if (s === "disconnected") setStreamStatus("offline");
        }
      } catch {}
    };

    socket.onclose = () => {
      clearTimeout(openTimeout);
      wsRef.current = null;
      if (!mountedRef.current) return;
      setStreamStatus("connecting");
      scheduleReconnect();
    };

    socket.onerror = () => {
      clearTimeout(openTimeout);
    };
  }, [setStreamQuote, setStreamStatus, mergeTick, addLiveNews]);

  function scheduleReconnect() {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    const delay = reconnectDelayRef.current;
    reconnectDelayRef.current = Math.min(delay * 2, WS_RECONNECT_MAX);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      void connectWs();
    }, delay);
  }

  useEffect(() => {
    mountedRef.current = true;
    tokenReadyRef.current = true;

    void connectWs();

    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
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
  }, [symbol, tickerTapeSymbols.join(","), macroSymbols.join(","), watchlist.join(",")]);

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

  const sendWsMessage = useCallback((msg: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { subscribeOptionSymbols, subscribeEquitySymbols, sendWsMessage };
}
