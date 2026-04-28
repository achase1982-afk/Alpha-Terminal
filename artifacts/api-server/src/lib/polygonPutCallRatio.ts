import { logger as baseLogger } from "./logger.js";

const logger = baseLogger.child({ module: "polygonPCRatio" });

const POLYGON_API = "https://api.polygon.io";
const POLL_INTERVAL_MS = 60_000;
const PAGE_LIMIT = 250;

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

interface PolygonSnapshotContractDay {
  volume?: number;
}

interface PolygonSnapshotContract {
  day?: PolygonSnapshotContractDay;
}

/** Polygon v3 snapshot options page (`next_url` pagination). */
interface PolygonOptionsSnapshotPage {
  results?: PolygonSnapshotContract[];
  next_url?: string;
}

async function fetchTotalVolume(
  underlying: string,
  contractType: "put" | "call",
  apiKey: string,
): Promise<number> {
  let totalVolume = 0;
  let url: string | null =
    `${POLYGON_API}/v3/snapshot/options/${encodeURIComponent(underlying)}?contract_type=${contractType}&limit=${PAGE_LIMIT}&apiKey=${apiKey}`;

  let pages = 0;
  const maxPages = 40;

  while (url && pages < maxPages) {
    pages++;
    const resp = await fetch(url);
    if (!resp.ok) {
      logger.warn({ status: resp.status, underlying, contractType }, "Polygon options snapshot request failed");
      break;
    }
    const data = (await resp.json()) as PolygonOptionsSnapshotPage;
    const results = data.results ?? [];
    for (const r of results) {
      totalVolume += r?.day?.volume ?? 0;
    }
    const nextUrl = data.next_url;
    url = nextUrl ? `${nextUrl}&apiKey=${apiKey}` : null;
  }

  return totalVolume;
}

async function computeRatio(underlying: string, apiKey: string): Promise<PCRatioData> {
  const [putVol, callVol] = await Promise.all([
    fetchTotalVolume(underlying, "put", apiKey),
    fetchTotalVolume(underlying, "call", apiKey),
  ]);

  const ratio = callVol > 0 ? Math.round((putVol / callVol) * 10000) / 10000 : null;

  return {
    putVolume: putVol,
    callVolume: callVol,
    ratio,
    ts: Date.now(),
  };
}

async function pollOnce(apiKey: string) {
  try {
    const [eq, idx] = await Promise.all([
      computeRatio("SPY", apiKey),
      computeRatio("SPX", apiKey),
    ]);
    equityPC = eq;
    indexPC = idx;
    logger.info(
      {
        equityRatio: eq.ratio,
        equityPuts: eq.putVolume,
        equityCalls: eq.callVolume,
        indexRatio: idx.ratio,
        indexPuts: idx.putVolume,
        indexCalls: idx.callVolume,
      },
      "Polygon P/C ratios updated",
    );
  } catch (err: any) {
    logger.error({ err: err?.message ?? err }, "Polygon P/C ratio poll failed");
  }
}

export function startPolygonPCRatioPoller() {
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    logger.warn("No POLYGON_API_KEY — P/C ratio polling disabled");
    return;
  }

  if (pollTimer) return;

  logger.info("Starting Polygon P/C ratio poller (60s interval)");
  pollOnce(apiKey);
  pollTimer = setInterval(() => pollOnce(apiKey), POLL_INTERVAL_MS);
}

export function stopPolygonPCRatioPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
