import { logger as baseLogger } from "./logger.js";
import { getBestAccessToken } from "./tokenStore.js";

const logger = baseLogger.child({ module: "putCallRatio" });

const POLL_INTERVAL_MS = 60_000;

interface PCRatioData {
  putVolume: number;
  callVolume: number;
  ratio: number | null;
  ts: number;
}

let equityPC: PCRatioData | null = null;
let indexPC: PCRatioData | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export function getEquityPCRatio(): PCRatioData | null {
  return equityPC;
}

export function getIndexPCRatio(): PCRatioData | null {
  return indexPC;
}

async function computeRatio(underlying: string): Promise<PCRatioData> {
  const token = getBestAccessToken();
  if (!token) {
    return { putVolume: 0, callVolume: 0, ratio: null, ts: Date.now() };
  }
  const { getOrFetchChain } = await import("../routes/market.js");
  const chain = await getOrFetchChain(underlying, token, logger);
  let putVolume = 0;
  let callVolume = 0;
  for (const put of chain?.puts ?? []) putVolume += put.volume ?? 0;
  for (const call of chain?.calls ?? []) callVolume += call.volume ?? 0;
  const ratio = callVolume > 0 ? Math.round((putVolume / callVolume) * 10000) / 10000 : null;
  return { putVolume, callVolume, ratio, ts: Date.now() };
}

async function pollOnce() {
  try {
    const [eq, idx] = await Promise.all([
      computeRatio("SPY"),
      computeRatio("SPX"),
    ]);
    equityPC = eq;
    indexPC = idx;
  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? err.message : err }, "P/C ratio poll failed");
  }
}

export function startPolygonPCRatioPoller() {
  if (pollTimer) return;
  void pollOnce();
  pollTimer = setInterval(() => { void pollOnce(); }, POLL_INTERVAL_MS);
}

export function stopPolygonPCRatioPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
