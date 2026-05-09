import { logger } from "./logger.js";

export function nyCalendarYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function nyOffsetForYmd(ymd: string): "-04:00" | "-05:00" {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  })
    .formatToParts(probe)
    .find((p) => p.type === "timeZoneName")?.value ?? "";
  return part.includes("-4") || part.includes("EDT") ? "-04:00" : "-05:00";
}

/** Calendar add in America/New_York (walk session dates without importing Temporal). */
export function addCalendarDaysNy(ymd: string, deltaDays: number): string {
  const off = nyOffsetForYmd(ymd);
  const d = new Date(`${ymd}T12:00:00${off}`);
  d.setTime(d.getTime() + deltaDays * 86_400_000);
  return nyCalendarYmd(d);
}

function addDaysYmd(ymd: string, deltaDays: number): string {
  return addCalendarDaysNy(ymd, deltaDays);
}

function nyWeekdaySun0(ymd: string): number {
  const off = nyOffsetForYmd(ymd);
  const d = new Date(`${ymd}T12:00:00${off}`);
  const long = d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const i = names.indexOf(long);
  return i >= 0 ? i : 0;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dsUtc(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** US civil-calendar weekday (UTC) for NYSE-schedule arithmetic on YYYY-MM-DD components. */
function utcDow(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function civilObservedUtc(y: number, m: number, d: number): { y: number; m: number; d: number } {
  const w = utcDow(y, m, d);
  if (w === 6) {
    const t = new Date(Date.UTC(y, m - 1, d - 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  if (w === 0) {
    const t = new Date(Date.UTC(y, m - 1, d + 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  return { y, m, d };
}

function nthDowUtc(y: number, month: number, n: number, wd: number): string {
  const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
  const day = 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  return dsUtc(y, month, day);
}

function lastDowUtc(y: number, month: number, wd: number): string {
  const dim = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const lastWd = new Date(Date.UTC(y, month - 1, dim)).getUTCDay();
  const day = dim - ((lastWd - wd + 7) % 7);
  return dsUtc(y, month, day);
}

function easterSundayUtc(y: number): { m: number; d: number } {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * mm + 114) / 31);
  const da = ((h + l - 7 * mm + 114) % 31) + 1;
  return { m: mo, d: da };
}

function addUtcDaysYmd(ymd: string, delta: number): string {
  const y = parseInt(ymd.slice(0, 4), 10);
  const m = parseInt(ymd.slice(5, 7), 10);
  const d = parseInt(ymd.slice(8, 10), 10);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return dsUtc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * NYSE/NASDAQ full-day closures from the standard exchange holiday calendar (civil dates).
 * Polygon `marketstatus/upcoming` only lists future events; this covers historical session skips
 * for trading-day arithmetic (e.g. earnings reactions over multi-year windows).
 */
function nyseStandardFullClosureYmdsForYear(y: number): Set<string> {
  const s = new Set<string>();
  const add = (yy: number, m: number, d: number) => s.add(dsUtc(yy, m, d));

  const ny = civilObservedUtc(y, 1, 1);
  add(ny.y, ny.m, ny.d);
  s.add(nthDowUtc(y, 1, 3, 1));
  s.add(nthDowUtc(y, 2, 3, 1));
  const es = easterSundayUtc(y);
  s.add(addUtcDaysYmd(dsUtc(y, es.m, es.d), -2));
  s.add(lastDowUtc(y, 5, 1));
  if (y >= 2022) {
    const jn = civilObservedUtc(y, 6, 19);
    add(jn.y, jn.m, jn.d);
  }
  const j4 = civilObservedUtc(y, 7, 4);
  add(j4.y, j4.m, j4.d);
  s.add(nthDowUtc(y, 9, 1, 1));
  s.add(nthDowUtc(y, 11, 4, 4));
  const xm = civilObservedUtc(y, 12, 25);
  add(xm.y, xm.m, xm.d);
  return s;
}

function isNyseStandardFullClosure(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const y = parseInt(ymd.slice(0, 4), 10);
  if (!Number.isFinite(y)) return false;
  for (const yy of [y - 1, y, y + 1]) {
    if (nyseStandardFullClosureYmdsForYear(yy).has(ymd)) return true;
  }
  return false;
}

/** True when this NY calendar date is a regular equity session (Mon–Fri, not a full-market holiday). */
export async function isNyTradingSessionDate(dateYmd: string): Promise<boolean> {
  const wd = nyWeekdaySun0(dateYmd);
  if (wd === 0 || wd === 6) return false;
  if (isNyseStandardFullClosure(dateYmd)) return false;
  if (await isMarketHoliday(dateYmd)) return false;
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

/** True if Polygon lists this NY session date as fully closed (NYSE/NASDAQ). Weekends are handled separately in session logic. */
export async function isMarketHoliday(dateYmd: string): Promise<boolean> {
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
    if (await isMarketHoliday(ymd)) {
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
