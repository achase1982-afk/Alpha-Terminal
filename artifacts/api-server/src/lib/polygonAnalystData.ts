import { appendPolygonApiTraceRecord } from "./polygonApiTrace.js";

/**
 * Polygon Benzinga partner analyst ratings (api.polygon.io/benzinga/v1/ratings).
 * Shared aggregation for GET /api/polygon/analyst-ratings and Strategist enrichment.
 */

const POLYGON_BASE = "https://api.polygon.io";

export function polygonKey(): string | null {
  const k = process.env["POLYGON_API_KEY"];
  return k && k.length > 0 ? k : null;
}

export type ConsensusPriceTargetFreshness = "fresh" | "stale" | "unknown";

export interface PolygonAnalystConsensus {
  symbol: string;
  consensus_price_target: number | null;
  high_pt: number | null;
  low_pt: number | null;
  num_analysts: number | null;
  strong_buy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strong_sell: number | null;
  consensus_rating: string | null;
  consensus_rating_value: number | null;
  consensusPriceTargetAsOfDate: string | null;
  consensusPriceTargetFreshness: ConsensusPriceTargetFreshness;
  /** Set when consensus fields are null (e.g. no rows in the last 120 days). */
  coverage_reason: string | null;
}

export interface PolygonAnalystRatingRow {
  id: string;
  firm: string;
  analyst: string;
  action_type: string;
  rating_prior: string | null;
  rating_current: string | null;
  pt_prior: number | null;
  pt_current: number | null;
  date: string;
  time: string | null;
  rating_action: string | null;
  price_target_action: string | null;
}

function firstYmdString(v: unknown): string | null {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

function consensusFreshness(asOf: string | null): ConsensusPriceTargetFreshness {
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return "unknown";
  const asOfMs = new Date(`${asOf}T00:00:00Z`).getTime();
  const todayMs = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(asOfMs)) return "unknown";
  const ageDays = Math.floor((todayMs - asOfMs) / 86_400_000);
  return ageDays <= 30 ? "fresh" : "stale";
}

export function parseActionDate(dateStr: string, timeStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const t = timeStr && /^\d{1,2}:\d{2}/.test(timeStr) ? timeStr : "12:00:00";
  const normalized = t.length === 5 ? `${t}:00` : t;
  const d = new Date(`${dateStr}T${normalized}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeAction(ratingAction: string, ptAction: string): string {
  const ra = ratingAction.toLowerCase();
  if (ra.includes("initiate")) return "initiated";
  if (ra.includes("upgrade")) return "upgraded";
  if (ra.includes("downgrade")) return "downgraded";
  if (ra.includes("maintain") || ra.includes("reiterat")) return "maintained";
  const pta = ptAction.toLowerCase();
  if (pta.includes("raise") || pta.includes("lower") || pta.includes("set") || pta.includes("announc")) {
    return pta.includes("raise") ? "pt_raised" : pta.includes("lower") ? "pt_lowered" : "pt_updated";
  }
  return ratingAction ? ratingAction.replace(/_/g, " ") : (ptAction || "action");
}

type RatingBucket = "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";

function mapRatingToBucket(rating: string | null | undefined): RatingBucket | null {
  if (!rating) return null;
  const s = rating.toLowerCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/(strong\s*buy|conviction\s*buy|top\s*pick)/.test(s)) return "strong_buy";
  if (/(strong\s*sell)/.test(s)) return "strong_sell";
  if (/(^buy|outperform|overweight|positive|accumulat|sector\s*outperform)/.test(s)) return "buy";
  if (/(^sell|underperform|under\s*weight|reduce)/.test(s)) return "sell";
  if (/(hold|neutral|market\s*perform|sector\s*perform|equal[\s-]*weight|in[\s-]*line|peer\s*perform|mixed)/.test(s)) {
    return "hold";
  }
  if (s.includes("buy")) return "buy";
  if (s.includes("sell")) return "sell";
  return "hold";
}

export interface ParsedAnalystActionRow {
  id: string;
  firm: string;
  analyst: string;
  action_type: string;
  rating_prior: string | null;
  rating_current: string | null;
  pt_prior: number | null;
  pt_current: number | null;
  date: string;
  time: string | null;
  rating_action: string | null;
  price_target_action: string | null;
  action_company: string | null;
}

/** Map one Benzinga /v1/ratings API result row to our normalized shape. */
export function parsePolygonBenzingaRatingRow(row: Record<string, unknown>): ParsedAnalystActionRow | null {
  const ratingAction = typeof row["rating_action"] === "string" ? row["rating_action"] : "";
  const ptAction = typeof row["price_target_action"] === "string" ? row["price_target_action"] : "";
  const ac = typeof row["action_company"] === "string" ? row["action_company"] : null;
  const pt = typeof row["price_target"] === "number" ? row["price_target"] : null;
  const firm = typeof row["firm"] === "string" ? row["firm"].trim() : "";
  const analyst = typeof row["analyst"] === "string" ? row["analyst"].trim() : "";
  const date =
    typeof row["date"] === "string"
      ? row["date"]
      : firstYmdString(row["published_date"])
      ?? firstYmdString(row["updated_at"])
      ?? "";
  const time = typeof row["time"] === "string" ? row["time"] : null;
  const id = String(row["benzinga_id"] ?? row["id"] ?? "");
  return {
    id: id || `${firm}-${date}-${analyst}`,
    firm,
    analyst,
    action_type: normalizeAction(ratingAction, ptAction),
    rating_prior: typeof row["previous_rating"] === "string" ? row["previous_rating"] : null,
    rating_current: typeof row["rating"] === "string" ? row["rating"] : null,
    pt_prior: typeof row["previous_price_target"] === "number" ? row["previous_price_target"] : null,
    pt_current: pt,
    date,
    time,
    rating_action: ratingAction || null,
    price_target_action: ptAction || null,
    action_company: ac,
  };
}

export interface AnalystAggregationConsensus {
  consensus_pt: number | null;
  high_pt: number | null;
  low_pt: number | null;
  num_active_analysts: number;
  strong_buy: number;
  buy: number;
  hold: number;
  sell: number;
  strong_sell: number;
  consensus_as_of_date: string | null;
}

const LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * Filter to last 120 calendar days, dedupe by firm (latest action wins),
 * require finite PT > 0. Mean/min/max over deduped PTs; analyst count = unique firms.
 */
export function aggregateBenzingaRatings(
  _symbol: string,
  rawRows: Array<Record<string, unknown>>,
): {
  consensus: AnalystAggregationConsensus;
  dedupedActions: ParsedAnalystActionRow[];
  rawCount: number;
  filteredCount: number;
} {
  const now = Date.now();
  const cutoff = now - LOOKBACK_MS;

  const actions: ParsedAnalystActionRow[] = [];
  for (const row of rawRows) {
    const a = parsePolygonBenzingaRatingRow(row);
    if (!a.date) continue;
    const ad = parseActionDate(a.date, a.time);
    if (!ad || ad.getTime() < cutoff) continue;

    const ac = (a.action_company || "").trim();
    const rc = (a.rating_current || "").trim();
    if (ac.toLowerCase() === "downgrades" && !rc) continue;

    const pt = a.pt_current;
    if (pt == null || typeof pt !== "number" || !Number.isFinite(pt) || pt <= 0) continue;

    actions.push(a);
  }

  const filteredSorted = [...actions].sort((x, y) => {
    const dx = parseActionDate(x.date, x.time)?.getTime() ?? 0;
    const dy = parseActionDate(y.date, y.time)?.getTime() ?? 0;
    return dy - dx;
  });

  const byFirm = new Map<string, ParsedAnalystActionRow>();
  for (const row of filteredSorted) {
    const firmKey = row.firm.trim().toLowerCase();
    if (!firmKey) continue;
    const prev = byFirm.get(firmKey);
    const curD = parseActionDate(row.date, row.time);
    const prevD = prev ? parseActionDate(prev.date, prev.time) : null;
    if (!prev || (curD && prevD && curD > prevD)) byFirm.set(firmKey, row);
  }

  const deduped = Array.from(byFirm.values()).sort((a, b) => {
    const da = parseActionDate(a.date, a.time)?.getTime() ?? 0;
    const db = parseActionDate(b.date, b.time)?.getTime() ?? 0;
    return db - da;
  });

  const pts = deduped.map((r) => r.pt_current!).filter((p) => p > 0 && Number.isFinite(p));
  const consensus_pt = pts.length > 0 ? Math.round((pts.reduce((s, v) => s + v, 0) / pts.length) * 100) / 100 : null;
  const high_pt = pts.length > 0 ? Math.round(Math.max(...pts) * 100) / 100 : null;
  const low_pt = pts.length > 0 ? Math.round(Math.min(...pts) * 100) / 100 : null;

  const dist: Record<RatingBucket, number> = {
    strong_buy: 0, buy: 0, hold: 0, sell: 0, strong_sell: 0,
  };
  for (const row of deduped) {
    const b = mapRatingToBucket(row.rating_current);
    if (b) dist[b] += 1;
  }

  let consensus_as_of_date: string | null = null;
  for (const row of deduped) {
    const y = row.date && /^\d{4}-\d{2}-\d{2}/.test(row.date) ? row.date.slice(0, 10) : null;
    if (y && (!consensus_as_of_date || y > consensus_as_of_date)) consensus_as_of_date = y;
  }

  return {
    consensus: {
      consensus_pt,
      high_pt,
      low_pt,
      num_active_analysts: deduped.length,
      strong_buy: dist.strong_buy,
      buy: dist.buy,
      hold: dist.hold,
      sell: dist.sell,
      strong_sell: dist.strong_sell,
      consensus_as_of_date,
    },
    dedupedActions: deduped,
    rawCount: rawRows.length,
    filteredCount: actions.length,
  };
}

function emptyConsensus(sym: string, coverage_reason: string | null): PolygonAnalystConsensus {
  return {
    symbol: sym,
    consensus_price_target: null,
    high_pt: null,
    low_pt: null,
    num_analysts: null,
    strong_buy: null,
    buy: null,
    hold: null,
    sell: null,
    strong_sell: null,
    consensus_rating: null,
    consensus_rating_value: null,
    consensusPriceTargetAsOfDate: null,
    consensusPriceTargetFreshness: "unknown",
    coverage_reason,
  };
}

function consensusRatingLabel(dist: AnalystAggregationConsensus): string | null {
  const total =
    dist.strong_buy + dist.buy + dist.hold + dist.sell + dist.strong_sell;
  if (total <= 0) return null;
  const score =
    (dist.strong_buy * 5 + dist.buy * 4 + dist.hold * 3 + dist.sell * 2 + dist.strong_sell * 1) / total;
  const rounded = Math.round(score * 100) / 100;
  if (rounded >= 4.5) return "strong_buy";
  if (rounded >= 3.5) return "buy";
  if (rounded >= 2.5) return "hold";
  if (rounded >= 1.5) return "sell";
  return "strong_sell";
}

/** Fetch all Benzinga rating rows for a ticker (paginated via next_url). */
export async function fetchPolygonBenzingaRatingsAllPages(symbol: string): Promise<{
  ok: boolean;
  rows: Array<Record<string, unknown>>;
  errorMessage: string | null;
}> {
  const key = polygonKey();
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  if (!key || !sym) {
    return { ok: false, rows: [], errorMessage: "POLYGON_API_KEY not configured" };
  }

  const rows: Array<Record<string, unknown>> = [];
  let url: string | null =
    `${POLYGON_BASE}/benzinga/v1/ratings?ticker=${encodeURIComponent(sym)}&limit=1000&sort=date.desc&apiKey=${encodeURIComponent(key)}`;

  while (url) {
    const pageUrl = url;
    const pathForTrace = (() => {
      try {
        const u = new URL(pageUrl.replace(/\bapiKey=[^&]+/i, "apiKey=[REDACTED]"));
        return u.pathname + u.search;
      } catch {
        return pageUrl.split("?")[0] ?? pageUrl;
      }
    })();
    const t0 = Date.now();
    let timedOut = false;
    try {
      const r = await fetch(pageUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
      appendPolygonApiTraceRecord({
        path: pathForTrace,
        method: "GET",
        statusCode: r.status,
        responseTimeMs: Date.now() - t0,
        saw429: r.status === 429,
        timedOut,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return {
          ok: false,
          rows: [],
          errorMessage: text.slice(0, 240) || `Polygon ratings HTTP ${r.status}`,
        };
      }
      const data = (await r.json()) as { results?: unknown[]; next_url?: string };
      const chunk = data.results;
      if (Array.isArray(chunk)) {
        for (const item of chunk) {
          if (item && typeof item === "object") rows.push(item as Record<string, unknown>);
        }
      }
      const nu = data.next_url;
      if (nu && typeof nu === "string") {
        url = nu.includes("apiKey=") ? nu : `${nu}${nu.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(key)}`;
      } else {
        url = null;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort|timeout/i.test(msg)) timedOut = true;
      appendPolygonApiTraceRecord({
        path: pathForTrace,
        method: "GET",
        statusCode: null,
        responseTimeMs: Date.now() - t0,
        timedOut,
      });
      return { ok: false, rows: [], errorMessage: msg };
    }
  }

  return { ok: true, rows, errorMessage: null };
}

export interface AnalystRatingsAndConsensusPayload {
  symbol: string;
  ratings: PolygonAnalystRatingRow[];
  consensus: AnalystAggregationConsensus;
  /** Strategist-facing envelope (null consensus_price_target when no coverage). */
  analystConsensus: PolygonAnalystConsensus;
  rawCount: number;
  filteredCount: number;
}

function mapRowsToRatingOutput(rows: ParsedAnalystActionRow[], limit: number): PolygonAnalystRatingRow[] {
  return rows.slice(0, limit).map((row) => ({
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
}

/** Full ratings + consensus from Benzinga (same shape as GET /api/polygon/analyst-ratings). */
export async function fetchPolygonAnalystRatingsAndConsensus(
  symbol: string,
  ratingsLimit = 500,
): Promise<AnalystRatingsAndConsensusPayload | null> {
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  const key = polygonKey();
  if (!key || !sym) return null;

  const fetched = await fetchPolygonBenzingaRatingsAllPages(sym);
  if (!fetched.ok) {
    const ac = emptyConsensus(sym, fetched.errorMessage ?? "polygon_ratings_unavailable");
    const zeroConsensus: AnalystAggregationConsensus = {
      consensus_pt: null,
      high_pt: null,
      low_pt: null,
      num_active_analysts: 0,
      strong_buy: 0,
      buy: 0,
      hold: 0,
      sell: 0,
      strong_sell: 0,
      consensus_as_of_date: null,
    };
    return {
      symbol: sym,
      ratings: [],
      consensus: zeroConsensus,
      analystConsensus: ac,
      rawCount: 0,
      filteredCount: 0,
    };
  }

  const { consensus, dedupedActions, rawCount, filteredCount } = aggregateBenzingaRatings(sym, fetched.rows);
  const lim = Number.isFinite(ratingsLimit) ? Math.min(500, Math.max(1, Math.floor(ratingsLimit))) : 500;
  const ratings = mapRowsToRatingOutput(dedupedActions, lim);

  if (dedupedActions.length === 0) {
    const ac = emptyConsensus(sym, "no_recent_coverage");
    return {
      symbol: sym,
      ratings,
      consensus,
      analystConsensus: ac,
      rawCount,
      filteredCount,
    };
  }

  const asOf = consensus.consensus_as_of_date;
  const label = consensusRatingLabel(consensus);
  const totalR = consensus.strong_buy + consensus.buy + consensus.hold + consensus.sell + consensus.strong_sell;
  const score =
    totalR > 0
      ? Math.round(
        ((consensus.strong_buy * 5 + consensus.buy * 4 + consensus.hold * 3 + consensus.sell * 2 + consensus.strong_sell * 1)
          / totalR) * 100,
      ) / 100
      : null;

  const analystConsensus: PolygonAnalystConsensus = {
    symbol: sym,
    consensus_price_target: consensus.consensus_pt,
    high_pt: consensus.high_pt,
    low_pt: consensus.low_pt,
    num_analysts: consensus.num_active_analysts,
    strong_buy: consensus.strong_buy,
    buy: consensus.buy,
    hold: consensus.hold,
    sell: consensus.sell,
    strong_sell: consensus.strong_sell,
    consensus_rating: label,
    consensus_rating_value: score,
    consensusPriceTargetAsOfDate: asOf,
    consensusPriceTargetFreshness: consensusFreshness(asOf),
    coverage_reason: null,
  };

  return {
    symbol: sym,
    ratings,
    consensus,
    analystConsensus,
    rawCount,
    filteredCount,
  };
}

export async function fetchPolygonAnalystConsensus(symbol: string): Promise<PolygonAnalystConsensus | null> {
  const pack = await fetchPolygonAnalystRatingsAndConsensus(symbol, 1);
  return pack?.analystConsensus ?? null;
}

export async function fetchPolygonAnalystRatings(
  symbol: string,
  limit = 50,
): Promise<{ symbol: string; ratings: PolygonAnalystRatingRow[] } | null> {
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  if (!polygonKey() || !sym) return null;
  const lim = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.floor(limit))) : 50;
  const pack = await fetchPolygonAnalystRatingsAndConsensus(symbol, lim);
  if (!pack) return null;
  return { symbol: sym, ratings: pack.ratings };
}
