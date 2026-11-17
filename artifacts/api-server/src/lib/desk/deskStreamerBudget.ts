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

/** Schwab L1 options headroom kept below the hard cap for ADD transitions. */
export const DESK_STREAMER_HEADROOM = 150;
export const DESK_OPTIONS_BOOK_HEADROOM = 5;

/** Target desk tape L1 options (trimmed universe size; not app-dependent). */
export const DESK_LEVELONE_OPTIONS_TARGET = 2822;
/** Desk OPTIONS_BOOK keys (within the 100 service cap). */
export const DESK_OPTIONS_BOOK_TARGET = 95;

export function deskResetStreamerLimitsForTests(): void {
  reportedLimits = { ...DEFAULT_LIMITS };
}

export function deskGetSchwabStreamerLimits(): SchwabStreamerServiceLimits {
  return { ...reportedLimits };
}

/** Parse e.g. `LEVELONE_OPTIONS=3000, DISCARDED=500` from streamer rejection text. */
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

/** Max L1 option keys the desk universe builder may target (independent of app holds). */
export function deskComputeDeskLevelOneOptionsBudget(): number {
  const cap = reportedLimits.levelone_options;
  return Math.min(DESK_LEVELONE_OPTIONS_TARGET, Math.max(0, cap - DESK_STREAMER_HEADROOM));
}

/** Slots reserved on the wire for desk ADD — fixed; app SUBS may not consume this. */
export function deskReservedLevelOneOptionsSlots(): number {
  return deskComputeDeskLevelOneOptionsBudget();
}

/** App managed SUBS cap for LEVELONE_OPTIONS. */
export function deskAppLevelOneOptionsCap(): number {
  return Math.max(0, reportedLimits.levelone_options - deskReservedLevelOneOptionsSlots());
}

export function deskComputeDeskOptionsBookBudget(): number {
  const cap = reportedLimits.options_book;
  return Math.min(DESK_OPTIONS_BOOK_TARGET, Math.max(0, cap - DESK_OPTIONS_BOOK_HEADROOM));
}

export function deskReservedOptionsBookSlots(): number {
  return deskComputeDeskOptionsBookBudget();
}

export function deskAppOptionsBookCap(): number {
  return Math.max(0, reportedLimits.options_book - deskReservedOptionsBookSlots());
}

export function deskComputeDeskEquitiesBudget(appEquityCount: number): number {
  const cap = reportedLimits.levelone_equities;
  const deskSlots = 3;
  return Math.max(0, Math.min(deskSlots, cap - appEquityCount - 10));
}
