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

export function deskComputeDeskLevelOneOptionsBudget(appOptionCount: number): number {
  const cap = reportedLimits.levelone_options;
  return Math.max(0, cap - appOptionCount - DESK_STREAMER_HEADROOM);
}

export function deskComputeDeskOptionsBookBudget(appBookCount: number): number {
  const cap = reportedLimits.options_book;
  return Math.max(0, cap - appBookCount - DESK_OPTIONS_BOOK_HEADROOM);
}

export function deskComputeDeskEquitiesBudget(appEquityCount: number): number {
  const cap = reportedLimits.levelone_equities;
  const deskSlots = 3;
  return Math.max(0, Math.min(deskSlots, cap - appEquityCount - 10));
}
