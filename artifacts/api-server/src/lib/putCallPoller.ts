import { logger } from "./logger.js";
import { getBestAccessToken } from "./tokenStore.js";
import { injectExternalQuote, type LiveQuote } from "./schwabStreamer.js";

const SCHWAB_QUOTES_URL = "https://api.schwabapi.com/marketdata/v1/quotes";

const PC_SYMBOLS = ["$CPC", "$CPCE", "$CPCI", "$PCSPY", "$PCQQQ", "$PCIWM"];

const POLL_INTERVAL_MS = 30_000;
const POLL_INTERVAL_NO_TOKEN_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function fetchPutCallRatios() {
  const token = getBestAccessToken();
  if (!token) {
    return;
  }

  const symbolList = PC_SYMBOLS.map((s) => s.replace("$", "")).join(",");

  try {
    const res = await fetch(
      `${SCHWAB_QUOTES_URL}?symbols=${encodeURIComponent(symbolList)}&fields=quote`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (res.status === 401) {
      logger.warn("PutCallPoller: 401 — token may be expired");
      return;
    }

    if (!res.ok) {
      logger.warn({ status: res.status }, "PutCallPoller: Schwab quotes fetch failed");
      return;
    }

    const json = (await res.json()) as Record<string, unknown>;

    let injected = 0;
    for (const [rawKey, val] of Object.entries(json)) {
      if (!val || typeof val !== "object") continue;
      const q = (val as Record<string, unknown>)["quote"] as
        | Record<string, unknown>
        | undefined;
      if (!q) continue;

      const symbol = "$" + rawKey.replace(/^\$/, "");

      const last =
        (q["lastPrice"] as number | undefined) ??
        (q["mark"] as number | undefined) ??
        (q["closePrice"] as number | undefined) ??
        null;

      if (last === null || last === 0) continue;

      const quote: LiveQuote = {
        symbol,
        last,
        extendedLast: null,
        bid: (q["bidPrice"] as number | undefined) ?? null,
        ask: (q["askPrice"] as number | undefined) ?? null,
        bidSize: (q["bidSize"] as number | undefined) ?? null,
        askSize: (q["askSize"] as number | undefined) ?? null,
        change: (q["netChange"] as number | undefined) ?? null,
        changePct: (q["netPercentChangeInDouble"] as number | undefined) ?? null,
        volume: (q["totalVolume"] as number | undefined) ?? null,
        high: (q["highPrice"] as number | undefined) ?? null,
        low: (q["lowPrice"] as number | undefined) ?? null,
        close: (q["closePrice"] as number | undefined) ?? null,
        ts: Date.now(),
      };

      injectExternalQuote(symbol, quote);
      injected++;
    }

    if (injected > 0) {
      logger.info({ injected, total: PC_SYMBOLS.length }, "PutCallPoller: injected P/C ratios");
    }
  } catch (err) {
    logger.warn({ err }, "PutCallPoller: fetch error");
  }
}

export function startPutCallPoller() {
  if (timer) return;
  logger.info("PutCallPoller: starting (interval %ds)", POLL_INTERVAL_MS / 1000);

  fetchPutCallRatios();

  timer = setInterval(() => {
    const token = getBestAccessToken();
    if (!token) return;
    fetchPutCallRatios();
  }, POLL_INTERVAL_MS);
}

export function stopPutCallPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("PutCallPoller: stopped");
  }
}
