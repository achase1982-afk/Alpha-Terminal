/**
 * US equity session calendar: NYSE/NASDAQ full-day closures (observed civil dates)
 * + helpers for trading-day checks. Used by schedulers and session fallback logic.
 */

export function nyCalendarYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export function nyOffsetForYmd(ymd: string): "-04:00" | "-05:00" {
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

export function nyWeekdaySun0(ymd: string): number {
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
 */
export function nyseStandardFullClosureYmdsForYear(y: number): Set<string> {
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

/** True when `ymd` (America/New_York calendar date) is an NYSE/NASDAQ full-day market closure. */
export function isNyseFullDayClosureYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const y = parseInt(ymd.slice(0, 4), 10);
  if (!Number.isFinite(y)) return false;
  for (const yy of [y - 1, y, y + 1]) {
    if (nyseStandardFullClosureYmdsForYear(yy).has(ymd)) return true;
  }
  return false;
}

/** Sorted ISO dates (YYYY-MM-DD) for all full NYSE closures in the given calendar year. */
export function getHolidaysForYear(year: number): string[] {
  return [...nyseStandardFullClosureYmdsForYear(year)].sort();
}

/** Full equity-session holiday (exchange closed), not counting weekends as named holidays. */
export function isMarketHoliday(date: Date): boolean {
  const ymd = nyCalendarYmd(date);
  return isNyseFullDayClosureYmd(ymd);
}

/** Mon–Fri NY calendar session days that are not full closures (sync; no Polygon fetch). */
export function isNyTradingSessionDateSync(dateYmd: string): boolean {
  const wd = nyWeekdaySun0(dateYmd);
  if (wd === 0 || wd === 6) return false;
  if (isNyseFullDayClosureYmd(dateYmd)) return false;
  return true;
}

/** Last `count` equity trading sessions ending at today's NY calendar date (includes today if session). */
export function lastNyTradingSessionYmds(count: number): string[] {
  const out: string[] = [];
  let ymd = nyCalendarYmd(new Date());
  for (let guard = 0; guard < 600 && out.length < count; guard++) {
    if (isNyTradingSessionDateSync(ymd)) out.push(ymd);
    const prev = addCalendarDaysNy(ymd, -1);
    ymd = prev;
  }
  return out;
}
