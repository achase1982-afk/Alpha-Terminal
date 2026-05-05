import { fmpImpactToImportance } from "./fmpClient.js";
import { getMacroCalendarRowsInRange } from "./fmpDataService.js";

/** In-memory slice of `macro_calendar` for deterministic overlap with `getUpcomingEvents`. */
type CachedMacro = {
  eventDate: string;
  eventTime: string | null;
  event: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
};

let cachedMacro: CachedMacro[] = [];
let cachedAtMs = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function horizonYmd(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function refreshMacroCalendarCacheFromDb(): Promise<void> {
  const rows = await getMacroCalendarRowsInRange(horizonYmd(25));
  cachedMacro = rows.map((r) => ({
    eventDate: r.eventDate,
    eventTime: r.eventTime,
    event: r.event,
    importance: fmpImpactToImportance(r.impact),
  }));
  cachedAtMs = Date.now();
}

export function getFmpMacroCalendarSyntheticEvents(): Array<{
  date: string;
  type: "economic";
  title: string;
  time?: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
}> {
  void CACHE_TTL_MS;
  return cachedMacro.map((r) => ({
    date: r.eventDate,
    type: "economic" as const,
    title: r.event,
    ...(r.eventTime ? { time: r.eventTime } : {}),
    importance: r.importance,
  }));
}

export function fmpMacroCacheAgeMs(): number {
  return cachedAtMs ? Date.now() - cachedAtMs : Number.POSITIVE_INFINITY;
}
