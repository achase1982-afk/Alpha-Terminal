import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";
import { useDepthStore, type DepthBook } from "@/lib/depth-store";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import type { SchwabAccountSummary } from "@/lib/schwab-account-types";
import { useOrderAlertStore, type OrderAlert } from "@/stores/orderAlertStore";
import {
  buildAuthenticatedEventSourceUrl,
  fetchWithAuth,
  getClerkToken,
} from "@/lib/fetchWithAuth";
import { signalSchwabAuthLost } from "@/lib/authNoticeStore";
import { refreshSchwabViaServer, syncSchwabTokensFromServer } from "@/lib/schwabTokenSync";
import type { LiveQuote, LiveNewsItem } from "@/lib/store";

declare global {
  interface Window {
    /** Dev/debug: last market WebSocket (read by PortfolioView for optional features). */
    __alphaWs?: WebSocket;
  }
}

/** SSE/WS `snapshot` payload: either a bare quote array or `{ quotes?, status? }`. */
interface StreamSnapshotEnvelope {
  quotes?: LiveQuote[];
  status?: string;
}

function isLiveQuoteRecord(v: unknown): v is LiveQuote {
  return (
    v !== null &&
    typeof v === "object" &&
    typeof (v as LiveQuote).symbol === "string" &&
    typeof (v as LiveQuote).ts === "number"
  );
}

function snapshotQuotesFromData(data: unknown): { quotes: LiveQuote[]; status?: string } {
  if (Array.isArray(data)) {
    const quotes = data.filter(isLiveQuoteRecord);
    return { quotes };
  }
  const env = data as StreamSnapshotEnvelope;
  const raw = env.quotes;
  const quotes = Array.isArray(raw) ? raw.filter(isLiveQuoteRecord) : [];
  return { quotes, status: env.status };
}

/** Portfolio stream payloads (matches `portfolio-stream-store` shapes). */
interface StreamPortfolioAccount {
  accountNumber: string;
  type: string;
  isDayTrader: boolean;
  roundTrips: number;
  balances: Record<string, number>;
  initialBalances: Record<string, number>;
  dayPL: number;
  totalPL: number;
  positions: unknown[];
}

interface StreamPortfolioOrder {
  orderId: number;
  orderType: string;
  session: string;
  duration: string;
  status: string;
  filledQuantity: number;
  remainingQuantity: number;
  price: number | null;
  complexStrategy: string;
  enteredTime: string;
  closeTime: string | null;
  legs: unknown[];
  fills: unknown[];
  tag: string | null;
}

interface StreamPortfolioStatus {
  status: "ok" | "no_token" | "error";
  message?: string;
}

const API_BASE = "/api";
const DEV_BYPASS_AUTH = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";
const WS_RECONNECT_BASE = 1_000;
const WS_RECONNECT_MAX = 30_000;
const REJECTED_RETRY_DELAY = 3_000;
const MAX_REJECTED_RETRIES = 3;
const REST_POLL_INTERVAL = 5000;
const SSE_FALLBACK_DELAY = 2_500;


async function refreshAndRetry(retryCount: number): Promise<boolean> {
  if (retryCount >= MAX_REJECTED_RETRIES) {
    console.warn("[stream] Max rejected retries reached — giving up");
    return false;
  }

  const state = useTerminalStore.getState();
  await syncSchwabTokensFromServer();
  const { ok } = await refreshSchwabViaServer();

  if (!ok) {
    signalSchwabAuthLost(
      "Schwab stream rejected the current login.",
      "Live data paused. Reconnect Schwab — your Alpha Terminal account stays signed in.",
    );
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

async function fetchRestSnapshot(
  _marketToken: string,
  _traderToken: string | null,
  _symbols: string[]
): Promise<{ quotes: LiveQuote[]; status?: string }> {
  const res = await fetchWithAuth(`${API_BASE}/stream/snapshot`, {
    method: "GET",
  });
  if (!res.ok) {
    throw new Error(`REST snapshot failed (${res.status})`);
  }
  return (await res.json()) as { quotes: LiveQuote[]; status?: string };
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
  const clearOptionTicks = useOptionsStreamStore((s) => s.clearTicks);
  const setDepthBook = useDepthStore((s) => s.setBook);
  const setDepthBooks = useDepthStore((s) => s.setBooks);
  const setPortfolioAccount = usePortfolioStreamStore((s) => s.setAccount);
  const setPortfolioAccounts = usePortfolioStreamStore((s) => s.setAccounts);
  const setPortfolioOrders = usePortfolioStreamStore((s) => s.setOrders);
  const setPortfolioStatus = usePortfolioStreamStore((s) => s.setPortfolioStatus);
  const rejectedRetries = useRef(0);
  const symDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);
  const startDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(WS_RECONNECT_BASE);
  const restPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const stopSseStream = useCallback(() => {
    if (sseFallbackTimerRef.current) {
      clearTimeout(sseFallbackTimerRef.current);
      sseFallbackTimerRef.current = null;
    }
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const stopRestPolling = useCallback(() => {
    if (restPollRef.current) {
      clearInterval(restPollRef.current);
      restPollRef.current = null;
    }
  }, []);

  const handleStreamEvent = useCallback((event: string, data: unknown) => {
    if (event === "snapshot") {
      const { quotes, status } = snapshotQuotesFromData(data);
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
    } else if (event === "quote") {
      setStreamStatus("live");
      rejectedRetries.current = 0;
      setStreamQuote(data as LiveQuote);
    } else if (event === "optionQuote") {
      mergeTick(data as OptionTick);
    } else if (event === "depth") {
      setDepthBook(data as DepthBook);
    } else if (event === "depthSnapshot") {
      setDepthBooks(data as DepthBook[]);
    } else if (event === "ibNews") {
      addLiveNews(data as LiveNewsItem);
    } else if (event === "portfolioAccounts") {
      const accounts = data as SchwabAccountSummary[];
      if (Array.isArray(accounts) && accounts.length > 0) {
        setPortfolioAccounts(accounts);
        useSchwabAccountStore.getState().syncAccountsFromStream(accounts);
      }
    } else if (event === "portfolioAccount") {
      console.log("[WS_RECV] portfolio_update", { kind: "account", ts: Date.now(), data });
      setPortfolioAccount(data as StreamPortfolioAccount);
    } else if (event === "portfolio_error") {
      console.log("[WS_RECV] portfolio_error", { ts: Date.now(), data });
    } else if (event === "portfolioOrders") {
      console.log("[WS_RECV] portfolio_update", { kind: "orders", ts: Date.now(), data });
      setPortfolioOrders(data as StreamPortfolioOrder[]);
    } else if (event === "portfolioStatus") {
      setPortfolioStatus(data as StreamPortfolioStatus);
    } else if (event === "orderAlert") {
      const d = data as Record<string, unknown>;
      const alertType = (d.type as string) ?? "UNKNOWN";
      const prefs = useTerminalStore.getState().notificationPrefs;
      if (prefs.masterEnabled) {
        const inAppEnabled = (prefs.inApp as Record<string, boolean>)[alertType as string] ?? true;
        if (inAppEnabled) {
          const alert: OrderAlert = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: alertType,
            symbol: (d.symbol as string) ?? null,
            status: (d.status as string) ?? null,
            side: (d.side as string) ?? null,
            quantity: (d.quantity as string) ?? null,
            price: (d.price as string) ?? null,
            orderId: (d.orderId as string) ?? null,
            timestamp: (d.timestamp as number) ?? Date.now(),
            raw: (d.raw as string) ?? "",
          };
          useOrderAlertStore.getState().addAlert(alert);
        }
      }
    } else if (event === "streamerStatus") {
      const s = typeof data === "string" ? data : (data as { status?: string }).status;
      if (s === "connected") setStreamStatus("live");
      else if (s === "rejected") setStreamStatus("offline");
      else if (s === "connecting") setStreamStatus("connecting");
      else if (s === "disconnected") setStreamStatus("offline");
    }
  }, [
    addLiveNews,
    mergeTick,
    setDepthBook,
    setDepthBooks,
    setPortfolioAccount,
    setPortfolioAccounts,
    setPortfolioOrders,
    setPortfolioStatus,
    setStreamQuote,
    setStreamQuotes,
    setStreamStatus,
  ]);

  const startSseStream = useCallback(async () => {
    if (!mountedRef.current || esRef.current) return;

    const sseUrl = await buildAuthenticatedEventSourceUrl(`${API_BASE}/stream/quotes`);
    const es = new EventSource(sseUrl);
    esRef.current = es;

    const parseEvent = (event: string) => (e: Event) => {
      try {
        handleStreamEvent(event, JSON.parse((e as MessageEvent).data));
      } catch {}
    };

    es.addEventListener("quote", parseEvent("quote"));
    es.addEventListener("optionQuote", parseEvent("optionQuote"));
    es.addEventListener("streamerStatus", parseEvent("streamerStatus"));
    es.addEventListener("heartbeat", () => {});
    es.onerror = () => {
      es.close();
      if (esRef.current === es) esRef.current = null;
      if (mountedRef.current) setStreamStatus("connecting");
    };
  }, [handleStreamEvent, setStreamStatus]);

  const scheduleSseFallback = useCallback(() => {
    if (sseFallbackTimerRef.current || esRef.current) return;
    sseFallbackTimerRef.current = setTimeout(() => {
      sseFallbackTimerRef.current = null;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      void startSseStream();
    }, SSE_FALLBACK_DELAY);
  }, [startSseStream]);

  const connectWs = useCallback(async () => {
    if (wsRef.current && wsRef.current.readyState <= WebSocket.OPEN) return;
    if (!mountedRef.current) return;

    const clerkToken = await getClerkToken();
    if (!clerkToken && !DEV_BYPASS_AUTH) {
      setStreamStatus("connecting");
      scheduleReconnect();
      return;
    }

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
      window.__alphaWs = socket;
      clearOptionTicks();
      stopSseStream();
      stopRestPolling();
      console.log("[ws] connected to /api/ws/prices");
    };

    socket.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as {
          event: string;
          data: Record<string, unknown>;
        };

        handleStreamEvent(msg.event, msg.data);
      } catch {}
    };

    socket.onclose = () => {
      clearTimeout(openTimeout);
      wsRef.current = null;
      if (!mountedRef.current) return;
      setStreamStatus("connecting");
      scheduleSseFallback();
      scheduleReconnect();
    };

    socket.onerror = () => {
      clearTimeout(openTimeout);
    };
    scheduleSseFallback();
  }, [clearOptionTicks, handleStreamEvent, scheduleSseFallback, setStreamStatus, stopRestPolling, stopSseStream]);

  const startRestPolling = useCallback(async () => {
    if (restPollRef.current) return;
    if (!mountedRef.current) return;
    setStreamStatus("connecting");
    const poll = async () => {
      if (!mountedRef.current) return;
      const clerkToken = await getClerkToken();
      if (!clerkToken && !useTerminalStore.getState().accessToken && !useTerminalStore.getState().traderAccessToken) return;
      try {
        const state = useTerminalStore.getState();
        const snapshot = await fetchRestSnapshot(
          state.accessToken || state.traderAccessToken || "",
          state.traderAccessToken || state.accessToken || null,
          allSymbols()
        );
        const quotes = snapshot.quotes ?? [];
        if (quotes.length > 0) {
          setStreamStatus("live");
          if (quotes.length === 1) setStreamQuote(quotes[0]);
          else setStreamQuotes(quotes);
        } else if (snapshot.status === "disconnected") {
          setStreamStatus("offline");
        }
      } catch {
        setStreamStatus("offline");
      }
    };
    void poll();
    restPollRef.current = setInterval(() => {
      void poll();
    }, REST_POLL_INTERVAL);
  }, [setStreamQuote, setStreamQuotes, setStreamStatus]);

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
      stopSseStream();
      stopRestPolling();
    };
  }, [connectWs, stopRestPolling, stopSseStream]);

  const streamKey = `${accessToken || ""}|${traderAccessToken || ""}`;
  const effectiveToken = accessToken || traderAccessToken || "";

  useEffect(() => {
    if (!effectiveToken) return;

    if (startDebounceRef.current) clearTimeout(startDebounceRef.current);
    startDebounceRef.current = setTimeout(() => {
      startedRef.current = false;
      void startServerStream(effectiveToken, traderAccessToken || accessToken || null);
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
