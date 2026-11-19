import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";

const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** True when `tradeMs` is a regular-session print on the same New York day as `now`. */
export function isRthTradeOnSameEtDay(tradeMs: number | null | undefined, now: Date): boolean {
  if (tradeMs == null || !Number.isFinite(tradeMs) || tradeMs <= 0) return false;
  if (ET_DAY.format(new Date(tradeMs)) !== ET_DAY.format(now)) return false;
  return isUsEquitiesMarketHoursEt(new Date(tradeMs));
}
