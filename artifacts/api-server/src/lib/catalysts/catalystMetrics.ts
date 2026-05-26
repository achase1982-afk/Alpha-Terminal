import {
  CATALYST_DRIFT_SESSION_COUNT,
  CATALYST_SUSPECT_SESSION_REL_MOVE_ABS_PCT,
  type CatalystSessionSnapshot,
} from "@workspace/catalysts-types";

function pctMove(from: number, to: number): number {
  if (!Number.isFinite(from) || from === 0 || !Number.isFinite(to)) return 0;
  return ((to - from) / from) * 100;
}

function sumTail(values: number[], n: number): number {
  return values.slice(-n).reduce((a, b) => a + b, 0);
}

export function detectSuspectSessionMoves(
  sessionMovesPct: number[],
  bound = CATALYST_SUSPECT_SESSION_REL_MOVE_ABS_PCT,
): boolean[] {
  return sessionMovesPct.map((m) => Math.abs(m) > bound);
}

/** Sum last N sessions, skipping suspect bars (bad prior close / data glitch). */
export function sumTailExcludingSuspect(
  values: number[],
  suspect: boolean[],
  n: number,
): number {
  const tail = values.slice(-n);
  const tailSuspect = suspect.slice(-n);
  return tail.reduce((acc, v, i) => acc + (tailSuspect[i] ? 0 : v), 0);
}

function movesForAggregate(
  moves: number[],
  suspect: boolean[],
): number[] {
  return moves.map((m, i) => (suspect[i] ? 0 : m));
}

function countStreak(moves: number[]): number {
  if (moves.length === 0) return 0;
  const last = moves[moves.length - 1]!;
  if (last === 0) return 0;
  const sign = Math.sign(last);
  let streak = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i]!;
    if (Math.sign(m) !== sign || m === 0) break;
    streak++;
  }
  return streak;
}

export type CatalystDriftClass = "trending_up" | "trending_down" | "choppy";

export function emptySessionSnapshot(): CatalystSessionSnapshot {
  const zeros = Array.from({ length: CATALYST_DRIFT_SESSION_COUNT }, () => 0);
  return {
    sessionDates: [],
    closes: [],
    sessionMovesPct: [...zeros],
    sessionMovesRawPct: [...zeros],
    sessionSuspect: Array.from({ length: CATALYST_DRIFT_SESSION_COUNT }, () => false),
    cumulative1d: 0,
    cumulative3d: 0,
    cumulative5d: 0,
    cumulative10d: 0,
    streak: 0,
    upCount: 0,
    downCount: 0,
    patternRead: "Session drift unavailable — Schwab price history missing for this symbol.",
  };
}

export function classifyDriftFromMoves(moves: number[]): CatalystDriftClass {
  const ups = moves.filter((m) => m > 0).length;
  if (ups >= 7) return "trending_up";
  if (ups <= 3) return "trending_down";
  return "choppy";
}

export function buildPatternRead(moves: number[], streak: number): string {
  const ups = moves.filter((m) => m > 0).length;
  const last = moves[moves.length - 1] ?? 0;
  const signWord = last >= 0 ? "green" : "red";
  const cum10 = sumTail(moves, 10);
  const cumFmt = `${cum10 >= 0 ? "+" : ""}${cum10.toFixed(1)}%`;
  const drift = classifyDriftFromMoves(moves);

  if (streak >= 5) {
    return `Strong directional drift — ${streak} straight ${signWord} sessions vs S&P, ${cumFmt} into print.`;
  }
  if (drift === "trending_up") {
    return `Building accumulation — ${ups} of ${CATALYST_DRIFT_SESSION_COUNT} sessions outperforming S&P.`;
  }
  if (drift === "trending_down") {
    const downs = moves.length - ups;
    return `Building distribution — ${downs} of ${CATALYST_DRIFT_SESSION_COUNT} sessions under S&P.`;
  }
  return "Choppy vs S&P — no clear pre-earnings direction. Treat as noise.";
}

function priorCloseOnMap(closesByDate: Map<string, number>, sessionYmd: string): number | null {
  const priorDates = [...closesByDate.keys()].filter((k) => k < sessionYmd).sort();
  const priorKey = priorDates[priorDates.length - 1];
  if (!priorKey) return null;
  const px = closesByDate.get(priorKey);
  return px != null && Number.isFinite(px) ? px : null;
}

/**
 * Ten settled sessions; per-day move is stock daily % minus SPY daily %.
 */
export function computeSessionSnapshot(
  sessionDates: string[],
  stockClosesByDate: Map<string, number>,
  spyClosesByDate: Map<string, number>,
): CatalystSessionSnapshot | null {
  if (sessionDates.length !== CATALYST_DRIFT_SESSION_COUNT) return null;

  const sessionMovesPct: number[] = [];
  const sessionMovesRawPct: number[] = [];
  const closes: number[] = [];

  for (const d of sessionDates) {
    const close = stockClosesByDate.get(d);
    const spyClose = spyClosesByDate.get(d);
    if (close == null || !Number.isFinite(close) || spyClose == null || !Number.isFinite(spyClose)) {
      return null;
    }
    closes.push(close);

    const priorStock = priorCloseOnMap(stockClosesByDate, d);
    const priorSpy = priorCloseOnMap(spyClosesByDate, d);
    const stockDay =
      priorStock != null && Number.isFinite(priorStock) ? pctMove(priorStock, close) : 0;
    const spyDay = priorSpy != null && Number.isFinite(priorSpy) ? pctMove(priorSpy, spyClose) : 0;
    sessionMovesRawPct.push(stockDay);
    sessionMovesPct.push(stockDay - spyDay);
  }

  const sessionSuspect = detectSuspectSessionMoves(sessionMovesPct);
  const aggregateMoves = movesForAggregate(sessionMovesPct, sessionSuspect);
  const upCount = aggregateMoves.filter((m) => m > 0).length;
  const downCount = aggregateMoves.filter((m) => m < 0).length;
  const streak = countStreak(aggregateMoves);
  const patternRead = buildPatternRead(aggregateMoves, streak);

  return {
    sessionDates,
    closes,
    sessionMovesPct,
    sessionMovesRawPct,
    sessionSuspect,
    cumulative1d: sumTailExcludingSuspect(sessionMovesPct, sessionSuspect, 1),
    cumulative3d: sumTailExcludingSuspect(sessionMovesPct, sessionSuspect, 3),
    cumulative5d: sumTailExcludingSuspect(sessionMovesPct, sessionSuspect, 5),
    cumulative10d: sumTailExcludingSuspect(sessionMovesPct, sessionSuspect, 10),
    streak,
    upCount,
    downCount,
    patternRead,
  };
}
