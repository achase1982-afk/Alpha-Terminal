/**
 * Deterministic sell-side price-target pipe (upstream of the model).
 * Fetches FMP-backed DB rows, normalizes, validates coverage, fails loud on stale.
 */

import {
  getAnalystPriceTargets,
  getRecentAnalystGrades,
  type AnalystGradeDbRow,
  type AnalystPriceTargetsRow,
} from "./fmpDataService.js";
import { logger } from "./logger.js";
import type { RevisionTrend } from "./strategistFullReport/types.js";

const PT_STALE_DAYS = 45;
const GRADES_WINDOW_DAYS = 90;

export type NormalizedPriceTargetSnapshot = {
  available: boolean;
  asOfDate: string | null;
  consensusPT: number | null;
  ptHigh: number | null;
  ptLow: number | null;
  analystCount: number | null;
  ptVsSignalPct: number | null;
  revisions: { raises: number; cuts: number; windowDays: number };
  revisionTrend: RevisionTrend;
  recent: Array<{ firm: string; action: string; from: string; to: string; date: string }>;
  staleReason?: string;
};

function daysBetween(ymd: string, now = new Date()): number {
  const d = new Date(ymd + "T12:00:00Z");
  if (isNaN(d.getTime())) return 9999;
  return Math.round((now.getTime() - d.getTime()) / 86400000);
}

function classifyRevisionTrend(raises: number, cuts: number): RevisionTrend {
  if (raises > cuts + 1) return "rising";
  if (cuts > raises + 1) return "falling";
  return "flat";
}

function gradeActionKind(action: string): "raise" | "cut" | "other" {
  const a = action.toLowerCase();
  if (a.includes("upgrade") || a.includes("raise") || a.includes("init") && a.includes("buy")) return "raise";
  if (a.includes("downgrade") || a.includes("cut") || a.includes("lower")) return "cut";
  return "other";
}

function mapRecent(grades: AnalystGradeDbRow[]): NormalizedPriceTargetSnapshot["recent"] {
  return grades.slice(0, 6).map((g) => ({
    firm: g.gradingCompany?.trim() || "—",
    action: g.action,
    from: g.previousGrade?.trim() || "—",
    to: g.newGrade?.trim() || "—",
    date: g.actionDate,
  }));
}

export async function fetchNormalizedPriceTargets(
  ticker: string,
  signalPrice: number | null,
): Promise<NormalizedPriceTargetSnapshot> {
  const empty: NormalizedPriceTargetSnapshot = {
    available: false,
    asOfDate: null,
    consensusPT: null,
    ptHigh: null,
    ptLow: null,
    analystCount: null,
    ptVsSignalPct: null,
    revisions: { raises: 0, cuts: 0, windowDays: GRADES_WINDOW_DAYS },
    revisionTrend: "flat",
    recent: [],
  };

  let pt: AnalystPriceTargetsRow | null = null;
  let grades: AnalystGradeDbRow[] = [];
  try {
    [pt, grades] = await Promise.all([
      getAnalystPriceTargets(ticker),
      getRecentAnalystGrades(ticker, GRADES_WINDOW_DAYS),
    ]);
  } catch (err) {
    logger.warn({ ticker, err }, "Strategist PT service: fetch failed");
    return { ...empty, staleReason: "fetch_failed" };
  }

  if (!pt) {
    return { ...empty, staleReason: "no_coverage" };
  }

  const asOf = pt.asOfDate;
  if (!asOf || daysBetween(asOf) > PT_STALE_DAYS) {
    logger.warn({ ticker, asOf }, "Strategist PT service: stale or missing as-of date");
    return { ...empty, staleReason: "stale_or_missing_date" };
  }

  const consensus = pt.targetConsensus ?? pt.targetMedian;
  const count = pt.numAnalysts;
  if (consensus == null || !Number.isFinite(consensus) || consensus <= 0) {
    return { ...empty, asOfDate: asOf, staleReason: "invalid_consensus" };
  }
  if (count != null && count < 2) {
    return { ...empty, asOfDate: asOf, staleReason: "low_coverage" };
  }

  let raises = 0;
  let cuts = 0;
  for (const g of grades) {
    const k = gradeActionKind(g.action);
    if (k === "raise") raises += 1;
    else if (k === "cut") cuts += 1;
  }

  const ptVsSignalPct =
    signalPrice != null && signalPrice > 0
      ? Math.round(((consensus - signalPrice) / signalPrice) * 1000) / 10
      : null;

  return {
    available: true,
    asOfDate: asOf,
    consensusPT: consensus,
    ptHigh: pt.targetHigh,
    ptLow: pt.targetLow,
    analystCount: count,
    ptVsSignalPct,
    revisions: { raises, cuts, windowDays: GRADES_WINDOW_DAYS },
    revisionTrend: classifyRevisionTrend(raises, cuts),
    recent: mapRecent(grades),
  };
}
