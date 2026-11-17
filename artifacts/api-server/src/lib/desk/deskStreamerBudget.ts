/** Parsed from Schwab ADD rejections (code 19) and conservative defaults. */
export type SchwabStreamerServiceLimits = {
  levelone_options: number;
  levelone_equities: number;
  options_book: number;
};

const DEFAULT_LIMITS: SchwabStreamerServiceLimits = {
  levelone_options: 3000,
  levelone_equities: 3000,
  options_book: 100,
};

let reportedLimits: SchwabStreamerServiceLimits = { ...DEFAULT_LIMITS };

export const DESK_STREAMER_HEADROOM = 150;
export const DESK_OPTIONS_BOOK_HEADROOM = 5;

/** Max keys in the managed app SUBS list (Anthony views over desk tape). */
export const APP_L1_OPTIONS_MAX = 600;
export const APP_OPTIONS_BOOK_MAX = 20;

/** Target desk tape L1 when room allows. */
export const DESK_LEVELONE_OPTIONS_TARGET = 2822;
export const DESK_OPTIONS_BOOK_TARGET = 95;

export function deskResetStreamerLimitsForTests(): void {
  reportedLimits = { ...DEFAULT_LIMITS };
}

export function deskGetSchwabStreamerLimits(): SchwabStreamerServiceLimits {
  return { ...reportedLimits };
}

export function deskParseSchwabStreamerLimitMessage(msg: string): void {
  const pairs = msg.matchAll(/([A-Z_]+)=(\d+)/g);
  for (const m of pairs) {
    const key = m[1];
    const n = parseInt(m[2]!, 10);
    if (!Number.isFinite(n)) continue;
    if (key === "LEVELONE_OPTIONS") reportedLimits.levelone_options = n;
    if (key === "LEVELONE_EQUITIES") reportedLimits.levelone_equities = n;
    if (key === "OPTIONS_BOOK") reportedLimits.options_book = n;
  }
}

/** Desk ADD budget given current app SUBS size (desk derived from app; no feedback). */
export function deskComputeDeskLevelOneOptionsBudget(appPlanSize: number): number {
  const cap = reportedLimits.levelone_options;
  return Math.min(
    DESK_LEVELONE_OPTIONS_TARGET,
    Math.max(0, cap - DESK_STREAMER_HEADROOM - Math.max(0, appPlanSize)),
  );
}

export function deskAppLevelOneOptionsCap(): number {
  return Math.min(APP_L1_OPTIONS_MAX, reportedLimits.levelone_options);
}

export function deskComputeDeskOptionsBookBudget(appPlanSize: number): number {
  const cap = reportedLimits.options_book;
  return Math.max(0, Math.min(DESK_OPTIONS_BOOK_TARGET, cap - DESK_OPTIONS_BOOK_HEADROOM - appPlanSize));
}

export function deskAppOptionsBookCap(): number {
  return Math.min(APP_OPTIONS_BOOK_MAX, reportedLimits.options_book);
}

export function deskComputeDeskEquitiesBudget(appEquityCount: number): number {
  const cap = reportedLimits.levelone_equities;
  const deskSlots = 3;
  return Math.max(0, Math.min(deskSlots, cap - appEquityCount - 10));
}
