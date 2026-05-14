import { db, strategistTelemetryTable } from "@workspace/db";
import { and, gte, sql, eq } from "@workspace/db";
import type { ScannerSourceForStrategist } from "./scannerStrategistContext.js";

export type ScoreBucket = "50-59" | "60-69" | "70-79" | "80-89" | "90-100";

export interface ScannerStrategistCorrelation {
  totalScannerSourcedRuns: number;
  byOutcome: { recommend: number; pass: number; fail: number };
  byEdgeType: Record<string, { recommend: number; pass: number; fail: number }>;
  byScoreBucket: Record<ScoreBucket, { recommend: number; pass: number; fail: number }>;
  recommendationRate: number;
}

function outcomeBucket(result: string): "recommend" | "pass" | "fail" {
  if (result === "recommendation" || result === "desk_recommendation") return "recommend";
  if (result === "no_viable_setup") return "pass";
  return "fail";
}

function scoreBucket(score: number | null): ScoreBucket | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 90) return "90-100";
  if (score >= 80) return "80-89";
  if (score >= 70) return "70-79";
  if (score >= 60) return "60-69";
  if (score >= 50) return "50-59";
  return null;
}

const EMPTY_BUCKET = (): { recommend: number; pass: number; fail: number } => ({
  recommend: 0,
  pass: 0,
  fail: 0,
});

export async function getScannerStrategistCorrelation(opts: {
  lookbackDays: number;
  scannerSource?: ScannerSourceForStrategist;
}): Promise<ScannerStrategistCorrelation> {
  const days = Math.max(1, Math.min(365, Math.floor(opts.lookbackDays)));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const rows = await db
    .select({
      result: strategistTelemetryTable.result,
      scannerSource: strategistTelemetryTable.scannerSource,
      scannerScore: strategistTelemetryTable.scannerScore,
      scannerEdgeType: strategistTelemetryTable.scannerEdgeType,
    })
    .from(strategistTelemetryTable)
    .where(
      and(
        gte(strategistTelemetryTable.timestamp, cutoff),
        sql`${strategistTelemetryTable.scannerSource} IS NOT NULL`,
        opts.scannerSource ? eq(strategistTelemetryTable.scannerSource, opts.scannerSource) : sql`true`,
      ),
    );

  const byEdgeType: Record<string, { recommend: number; pass: number; fail: number }> = {};
  const byScoreBucket: Record<ScoreBucket, { recommend: number; pass: number; fail: number }> = {
    "50-59": EMPTY_BUCKET(),
    "60-69": EMPTY_BUCKET(),
    "70-79": EMPTY_BUCKET(),
    "80-89": EMPTY_BUCKET(),
    "90-100": EMPTY_BUCKET(),
  };

  let recommend = 0;
  let pass = 0;
  let fail = 0;

  for (const r of rows) {
    const o = outcomeBucket(r.result);
    if (o === "recommend") recommend++;
    else if (o === "pass") pass++;
    else fail++;

    const edge = r.scannerEdgeType ?? "unknown";
    if (!byEdgeType[edge]) byEdgeType[edge] = EMPTY_BUCKET();
    byEdgeType[edge][o]++;

    const sb = scoreBucket(r.scannerScore);
    if (sb) byScoreBucket[sb][o]++;
  }

  const total = rows.length;
  const recommendationRate = total > 0 ? Math.round((recommend / total) * 10_000) / 100 : 0;

  return {
    totalScannerSourcedRuns: total,
    byOutcome: { recommend, pass, fail },
    byEdgeType,
    byScoreBucket,
    recommendationRate,
  };
}
