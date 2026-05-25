import {
  classifyCatalystDrift,
  type CatalystDriftClass,
  type CatalystSessionSnapshot,
} from "@workspace/catalysts-types";

function pctMove(from: number, to: number): number {
  if (!Number.isFinite(from) || from === 0 || !Number.isFinite(to)) return 0;
  return ((to - from) / from) * 100;
}

function sumTail(values: number[], n: number): number {
  return values.slice(-n).reduce((a, b) => a + b, 0);
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

export function buildPatternRead(moves: number[], streak: number): string {
  const ups = moves.filter((m) => m > 0).length;
  const last = moves[moves.length - 1] ?? 0;
  const signWord = last >= 0 ? "green" : "red";
  const cum5 = sumTail(moves, 5);
  const cumFmt = `${cum5 >= 0 ? "+" : ""}${cum5.toFixed(1)}%`;
  const drift = classifyCatalystDrift(moves, null);

  if (streak >= 5) {
    return `Strong directional drift — ${streak} straight ${signWord} sessions, ${cumFmt} into print.`;
  }
  if (drift === "trending_up") {
    return `Building accumulation — ${ups} of 6 sessions up.`;
  }
  if (drift === "trending_down") {
    const downs = moves.length - ups;
    return `Building distribution — ${downs} of 6 sessions down.`;
  }
  return "Choppy — no clear pre-earnings direction. Treat as noise.";
}

/**
 * `sessionDates` = five settled dates D-5..D-1 (oldest first).
 * `closesByDate` must include each session date and the trading day immediately before D-5.
 */
export function computeSessionSnapshot(
  sessionDates: string[],
  closesByDate: Map<string, number>,
): CatalystSessionSnapshot | null {
  if (sessionDates.length !== 5) return null;

  const sessionMovesPct: number[] = [];
  const closes: number[] = [];

  for (let i = 0; i < sessionDates.length; i++) {
    const d = sessionDates[i]!;
    const close = closesByDate.get(d);
    if (close == null || !Number.isFinite(close)) return null;
    closes.push(close);

    const priorDates = [...closesByDate.keys()].filter((k) => k < d).sort();
    const priorKey = priorDates[priorDates.length - 1];
    const priorClose = priorKey ? closesByDate.get(priorKey) : null;
    sessionMovesPct.push(
      priorClose != null && Number.isFinite(priorClose) ? pctMove(priorClose, close) : 0,
    );
  }

  const upCount = sessionMovesPct.filter((m) => m > 0).length;
  const downCount = sessionMovesPct.filter((m) => m < 0).length;
  const streak = countStreak(sessionMovesPct);
  const patternRead = buildPatternRead(sessionMovesPct, streak);

  return {
    sessionDates,
    closes,
    sessionMovesPct,
    cumulative1d: sumTail(sessionMovesPct, 1),
    cumulative2d: sumTail(sessionMovesPct, 2),
    cumulative3d: sumTail(sessionMovesPct, 3),
    cumulative4d: sumTail(sessionMovesPct, 4),
    cumulative5d: sumTail(sessionMovesPct, 5),
    streak,
    upCount,
    downCount,
    patternRead,
  };
}
