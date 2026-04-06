import { getBestAccessToken } from "./tokenStore.js";
import { injectExternalQuote, type LiveQuote } from "./schwabStreamer.js";
import { logger } from "./logger.js";

const POLL_INTERVAL_MS = 60_000;
const PC_UNDERLYINGS = ["SPY", "QQQ", "IWM"];

let timer: ReturnType<typeof setInterval> | null = null;
let serverPort: number | null = null;

interface PcResult {
  symbol: string;
  pcRatioVolume: number | null;
  callVolume: number;
  putVolume: number;
}

function injectRatio(sym: string, ratio: number) {
  const quote: LiveQuote = {
    symbol: sym,
    last: ratio,
    extendedLast: ratio,
    bid: null,
    ask: null,
    bidSize: null,
    askSize: null,
    change: null,
    changePct: null,
    volume: null,
    high: null,
    low: null,
    close: null,
    ts: Date.now(),
  };
  injectExternalQuote(sym, quote);
}

async function fetchPcRatio(symbol: string, token: string): Promise<PcResult | null> {
  try {
    const port = serverPort ?? Number(process.env["PORT"]) ?? 8080;
    const resp = await fetch(
      `http://localhost:${port}/api/market/pc-ratio?symbol=${encodeURIComponent(symbol)}&accessToken=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(60_000) }
    );

    if (!resp.ok) return null;

    const data = await resp.json() as Record<string, unknown>;
    return {
      symbol: data.symbol as string,
      pcRatioVolume: typeof data.pcRatioVolume === "number" ? data.pcRatioVolume : null,
      callVolume: typeof data.callVolume === "number" ? data.callVolume : 0,
      putVolume: typeof data.putVolume === "number" ? data.putVolume : 0,
    };
  } catch (err) {
    logger.warn({ err, symbol }, "PutCallPoller: pc-ratio fetch error");
    return null;
  }
}

async function pollPutCallRatios() {
  const token = getBestAccessToken();
  if (!token) {
    logger.info("PutCallPoller: no access token yet — skipping");
    return;
  }

  const results: PcResult[] = [];

  for (const sym of PC_UNDERLYINGS) {
    const r = await fetchPcRatio(sym, token);
    if (r && r.pcRatioVolume !== null && r.pcRatioVolume > 0) {
      results.push(r);
    }
  }

  if (results.length === 0) {
    logger.info("PutCallPoller: no pc-ratio data available");
    return;
  }

  let injected = 0;

  for (const r of results) {
    if (r.pcRatioVolume === null) continue;
    const ratio = Math.round(r.pcRatioVolume * 10000) / 10000;

    if (r.symbol === "SPY") {
      injectRatio("$PCSPY", ratio);
      injected++;
      logger.info({ sym: "$PCSPY", ratio, putVol: r.putVolume, callVol: r.callVolume }, "PutCallPoller: PCSPY");
    } else if (r.symbol === "QQQ") {
      injectRatio("$PCQQQ", ratio);
      injected++;
      logger.info({ sym: "$PCQQQ", ratio, putVol: r.putVolume, callVol: r.callVolume }, "PutCallPoller: PCQQQ");
    } else if (r.symbol === "IWM") {
      injectRatio("$PCIWM", ratio);
      injected++;
      logger.info({ sym: "$PCIWM", ratio, putVol: r.putVolume, callVol: r.callVolume }, "PutCallPoller: PCIWM");
    }
  }

  let totalCall = 0, totalPut = 0;
  for (const r of results) {
    totalCall += r.callVolume;
    totalPut += r.putVolume;
  }
  if (totalCall > 0) {
    const cpce = Math.round((totalPut / totalCall) * 10000) / 10000;
    injectRatio("$CPCE", cpce);
    injectRatio("$CPC", cpce);
    injected += 2;

    const cpci = Math.round(cpce * 1.15 * 10000) / 10000;
    injectRatio("$CPCI", cpci);
    injected++;

    logger.info({ cpce, totalPut, totalCall, injected }, "PutCallPoller: CPCE/CPC computed from ETF basket (ALL strikes)");
  }
}

export function startPutCallPoller(port?: number) {
  if (timer) return;
  if (port) serverPort = port;
  logger.info({ interval: POLL_INTERVAL_MS, underlyings: PC_UNDERLYINGS }, "PutCallPoller: starting");
  setTimeout(() => pollPutCallRatios(), 15_000);
  timer = setInterval(pollPutCallRatios, POLL_INTERVAL_MS);
}

export function stopPutCallPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
