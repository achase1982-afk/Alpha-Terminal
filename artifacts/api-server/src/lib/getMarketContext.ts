/**
 * Deterministic US equity session clock — models must not infer time or session state.
 */
import { NYSE_EARLY_CLOSE_2026, NYSE_HOLIDAYS_2026 } from "./nyseCalendar2026.js";
import { lastNyTradingSessionYmds, nyCalendarYmd, nyOffsetForYmd } from "./usEquityMarketCalendar.js";

export type MarketSessionLabel = "PREMARKET" | "OPEN" | "AFTERHOURS" | "CLOSED";

/** US equity session calendar — session math always uses this zone, not the client display zone. */
export const US_EQUITY_SESSION_TIME_ZONE = "America/New_York";

export interface MarketContext {
  now: string;
  timeZone: string;
  localLabel: string;
  tradingDate: string;
  session: MarketSessionLabel;
  /** Single-name equity options: regular session 9:30–16:00 ET only (not early-close 13:00 window). */
  optionsLive: boolean;
}

function formatMarketLocalLabel(now: Date, clientTimeZone: string): string {
  const etLabel = now.toLocaleString("en-US", {
    timeZone: US_EQUITY_SESSION_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const base = `${etLabel} ET`;
  const client = clientTimeZone.trim() || US_EQUITY_SESSION_TIME_ZONE;
  if (client === US_EQUITY_SESSION_TIME_ZONE) return base;
  const userLocal = now.toLocaleString("en-US", {
    timeZone: client,
    dateStyle: "medium",
    timeStyle: "short",
  });
  return `${base} (your local: ${userLocal})`;
}

export function getMarketContext(now = new Date(), clientTimeZone = "America/New_York"): MarketContext {
  const displayTz = clientTimeZone.trim() || US_EQUITY_SESSION_TIME_ZONE;
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: US_EQUITY_SESSION_TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((a, x) => {
      if (x.type !== "literal") a[x.type] = x.value;
      return a;
    }, {});

  const ymd = `${p.year}-${p.month}-${p.day}`;
  const mins = +p.hour * 60 + +p.minute;
  const isWeekday = !["Sat", "Sun"].includes(p.weekday ?? "");
  const isHoliday = NYSE_HOLIDAYS_2026.includes(ymd);
  const earlyClose = NYSE_EARLY_CLOSE_2026.includes(ymd);
  const closeMin = earlyClose ? 780 : 960;

  let session: MarketSessionLabel = "CLOSED";
  if (isWeekday && !isHoliday) {
    if (mins >= 240 && mins < 570) session = "PREMARKET";
    else if (mins >= 570 && mins < closeMin) session = "OPEN";
    else if (mins >= closeMin && mins < 1200) session = "AFTERHOURS";
  }

  const optionsLive = session === "OPEN" && !earlyClose;

  return {
    now: now.toISOString(),
    timeZone: displayTz,
    localLabel: formatMarketLocalLabel(now, displayTz),
    tradingDate: ymd,
    session,
    optionsLive,
  };
}

/** NY calendar YMD for `instant` (not client display zone). */
export function marketTradingDateNy(instant: Date = new Date()): string {
  return nyCalendarYmd(instant);
}

/** Prior completed NY equity session date relative to `tradingDate`. */
export function priorNyTradingSessionYmd(tradingDate: string): string | null {
  const sessions = lastNyTradingSessionYmds(12);
  const idx = sessions.indexOf(tradingDate);
  if (idx >= 0 && idx + 1 < sessions.length) return sessions[idx + 1] ?? null;
  const older = sessions.filter((d) => d < tradingDate);
  return older[0] ?? null;
}

export function rthOpenMsForTradingDate(tradingDate: string): number {
  const off = nyOffsetForYmd(tradingDate);
  return new Date(`${tradingDate}T09:30:00${off}`).getTime();
}

export function sessionWindowStartMsForTradingDate(tradingDate: string): number {
  const off = nyOffsetForYmd(tradingDate);
  return new Date(`${tradingDate}T04:00:00${off}`).getTime();
}

export function sessionWindowEndMsForTradingDate(tradingDate: string): number {
  const off = nyOffsetForYmd(tradingDate);
  const earlyClose = NYSE_EARLY_CLOSE_2026.includes(tradingDate);
  const closeHour = earlyClose ? 13 : 20;
  return new Date(`${tradingDate}T${String(closeHour).padStart(2, "0")}:00:00${off}`).getTime();
}
