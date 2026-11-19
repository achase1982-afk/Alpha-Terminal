import { isNyseEarlyClose, isNyseHoliday } from "./nyseSessionCalendar.js";

/** Equity options regular-session open (ET). GTH may start earlier per underlying; pill copy uses GTH. */
export const EQUITY_OPTIONS_GTH_OPEN_ET = { hour: 7, minute: 30 } as const;
export const EQUITY_OPTIONS_RTH_OPEN_ET = { hour: 9, minute: 30 } as const;

const ET = "America/New_York";
const MINUTE_MS = 60_000;
const GTH_OPEN_MINUTES = EQUITY_OPTIONS_GTH_OPEN_ET.hour * 60 + EQUITY_OPTIONS_GTH_OPEN_ET.minute;
const SESSION_END_MINUTES = 16 * 60 + 15;
const EARLY_CLOSE_END_MINUTES = 13 * 60;

type EtParts = { y: number; m: number; d: number; hour: number; minute: number; weekday: string };

/*
 * These helpers run once per quote cell on every chain and ladder render.
 * Building an Intl.DateTimeFormat costs tens of microseconds, so the
 * formatters are built once and the Eastern wall clock is cached per minute
 * (New York's UTC offset is always a whole number of hours, so every instant
 * in one UTC minute shares the same Eastern year/month/day/hour/minute).
 */
let etPartsFormatter: Intl.DateTimeFormat | null = null;
let asOfTimeFormatter: Intl.DateTimeFormat | null = null;
let asOfDateFormatter: Intl.DateTimeFormat | null = null;

const ET_PARTS_CACHE_MAX = 256;
const etPartsByMinute = new Map<number, EtParts>();
let gthOpenCache: { dayKey: number; ms: number } | null = null;

function etParts(ms: number): EtParts {
  const minuteKey = Math.floor(ms / MINUTE_MS);
  const cached = etPartsByMinute.get(minuteKey);
  if (cached) return cached;

  etPartsFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const out: EtParts = { y: 0, m: 0, d: 0, hour: 0, minute: 0, weekday: "" };
  for (const part of etPartsFormatter.formatToParts(new Date(ms))) {
    if (part.type === "year") out.y = Number(part.value);
    else if (part.type === "month") out.m = Number(part.value);
    else if (part.type === "day") out.d = Number(part.value);
    else if (part.type === "hour") out.hour = Number(part.value) % 24;
    else if (part.type === "minute") out.minute = Number(part.value);
    else if (part.type === "weekday") out.weekday = part.value;
  }

  if (etPartsByMinute.size >= ET_PARTS_CACHE_MAX) etPartsByMinute.clear();
  etPartsByMinute.set(minuteKey, out);
  return out;
}

/** Ms for today's options GTH open (7:30:00 AM) in America/New_York. */
export function equityOptionsGthOpenMs(nowMs: number): number {
  const anchor = etParts(nowMs);
  const dayKey = anchor.y * 10_000 + anchor.m * 100 + anchor.d;
  if (gthOpenCache?.dayKey === dayKey) return gthOpenCache.ms;

  const minuteStart = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  let open = minuteStart + (GTH_OPEN_MINUTES - (anchor.hour * 60 + anchor.minute)) * MINUTE_MS;
  // A daylight-saving switch (2 AM ET) between `nowMs` and 7:30 shifts the wall clock by an hour.
  for (let i = 0; i < 2; i++) {
    const p = etParts(open);
    const drift = GTH_OPEN_MINUTES - (p.hour * 60 + p.minute);
    if (drift === 0) break;
    open += drift * MINUTE_MS;
  }

  gthOpenCache = { dayKey, ms: open };
  return open;
}

function ymd(p: EtParts): string {
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function exchangeClosedDay(p: EtParts): boolean {
  return p.weekday === "Sat" || p.weekday === "Sun" || isNyseHoliday(ymd(p));
}

/** 4:15 PM ET index close, or 1:00 PM ET on an NYSE early close. */
function sessionEndMinutes(p: EtParts): number {
  return isNyseEarlyClose(ymd(p)) ? EARLY_CLOSE_END_MINUTES : SESSION_END_MINUTES;
}

export function equityOptionsSessionOpen(nowMs: number): boolean {
  const p = etParts(nowMs);
  if (exchangeClosedDay(p)) return false;
  const mins = p.hour * 60 + p.minute;
  return mins >= GTH_OPEN_MINUTES && mins < sessionEndMinutes(p);
}

/** True once today's equity-options session has ended (4:15 PM ET, 1:00 PM on early close). */
export function equityOptionsSessionEnded(nowMs: number): boolean {
  const p = etParts(nowMs);
  if (exchangeClosedDay(p)) return true;
  return p.hour * 60 + p.minute >= sessionEndMinutes(p);
}

export function equityOptionsClosedPill(nowMs: number): string {
  const p = etParts(nowMs);
  const mins = p.hour * 60 + p.minute;
  if (exchangeClosedDay(p) || mins >= sessionEndMinutes(p)) {
    return "Options closed · next GTH 7:30 AM ET";
  }
  if (mins < GTH_OPEN_MINUTES) return "Options closed · GTH opens 7:30 AM ET";
  return "Options closed";
}

/** Schwab quoteTimeInLong is from a prior options session (carryover close). */
export function isCarryoverOptionQuote(quoteTimeMs: number | null | undefined, nowMs: number): boolean {
  if (quoteTimeMs == null || !Number.isFinite(quoteTimeMs) || quoteTimeMs <= 0) return false;
  if (!equityOptionsSessionOpen(nowMs)) return true;
  return quoteTimeMs < equityOptionsGthOpenMs(nowMs);
}

export function formatQuoteAsOfEt(quoteTimeMs: number): string {
  asOfTimeFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  asOfDateFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "numeric",
    day: "numeric",
  });
  return `as of ${asOfTimeFormatter.format(quoteTimeMs)} ${asOfDateFormatter.format(quoteTimeMs)}`;
}
