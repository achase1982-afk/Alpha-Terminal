import { US_EQUITY_TZ, deskEtMinutesOfDay } from "./deskEt.js";

function etWeekdayShort(now: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: US_EQUITY_TZ, weekday: "short" }).format(now);
}

function hmsToSec(hms: string): number {
  const [h, m, s] = hms.split(":").map(Number);
  return h! * 3600 + m! * 60 + (s ?? 0);
}

/**
 * SPX / SPXW / XSP desk products: GTH 20:15–09:30 ET (Sun–Fri evenings),
 * RTH 09:30–16:00, curb through 16:15. Morning GTH runs through the cash open.
 */
export function isSpxDeskProductSessionActive(now = new Date()): boolean {
  const wd = etWeekdayShort(now);
  const t = deskEtMinutesOfDay(now);

  const rthStart = hmsToSec("09:30:00");
  const curbEnd = hmsToSec("16:15:00");
  const gthEvenStart = hmsToSec("20:15:00");
  const gthMornEnd = hmsToSec("09:30:00");

  if (["Mon", "Tue", "Wed", "Thu", "Fri"].includes(wd) && t >= rthStart && t <= curbEnd) {
    return true;
  }

  if (["Mon", "Tue", "Wed", "Thu", "Fri"].includes(wd) && t <= gthMornEnd) {
    return true;
  }

  if (wd === "Sat" && t <= gthMornEnd) {
    return true;
  }

  if (["Sun", "Mon", "Tue", "Wed", "Thu", "Fri"].includes(wd) && t >= gthEvenStart) {
    return true;
  }

  return false;
}

/** Equity NBBO REST: pre 07:00–09:30, RTH 09:30–16:00, post 16:00–20:00 ET (Mon–Fri). */
export function isEquityQuoteRestSessionActive(now = new Date()): boolean {
  const wd = etWeekdayShort(now);
  if (wd === "Sat" || wd === "Sun") return false;

  const t = deskEtMinutesOfDay(now);
  const preStart = hmsToSec("07:00:00");
  const rthStart = hmsToSec("09:30:00");
  const rthEnd = hmsToSec("16:00:00");
  const postEnd = hmsToSec("20:00:00");

  if (t < preStart || t > postEnd) return false;
  if (t < rthStart) return true;
  if (t <= rthEnd) return true;
  return t <= postEnd;
}

/** RTH slice for equity quote stale threshold (15s vs 300s). */
export function isEquityQuoteRthStaleWindow(now = new Date()): boolean {
  const wd = etWeekdayShort(now);
  if (wd === "Sat" || wd === "Sun") return false;
  const t = deskEtMinutesOfDay(now);
  return t >= hmsToSec("09:30:00") && t <= hmsToSec("16:00:00");
}