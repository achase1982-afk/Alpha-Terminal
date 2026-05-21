/**
 * Unified analyst coverage for Company Valuation and chat.
 * Prefers working sources (Benzinga direct, FMP, Schwab). Polygon Benzinga is optional when entitled.
 */
const POLYGON_BLOCK_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ANALYST_LIMIT = 20;

let polygonBenzingaBlocked = false;
let polygonBlockedAtMs = 0;

/** Test hook — reset Polygon entitlement cache. */
export function resetPolygonBenzingaBlockCache(): void {
  polygonBenzingaBlocked = false;
  polygonBlockedAtMs = 0;
}

function polygonBenzingaDisabledByEnv(): boolean {
  const v = (process.env["POLYGON_BENZINGA_RATINGS_DISABLED"] ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function shouldSkipPolygonBenzinga(): boolean {
  if (polygonBenzingaDisabledByEnv()) return true;
  if (!polygonBenzingaBlocked) return false;
  if (Date.now() - polygonBlockedAtMs > POLYGON_BLOCK_TTL_MS) {
    polygonBenzingaBlocked = false;
    return false;
  }
  return true;
}

function markPolygonBenzingaUnauthorized(reason: string | null | undefined): void {
  if (!reason || !/NOT_AUTHORIZED|not entitled/i.test(reason)) return;
  polygonBenzingaBlocked = true;
  polygonBlockedAtMs = Date.now();
}
import { getBestAccessToken } from "./tokenStore.js";
import { getAnalystPriceTargets, getRecentAnalystGrades } from "./fmpDataService.js";
import {
  aggregateBenzingaRatings,
  consensusRatingLabel,
  emptyConsensus,
  fetchPolygonAnalystRatingsAndConsensus,
  mapRatingToBucket,
  type AnalystAggregationConsensus,
  type PolygonAnalystRatingRow,
} from "./polygonAnalystData.js";

export type AnalystCoverageSource =
  | "polygon_benzinga"
  | "benzinga_direct"
  | "fmp_db"
  | "schwab_fundamental"
  | "none";

export interface AnalystCoverageResult {
  symbol: string;
  ratings: PolygonAnalystRatingRow[];
  consensus: {
    consensus_pt: number | null;
    high_pt: number | null;
    low_pt: number | null;
    num_active_analysts: number;
    strong_buy: number;
    buy: number;
    hold: number;
    sell: number;
    strong_sell: number;
  };
  coverage_reason: string | null;
  data_source: AnalystCoverageSource;
  upstream_records: number;
  filtered_records: number;
  /** Human-readable note for UI (e.g. Schwab snapshot vs full history). */
  source_note: string | null;
}

function pickNum(obj: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

async function fetchFromPolygon(symbol: string, limit: number): Promise<AnalystCoverageResult | null> {
  if (shouldSkipPolygonBenzinga()) return null;
  const pack = await fetchPolygonAnalystRatingsAndConsensus(symbol, limit);
  if (!pack) return null;
  const reason = pack.analystConsensus.coverage_reason ?? "";
  if (/NOT_AUTHORIZED|not entitled/i.test(reason)) {
    markPolygonBenzingaUnauthorized(reason);
    return null;
  }
  if (pack.ratings.length === 0 && pack.consensus.num_active_analysts === 0 && reason) {
    markPolygonBenzingaUnauthorized(reason);
    if (reason.includes("polygon_ratings_unavailable")) return null;
  }
  if (pack.ratings.length === 0 && pack.consensus.num_active_analysts === 0) return null;

  return {
    symbol: pack.symbol,
    ratings: pack.ratings,
    consensus: {
      consensus_pt: pack.consensus.consensus_pt,
      high_pt: pack.consensus.high_pt,
      low_pt: pack.consensus.low_pt,
      num_active_analysts: pack.consensus.num_active_analysts,
      strong_buy: pack.consensus.strong_buy,
      buy: pack.consensus.buy,
      hold: pack.consensus.hold,
      sell: pack.consensus.sell,
      strong_sell: pack.consensus.strong_sell,
    },
    coverage_reason: pack.analystConsensus.coverage_reason,
    data_source: "polygon_benzinga",
    upstream_records: pack.rawCount,
    filtered_records: pack.filteredCount,
    source_note: "Polygon/Massive Benzinga partner ratings (120-day firm dedupe).",
  };
}

function benzingaCalendarRowToPolygonRaw(r: Record<string, unknown>): Record<string, unknown> {
  const ptCur = r.pt_current ?? r.ptCurrent;
  const ptPri = r.pt_prior ?? r.ptPrior;
  return {
    benzinga_id: r.id,
    firm: r.analyst ?? r.name ?? "",
    analyst: r.analyst_name ?? r.analystName ?? "",
    date: r.date,
    rating: r.rating_current ?? r.ratingCurrent,
    previous_rating: r.rating_prior ?? r.ratingPrior,
    price_target: typeof ptCur === "string" ? parseFloat(ptCur) : ptCur,
    previous_price_target: typeof ptPri === "string" ? parseFloat(ptPri) : ptPri,
    rating_action: r.action_company ?? r.actionCompany ?? "",
    price_target_action: r.action_pt ?? r.actionPt ?? "",
  };
}

async function fetchFromBenzingaDirect(symbol: string, limit: number): Promise<AnalystCoverageResult | null> {
  const key = (process.env["BENZINGA_API_KEY"] ?? "").trim();
  if (!key) return null;
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  try {
    const url =
      `https://api.benzinga.com/api/v2.1/calendar/ratings?token=${encodeURIComponent(key)}` +
      `&pageSize=1000&parameters%5Btickers%5D=${encodeURIComponent(sym)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ratings?: Array<Record<string, unknown>> };
    const items = (data.ratings ?? []).filter((r) => {
      const t = String(r.ticker ?? "").toUpperCase();
      return t === sym;
    });
    if (items.length === 0) return null;

    const rawRows = items.map((r) => benzingaCalendarRowToPolygonRaw(r));
    const { consensus, dedupedActions, rawCount, filteredCount } = aggregateBenzingaRatings(sym, rawRows);
    const ratings: PolygonAnalystRatingRow[] = dedupedActions.slice(0, limit).map((row) => ({
      id: row.id,
      firm: row.firm,
      analyst: row.analyst,
      action_type: row.action_type,
      rating_prior: row.rating_prior,
      rating_current: row.rating_current,
      pt_prior: row.pt_prior,
      pt_current: row.pt_current,
      date: row.date,
      time: row.time,
      rating_action: row.rating_action,
      price_target_action: row.price_target_action,
    }));

    return {
      symbol: sym,
      ratings,
      consensus: {
        consensus_pt: consensus.consensus_pt,
        high_pt: consensus.high_pt,
        low_pt: consensus.low_pt,
        num_active_analysts: consensus.num_active_analysts,
        strong_buy: consensus.strong_buy,
        buy: consensus.buy,
        hold: consensus.hold,
        sell: consensus.sell,
        strong_sell: consensus.strong_sell,
      },
      coverage_reason: ratings.length === 0 ? "no_recent_coverage" : null,
      data_source: "benzinga_direct",
      upstream_records: rawCount,
      filtered_records: filteredCount,
      source_note: "Benzinga calendar ratings API (direct key).",
    };
  } catch {
    return null;
  }
}

function buildConsensusFromDistribution(dist: {
  strong_buy: number;
  buy: number;
  hold: number;
  sell: number;
  strong_sell: number;
}): AnalystAggregationConsensus {
  const total = dist.strong_buy + dist.buy + dist.hold + dist.sell + dist.strong_sell;
  return {
    consensus_pt: null,
    high_pt: null,
    low_pt: null,
    num_active_analysts: total,
    ...dist,
    consensus_as_of_date: new Date().toISOString().slice(0, 10),
  };
}

async function fetchFromFmpDb(symbol: string, limit: number): Promise<AnalystCoverageResult | null> {
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  const [grades, pt] = await Promise.all([
    getRecentAnalystGrades(sym, 120),
    getAnalystPriceTargets(sym),
  ]);
  if (grades.length === 0 && !pt) return null;

  const dist = { strong_buy: 0, buy: 0, hold: 0, sell: 0, strong_sell: 0 };
  const ratings: PolygonAnalystRatingRow[] = [];
  for (const g of grades.slice(0, limit)) {
    const bucket = mapRatingToBucket(g.newGrade);
    if (bucket) dist[bucket]++;
    ratings.push({
      id: `${g.gradingCompany ?? "firm"}-${g.actionDate}-${g.action}`,
      firm: g.gradingCompany ?? "—",
      analyst: "—",
      action_type: (g.action || "grade").toLowerCase().replace(/\s+/g, "_"),
      rating_prior: g.previousGrade,
      rating_current: g.newGrade,
      pt_prior: null,
      pt_current: pt?.targetConsensus ?? null,
      date: g.actionDate,
      time: null,
      rating_action: g.action,
      price_target_action: null,
    });
  }

  let consensus = buildConsensusFromDistribution(dist);
  if (pt) {
    consensus = {
      ...consensus,
      consensus_pt: pt.targetConsensus ?? pt.targetMedian ?? consensus.consensus_pt,
      high_pt: pt.targetHigh ?? consensus.high_pt,
      low_pt: pt.targetLow ?? consensus.low_pt,
      num_active_analysts: pt.numAnalysts ?? consensus.num_active_analysts,
      consensus_as_of_date: pt.asOfDate ?? consensus.consensus_as_of_date,
    };
  }

  if (ratings.length === 0 && !consensus.consensus_pt) return null;

  return {
    symbol: sym,
    ratings,
    consensus: {
      consensus_pt: consensus.consensus_pt,
      high_pt: consensus.high_pt,
      low_pt: consensus.low_pt,
      num_active_analysts: consensus.num_active_analysts,
      strong_buy: consensus.strong_buy,
      buy: consensus.buy,
      hold: consensus.hold,
      sell: consensus.sell,
      strong_sell: consensus.strong_sell,
    },
    coverage_reason: ratings.length === 0 ? "fmp_price_target_only" : null,
    data_source: "fmp_db",
    upstream_records: grades.length,
    filtered_records: ratings.length,
    source_note: "FMP backfill (grades + price target consensus in Postgres).",
  };
}

async function fetchFromSchwabFundamental(symbol: string): Promise<AnalystCoverageResult | null> {
  const token = getBestAccessToken();
  if (!token) return null;
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  try {
    const res = await fetch(
      `https://api.schwabapi.com/marketdata/v1/quotes?symbols=${encodeURIComponent(sym)}&fields=fundamental`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const entry = (json[sym] ?? Object.values(json)[0]) as Record<string, unknown> | undefined;
    const f = (entry?.["fundamental"] ?? {}) as Record<string, unknown>;

    const strong_buy = pickNum(f, ["strongBuyRatings", "strongBuy"]) ?? 0;
    const buy = pickNum(f, ["buyRatings", "buy"]) ?? 0;
    const hold = pickNum(f, ["holdRatings", "hold"]) ?? 0;
    const sell = pickNum(f, ["sellRatings", "sell"]) ?? 0;
    const strong_sell = pickNum(f, ["strongSellRatings", "strongSell"]) ?? 0;
    const numAnalysts = pickNum(f, ["numAnalysts", "numberOfAnalysts"]) ?? 0;
    const total = strong_buy + buy + hold + sell + strong_sell;
    if (total === 0 && numAnalysts === 0 && pickNum(f, ["targetMeanPrice", "targetHighPrice", "targetLowPrice"]) == null) {
      return null;
    }

    const consensus_pt = pickNum(f, ["targetMeanPrice", "targetMean", "consensusTargetPrice"]);
    const high_pt = pickNum(f, ["targetHighPrice", "targetHigh"]);
    const low_pt = pickNum(f, ["targetLowPrice", "targetLow"]);

    const dist = { strong_buy, buy, hold, sell, strong_sell };
    const consensus = buildConsensusFromDistribution(dist);
    consensus.consensus_pt = consensus_pt;
    consensus.high_pt = high_pt;
    consensus.low_pt = low_pt;
    consensus.num_active_analysts = numAnalysts > 0 ? Math.floor(numAnalysts) : total;

    const label = consensusRatingLabel(consensus);

    return {
      symbol: sym,
      ratings: [],
      consensus: {
        consensus_pt: consensus.consensus_pt,
        high_pt: consensus.high_pt,
        low_pt: consensus.low_pt,
        num_active_analysts: consensus.num_active_analysts,
        strong_buy: consensus.strong_buy,
        buy: consensus.buy,
        hold: consensus.hold,
        sell: consensus.sell,
        strong_sell: consensus.strong_sell,
      },
      coverage_reason: null,
      data_source: "schwab_fundamental",
      upstream_records: 0,
      filtered_records: 0,
      source_note:
        `Schwab quote fundamental snapshot (consensus counts${label ? `, ~${label.replace(/_/g, " ")}` : ""}). ` +
        "Per-firm rating history requires Polygon/Benzinga or FMP — not individual Form 4-style rows.",
    };
  } catch {
    return null;
  }
}

function emptyResult(symbol: string, reason: string): AnalystCoverageResult {
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  const ac = emptyConsensus(sym, reason);
  return {
    symbol: sym,
    ratings: [],
    consensus: {
      consensus_pt: null,
      high_pt: null,
      low_pt: null,
      num_active_analysts: 0,
      strong_buy: 0,
      buy: 0,
      hold: 0,
      sell: 0,
      strong_sell: 0,
    },
    coverage_reason: reason,
    data_source: "none",
    upstream_records: 0,
    filtered_records: 0,
    source_note: null,
  };
}

/**
 * Resolve analyst coverage for Valuation tab and chat.
 * Order: Benzinga direct → FMP DB → Schwab snapshot → Polygon Benzinga (only when entitled).
 */
export async function fetchAnalystCoverage(symbol: string, limit = DEFAULT_ANALYST_LIMIT): Promise<AnalystCoverageResult> {
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  const lim = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : DEFAULT_ANALYST_LIMIT;

  const benzinga = await fetchFromBenzingaDirect(sym, lim);
  if (benzinga) return benzinga;

  const fmp = await fetchFromFmpDb(sym, lim);
  if (fmp) return fmp;

  const schwab = await fetchFromSchwabFundamental(sym);
  if (schwab) return schwab;

  const polygon = await fetchFromPolygon(sym, lim);
  if (polygon) return polygon;

  const reason = shouldSkipPolygonBenzinga()
    ? "Analyst coverage unavailable (Polygon Benzinga ratings not entitled; set BENZINGA_API_KEY, refresh FMP backfill, or connect Schwab)."
    : "Analyst coverage unavailable (no Benzinga/FMP/Schwab data and Polygon returned no rows).";

  return emptyResult(sym, reason);
}
