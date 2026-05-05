import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, inArray, isNull, or, sql } from "drizzle-orm";
import { db, scannerHealthTable, tickerSignalSnapshotTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { resolveScannerUniverseSymbolsForUser } from "./scanner.js";
import { SCANNER_SUB_SCORE_HIGH } from "../lib/scannerScoringV2.js";

const STALE_AFTER_SECONDS = 5 * 60;
const router: IRouter = Router();
const log = logger.child({ route: "scannerV2" });

const DEV_BYPASS = process.env.DEV_BYPASS_AUTH === "true";
const DEV_USER_ID = "dev_user";

function requireUserId(req: Parameters<typeof getAuth>[0]): string | null {
  if (DEV_BYPASS) return DEV_USER_ID;
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

/** Map DB row to unified card wire shape (frontend UnifiedScanCandidate). */
function rowToCandidate(r: typeof tickerSignalSnapshotTable.$inferSelect) {
  const spot = r.spot != null ? Number(r.spot) : 0;
  const changePct = r.dailyChangePct != null ? Number(r.dailyChangePct) : 0;
  const ivr = r.ivr != null ? Number(r.ivr) : null;
  const ivrSrc = (r.ivrSource ?? "").toLowerCase();
  const ivrSource: "canonical" | "intraday" | "missing" =
    ivrSrc === "canonical" || ivrSrc === "intraday" ? (ivrSrc as "canonical" | "intraday") : "missing";
  const comps = (r.componentScores as Record<string, number> | null) ?? {};
  const termShape = Number(comps["catalyst_term_shape"] ?? comps["term_structure"] ?? 0);
  const ivRv = Number(comps["iv_vs_realized"] ?? 0);
  const flowA = Number(comps["flow_quality"] ?? comps["flow_alignment"] ?? 0);
  const skew = Number(comps["skew_anomaly"] ?? 0);
  const macroD = Number(comps["macro_density_in_window"] ?? comps["catalyst_proximity"] ?? 0);
  const liqAnch =
    r.liquidityAnchorScore != null ? Number(r.liquidityAnchorScore) : Math.min(100, (r.atmOiFront ?? 0) / 500);
  const edgeType = (comps["edge_type"] as string) ?? "no_clear_edge";
  const flow = (r.flowSummary as Record<string, unknown> | null) ?? {};
  const askPct = typeof flow["ask_pct"] === "number" ? flow["ask_pct"] : 0;
  const bidPct =
    typeof flow["bid_notional"] === "number" && typeof flow["ask_notional"] === "number"
      ? (100 - askPct) * 0.5
      : 0;
  const midPct = Math.max(0, 100 - askPct - bidPct);
  const top = flow["top_strike"] as { strike?: number; expiry?: string; type?: string } | null;
  const tapeQ = (flow["tape_quality"] as string) ?? "not_run";
  const tapeQuality =
    tapeQ === "complete" || tapeQ === "partial" || tapeQ === "degraded" ? tapeQ : "not_run";
  const composite = r.compositeScore != null ? Number(r.compositeScore) : 0;
  const directionalLean: "bullish" | "bearish" | "neutral" =
    edgeType === "directional_bearish" || edgeType === "premium_sale" ? "bearish" : edgeType === "directional_bullish" || edgeType === "premium_buy" ? "bullish" : "neutral";

  const macroEvents: Array<{ date: string; title: string }> = [];
  const earnDate = r.earningsDate ? String(r.earningsDate) : null;
  const earnDays = r.earningsDaysAway;

  const storedSurf = Array.isArray(r.surfacingSubScores) ? r.surfacingSubScores.filter(Boolean) : [];
  const derivedSurf: string[] = [];
  for (const [k, v] of Object.entries(comps)) {
    if (k === "edge_type") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= SCANNER_SUB_SCORE_HIGH) derivedSurf.push(k);
  }
  const surfacedBy = storedSurf.length ? storedSurf : derivedSurf.length ? derivedSurf : ["momentum"];

  const riskFromDb = Array.isArray(r.disqualFlags) ? r.disqualFlags.filter(Boolean) : [];

  return {
    ticker: r.ticker,
    spot,
    changePct,
    sector: r.sector ?? "Other",
    marketCapTier: r.marketCapTier ?? "mid",
    surfacedBy,
    compositeScore: Math.round(composite),
    edgeType,
    directionalLean,
    ivr,
    ivrSource,
    ivrAsOfDate: r.ivrUpdatedAt ? new Date(r.ivrUpdatedAt).toISOString().slice(0, 10) : null,
    hv20: r.hv20 != null ? Number(r.hv20) : null,
    hv30: r.hv30 != null ? Number(r.hv30) : null,
    high52w: null,
    low52w: null,
    avgVolume20d: null,
    components: {
      trend: termShape,
      relativeStrength: macroD,
      volRegime: ivRv,
      flowScore: flowA,
      liquidity: liqAnch,
    },
    flowSnapshot: {
      topStrike:
        top?.strike != null && top?.expiry
          ? { strike: top.strike, expiry: String(top.expiry), type: (top.type === "put" ? "put" : "call") as "call" | "put" }
          : null,
      volumeMix: { askPct, bidPct, midPct },
      tapeQuality,
      notional24h: typeof flow["ask_notional"] === "number" ? flow["ask_notional"] : null,
    },
    catalystWindow: {
      nextEarnings:
        earnDate && earnDays != null
          ? { date: earnDate, daysAway: earnDays, confirmed: !!r.earningsConfirmed }
          : null,
      macroEventsInPositionWindow: macroEvents,
    },
    riskFlags: riskFromDb,
    positionContext: { hasPosition: false },
    surfacingReasons: [
      {
        engine: "momentum" as const,
        reasons: Array.isArray(r.surfacingReasons) ? r.surfacingReasons : [],
      },
    ],
    atmIvByExpiry: r.atmIvByExpiry,
    skew25dByExpiry: r.skew25dByExpiry,
    impliedMoveFrontPct: r.impliedMoveFrontPct != null ? Number(r.impliedMoveFrontPct) : null,
    impliedMoveFrontAbs: r.impliedMoveFrontAbs != null ? Number(r.impliedMoveFrontAbs) : null,
    snapshotAt: r.snapshotAt ? new Date(r.snapshotAt).toISOString() : null,
    chainUpdatedAt: r.chainUpdatedAt ? new Date(r.chainUpdatedAt).toISOString() : null,
    flowUpdatedAt: r.flowUpdatedAt ? new Date(r.flowUpdatedAt).toISOString() : null,
  };
}

router.get("/scan", async (req, res) => {
  const userId = requireUserId(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const universe = typeof req.query["universe"] === "string" ? req.query["universe"] : "preset:liquidCore130";
  const limitRaw = req.query["limit"];
  const minScoreRaw = req.query["minScore"];
  const limit = Math.min(50, Math.max(1, Number.parseInt(String(limitRaw ?? "25"), 10) || 25));
  const minScore = Math.max(0, Number.parseFloat(String(minScoreRaw ?? "0")) || 0);

  let tickers: string[] = [];
  try {
    tickers = await resolveScannerUniverseSymbolsForUser(universe.trim(), userId);
  } catch (e) {
    log.error({ err: e }, "v2 scan universe resolve failed");
    return res.status(500).json({ error: "universe resolve failed" });
  }
  const upper = [...new Set(tickers.map((t) => t.toUpperCase()))];
  if (upper.length === 0) {
    return res.json({
      candidates: [],
      snapshot_completed_at: null,
      snapshot_age_seconds: null,
      stale: null,
      scan_at: new Date().toISOString(),
    });
  }

  const health = await db
    .select({ cycleCompletedAt: scannerHealthTable.cycleCompletedAt })
    .from(scannerHealthTable)
    .orderBy(desc(scannerHealthTable.cycleCompletedAt))
    .limit(1);

  const last = health[0]?.cycleCompletedAt ?? null;
  if (!last) {
    return res.status(503).json({
      error:
        "Scanner snapshot worker has not completed a cycle yet. Data will appear after the worker initializes.",
    });
  }

  const snapshotIso = new Date(last).toISOString();
  const now = Date.now();
  const lastMs = new Date(last).getTime();
  const ageSec = Math.max(0, Math.floor((now - lastMs) / 1000));
  const stale = ageSec > STALE_AFTER_SECONDS;

  res.setHeader("X-Scanner-Snapshot-At", snapshotIso);
  res.setHeader("X-Scanner-Snapshot-Age-Seconds", String(ageSec));
  res.setHeader("X-Scanner-Stale", stale ? "true" : "false");

  const rows = await db
    .select()
    .from(tickerSignalSnapshotTable)
    .where(
      and(
        inArray(tickerSignalSnapshotTable.ticker, upper),
        or(
          isNull(tickerSignalSnapshotTable.disqualFlags),
          sql`cardinality(${tickerSignalSnapshotTable.disqualFlags}) = 0`,
        ),
        sql`coalesce(cast(${tickerSignalSnapshotTable.compositeScore} as double precision), 0) >= ${minScore}`,
      ),
    )
    .orderBy(sql`coalesce(cast(${tickerSignalSnapshotTable.compositeScore} as double precision), 0) DESC`)
    .limit(limit);

  const candidates = rows.map(rowToCandidate);
  return res.json({
    candidates,
    snapshot_completed_at: snapshotIso,
    snapshot_age_seconds: ageSec,
    stale,
    scan_at: new Date().toISOString(),
  });
});

export default router;
