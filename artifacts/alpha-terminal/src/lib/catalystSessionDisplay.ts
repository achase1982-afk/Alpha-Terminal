import type { CatalystCard } from "@workspace/catalysts-types";
import { nyParts } from "@/lib/catalystsSession";

export type SettledSessionRow = {
  /** T-1 … T-10 (most recent settled first). */
  label: string;
  dateYmd: string;
  rawPct: number;
  spyPct: number;
  vsSpyPct: number;
};

/** Ten settled sessions, newest first (T-1 at top). */
export function buildSettledSessionRowsNewestFirst(
  card: CatalystCard,
  spyHistoryOk: boolean,
): SettledSessionRow[] {
  const { sessionDates, sessionMovesRawPct, sessionMovesPct } = card.snapshot;
  const n = sessionDates.length;
  const rows: SettledSessionRow[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = n - i;
    const raw = sessionMovesRawPct[i] ?? 0;
    const vs = sessionMovesPct[i] ?? 0;
    const spy = spyHistoryOk ? raw - vs : 0;
    rows.push({
      label: t === 1 ? "T-1" : `T-${t}`,
      dateYmd: sessionDates[i] ?? "",
      rawPct: raw,
      spyPct: spy,
      vsSpyPct: vs,
    });
  }
  return rows;
}

function isAtOrAfterNyRegularClose(now: Date): boolean {
  const { hour, minute } = nyParts(now);
  return hour * 60 + minute >= 16 * 60;
}

function fmtBuiltTimeEt(d: Date): string {
  return d.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/**
 * Feed-age line so users know whether the cached settled window matches the calendar.
 */
export function catalystFeedFreshnessLabel(builtAtIso: string, now = new Date()): string {
  if (!builtAtIso) return "";
  const built = new Date(builtAtIso);
  if (Number.isNaN(built.getTime())) return "";

  const builtYmd = nyParts(built).ymd;
  const todayYmd = nyParts(now).ymd;
  const builtPostClose = isAtOrAfterNyRegularClose(built);
  const nowPostClose = isAtOrAfterNyRegularClose(now);
  const timeEt = fmtBuiltTimeEt(built);

  if (builtYmd === todayYmd) {
    const when = builtPostClose ? "post-close" : "pre-close";
    const settledHint = builtPostClose
      ? "settled window includes today’s close"
      : "settled window ends at prior session (live Today is separate)";
    return `Built today ${timeEt} ET (${when}) · ${settledHint}`;
  }

  const builtDayLabel = built.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
  const stale =
    !nowPostClose || builtYmd < todayYmd
      ? "refresh for an up-to-date settled window"
      : "may be missing today’s settled bar";
  return `Built ${builtDayLabel} ${timeEt} ET · ${stale}`;
}
