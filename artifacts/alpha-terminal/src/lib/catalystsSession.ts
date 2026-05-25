import {
  classifyCatalystDrift,
  type CatalystCard,
  type CatalystDirectionFilter,
  type CatalystDriftClass,
} from "@workspace/catalysts-types";
import type { QuoteData } from "@/hooks/useQuote";
import type { LiveQuote } from "@/lib/store";

const BG = "#0D0D0D";
const CARD = "#1A1A1A";
const ELEVATED = "#222222";
const BORDER = "#2A2A2A";
const BORDER_STRONG = "#3A3A3A";
const GOLD = "#F2A93C";
const BLUE = "#0064FF";
const GREEN = "#00E88F";
const RED = "#FF4D4D";
const TEXT = "#F5F5F5";

export const CATALYSTS_COLORS = {
  BG,
  CARD,
  ELEVATED,
  BORDER,
  BORDER_STRONG,
  GOLD,
  BLUE,
  GREEN,
  RED,
  TEXT,
} as const;

export const CATALYSTS_MIN_FONT_PX = 12;

export type LiveTapeMode = "SESSION" | "AHRS" | "OVERNIGHT";

export type CatalystCardPhase =
  | "upcoming"
  | "reports_today"
  | "reporting_after_close"
  | "reported";

function nyParts(now: Date): { ymd: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { ymd: `${y}-${m}-${d}`, hour, minute };
}

export function liveTapeMode(now = new Date()): LiveTapeMode {
  const { hour, minute } = nyParts(now);
  const mins = hour * 60 + minute;
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return "SESSION";
  if (mins >= 16 * 60 && mins < 20 * 60) return "AHRS";
  return "OVERNIGHT";
}

export function daysUntilEarnings(earningsDate: string, now = new Date()): number {
  const today = nyParts(now).ymd;
  const t0 = Date.parse(`${today}T12:00:00Z`);
  const t1 = Date.parse(`${earningsDate}T12:00:00Z`);
  return Math.round((t1 - t0) / 86_400_000);
}

function nyOpenMs(ymd: string): number {
  for (const off of ["-04:00", "-05:00"] as const) {
    const ms = Date.parse(`${ymd}T09:30:00${off}`);
    const p = nyParts(new Date(ms));
    if (p.ymd === ymd && p.hour === 9 && p.minute === 30) return ms;
  }
  return Date.parse(`${ymd}T14:30:00Z`);
}

/** First 9:30 AM ET regular open strictly after the earnings release instant. */
export function regularSessionOpenMsAfterReport(reportAtIso: string): number {
  const reportMs = Date.parse(reportAtIso);
  for (let day = 1; day <= 10; day++) {
    const probe = new Date(reportMs + day * 86_400_000);
    const openMs = nyOpenMs(nyParts(probe).ymd);
    if (openMs > reportMs) return openMs;
  }
  return reportMs + 5 * 86_400_000;
}

/** Client fall-off: first regular open after the print. */
export function shouldFallOffCatalyst(card: CatalystCard, now = new Date()): boolean {
  const reportMs = Date.parse(card.reportAtIso);
  if (!Number.isFinite(reportMs) || now.getTime() < reportMs) return false;
  const openMs = regularSessionOpenMsAfterReport(card.reportAtIso);
  return now.getTime() >= openMs;
}

export function catalystCardPhase(card: CatalystCard, now = new Date()): CatalystCardPhase {
  const { ymd } = nyParts(now);
  const reportMs = Date.parse(card.reportAtIso);
  const days = daysUntilEarnings(card.earningsDate, now);

  if (now.getTime() >= reportMs) return "reported";

  if (card.earningsDate === ymd) {
    const mode = liveTapeMode(now);
    if (
      card.earningsTiming === "AMC" &&
      mode === "AHRS" &&
      now.getTime() < reportMs
    ) {
      return "reporting_after_close";
    }
    return "reports_today";
  }

  if (days === 1 && card.earningsTiming === "BMO") {
    return "reports_today";
  }

  return "upcoming";
}

export function earningsBadgeLabel(card: CatalystCard, now = new Date()): string {
  const phase = catalystCardPhase(card, now);
  const timing = card.earningsTiming ? ` · ${card.earningsTiming}` : "";

  switch (phase) {
    case "reported":
      return "REPORTED";
    case "reporting_after_close":
      return "REPORTING AFTER CLOSE";
    case "reports_today":
      return `REPORTS TODAY${timing}`;
    default: {
      const days = daysUntilEarnings(card.earningsDate, now);
      if (days <= 0) return `REPORTS TODAY${timing}`;
      if (days === 1 && card.earningsTiming === "BMO") return `REPORTS TOMORROW${timing}`;
      return `ER ${days}d`;
    }
  }
}

export function sessionSettledPct(quote: QuoteData | null): number | null {
  if (!quote) return null;
  if (
    quote.regularLast != null &&
    quote.close != null &&
    quote.close !== 0 &&
    Number.isFinite(quote.regularLast)
  ) {
    return ((quote.regularLast - quote.close) / quote.close) * 100;
  }
  return quote.changePct;
}

export function afterHoursPct(quote: QuoteData | null): number | null {
  if (!quote) return null;
  const reg = quote.regularLast ?? quote.close;
  const ext = quote.extendedLast ?? quote.last;
  if (reg != null && ext != null && reg !== 0 && Number.isFinite(reg) && Number.isFinite(ext)) {
    return ((ext - reg) / reg) * 100;
  }
  return null;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function pctColor(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return TEXT;
  return n > 0 ? GREEN : RED;
}

export function driftClassForCard(
  card: CatalystCard,
  liveMovePct: number | null,
): CatalystDriftClass {
  return classifyCatalystDrift(card.snapshot.sessionMovesPct, liveMovePct);
}

export function matchesDirectionFilter(
  card: CatalystCard,
  filter: CatalystDirectionFilter,
  liveMovePct: number | null,
): boolean {
  if (filter === "all") return true;
  return driftClassForCard(card, liveMovePct) === filter;
}

/** Live session % for drift filter (6th session in the trailing window). */
export function liveMovePctFromQuote(quote: QuoteData | null | undefined): number | null {
  if (!quote) return null;
  const mode = liveTapeMode();
  if (mode === "SESSION") {
    return sessionSettledPct(quote) ?? quote.changePct;
  }
  return quote.changePct;
}

export function liveMovePctFromStream(quote: LiveQuote | undefined): number | null {
  if (!quote) return null;
  return liveMovePctFromQuote({
    symbol: quote.symbol,
    description: null,
    last: quote.last,
    regularLast: quote.regularLast,
    extendedLast: quote.extendedLast,
    bid: quote.bid,
    ask: quote.ask,
    bidSize: quote.bidSize,
    askSize: quote.askSize,
    change: quote.change,
    changePct: quote.changePct,
    volume: quote.volume,
    high: quote.high,
    low: quote.low,
    close: quote.close,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    peRatio: null,
  });
}

export const DIRECTION_FILTER_EMPTY: Record<Exclude<CatalystDirectionFilter, "all">, string> = {
  trending_up: "No names trending up in the next 10 days",
  trending_down: "No names trending down in the next 10 days",
  choppy: "No choppy names in the next 10 days",
};
