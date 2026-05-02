function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function ds(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function dow(y: number, m: number, d: number): number {
  return new Date(y, m - 1, d).getDay();
}

function dim(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function nthDow(y: number, m: number, n: number, wd: number): number {
  const first = dow(y, m, 1);
  return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
}

function lastDow(y: number, m: number, wd: number): number {
  const last = dim(y, m);
  const lastWd = dow(y, m, last);
  return last - ((lastWd - wd + 7) % 7);
}

function addDays(y: number, m: number, d: number, days: number): [number, number, number] {
  const dt = new Date(y, m - 1, d + days);
  return [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()];
}

function observed(y: number, m: number, d: number): [number, number, number] {
  const w = dow(y, m, d);
  if (w === 6) return addDays(y, m, d, -1);
  if (w === 0) return addDays(y, m, d, 1);
  return [y, m, d];
}

function easter(y: number): [number, number] {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d2 = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d2 - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * mm + 114) / 31);
  const da = ((h + l - 7 * mm + 114) % 31) + 1;
  return [mo, da];
}

const FOMC_KNOWN: Record<number, string[]> = {
  2024: ["01-31", "03-20", "05-01", "06-12", "07-31", "09-18", "11-07", "12-18"],
  2025: ["01-29", "03-19", "05-07", "06-18", "07-30", "09-17", "10-29", "12-10"],
  2026: ["01-28", "03-18", "04-29", "06-17", "07-29", "09-16", "10-28", "12-09"],
  2027: ["01-27", "03-17", "05-05", "06-16", "07-28", "09-22", "10-27", "12-15"],
};

function fomcDates(y: number): string[] {
  if (FOMC_KNOWN[y]) return FOMC_KNOWN[y];
  return [
    `01-${pad2(lastDow(y, 1, 3))}`,
    `03-${pad2(nthDow(y, 3, 3, 3))}`,
    `05-${pad2(nthDow(y, 5, 1, 3))}`,
    `06-${pad2(nthDow(y, 6, 3, 3))}`,
    `07-${pad2(lastDow(y, 7, 3))}`,
    `09-${pad2(nthDow(y, 9, 3, 3))}`,
    `10-${pad2(lastDow(y, 10, 3))}`,
    `12-${pad2(nthDow(y, 12, 3, 3))}`,
  ];
}

interface CalendarEvent {
  date: string;
  type: "holiday" | "fomc" | "economic" | "earnings" | "opex" | "witching";
  title: string;
  ticker?: string;
  time?: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
}

// Legacy MEGA_EARNINGS hardcoded list intentionally removed. Per-ticker
// earnings dates now flow through `earningsDaysAway` (sourced from
// earningsService → vendor calendar/Yahoo) which is passed in to checkEventConflicts
// directly. Injecting synthetic earnings events from a stale wk-of-month table
// caused ticker-specific event conflicts to disagree with the rest of the
// pipeline (e.g. an AAPL trade could show "Apple Earnings" on the synthetic
// 4th-Thursday-of-Jan even after the real date had already passed).

const HIGH_IMPACT_TITLES = new Set([
  "Jobs Report (NFP)", "CPI Report", "PPI Report", "PCE Price Index", "GDP",
]);

function isHighImpact(title: string): boolean {
  for (const t of HIGH_IMPACT_TITLES) {
    if (title.includes(t) || title.startsWith("GDP")) return true;
  }
  return false;
}

const INDEX_SYMBOLS = new Set(["SPX", "SPY", "QQQ", "IWM", "/ES", "/NQ", "/RTY", "/YM", "$SPX", "SPXW"]);

function generateAllEvents(y: number): CalendarEvent[] {
  const ev: CalendarEvent[] = [];

  const holidays = new Set<string>();
  const addHoliday = (hy: number, m: number, d: number, title: string) => {
    const dateStr = ds(hy, m, d);
    holidays.add(dateStr);
    ev.push({ date: dateStr, type: "holiday", title, importance: "LOW" });
  };
  const [nyY, nyM, nyD] = observed(y, 1, 1);
  addHoliday(nyY, nyM, nyD, "New Year's Day");
  addHoliday(y, 1, nthDow(y, 1, 3, 1), "MLK Jr. Day");
  addHoliday(y, 2, nthDow(y, 2, 3, 1), "Presidents' Day");
  const [em, ed] = easter(y);
  const [, gfm, gfd] = addDays(y, em, ed, -2);
  addHoliday(y, gfm, gfd, "Good Friday");
  addHoliday(y, 5, lastDow(y, 5, 1), "Memorial Day");
  const [jnY, jnM, jnD] = observed(y, 6, 19);
  addHoliday(jnY, jnM, jnD, "Juneteenth");
  const [j4Y, j4M, j4D] = observed(y, 7, 4);
  addHoliday(j4Y, j4M, j4D, "Independence Day");
  addHoliday(y, 9, nthDow(y, 9, 1, 1), "Labor Day");
  addHoliday(y, 11, nthDow(y, 11, 4, 4), "Thanksgiving Day");
  const [xmY, xmM, xmD] = observed(y, 12, 25);
  addHoliday(xmY, xmM, xmD, "Christmas Day");

  const dates = fomcDates(y);
  dates.forEach((md) => {
    const mNum = parseInt(md.split("-")[0]);
    const dNum = parseInt(md.split("-")[1]);
    ev.push({ date: `${y}-${md}`, type: "fomc", title: "FOMC Decision", time: "2:00 PM ET", importance: "HIGH" });
    const [minY, minM, minD] = addDays(y, mNum, dNum, 21);
    ev.push({ date: ds(minY, minM, minD), type: "fomc", title: "FOMC Minutes", time: "2:00 PM ET", importance: "HIGH" });
  });

  for (let m = 1; m <= 12; m++) {
    const nfpDay = nthDow(y, m, 1, 5);
    ev.push({ date: ds(y, m, nfpDay), type: "economic", title: "Jobs Report (NFP)", time: "8:30 AM ET", importance: "HIGH" });

    const cpiDay = nthDow(y, m, 2, 3);
    ev.push({ date: ds(y, m, cpiDay), type: "economic", title: "CPI Report", time: "8:30 AM ET", importance: "HIGH" });

    const [ppiY, ppiM, ppiD] = addDays(y, m, cpiDay, -1);
    ev.push({ date: ds(ppiY, ppiM, ppiD), type: "economic", title: "PPI Report", time: "8:30 AM ET", importance: "HIGH" });

    const pceDay = lastDow(y, m, 5);
    ev.push({ date: ds(y, m, pceDay), type: "economic", title: "PCE Price Index", time: "8:30 AM ET", importance: "HIGH" });

    let thirdFriday = nthDow(y, m, 3, 5);
    if (holidays.has(ds(y, m, thirdFriday))) {
      const [, , shifted] = addDays(y, m, thirdFriday, -1);
      thirdFriday = shifted;
    }
    const isQuad = m === 3 || m === 6 || m === 9 || m === 12;
    ev.push({
      date: ds(y, m, thirdFriday),
      type: isQuad ? "witching" : "opex",
      title: isQuad ? "Quad Witching" : "Monthly OpEx",
      importance: isQuad ? "HIGH" : "MEDIUM",
    });
  }

  const gdpMonths = [1, 4, 7, 10];
  const gdpQuarters = ["Q4", "Q1", "Q2", "Q3"];
  gdpMonths.forEach((m, idx) => {
    const gdpDay = lastDow(y, m, 4);
    ev.push({ date: ds(y, m, gdpDay), type: "economic", title: `GDP ${gdpQuarters[idx]} (Advance)`, time: "8:30 AM ET", importance: "HIGH" });
  });

  // Per-ticker earnings injection removed — see top-of-file note. The
  // `earningsDaysAway` parameter on checkEventConflicts is the only authoritative
  // earnings source going forward.

  return ev;
}

let cachedEvents: CalendarEvent[] | null = null;
let cachedYear: number | null = null;
let cachedHolidayDates: Set<string> | null = null;

function getEvents(): CalendarEvent[] {
  const now = new Date();
  const y = now.getFullYear();
  if (cachedYear === y && cachedEvents) return cachedEvents;
  const events = [
    ...generateAllEvents(y - 1),
    ...generateAllEvents(y),
    ...generateAllEvents(y + 1),
  ].sort((a, b) => a.date.localeCompare(b.date));
  cachedEvents = events;
  cachedHolidayDates = new Set(events.filter(e => e.type === "holiday").map(e => e.date));
  cachedYear = y;
  return events;
}

function getHolidays(): Set<string> {
  if (!cachedHolidayDates) getEvents();
  return cachedHolidayDates!;
}

function toDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateToString(d: Date): string {
  return ds(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function tradingDaysBetween(from: Date, to: Date): number {
  const holidays = getHolidays();
  let count = 0;
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d <= to) {
    const w = d.getDay();
    if (w >= 1 && w <= 5 && !holidays.has(dateToString(d))) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

function addTradingDays(from: Date, days: number): Date {
  const holidays = getHolidays();
  const d = new Date(from);
  let count = 0;
  while (count < days) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w >= 1 && w <= 5 && !holidays.has(dateToString(d))) count++;
  }
  return d;
}

function formatDateShort(dateStr: string): string {
  const d = toDate(dateStr);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

export type StrategyCategory = "CREDIT" | "DEBIT" | "DIRECTIONAL" | "NEUTRAL";

const CREDIT_STRATEGIES = new Set([
  "BULL_PUT_SPREAD", "BEAR_CALL_SPREAD", "IRON_CONDOR", "IRON_BUTTERFLY",
  "SHORT_PUT", "SHORT_CALL", "SHORT_STRADDLE", "SHORT_STRANGLE",
  "COVERED_CALL", "CASH_SECURED_PUT",
]);

function classifyStrategy(strategyType: string): StrategyCategory {
  const upper = strategyType.toUpperCase().replace(/ /g, "_");
  if (CREDIT_STRATEGIES.has(upper)) return "CREDIT";
  if (upper.includes("LONG") || upper.includes("DEBIT")) return "DEBIT";
  if (upper.includes("BULL") || upper.includes("BEAR")) return "DIRECTIONAL";
  return "NEUTRAL";
}

export interface EventConflict {
  eventType: string;
  eventTitle: string;
  date: string;
  dateFormatted: string;
  time?: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
  ticker?: string;
}

export interface EventCheckResult {
  eventConflicts: EventConflict[];
  hardBlocks: string[];
  warnings: string[];
}

export function checkEventConflicts(
  symbol: string,
  proposedDTE: number,
  strategyType: string,
  earningsDaysAway?: number | null,
): EventCheckResult {
  const events = getEvents();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const expirationDate = new Date(today);
  expirationDate.setDate(expirationDate.getDate() + proposedDTE);

  const symbolUpper = symbol.toUpperCase();
  const stratCat = classifyStrategy(strategyType);
  const isIndex = INDEX_SYMBOLS.has(symbolUpper);

  const conflicts: EventConflict[] = [];
  const hardBlocks: string[] = [];
  const warnings: string[] = [];

  for (const ev of events) {
    const evDate = toDate(ev.date);
    if (evDate < today || evDate > expirationDate) continue;

    const tradingDaysAway = tradingDaysBetween(today, evDate);
    const dateLabel = formatDateShort(ev.date);
    const timeLabel = ev.time ? ` at ${ev.time}` : "";

    if (ev.type === "earnings") {
      if (!ev.ticker || ev.ticker.toUpperCase() !== symbolUpper) continue;
      conflicts.push({
        eventType: "earnings",
        eventTitle: ev.title,
        date: ev.date,
        dateFormatted: dateLabel,
        time: ev.time,
        importance: "HIGH",
        ticker: ev.ticker,
      });

      if (stratCat === "CREDIT") {
        hardBlocks.push(
          `${ev.ticker} earnings ${dateLabel} falls within DTE. Do not sell premium through earnings.`
        );
      } else {
        warnings.push(
          `${ev.ticker} earnings ${dateLabel}${timeLabel} falls within this expiration. Consider shorter DTE.`
        );
      }
    }

    if (ev.type === "fomc") {
      conflicts.push({
        eventType: "fomc",
        eventTitle: ev.title,
        date: ev.date,
        dateFormatted: dateLabel,
        time: ev.time,
        importance: "HIGH",
      });

      if (stratCat === "CREDIT") {
        hardBlocks.push(
          `${ev.title} ${dateLabel}${timeLabel} falls within DTE. Avoid selling premium through FOMC.`
        );
      } else if (tradingDaysAway <= 2) {
        warnings.push(
          `${ev.title} ${dateLabel}${timeLabel}. Expect elevated volatility around this event.`
        );
      }
    }

    if (ev.type === "economic" && isHighImpact(ev.title)) {
      conflicts.push({
        eventType: "economic",
        eventTitle: ev.title,
        date: ev.date,
        dateFormatted: dateLabel,
        time: ev.time,
        importance: "HIGH",
      });

      if (isIndex && stratCat === "CREDIT") {
        hardBlocks.push(
          `${ev.title} ${dateLabel}${timeLabel} — high-impact release within DTE on index trade. Avoid selling premium.`
        );
      } else if (tradingDaysAway <= 1) {
        warnings.push(
          `${ev.title} ${dateLabel}${timeLabel} — high-impact economic release imminent.`
        );
      } else if (stratCat === "CREDIT") {
        warnings.push(
          `${ev.title} ${dateLabel}${timeLabel} falls within DTE. Monitor for volatility impact.`
        );
      }
    }

    if (ev.type === "opex" || ev.type === "witching") {
      if (tradingDaysAway <= 1) {
        conflicts.push({
          eventType: ev.type,
          eventTitle: ev.title,
          date: ev.date,
          dateFormatted: dateLabel,
          importance: ev.type === "witching" ? "HIGH" : "MEDIUM",
        });
        warnings.push(
          `${ev.title} ${dateLabel} — increased pin risk and gamma exposure near the money.`
        );
      }
    }

    if (ev.type === "holiday") {
      if (tradingDaysAway <= 1) {
        conflicts.push({
          eventType: "holiday",
          eventTitle: ev.title,
          date: ev.date,
          dateFormatted: dateLabel,
          importance: "LOW",
        });
      }
    }
  }

  if (earningsDaysAway != null && earningsDaysAway <= proposedDTE && earningsDaysAway > 0) {
    const hasTickerEarnings = conflicts.some(c => c.eventType === "earnings" && c.ticker?.toUpperCase() === symbolUpper);
    if (!hasTickerEarnings) {
      const earningsDateApprox = new Date(today);
      earningsDateApprox.setDate(earningsDateApprox.getDate() + earningsDaysAway);
      const earningsLabel = formatDateShort(ds(earningsDateApprox.getFullYear(), earningsDateApprox.getMonth() + 1, earningsDateApprox.getDate()));

      conflicts.push({
        eventType: "earnings",
        eventTitle: `${symbolUpper} Earnings (projected)`,
        date: ds(earningsDateApprox.getFullYear(), earningsDateApprox.getMonth() + 1, earningsDateApprox.getDate()),
        dateFormatted: earningsLabel,
        importance: "HIGH",
        ticker: symbolUpper,
      });

      if (stratCat === "CREDIT") {
        hardBlocks.push(
          `${symbolUpper} projected earnings ~${earningsLabel} falls within DTE. Do not sell premium through earnings.`
        );
      } else {
        warnings.push(
          `${symbolUpper} projected earnings ~${earningsLabel} falls within this expiration. Consider shorter DTE.`
        );
      }
    }
  }

  return { eventConflicts: conflicts, hardBlocks, warnings };
}

export interface UpcomingEvent {
  date: string;
  dateFormatted: string;
  title: string;
  type: string;
  time?: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
}

export function getUpcomingEvents(withinTradingDays: number = 2): UpcomingEvent[] {
  const events = getEvents();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const horizon = addTradingDays(today, withinTradingDays);

  const upcoming: UpcomingEvent[] = [];

  for (const ev of events) {
    const evDate = toDate(ev.date);
    if (evDate < today || evDate > horizon) continue;
    if (ev.type === "holiday") continue;

    upcoming.push({
      date: ev.date,
      dateFormatted: formatDateShort(ev.date),
      title: ev.title,
      type: ev.type,
      time: ev.time,
      importance: ev.importance,
    });
  }

  return upcoming.sort((a, b) => a.date.localeCompare(b.date));
}
