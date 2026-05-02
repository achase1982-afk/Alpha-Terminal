/**
 * Server-side Polygon Benzinga partner analyst endpoints (same upstream as
 * GET /api/polygon/analyst-*). Used by routes and Strategist data package.
 */

const POLYGON_BASE = "https://api.polygon.io";

function polygonKey(): string | null {
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
  /** As-of date for consensus PT from upstream, if the API provides one. */
  consensusPriceTargetAsOfDate: string | null;
  /** Derived from `consensusPriceTargetAsOfDate` vs current calendar date. */
  consensusPriceTargetFreshness: ConsensusPriceTargetFreshness;
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

/** Extract a consensus as-of / update date from a Polygon Benzinga consensus row. */
function consensusAsOfFromRow(row: Record<string, unknown>): string | null {
  const keys = [
    "as_of", "asOf", "as_of_date", "asOfDate", "last_updated", "lastUpdated",
    "updated_at", "updatedAt", "consensus_date", "consensusDate",
  ];
  for (const k of keys) {
    const y = firstYmdString(row[k]);
    if (y) return y;
  }
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

function consensusDefaults(_sym: string): Pick<
  PolygonAnalystConsensus,
  "consensusPriceTargetAsOfDate" | "consensusPriceTargetFreshness"
> {
  return {
    consensusPriceTargetAsOfDate: null,
    consensusPriceTargetFreshness: "unknown",
  };
}

function normalizeAction(ratingAction: string, ptAction: string): string {
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

export async function fetchPolygonAnalystConsensus(symbol: string): Promise<PolygonAnalystConsensus | null> {
  const key = polygonKey();
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  if (!key || !sym) return null;
  try {
    const url = `${POLYGON_BASE}/benzinga/v1/consensus-ratings/${encodeURIComponent(sym)}?apiKey=${encodeURIComponent(key)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return null;
    const data = (await r.json()) as { results?: Array<Record<string, unknown>> };
    const row = data.results?.[0] as Record<string, unknown> | undefined;
    if (!row) {
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
        ...consensusDefaults(sym),
      };
    }
    const asOf = consensusAsOfFromRow(row);
    return {
      symbol: sym,
      consensus_price_target: typeof row["consensus_price_target"] === "number" ? row["consensus_price_target"] : null,
      high_pt: typeof row["high_price_target"] === "number" ? row["high_price_target"] : null,
      low_pt: typeof row["low_price_target"] === "number" ? row["low_price_target"] : null,
      num_analysts: typeof row["ratings_contributors"] === "number" ? row["ratings_contributors"] : null,
      strong_buy: typeof row["strong_buy_ratings"] === "number" ? row["strong_buy_ratings"] : null,
      buy: typeof row["buy_ratings"] === "number" ? row["buy_ratings"] : null,
      hold: typeof row["hold_ratings"] === "number" ? row["hold_ratings"] : null,
      sell: typeof row["sell_ratings"] === "number" ? row["sell_ratings"] : null,
      strong_sell: typeof row["strong_sell_ratings"] === "number" ? row["strong_sell_ratings"] : null,
      consensus_rating: typeof row["consensus_rating"] === "string" ? row["consensus_rating"] : null,
      consensus_rating_value: typeof row["consensus_rating_value"] === "number" ? row["consensus_rating_value"] : null,
      consensusPriceTargetAsOfDate: asOf,
      consensusPriceTargetFreshness: consensusFreshness(asOf),
    };
  } catch {
    return null;
  }
}

export async function fetchPolygonAnalystRatings(
  symbol: string,
  limit = 50,
): Promise<{ symbol: string; ratings: PolygonAnalystRatingRow[] } | null> {
  const key = polygonKey();
  const sym = symbol.trim().toUpperCase().replace(/^\$/, "");
  if (!key || !sym) return null;
  const lim = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 50;
  try {
    const url = `${POLYGON_BASE}/benzinga/v1/ratings?ticker=${encodeURIComponent(sym)}&limit=${lim}&sort=date.desc&apiKey=${encodeURIComponent(key)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const data = (await r.json()) as { results?: Array<Record<string, unknown>> };
    const rows = data.results || [];
    const ratings: PolygonAnalystRatingRow[] = rows.map((row) => {
      const ratingAction = typeof row["rating_action"] === "string" ? row["rating_action"] : "";
      const ptAction = typeof row["price_target_action"] === "string" ? row["price_target_action"] : "";
      const actionType = normalizeAction(ratingAction, ptAction);
      return {
        id: String(row["benzinga_id"] ?? row["id"] ?? ""),
        firm: typeof row["firm"] === "string" ? row["firm"] : "",
        analyst: typeof row["analyst"] === "string" ? row["analyst"] : "",
        action_type: actionType,
        rating_prior: typeof row["previous_rating"] === "string" ? row["previous_rating"] : null,
        rating_current: typeof row["rating"] === "string" ? row["rating"] : null,
        pt_prior: typeof row["previous_price_target"] === "number" ? row["previous_price_target"] : null,
        pt_current: typeof row["price_target"] === "number" ? row["price_target"] : null,
        date: typeof row["date"] === "string" ? row["date"] : "",
        time: typeof row["time"] === "string" ? row["time"] : null,
        rating_action: ratingAction || null,
        price_target_action: ptAction || null,
      };
    });
    return { symbol: sym, ratings };
  } catch {
    return null;
  }
}
