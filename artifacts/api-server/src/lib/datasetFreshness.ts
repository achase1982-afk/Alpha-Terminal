import {
  getMarketContext,
  marketTradingDateNy,
  priorNyTradingSessionYmd,
  rthOpenMsForTradingDate,
  sessionWindowEndMsForTradingDate,
  sessionWindowStartMsForTradingDate,
  type MarketContext,
} from "./getMarketContext.js";
import { nyOffsetForYmd } from "./usEquityMarketCalendar.js";

export type DatasetOrigin = "CURRENT_SESSION" | "PRIOR_SESSION" | "STALE";

export interface DatasetFreshnessMeta {
  asOf: string;
  origin: DatasetOrigin;
}

/** Parse upstream asOf (ISO instant or YYYY-MM-DD) to epoch ms in America/New_York semantics. */
export function parseDatasetAsOfMs(asOf: string): number | null {
  const s = asOf.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const off = nyOffsetForYmd(s);
    const probe = new Date(`${s}T12:00:00${off}`);
    if (Number.isNaN(probe.getTime())) return null;
    return probe.getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function classifyOrigin(
  asOf: string | null | undefined,
  marketContext: MarketContext,
): DatasetOrigin {
  if (!asOf || typeof asOf !== "string") return "STALE";
  const asOfMs = parseDatasetAsOfMs(asOf);
  if (asOfMs == null) return "STALE";

  const trimmed = asOf.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const asOfYmd = dateOnly ? trimmed : marketTradingDateNy(new Date(asOfMs));

  const prior = priorNyTradingSessionYmd(marketContext.tradingDate);
  if (prior && asOfYmd < prior) return "STALE";

  if (asOfYmd < marketContext.tradingDate) return "PRIOR_SESSION";

  if (dateOnly && asOfYmd === marketContext.tradingDate) {
    if (marketContext.session === "PREMARKET" || marketContext.session === "CLOSED") return "PRIOR_SESSION";
    return "CURRENT_SESSION";
  }

  const openMs = rthOpenMsForTradingDate(marketContext.tradingDate);
  if (asOfMs < openMs) return "PRIOR_SESSION";

  const winStart = sessionWindowStartMsForTradingDate(marketContext.tradingDate);
  const winEnd = sessionWindowEndMsForTradingDate(marketContext.tradingDate);
  if (asOfMs >= winStart && asOfMs <= winEnd) return "CURRENT_SESSION";

  return "PRIOR_SESSION";
}

export function buildDatasetFreshnessMeta(
  asOf: string | null | undefined,
  marketContext?: MarketContext,
): DatasetFreshnessMeta | null {
  if (!asOf) return null;
  const ctx = marketContext ?? getMarketContext();
  return { asOf, origin: classifyOrigin(asOf, ctx) };
}

export function formatDatasetInlineTag(
  label: string,
  meta: DatasetFreshnessMeta | null | undefined,
): string {
  if (!meta) return label;
  const asOfDisplay = meta.asOf.length >= 10 ? meta.asOf.slice(0, 10) : meta.asOf;
  const suffix =
    meta.origin === "PRIOR_SESSION" && /close|16:00|eod/i.test(meta.asOf)
      ? " close"
      : "";
  return `${label} [asOf: ${asOfDisplay}${suffix} | origin: ${meta.origin}]`;
}
