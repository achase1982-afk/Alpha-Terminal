import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { LiveQuote } from "@/lib/store";

const API_BASE = "/api";
const REJECTED_RETRY_DELAY = 3_000;
const MAX_REJECTED_RETRIES = 3;
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
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  function allSymbols(): string[] {
    return [
      ...new Set(
        [symbol, ...tickerTapeSymbols, ...macroSymbols].map((s) =>
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

  const handleSnapshot = useCallback(
    (data: { quotes?: LiveQuote[]; status?: string }) => {
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
    },
    [setStreamQuote, setStreamStatus]
  );

  useEffect(() => {
    mountedRef.current = true;

    async function poll() {
      if (!mountedRef.current) return;
      try {
        const res = await fetchWithAuth(`${API_BASE}/stream/snapshot`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          quotes?: LiveQuote[];
          status?: string;
          optionQuotes?: Record<string, unknown>[];
        };
        if (!mountedRef.current) return;
        handleSnapshot(data);
        if (data.optionQuotes) {
          for (const oq of data.optionQuotes) {
            mergeTick(oq);
          }
        }
      } catch {}
    }

    void poll();
    pollTimerRef.current = setInterval(() => void poll(), POLL_INTERVAL);

    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [handleSnapshot, mergeTick]);

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
