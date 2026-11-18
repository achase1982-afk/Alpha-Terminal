/** Equity options regular-session open (ET). GTH may start earlier per underlying; pill copy uses GTH. */
export const EQUITY_OPTIONS_GTH_OPEN_ET = { hour: 7, minute: 30 } as const;
export const EQUITY_OPTIONS_RTH_OPEN_ET = { hour: 9, minute: 30 } as const;

const ET = "America/New_York";

function etParts(ms: number): { y: number; m: number; d: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Ms for today's options GTH open in America/New_York. */
export function equityOptionsGthOpenMs(nowMs: number): number {
  const anchor = etParts(nowMs);
  const dayStart = nowMs - (anchor.hour * 60 + anchor.minute) * 60_000;
  for (let probe = dayStart; probe < dayStart + 24 * 3_600_000; probe += 30_000) {
    const p = etParts(probe);
    if (
      p.y === anchor.y &&
      p.m === anchor.m &&
      p.d === anchor.d &&
      p.hour === EQUITY_OPTIONS_GTH_OPEN_ET.hour &&
      p.minute === EQUITY_OPTIONS_GTH_OPEN_ET.minute
    ) {
      return probe;
    }
  }
  return nowMs;
}

export function equityOptionsSessionOpen(nowMs: number): boolean {
  const p = etParts(nowMs);
  const mins = p.hour * 60 + p.minute;
  const gth = EQUITY_OPTIONS_GTH_OPEN_ET.hour * 60 + EQUITY_OPTIONS_GTH_OPEN_ET.minute;
  const rthEnd = 16 * 60 + 15;
  return mins >= gth && mins < rthEnd;
}

export function equityOptionsClosedPill(nowMs: number): string {
  const p = etParts(nowMs);
  const mins = p.hour * 60 + p.minute;
  const gth = EQUITY_OPTIONS_GTH_OPEN_ET.hour * 60 + EQUITY_OPTIONS_GTH_OPEN_ET.minute;
  if (mins < gth) return "Options closed · opens 7:30 AM";
  if (mins >= 16 * 60 + 15) return "Options closed · opens 7:30 AM";
  return "Options closed";
}

/** Schwab quoteTimeInLong is from a prior options session (carryover close). */
export function isCarryoverOptionQuote(quoteTimeMs: number | null | undefined, nowMs: number): boolean {
  if (quoteTimeMs == null || !Number.isFinite(quoteTimeMs) || quoteTimeMs <= 0) return false;
  if (!equityOptionsSessionOpen(nowMs)) return true;
  return quoteTimeMs < equityOptionsGthOpenMs(nowMs);
}

export function formatQuoteAsOfEt(quoteTimeMs: number): string {
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(quoteTimeMs);
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "numeric",
    day: "numeric",
  }).format(quoteTimeMs);
  return `as of ${time} ${date}`;
}