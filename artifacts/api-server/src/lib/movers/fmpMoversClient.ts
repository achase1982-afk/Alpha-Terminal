import { getFmpApiKeyOrThrow } from "../fmpClient.js";
import { FMP_HTTP_CONCURRENCY } from "../fmpClient.js";
import pLimit from "p-limit";

const FMP_STABLE_BASE = "https://financialmodelingprep.com/stable";
const httpLimit = pLimit(FMP_HTTP_CONCURRENCY);

export interface FmpMoverRow {
  symbol: string;
  price: number;
  name: string;
  change: number;
  changesPercentage: number;
  exchange: string;
}

function pickString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function normaliseMoverRow(raw: Record<string, unknown>): FmpMoverRow | null {
  const symbol = pickString(raw["symbol"])?.toUpperCase();
  const name = pickString(raw["name"]);
  const exchange = pickString(raw["exchange"]) ?? "";
  const price = pickNumber(raw["price"]);
  const change = pickNumber(raw["change"]) ?? 0;
  const changesPercentage =
    pickNumber(raw["changesPercentage"]) ?? pickNumber(raw["changePercentage"]) ?? 0;
  if (!symbol || !name || price == null) return null;
  return { symbol, name, exchange, price, change, changesPercentage };
}

async function fetchMoverList(path: "biggest-gainers" | "biggest-losers"): Promise<FmpMoverRow[]> {
  const apiKey = getFmpApiKeyOrThrow();
  const url = `${FMP_STABLE_BASE}/${path}?apikey=${encodeURIComponent(apiKey)}`;
  const res = await httpLimit(() =>
    fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }),
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FMP ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error(`FMP ${path}: expected JSON array`);
  }
  const out: FmpMoverRow[] = [];
  for (const item of data) {
    if (item && typeof item === "object") {
      const row = normaliseMoverRow(item as Record<string, unknown>);
      if (row) out.push(row);
    }
  }
  return out;
}

/** Gainers + losers only — most-actives is excluded (perpetual mega-cap volume, not movers). */
export async function fetchAllFmpMoverLists(): Promise<FmpMoverRow[]> {
  const [gainers, losers] = await Promise.all([
    fetchMoverList("biggest-gainers"),
    fetchMoverList("biggest-losers"),
  ]);
  const bySymbol = new Map<string, FmpMoverRow>();
  for (const row of [...gainers, ...losers]) {
    if (!bySymbol.has(row.symbol)) {
      bySymbol.set(row.symbol, row);
    }
  }
  return [...bySymbol.values()];
}
