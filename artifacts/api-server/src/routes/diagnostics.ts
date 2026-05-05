import { Router } from "express";
import { sql, eq, max, and } from "drizzle-orm";
import { db, optionsChainDailyTable, optionsFlowPerStrikeTable, schwabChainIngestMetricsTable } from "@workspace/db";
import { getFlowCaptureDiagnostics } from "../lib/flowCaptureService.js";
import { fetchPolygonReferenceContractCount } from "../lib/polygonReferenceContracts.js";
import {
  getIbkrTickPilotRunById,
  getLatestIbkrTickPilotSummary,
  listIbkrTickPilotRuns,
} from "../lib/ibkrTickEntitlementPilot.js";
import { logger } from "../lib/logger.js";

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
  range_all_status: "ok" | "fallback_used" | "total_failure" | "skipped_dense_ticker" | "thin_success_fallback" | null;
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
      status === "ok" ||
      status === "fallback_used" ||
      status === "total_failure" ||
      status === "skipped_dense_ticker" ||
      status === "thin_success_fallback"
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

router.get("/flow-capture", async (req, res) => {
  const auth = requireAdmin(req as never);
  if (!auth.ok) return res.status(403).json({ ok: false, error: auth.error });
  try {
    const d = getFlowCaptureDiagnostics();
    return res.json({ ok: true, ...d });
  } catch (e) {
    logger.error({ err: e }, "diagnostics: flow-capture failed");
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.get("/ibkr-tick-pilot/recent", async (_req, res) => {
  try {
    const runs = await listIbkrTickPilotRuns(10);
    return res.json({ ok: true, runs });
  } catch (e) {
    logger.error({ err: e }, "diagnostics: ibkr-tick-pilot recent failed");
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.get("/ibkr-tick-pilot/latest-summary", async (_req, res) => {
  try {
    const latest = await getLatestIbkrTickPilotSummary();
    return res.json({ ok: true, latest });
  } catch (e) {
    logger.error({ err: e }, "diagnostics: ibkr-tick-pilot latest-summary failed");
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

router.get("/ibkr-tick-pilot/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || typeof id !== "string") {
      return res.status(400).json({ ok: false, error: "Missing id" });
    }
    const row = await getIbkrTickPilotRunById(id);
    if (!row) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({
      ok: true,
      run: {
        id: row.id,
        runStartedAt: row.runStartedAt,
        runCompletedAt: row.runCompletedAt,
        durationSec: row.durationSec,
        clientId: row.clientId,
        perSymbolResults: row.perSymbolResults,
        globalErrors: row.globalErrors,
        summary: row.summary,
        triggeredByUserId: row.triggeredByUserId,
      },
    });
  } catch (e) {
    logger.error({ err: e }, "diagnostics: ibkr-tick-pilot get failed");
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
});

export default router;
