/**
 * Unified scanner orchestrator: async job queue + merge of Discovery, Momentum, Unusual Flow.
 * Does not modify the three underlying engines — imports them as libraries.
 */
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { db, equityDailyTable, scannerJobsTable } from "@workspace/db";
import { getNextEarningsDate } from "./earningsService.js";
import { getUpcomingEvents } from "./calendarEventChecker.js";
import { runDeterministicScan, getSector, type ScanCandidate, type ScanResult } from "./deterministicScanner.js";
import { runDiscoveryScan } from "./deterministicScanner.v2.js";
import { scanUnusualFlow, type UnusualFlowCandidate, type UnusualFlowScanResult } from "./unusualFlowScanner.js";
import { getCachedRegime } from "./regimePostProcessor.js";
import { getPolygonFlowHighlightsBulk, type PolygonFlowHighlights } from "./polygonFlowHighlights.js";
import type { ScannerEdgeType } from "./scannerEdgeType.js";
import { encrypt, decrypt } from "./tokenEncryption.js";
import { resolveScannerUniverseSymbolsForUser } from "../routes/scanner.js";
import { logger } from "./logger.js";

const log = logger.child({ module: "unifiedScannerEngine" });

// ── Tunable composite scoring (Step 3) ─────────────────────────────
const MULTI_ENGINE_BONUS_2 = 10;
const MULTI_ENGINE_BONUS_3 = 20;
const EDGE_TYPE_PENALTY_NO_CLEAR = 20;
const RESULT_CAP = 25;

const MOMENTUM_MAX_SCORE = 25 + 20 + 20 + 20 + 15;
const DISCOVERY_MAX_SCORE = 100;
const FLOW_MAX_SCORE = 40 + 22 + 10 + 20 + 8 + 12;

const SCHWAB_API = "https://api.schwabapi.com/marketdata/v1";
const SCHWAB_TRADER = "https://api.schwabapi.com/trader/v1";

/** Same shape as deterministic-scan / discovery momentum `pulseCtx`. */
export interface UnifiedScannerPulseContext {
  composite: number;
  confidence: number;
  bias: string;
}

export interface UnifiedScanRequest {
  universeId: string;
  traderToken: string;
  userId: string;
  /** Snapshot at enqueue time — persisted on the job for reproducible runs. */
  pulse: UnifiedScannerPulseContext;
}

export interface EngineRunStatus {
  status: "ok" | "failed" | "timeout";
  durationMs: number;
  resultCount: number;
  error?: string;
}

export interface UnifiedScanCandidate {
  ticker: string;
  spot: number;
  changePct: number;
  sector: string;
  marketCapTier: "mega" | "large" | "mid" | "small" | "micro" | "etf";
  surfacedBy: Array<"discovery" | "momentum" | "unusual_flow">;
  compositeScore: number;
  edgeType: ScannerEdgeType;
  directionalLean: "bullish" | "bearish" | "neutral";
  ivr: number | null;
  ivrSource: "canonical" | "intraday" | "missing";
  ivrAsOfDate: string | null;
  hv20: number | null;
  hv30: number | null;
  high52w: number | null;
  low52w: number | null;
  avgVolume20d: number | null;
  components: {
    trend: number;
    relativeStrength: number;
    volRegime: number;
    flowScore: number;
    liquidity: number;
  };
  flowSnapshot: {
    topStrike: { strike: number; expiry: string; type: "call" | "put" } | null;
    volumeMix: { askPct: number; bidPct: number; midPct: number };
    tapeQuality: "complete" | "partial" | "degraded" | "not_run";
    notional24h: number | null;
  };
  catalystWindow: {
    nextEarnings: { date: string; daysAway: number; confirmed: boolean } | null;
    macroEventsInPositionWindow: Array<{ date: string; title: string }>;
  };
  riskFlags: Array<
    | "halted"
    | "tape_backfill_incomplete"
    | "ivr_missing"
    | "earnings_inside_short_dte"
    | "regime_shock"
    | "iv_contamination_elevated"
    | "low_open_interest"
  >;
  positionContext: { hasPosition: boolean };
  surfacingReasons: Array<{ engine: "discovery" | "momentum" | "unusual_flow"; reasons: string[] }>;
}

export interface UnifiedScanJobPayload {
  symbolsScanned: number;
  engineStatus: {
    discovery: EngineRunStatus;
    momentum: EngineRunStatus;
    unusual_flow: EngineRunStatus;
  };
  candidates: UnifiedScanCandidate[];
  truncated?: boolean;
  error?: string;
}

export interface UnifiedScanJobResult {
  scanId: string;
  status: "queued" | "running" | "complete" | "failed";
  startedAt: string;
  completedAt: string | null;
  universeId: string;
  symbolsScanned: number;
  engineStatus: {
    discovery: EngineRunStatus;
    momentum: EngineRunStatus;
    unusual_flow: EngineRunStatus;
  };
  candidates: UnifiedScanCandidate[];
  error?: string;
}

type EngineKey = "discovery" | "momentum" | "unusual_flow";

interface MergedRow {
  ticker: string;
  surfacedBy: EngineKey[];
  engineScores: Partial<Record<EngineKey, number>>;
  surfacingReasons: Array<{ engine: EngineKey; reasons: string[] }>;
  edgeTypes: ScannerEdgeType[];
  directionalLeans: Array<"BULLISH" | "BEARISH" | "MIXED">;
  momentumComponents: ScanCandidate["components"] | null;
  discoveryScore: number | null;
  flowScore: number | null;
}

function defaultEngineStatus(): EngineRunStatus {
  return { status: "failed", durationMs: 0, resultCount: 0, error: "not_started" };
}

function emptyPayload(symbolsScanned: number): UnifiedScanJobPayload {
  return {
    symbolsScanned,
    engineStatus: {
      discovery: defaultEngineStatus(),
      momentum: defaultEngineStatus(),
      unusual_flow: defaultEngineStatus(),
    },
    candidates: [],
  };
}

async function withRetries<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = 200 * 2 ** i;
      log.warn({ label, attempt: i + 1, err }, "unifiedScannerEngine.dbRetry");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

type ScannerJobInsert = InferInsertModel<typeof scannerJobsTable>;

async function updateJobRow(scanId: string, patch: Partial<ScannerJobInsert>) {
  await withRetries("updateJob", () =>
    db.update(scannerJobsTable).set(patch).where(eq(scannerJobsTable.scanId, scanId)),
  );
}

export async function startUnifiedScan(request: UnifiedScanRequest): Promise<{ scanId: string; estimatedSeconds: number }> {
  const scanId = randomUUID();
  const now = new Date();
  const startedAtIso = now.toISOString();
  await withRetries("insertJob", () =>
    db.insert(scannerJobsTable).values({
      scanId,
      userId: request.userId,
      universeId: request.universeId,
      traderTokenEncrypted: encrypt(request.traderToken),
      pulseSnapshot: request.pulse,
      status: "queued",
      startedAt: now,
      completedAt: null,
      result: null,
      error: null,
    }),
  );

  setImmediate(() => {
    void runScanInBackground(scanId).catch((err) => {
      log.error({ scanId, err }, "scanner.runScanInBackground.unhandled");
    });
  });

  return { scanId, estimatedSeconds: 15 };
}

export async function getScanStatus(scanId: string, userId: string): Promise<UnifiedScanJobResult | null> {
  const row = await db.query.scannerJobsTable.findFirst({
    where: and(eq(scannerJobsTable.scanId, scanId), eq(scannerJobsTable.userId, userId)),
  });
  if (!row) return null;
  const payload = row.result as UnifiedScanJobPayload | null;
  return {
    scanId: row.scanId,
    status: row.status as UnifiedScanJobResult["status"],
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt),
    completedAt: row.completedAt
      ? row.completedAt instanceof Date
        ? row.completedAt.toISOString()
        : String(row.completedAt)
      : null,
    universeId: row.universeId,
    symbolsScanned: payload?.symbolsScanned ?? 0,
    engineStatus: payload?.engineStatus ?? {
      discovery: defaultEngineStatus(),
      momentum: defaultEngineStatus(),
      unusual_flow: defaultEngineStatus(),
    },
    candidates: payload?.candidates ?? [],
    error: row.error ?? payload?.error,
  };
}

/** Hourly GC: remove scanner_jobs older than 1 hour. */
export async function gcScannerJobsOlderThanOneHour(): Promise<number> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const deleted = await db
    .delete(scannerJobsTable)
    .where(lt(scannerJobsTable.startedAt, cutoff))
    .returning({ scanId: scannerJobsTable.scanId });
  if (deleted.length > 0) {
    log.info({ removed: deleted.length }, "scanner.gcScannerJobs");
  }
  return deleted.length;
}

export async function runScanInBackground(scanId: string): Promise<void> {
  const startedAt = Date.now();
  try {
    await updateJobRow(scanId, { status: "running", error: null });

    const job = await db.query.scannerJobsTable.findFirst({ where: eq(scannerJobsTable.scanId, scanId) });
    if (!job) {
      log.error({ scanId }, "scanner.runScanInBackground.jobNotFound");
      return;
    }

    const traderToken = decrypt(job.traderTokenEncrypted);
    const symbols = await resolveScannerUniverseSymbolsForUser(job.universeId, job.userId);
    const upperSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];

    if (upperSymbols.length === 0) {
      await markJobFailed(scanId, "Universe resolved to empty symbol list");
      return;
    }

    const regime = getCachedRegime();
    if (regime?.systemicRiskLevel === "SHOCK") {
      const shockPayload: UnifiedScanJobPayload = {
        ...emptyPayload(upperSymbols.length),
        engineStatus: {
          discovery: { status: "failed", durationMs: 0, resultCount: 0, error: "regime_shock" },
          momentum: { status: "failed", durationMs: 0, resultCount: 0, error: "regime_shock" },
          unusual_flow: { status: "failed", durationMs: 0, resultCount: 0, error: "regime_shock" },
        },
        candidates: [],
      };
      await markJobComplete(scanId, shockPayload);
      return;
    }

    const snap = job.pulseSnapshot as UnifiedScannerPulseContext | null | undefined;
    const pulseCtx: UnifiedScannerPulseContext = snap && typeof snap === "object"
      ? {
          composite: Number(snap.composite) || 0,
          confidence: Number(snap.confidence) || 0,
          bias: typeof snap.bias === "string" ? snap.bias : "NO_EDGE",
        }
      : { composite: 0, confidence: 0, bias: "NO_EDGE" };
    const engineLog = { info: log.info.bind(log), warn: log.warn.bind(log), error: log.error.bind(log) };

    const [discoveryRes, momentumRes, unusualFlowRes] = await Promise.allSettled([
      timedEngine("discovery", () =>
        runDiscoveryScan(upperSymbols, traderToken, traderToken, pulseCtx, engineLog, { returnAll: true }),
      ),
      timedEngine("momentum", () =>
        runDeterministicScan(upperSymbols, traderToken, traderToken, pulseCtx, engineLog),
      ),
      timedEngine("unusual_flow", () => scanUnusualFlow(upperSymbols)),
    ]);

    const discoveryNorm = normalizeDiscoverySettled(discoveryRes);
    const momentumNorm = normalizeMomentumSettled(momentumRes);
    const flowNorm = normalizeFlowSettled(unusualFlowRes);

    const engineStatus = {
      discovery: discoveryNorm.status,
      momentum: momentumNorm.status,
      unusual_flow: flowNorm.status,
    };

    const merged = mergeCandidates(discoveryNorm, momentumNorm, flowNorm);
    const scored = merged.map(computeCompositeScore);
    const portfolio = await fetchPortfolioSymbols(traderToken);
    const equityRows = await loadLatestEquityDaily(upperSymbols);
    const flowBulk = await getPolygonFlowHighlightsBulk(upperSymbols).catch((err) => {
      log.warn({ err }, "unifiedScannerEngine.getPolygonFlowHighlightsBulk.failed");
      return new Map<string, PolygonFlowHighlights>();
    });

    const enriched: UnifiedScanCandidate[] = [];
    const sorted = scored.sort((a, b) => b.compositeScore - a.compositeScore);
    for (const row of sorted) {
      if (enriched.length >= RESULT_CAP) break;
      try {
        const c = await enrichCandidate(row, {
          accessToken: traderToken,
          portfolio,
          equityRow: equityRows.get(row.ticker) ?? null,
          highlights: flowBulk.get(row.ticker) ?? null,
        });
        if (passesPreStrategistGates(c)) enriched.push(c);
      } catch (err) {
        log.warn({ err, ticker: row.ticker }, "unifiedScannerEngine.enrichCandidate.failed");
      }
    }

    const payload: UnifiedScanJobPayload = {
      symbolsScanned: upperSymbols.length,
      engineStatus,
      candidates: enriched,
      truncated: sorted.length > RESULT_CAP,
    };

    await markJobComplete(scanId, payload);
    log.info(
      {
        scanId,
        totalDurationMs: Date.now() - startedAt,
        symbolCount: upperSymbols.length,
        candidateCount: enriched.length,
      },
      "scanner.runScanInBackground.complete",
    );
  } catch (err) {
    log.error({ scanId, err }, "scanner.runScanInBackground.failed");
    await markJobFailed(scanId, err instanceof Error ? err.message : String(err));
  }
}

async function markJobComplete(scanId: string, payload: UnifiedScanJobPayload) {
  const now = new Date();
  await updateJobRow(scanId, {
    status: "complete",
    completedAt: now,
    result: payload as unknown as ScannerJobInsert["result"],
    error: null,
  });
}

async function markJobFailed(scanId: string, message: string) {
  const now = new Date();
  await updateJobRow(scanId, {
    status: "failed",
    completedAt: now,
    error: message,
  });
}

async function timedEngine<T>(
  name: EngineKey,
  fn: () => Promise<T>,
): Promise<{ status: "fulfilled"; value: T; durationMs: number } | { status: "rejected"; reason: unknown; durationMs: number }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { status: "fulfilled", value, durationMs: Date.now() - t0 };
  } catch (reason) {
    return { status: "rejected", reason, durationMs: Date.now() - t0 };
  }
}

function normalizeDiscoverySettled(
  res:
    | { status: "fulfilled"; value: ScanResult & { allScoredResults?: unknown[] }; durationMs: number }
    | { status: "rejected"; reason: unknown; durationMs: number },
): {
  status: EngineRunStatus;
  rows: Array<{ ticker: string; score: number; reasons: string[]; edgeType: ScannerEdgeType; lean: "BULLISH" | "BEARISH" | "MIXED" }>;
} {
  if (res.status === "rejected") {
    return {
      status: {
        status: "failed",
        durationMs: res.durationMs,
        resultCount: 0,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      },
      rows: [],
    };
  }
  const surfaced = new Set(res.value.candidates.map((c) => c.symbol.toUpperCase()));
  const scoreBySymbol = new Map<string, number>();
  const raw = res.value.allScoredResults as
    | Array<{ symbol: string; totalScore: number }>
    | undefined;
  if (raw) {
    for (const r of raw) scoreBySymbol.set(r.symbol.toUpperCase(), r.totalScore);
  }
  const rows: Array<{
    ticker: string;
    score: number;
    reasons: string[];
    edgeType: ScannerEdgeType;
    lean: "BULLISH" | "BEARISH" | "MIXED";
  }> = [];
  for (const c of res.value.candidates) {
    const t = c.symbol.toUpperCase();
    const score = scoreBySymbol.get(t) ?? c.totalScore;
    rows.push({
      ticker: t,
      score,
      reasons: [`discovery totalScore ${score}`, c.keyStatLabel ? `${c.keyStatLabel}: ${c.keyStatValue}` : "discovery"],
      edgeType: c.edgeType,
      lean: (c.directionalLean ?? "MIXED") as "BULLISH" | "BEARISH" | "MIXED",
    });
  }
  return {
    status: { status: "ok", durationMs: res.durationMs, resultCount: surfaced.size },
    rows,
  };
}

function normalizeMomentumSettled(
  res:
    | { status: "fulfilled"; value: ScanResult; durationMs: number }
    | { status: "rejected"; reason: unknown; durationMs: number },
): {
  status: EngineRunStatus;
  rows: Array<{ ticker: string; score: number; reasons: string[]; edgeType: ScannerEdgeType; lean: "BULLISH" | "BEARISH" | "MIXED"; components: ScanCandidate["components"] }>;
} {
  if (res.status === "rejected") {
    return {
      status: {
        status: "failed",
        durationMs: res.durationMs,
        resultCount: 0,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      },
      rows: [],
    };
  }
  const rows = res.value.candidates.map((c) => ({
    ticker: c.symbol.toUpperCase(),
    score: c.totalScore,
    reasons: [`momentum score ${c.totalScore}`],
    edgeType: c.edgeType,
    lean: (c.directionalLean ?? "MIXED") as "BULLISH" | "BEARISH" | "MIXED",
    components: c.components,
  }));
  return {
    status: { status: "ok", durationMs: res.durationMs, resultCount: res.value.candidates.length },
    rows,
  };
}

function normalizeFlowSettled(
  res:
    | { status: "fulfilled"; value: UnusualFlowScanResult; durationMs: number }
    | { status: "rejected"; reason: unknown; durationMs: number },
): {
  status: EngineRunStatus;
  rows: Array<{ ticker: string; score: number; reasons: string[]; edgeType: ScannerEdgeType; lean: "BULLISH" | "BEARISH" | "MIXED" }>;
} {
  if (res.status === "rejected") {
    return {
      status: {
        status: "failed",
        durationMs: res.durationMs,
        resultCount: 0,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      },
      rows: [],
    };
  }
  const rows = res.value.candidates.map((c: UnusualFlowCandidate) => ({
    ticker: c.symbol.toUpperCase(),
    score: c.score,
    reasons: [c.scoreReason ?? `flow score ${c.score}`],
    edgeType: c.edgeType,
    lean: c.skew === "bullish" ? ("BULLISH" as const) : c.skew === "bearish" ? ("BEARISH" as const) : ("MIXED" as const),
  }));
  return {
    status: { status: "ok", durationMs: res.durationMs, resultCount: res.value.candidates.length },
    rows,
  };
}

function mergeCandidates(
  d: ReturnType<typeof normalizeDiscoverySettled>,
  m: ReturnType<typeof normalizeMomentumSettled>,
  f: ReturnType<typeof normalizeFlowSettled>,
): MergedRow[] {
  const byTicker = new Map<string, MergedRow>();

  const bump = (
    ticker: string,
    engine: EngineKey,
    score: number,
    reasons: string[],
    edgeType: ScannerEdgeType,
    lean: "BULLISH" | "BEARISH" | "MIXED",
    momentumComponents: ScanCandidate["components"] | null,
    discoveryScore: number | null,
    flowScore: number | null,
  ) => {
    let row = byTicker.get(ticker);
    if (!row) {
      row = {
        ticker,
        surfacedBy: [],
        engineScores: {},
        surfacingReasons: [],
        edgeTypes: [],
        directionalLeans: [],
        momentumComponents: null,
        discoveryScore: null,
        flowScore: null,
      };
      byTicker.set(ticker, row);
    }
    if (!row.surfacedBy.includes(engine)) row.surfacedBy.push(engine);
    row.engineScores[engine] = score;
    row.surfacingReasons.push({ engine, reasons });
    row.edgeTypes.push(edgeType);
    row.directionalLeans.push(lean);
    if (momentumComponents) row.momentumComponents = momentumComponents;
    if (discoveryScore != null) row.discoveryScore = discoveryScore;
    if (flowScore != null) row.flowScore = flowScore;
  };

  for (const r of d.rows) {
    bump(r.ticker, "discovery", r.score, r.reasons, r.edgeType, r.lean, null, r.score, null);
  }
  for (const r of m.rows) {
    bump(r.ticker, "momentum", r.score, r.reasons, r.edgeType, r.lean, r.components, null, null);
  }
  for (const r of f.rows) {
    bump(r.ticker, "unusual_flow", r.score, r.reasons, r.edgeType, r.lean, null, null, r.score);
  }

  for (const row of byTicker.values()) {
    row.surfacedBy.sort();
  }
  return [...byTicker.values()];
}

function computeCompositeScore(row: MergedRow): MergedRow & { compositeScore: number } {
  const scores = row.surfacedBy.map((engine) => {
    const s = row.engineScores[engine] ?? 0;
    const max =
      engine === "momentum" ? MOMENTUM_MAX_SCORE : engine === "discovery" ? DISCOVERY_MAX_SCORE : FLOW_MAX_SCORE;
    return max > 0 ? (s / max) * 100 : 0;
  });
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  let bonus = 0;
  if (row.surfacedBy.length >= 3) bonus += MULTI_ENGINE_BONUS_3;
  else if (row.surfacedBy.length >= 2) bonus += MULTI_ENGINE_BONUS_2;
  const edgeMerged = mergeEdgeTypes(row.edgeTypes, row.directionalLeans);
  if (edgeMerged === "no_clear_edge") bonus -= EDGE_TYPE_PENALTY_NO_CLEAR;
  const compositeScore = Math.max(0, Math.min(100, Math.round(avg + bonus)));
  return { ...row, compositeScore };
}

function mergeEdgeTypes(types: ScannerEdgeType[], leans: Array<"BULLISH" | "BEARISH" | "MIXED">): ScannerEdgeType {
  if (types.includes("directional_bullish") && types.includes("directional_bearish")) {
    return "no_clear_edge";
  }
  const prio: ScannerEdgeType[] = [
    "directional_bullish",
    "directional_bearish",
    "premium_sale",
    "premium_buy",
    "calendar",
    "no_clear_edge",
  ];
  const bullish = types.includes("directional_bullish") || leans.includes("BULLISH");
  const bearish = types.includes("directional_bearish") || leans.includes("BEARISH");
  if (bullish && bearish) return "no_clear_edge";
  for (const p of prio) {
    if (types.includes(p)) {
      if (p === "directional_bullish" && bearish && !bullish) continue;
      if (p === "directional_bearish" && bullish && !bearish) continue;
      return p;
    }
  }
  return "no_clear_edge";
}

function mergeDirectional(leans: Array<"BULLISH" | "BEARISH" | "MIXED">): "bullish" | "bearish" | "neutral" {
  const hasB = leans.some((l) => l === "BULLISH");
  const hasS = leans.some((l) => l === "BEARISH");
  if (hasB && hasS) return "neutral";
  if (hasB) return "bullish";
  if (hasS) return "bearish";
  return "neutral";
}

function passesPreStrategistGates(c: UnifiedScanCandidate): boolean {
  if (c.flowSnapshot.tapeQuality === "not_run") return false;
  if (c.ivr === null || c.ivrSource === "missing") return false;
  if (c.riskFlags.includes("halted")) return false;
  if (c.components.liquidity < 30) return false;
  if (c.riskFlags.includes("regime_shock")) return false;
  return true;
}

type EquityDailyRow = typeof equityDailyTable.$inferSelect;

async function loadLatestEquityDaily(symbols: string[]): Promise<Map<string, EquityDailyRow>> {
  const out = new Map<string, EquityDailyRow>();
  if (symbols.length === 0) return out;
  const upper = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const agg = await db
    .select({
      symbol: equityDailyTable.symbol,
      maxDate: sql<string>`max(${equityDailyTable.date})`.as("max_date"),
    })
    .from(equityDailyTable)
    .where(inArray(equityDailyTable.symbol, upper))
    .groupBy(equityDailyTable.symbol);
  if (agg.length === 0) return out;
  const rows = await db
    .select()
    .from(equityDailyTable)
    .where(
      or(
        ...agg.map((a) =>
          and(eq(equityDailyTable.symbol, a.symbol), eq(equityDailyTable.date, a.maxDate)),
        ),
      )!,
    );
  for (const r of rows) {
    out.set(r.symbol.toUpperCase(), r);
  }
  return out;
}

async function fetchPortfolioSymbols(accessToken: string): Promise<Set<string>> {
  const held = new Set<string>();
  try {
    const traderRes = await fetch(`${SCHWAB_TRADER}/accounts?fields=positions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!traderRes.ok) return held;
    const accounts = (await traderRes.json()) as Array<Record<string, unknown>>;
    for (const acct of accounts) {
      const sa = acct["securitiesAccount"] as Record<string, unknown> | undefined;
      if (!sa) continue;
      const positions = (sa["positions"] as Array<Record<string, unknown>>) ?? [];
      for (const p of positions) {
        const inst = p["instrument"] as Record<string, unknown> | undefined;
        if (!inst) continue;
        const sym = (inst["underlyingSymbol"] as string) ?? (inst["symbol"] as string) ?? "";
        if (sym) held.add(sym.toUpperCase());
      }
    }
  } catch {
    /* ignore */
  }
  return held;
}

interface SchwabQuoteLite {
  lastPrice: number;
  netPercentChange: number;
  /** 52w when present on regular equity quote */
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  avgVolume20Day?: number;
  securityStatus?: string;
}

async function fetchSchwabQuote(symbol: string, accessToken: string): Promise<SchwabQuoteLite | null> {
  try {
    const res = await fetch(
      `${SCHWAB_API}/quotes?symbols=${encodeURIComponent(symbol)}&fields=quote`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const entry = json[symbol] as Record<string, unknown> | undefined;
    const q = entry?.["quote"] as Record<string, unknown> | undefined;
    if (!q) return null;
    const lastPrice = q["lastPrice"] as number;
    if (!(lastPrice > 0)) return null;
    return {
      lastPrice,
      netPercentChange: (q["netPercentChangeInDouble"] as number) ?? 0,
      fiftyTwoWeekHigh: q["52WeekHigh"] as number | undefined,
      fiftyTwoWeekLow: q["52WeekLow"] as number | undefined,
      avgVolume20Day: (q["avg20DayVolume"] as number | undefined) ?? (q["averageVolume20Day"] as number | undefined),
      securityStatus: q["securityStatus"] as string | undefined,
    };
  } catch {
    return null;
  }
}

function tierFromMarketCap(mc: number | null | undefined): UnifiedScanCandidate["marketCapTier"] {
  if (mc == null || !Number.isFinite(mc)) return "large";
  const v = mc;
  if (v >= 200e9) return "mega";
  if (v >= 10e9) return "large";
  if (v >= 2e9) return "mid";
  if (v >= 300e6) return "small";
  return "micro";
}

function mapIvrSource(raw: string | null | undefined): "canonical" | "intraday" | "missing" {
  if (!raw) return "missing";
  const u = raw.toLowerCase();
  if (u === "chain" || u === "canonical") return "canonical";
  if (u === "intraday" || u === "hv_proxy" || u === "populating" || u === "failed_insufficient_history") return "intraday";
  return "intraday";
}

function tapeQualityFromHighlights(h: PolygonFlowHighlights | null): UnifiedScanCandidate["flowSnapshot"]["tapeQuality"] {
  if (!h?.sessionTape) return "not_run";
  const kind = h.sessionTape.tapeKind;
  if (kind === "live") return "complete";
  if (kind === "eod_fallback") return "partial";
  const exec = h.sessionTape.execPerStrike?.length ?? 0;
  if (exec > 0) return "complete";
  return "degraded";
}

async function enrichCandidate(
  row: MergedRow & { compositeScore: number },
  ctx: {
    accessToken: string;
    portfolio: Set<string>;
    equityRow: EquityDailyRow | null;
    highlights: PolygonFlowHighlights | null;
  },
): Promise<UnifiedScanCandidate> {
  const ticker = row.ticker;
  const [quote, earn] = await Promise.all([
    fetchSchwabQuote(ticker, ctx.accessToken),
    getNextEarningsDate(ticker).catch(() => null),
  ]);

  const spot = quote?.lastPrice ?? 0;
  const changePct = quote?.netPercentChange ?? 0;

  const eq = ctx.equityRow;
  const ivrVal = eq?.ivr != null && Number.isFinite(eq.ivr) ? Math.round(eq.ivr * 10) / 10 : null;
  const ivrSourceRaw = eq?.ivrSource ?? null;
  const ivrMissing =
    ivrVal == null || ivrSourceRaw === "populating" || ivrSourceRaw === "failed_insufficient_history";
  const ivrSource: UnifiedScanCandidate["ivrSource"] = ivrMissing ? "missing" : mapIvrSource(ivrSourceRaw);

  const mc = eq?.marketCap ?? null;
  const sector = getSector(ticker);

  const mom = row.momentumComponents;
  const trend = mom?.trendAlignment ?? 0;
  const rs = mom?.relativeStrength ?? 0;
  const volRegime = mom?.volumeConfirmation ?? 0;
  const liquidity = mom?.optionsLiquidity ?? 0;
  const ivrScore = mom?.ivrScore ?? 0;
  const flowScore = row.flowScore ?? 0;

  const h = ctx.highlights;
  const session = h?.sessionTape;
  let topStrike: UnifiedScanCandidate["flowSnapshot"]["topStrike"] = null;
  if (session?.aggressorByStrike?.length) {
    const best = [...session.aggressorByStrike].sort((a, b) => b.askPct - a.askPct)[0]!;
    topStrike = {
      strike: best.strike,
      expiry: best.expiration,
      type: best.optionType,
    };
  }
  const totals = session?.aggressorSessionTotals;
  const totalP = totals?.totalPrints ?? 0;
  const volMix =
    totalP > 0 && totals
      ? {
          askPct: Math.round((1000 * totals.askCount) / totalP) / 10,
          bidPct: Math.round((1000 * totals.bidCount) / totalP) / 10,
          midPct: Math.round((1000 * totals.midCount) / totalP) / 10,
        }
      : { askPct: 0, bidPct: 0, midPct: 0 };

  const tapeQuality = tapeQualityFromHighlights(h);
  const notional24h =
    h != null ? (h.unusualCallVolume + h.unusualPutVolume) * spot * 100 : null;

  const macroEventsInPositionWindow = getUpcomingEvents(30)
    .filter((e) => e.importance === "HIGH" && e.type !== "earnings")
    .slice(0, 8)
    .map((e) => ({ date: e.date, title: e.title }));

  const nextEarnings =
    earn?.earningsDate && earn.daysAway != null
      ? { date: earn.earningsDate, daysAway: earn.daysAway, confirmed: !!earn.confirmed }
      : null;

  const riskFlags: UnifiedScanCandidate["riskFlags"] = [];
  const status = quote?.securityStatus?.toLowerCase() ?? "";
  if (status.includes("halt")) riskFlags.push("halted");
  if (tapeQuality === "partial" || tapeQuality === "degraded") riskFlags.push("tape_backfill_incomplete");
  if (ivrMissing) riskFlags.push("ivr_missing");
  if (nextEarnings && nextEarnings.daysAway <= 14) riskFlags.push("earnings_inside_short_dte");

  const edgeType = mergeEdgeTypes(row.edgeTypes, row.directionalLeans);
  const directionalLean = mergeDirectional(row.directionalLeans);

  return {
    ticker,
    spot,
    changePct,
    sector,
    marketCapTier: tierFromMarketCap(mc),
    surfacedBy: row.surfacedBy as UnifiedScanCandidate["surfacedBy"],
    compositeScore: row.compositeScore,
    edgeType,
    directionalLean,
    ivr: ivrVal,
    ivrSource,
    ivrAsOfDate: eq?.date ? String(eq.date) : null,
    hv20: eq?.hv20d ?? null,
    hv30: eq?.hv30d ?? null,
    high52w: quote?.fiftyTwoWeekHigh ?? null,
    low52w: quote?.fiftyTwoWeekLow ?? null,
    avgVolume20d: quote?.avgVolume20Day ?? (eq?.medianVolume20d != null ? Number(eq.medianVolume20d) : null),
    components: {
      trend,
      relativeStrength: rs,
      volRegime,
      flowScore,
      liquidity,
    },
    flowSnapshot: {
      topStrike: topStrike,
      volumeMix: volMix,
      tapeQuality,
      notional24h: notional24h != null && Number.isFinite(notional24h) ? Math.round(notional24h) : null,
    },
    catalystWindow: {
      nextEarnings,
      macroEventsInPositionWindow,
    },
    riskFlags,
    positionContext: { hasPosition: ctx.portfolio.has(ticker) },
    surfacingReasons: row.surfacingReasons,
  };
}
