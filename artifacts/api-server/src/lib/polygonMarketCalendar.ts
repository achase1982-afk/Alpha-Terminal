import { logger } from "./logger.js";
import {
  addCalendarDaysNy,
  isNyseFullDayClosureYmd,
  nyCalendarYmd,
  nyOffsetForYmd,
  nyWeekdaySun0,
  nyseStandardFullClosureYmdsForYear,
} from "./usEquityMarketCalendar.js";

export {
  addCalendarDaysNy,
  nyCalendarYmd,
  nyOffsetForYmd,
  nyWeekdaySun0,
  nyseStandardFullClosureYmdsForYear,
  isNyseFullDayClosureYmd,
};

function addDaysYmd(ymd: string, deltaDays: number): string {
  return addCalendarDaysNy(ymd, deltaDays);
}

/** True when this NY calendar date is a regular equity session (Mon–Fri, not a full-market holiday). */
export async function isNyTradingSessionDate(dateYmd: string): Promise<boolean> {
  const wd = nyWeekdaySun0(dateYmd);
  if (wd === 0 || wd === 6) return false;
  if (isNyseFullDayClosureYmd(dateYmd)) return false;
  if (await polygonListedMarketClosure(dateYmd)) return false;
  return true;
}

export async function nextNyTradingDayYmd(ymd: string): Promise<string> {
  let d = addCalendarDaysNy(ymd, 1);
  for (let i = 0; i < 400; i++) {
    if (await isNyTradingSessionDate(d)) return d;
    d = addCalendarDaysNy(d, 1);
  }
  logger.error({}, "polygonMarketCalendar: nextNyTradingDayYmd exceeded lookback");
  return d;
}

export async function prevNyTradingDayYmd(ymd: string): Promise<string> {
  let d = addCalendarDaysNy(ymd, -1);
  for (let i = 0; i < 400; i++) {
    if (await isNyTradingSessionDate(d)) return d;
    d = addCalendarDaysNy(d, -1);
  }
  logger.error({}, "polygonMarketCalendar: prevNyTradingDayYmd exceeded lookback");
  return d;
}

export async function advanceNyTradingDaysYmd(ymd: string, deltaSessions: number): Promise<string> {
  let d = ymd;
  const steps = Math.abs(deltaSessions);
  const dir = deltaSessions >= 0 ? 1 : -1;
  for (let s = 0; s < steps; s++) {
    d = dir > 0 ? await nextNyTradingDayYmd(d) : await prevNyTradingDayYmd(d);
  }
  return d;
}

const POLYGON_API = "https://api.polygon.io";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Raw row from GET /v1/marketstatus/upcoming */
interface PolygonUpcomingRow {
  date?: string;
  exchange?: string;
  name?: string;
  status?: string;
  close?: string;
  open?: string;
}

export interface MarketHolidayRow {
  date: string;
  name: string;
  status: "closed" | "early-close";
  close?: string;
  open?: string;
}

export interface MarketCalendarPayload {
  holidays: MarketHolidayRow[];
  fetchedAt: number;
}

let cache: MarketCalendarPayload | null = null;

function apiKey(): string | null {
  const k = process.env["POLYGON_API_KEY"];
  return k && k.length > 0 ? k : null;
}

/**
 * Fetch and normalize Polygon upcoming market events (NYSE/NASDAQ equities).
 * Cached 24h per process.
 */
export async function fetchMarketCalendar(): Promise<MarketCalendarPayload> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }

  const key = apiKey();
  if (!key) {
    logger.warn({}, "polygonMarketCalendar: POLYGON_API_KEY missing, using empty calendar");
    cache = { holidays: [], fetchedAt: now };
    return cache;
  }

  const url = `${POLYGON_API}/v1/marketstatus/upcoming?apiKey=${encodeURIComponent(key)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) {
      logger.warn({ status: r.status }, "polygonMarketCalendar: upcoming calendar non-OK, treating days as regular sessions");
      cache = { holidays: [], fetchedAt: now };
      return cache;
    }
    const raw = (await r.json()) as PolygonUpcomingRow[] | unknown;
    const rows = Array.isArray(raw) ? raw : [];

    const byDate = new Map<string, MarketHolidayRow>();
    for (const row of rows) {
      const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const ex = String(row.exchange ?? "").toUpperCase();
      if (ex !== "NYSE" && ex !== "NASDAQ") continue;
      const statusRaw = String(row.status ?? "").toLowerCase();
      const status: "closed" | "early-close" | null =
        statusRaw === "closed" ? "closed" : statusRaw === "early-close" ? "early-close" : null;
      if (!status) continue;

      const name = typeof row.name === "string" ? row.name : "Market event";
      const prev = byDate.get(date);
      if (status === "closed") {
        byDate.set(date, { date, name, status: "closed" });
      } else if (status === "early-close") {
        if (!prev || prev.status !== "closed") {
          const ec: MarketHolidayRow = { date, name, status: "early-close" };
          if (typeof row.close === "string") ec.close = row.close;
          if (typeof row.open === "string") ec.open = row.open;
          byDate.set(date, ec);
        }
      }
    }

    const holidays = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    cache = { holidays, fetchedAt: now };
    return cache;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "polygonMarketCalendar: fetch failed, treating days as regular sessions");
    cache = { holidays: [], fetchedAt: now };
    return cache;
  }
}

async function holidayRowForDate(dateYmd: string): Promise<MarketHolidayRow | undefined> {
  const { holidays } = await fetchMarketCalendar();
  return holidays.find((h) => h.date === dateYmd);
}

/** Polygon close ISO for early-close sessions (UTC string from API). */
export async function getEarlyCloseUtcIso(dateYmd: string): Promise<string | null> {
  const row = await holidayRowForDate(dateYmd);
  if (row?.status === "early-close" && typeof row.close === "string" && row.close.length > 0) {
    return row.close;
  }
  return null;
}

/**
 * True if Polygon upcoming-market API lists this NY session date as fully closed.
 * Weekends are handled separately. Complements {@link isNyseFullDayClosureYmd} (rule-based exchange calendar).
 */
export async function polygonListedMarketClosure(dateYmd: string): Promise<boolean> {
  const row = await holidayRowForDate(dateYmd);
  return row?.status === "closed";
}

export async function isEarlyClose(dateYmd: string): Promise<{ isEarlyClose: boolean; closeTimeEt: string | null }> {
  const row = await holidayRowForDate(dateYmd);
  if (!row || row.status !== "early-close") {
    return { isEarlyClose: false, closeTimeEt: null };
  }
  if (typeof row.close === "string" && row.close.length > 0) {
    const d = new Date(row.close);
    if (!Number.isNaN(d.getTime())) {
      const et = d.toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const closeTimeEt = et.replace(/\s/g, "");
      return { isEarlyClose: true, closeTimeEt };
    }
  }
  return { isEarlyClose: true, closeTimeEt: null };
}

/**
 * RTH wall-clock bounds in ms (UTC) for a given NYSE session calendar date.
 * Uses Polygon early-close when present; otherwise 9:30–16:00 America/New_York.
 */
export async function rthBoundsMs(sessionYmd: string): Promise<{ openMs: number; closeMs: number }> {
  const off = nyOffsetForYmd(sessionYmd);
  const openMs = new Date(`${sessionYmd}T09:30:00${off}`).getTime();
  const earlyCloseIso = await getEarlyCloseUtcIso(sessionYmd);
  let closeMs: number;
  if (earlyCloseIso) {
    const t = new Date(earlyCloseIso).getTime();
    closeMs = Number.isNaN(t) ? new Date(`${sessionYmd}T16:00:00${off}`).getTime() : t;
  } else {
    closeMs = new Date(`${sessionYmd}T16:00:00${off}`).getTime();
  }
  return { openMs, closeMs };
}

/**
 * YYYY-MM-DD in America/New_York for the most recently *completed* regular session
 * (after that session's official close, including early-close). During the current
 * session, returns the prior business day. Skips weekends and Polygon market holidays.
 */
export async function lastCompletedTradingDayNy(now: Date): Promise<string> {
  let ymd = nyCalendarYmd(now);
  for (let i = 0; i < 400; i++) {
    const wd = nyWeekdaySun0(ymd);
    if (wd === 0 || wd === 6) {
      ymd = addDaysYmd(ymd, -1);
      continue;
    }
    if (await polygonListedMarketClosure(ymd)) {
      ymd = addDaysYmd(ymd, -1);
      continue;
    }
    const { closeMs } = await rthBoundsMs(ymd);
    if (now.getTime() >= closeMs) {
      return ymd;
    }
    ymd = addDaysYmd(ymd, -1);
  }
  logger.error({}, "polygonMarketCalendar: lastCompletedTradingDayNy exceeded lookback");
  return nyCalendarYmd(now);
}
