import { Router } from "express";
import { sql, eq, max, and } from "drizzle-orm";
import { db, optionsChainDailyTable, optionsFlowPerStrikeTable, schwabChainIngestMetricsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const POLYGON_API = "https://api.polygon.io";
const REFERENCE_CONTRACT_CACHE_MS = 4 * 60 * 60 * 1000;
const REFERENCE_MAX_PAGES = 500;

const referenceContractCountCache = new Map<string, { fetchedAt: number; count: number }>();

function requireAdmin(req: { headers: Record<string, string | string[] | undefined> }): { ok: boolean; error?: string } {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return { ok: false, error: "ADMIN_API_KEY is not set on the server" };
  if (req.headers["x-admin-key"] !== adminKey) return { ok: false, error: "Unauthorized" };
  return { ok: true };
}

function parseSymbolsParam(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  const parts = raw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts.slice(0, 50)) {
    if (!/^[A-Z0-9.$]{1,15}$/.test(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function formatSqlDate(d: unknown): string | null {
  if (d == null) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === "string") return d.slice(0, 10);
  return String(d).slice(0, 10);
}

async function getLatestChainDailyDate(symbol: string): Promise<string | null> {
  const [row] = await db
    .select({ d: max(optionsChainDailyTable.date) })
    .from(optionsChainDailyTable)
    .where(eq(optionsChainDailyTable.underlyingSymbol, symbol));
  return formatSqlDate(row?.d);
}

async function getLatestFlowPerStrikeDate(symbol: string): Promise<string | null> {
  const [row] = await db
    .select({ d: max(optionsFlowPerStrikeTable.date) })
    .from(optionsFlowPerStrikeTable)
    .where(eq(optionsFlowPerStrikeTable.underlyingSymbol, symbol));
  return formatSqlDate(row?.d);
}

interface TableStats {
  contractCount: number | null;
  expirationCount: number | null;
  minExpiration: string | null;
  maxExpiration: string | null;
}

async function statsChainDaily(symbol: string, asOf: string | null): Promise<TableStats> {
  if (!asOf) {
    return { contractCount: null, expirationCount: null, minExpiration: null, maxExpiration: null };
  }
  const res = await db.execute(sql`
    SELECT
      COUNT(DISTINCT option_type || '|' || strike::text || '|' || expiration::text)::int AS contract_count,
      COUNT(DISTINCT expiration)::int AS expiration_count,
      MIN(expiration)::text AS min_exp,
      MAX(expiration)::text AS max_exp
    FROM options_chain_daily
    WHERE underlying_symbol = ${symbol} AND date = ${asOf}
  `);
  const rows = (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  const r = rows[0];
  if (!r) {
    return { contractCount: null, expirationCount: null, minExpiration: null, maxExpiration: null };
  }
  return {
    contractCount: typeof r.contract_count === "number" ? r.contract_count : Number(r.contract_count) || null,
    expirationCount: typeof r.expiration_count === "number" ? r.expiration_count : Number(r.expiration_count) || null,
    minExpiration: r.min_exp != null ? String(r.min_exp).slice(0, 10) : null,
    maxExpiration: r.max_exp != null ? String(r.max_exp).slice(0, 10) : null,
  };
}

async function statsFlowPerStrike(symbol: string, asOf: string | null): Promise<TableStats> {
  if (!asOf) {
    return { contractCount: null, expirationCount: null, minExpiration: null, maxExpiration: null };
  }
  const res = await db.execute(sql`
    SELECT
      COUNT(DISTINCT option_type || '|' || strike::text || '|' || expiration::text)::int AS contract_count,
      COUNT(DISTINCT expiration)::int AS expiration_count,
      MIN(expiration)::text AS min_exp,
      MAX(expiration)::text AS max_exp
    FROM options_flow_per_strike
    WHERE underlying_symbol = ${symbol} AND date = ${asOf}
  `);
  const rows = (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
  const r = rows[0];
  if (!r) {
    return { contractCount: null, expirationCount: null, minExpiration: null, maxExpiration: null };
  }
  return {
    contractCount: typeof r.contract_count === "number" ? r.contract_count : Number(r.contract_count) || null,
    expirationCount: typeof r.expiration_count === "number" ? r.expiration_count : Number(r.expiration_count) || null,
    minExpiration: r.min_exp != null ? String(r.min_exp).slice(0, 10) : null,
    maxExpiration: r.max_exp != null ? String(r.max_exp).slice(0, 10) : null,
  };
}

/**
 * Paginate Polygon reference options contracts for an underlying (active only).
 */
export async function fetchPolygonReferenceContractCount(symbol: string, apiKey: string): Promise<number | null> {
  const upper = symbol.toUpperCase();
  const cached = referenceContractCountCache.get(upper);
  if (cached && Date.now() - cached.fetchedAt < REFERENCE_CONTRACT_CACHE_MS) {
    return cached.count;
  }

  let total = 0;
  let pages = 0;
  let nextUrl: string | null =
    `${POLYGON_API}/v3/reference/options/contracts?underlying_ticker=${encodeURIComponent(upper)}&limit=1000&expired=false&sort=expiration_date&order=asc&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    while (nextUrl && pages < REFERENCE_MAX_PAGES) {
      const fetchUrl = nextUrl.includes("apiKey=") ? nextUrl : `${nextUrl}&apiKey=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(45_000) });
      if (!resp.ok) {
        logger.warn({ symbol: upper, status: resp.status }, "diagnostics: Polygon reference contracts HTTP non-OK");
        return null;
      }
      const json = (await resp.json()) as {
        results?: Array<{ contract_type?: string }>;
        next_url?: string | null;
        status?: string;
      };
      if (json.status === "ERROR" || !json.results?.length) break;
      for (const c of json.results) {
        const t = c.contract_type;
        if (t === "call" || t === "put") total++;
      }
      pages++;
      nextUrl = json.next_url ?? null;
    }
    if (nextUrl && pages >= REFERENCE_MAX_PAGES) {
      logger.warn({ symbol: upper, pages }, "diagnostics: Polygon reference contracts pagination cap reached");
    }
  } catch (err) {
    logger.warn({ err, symbol: upper }, "diagnostics: Polygon reference contracts fetch failed");
    return null;
  }

  referenceContractCountCache.set(upper, { fetchedAt: Date.now(), count: total });
  return total;
}

export interface ChainCoverageRow {
  symbol: string;
  chain_daily_contract_count: number | null;
  chain_daily_expiration_count: number | null;
  chain_daily_min_expiration: string | null;
  chain_daily_max_expiration: string | null;
  flow_per_strike_contract_count: number | null;
  flow_per_strike_expiration_count: number | null;
  flow_per_strike_min_expiration: string | null;
  flow_per_strike_max_expiration: string | null;
  polygon_reference_contract_count: number | null;
  coverage_ratio_chain_daily: number | null;
  coverage_ratio_flow: number | null;
  range_all_status: "ok" | "fallback_used" | "total_failure" | "skipped_dense_ticker" | null;
  last_attempt_timestamp: string | null;
  last_failure_reason: string | null;
  schwab_chain_range_all_failures_total: number | null;
  schwab_chain_bracketed_fallback_success_total: number | null;
  schwab_chain_total_failure_total: number | null;
}

function coveragePct(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

async function getSchwabIngestMetricsForChainDate(
  symbol: string,
  chainAsOf: string | null,
): Promise<typeof schwabChainIngestMetricsTable.$inferSelect | null> {
  if (!chainAsOf) return null;
  const [row] = await db
    .select()
    .from(schwabChainIngestMetricsTable)
    .where(
      and(
        eq(schwabChainIngestMetricsTable.underlyingSymbol, symbol),
        eq(schwabChainIngestMetricsTable.sessionDate, chainAsOf),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function buildChainCoverageRows(symbols: string[]): Promise<ChainCoverageRow[]> {
  const apiKey = process.env.POLYGON_API_KEY ?? "";
  const out: ChainCoverageRow[] = [];

  for (const symbol of symbols) {
    const chainAsOf = await getLatestChainDailyDate(symbol);
    const flowAsOf = await getLatestFlowPerStrikeDate(symbol);
    const chainStats = await statsChainDaily(symbol, chainAsOf);
    const flowStats = await statsFlowPerStrike(symbol, flowAsOf);
    const ingest = await getSchwabIngestMetricsForChainDate(symbol, chainAsOf);

    let refCount: number | null = null;
    if (apiKey) {
      refCount = await fetchPolygonReferenceContractCount(symbol, apiKey);
    }

    const status = ingest?.rangeAllStatus;
    const rangeAllStatus =
      status === "ok" || status === "fallback_used" || status === "total_failure" || status === "skipped_dense_ticker"
        ? status
        : null;

    out.push({
      symbol,
      chain_daily_contract_count: chainStats.contractCount,
      chain_daily_expiration_count: chainStats.expirationCount,
      chain_daily_min_expiration: chainStats.minExpiration,
      chain_daily_max_expiration: chainStats.maxExpiration,
      flow_per_strike_contract_count: flowStats.contractCount,
      flow_per_strike_expiration_count: flowStats.expirationCount,
      flow_per_strike_min_expiration: flowStats.minExpiration,
      flow_per_strike_max_expiration: flowStats.maxExpiration,
      polygon_reference_contract_count: refCount,
      coverage_ratio_chain_daily: coveragePct(chainStats.contractCount, refCount),
      coverage_ratio_flow: coveragePct(flowStats.contractCount, refCount),
      range_all_status: rangeAllStatus,
      last_attempt_timestamp: ingest?.lastAttemptAt instanceof Date
        ? ingest.lastAttemptAt.toISOString()
        : ingest?.lastAttemptAt
          ? String(ingest.lastAttemptAt)
          : null,
      last_failure_reason: ingest?.lastFailureReason ?? null,
      schwab_chain_range_all_failures_total: ingest?.rangeAllFailuresTotal ?? null,
      schwab_chain_bracketed_fallback_success_total: ingest?.bracketedFallbackSuccessTotal ?? null,
      schwab_chain_total_failure_total: ingest?.totalFailureTotal ?? null,
    });
  }

  return out;
}

const router = Router();

router.get("/chain-coverage", async (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });

  const symbols = parseSymbolsParam(req.query["symbols"]);
  if (!symbols.length) {
    return res.status(400).json({
      ok: false,
      error: "Query `symbols` is required (comma-separated tickers, max 50).",
    });
  }

  try {
    const rows = await buildChainCoverageRows(symbols);
    const lowCoverage = rows.filter(r => {
      const c = r.coverage_ratio_chain_daily;
      const f = r.coverage_ratio_flow;
      if (c != null && c < 50) return true;
      if (f != null && f < 50) return true;
      return false;
    });
    return res.json({
      ok: true,
      rows,
      ...(lowCoverage.length
        ? {
            coverage_warnings: lowCoverage.map(r => ({
              symbol: r.symbol,
              chain_daily_pct: r.coverage_ratio_chain_daily,
              flow_pct: r.coverage_ratio_flow,
            })),
          }
        : {}),
    });
  } catch (e) {
    logger.error({ err: e }, "diagnostics: chain-coverage failed");
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
