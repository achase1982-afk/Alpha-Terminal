/** SPX 0DTE Glance calculations. Thresholds are product heuristics, not a trading edge. */

export const PNF_GROSS_USD = 10_000_000;
export const PNF_RESPONSE_PTS = 3;
export const TREND_EFF_ENTRY = 0.6;
export const TREND_EFF_HOLD = 0.4;

export type GrossSide = "cb" | "cs" | "pb" | "ps";

export type GrossQuad = {
  cb: number | null;
  cs: number | null;
  pb: number | null;
  ps: number | null;
};

const SIDE_SIGN: Record<GrossSide, 1 | -1> = { cb: 1, cs: -1, pb: -1, ps: 1 };

export function dayMove(spot: number | null, previousClose: number | null): { points: number; percent: number } | null {
  if (spot == null || previousClose == null || !(previousClose > 0) || !Number.isFinite(spot)) return null;
  const points = spot - previousClose;
  return { points, percent: (100 * points) / previousClose };
}

export function fromOpenPoints(spot: number | null, rthOpen: number | null): number | null {
  if (spot == null || rthOpen == null || !Number.isFinite(spot) || !Number.isFinite(rthOpen)) return null;
  return spot - rthOpen;
}

/** callsBought − callsSold − putsBought + putsSold */
export function premiumNet(q: GrossQuad): number | null {
  if (q.cb == null || q.cs == null || q.pb == null || q.ps == null) return null;
  return q.cb - q.cs - q.pb + q.ps;
}

export function pathStats(closes: readonly number[]): { move: number; path: number; efficiency: number } | null {
  if (closes.length < 2) return null;
  for (const n of closes) {
    if (!Number.isFinite(n)) return null;
  }
  const move = closes[closes.length - 1]! - closes[0]!;
  let path = 0;
  for (let i = 1; i < closes.length; i++) path += Math.abs(closes[i]! - closes[i - 1]!);
  return { move, path, efficiency: path > 0 ? Math.abs(move) / path : 0 };
}

export type TrendHorizon = 10 | 15;

export type TrendReading = {
  horizon: TrendHorizon;
  direction: 1 | -1;
  move: number;
  efficiency: number;
};

export function qualifiesTrend(horizon: TrendHorizon, move: number, efficiency: number): boolean {
  const floor = horizon === 10 ? 10 : 15;
  return Math.abs(move) >= floor && efficiency >= TREND_EFF_ENTRY && move !== 0;
}

/**
 * Entry/hold for the price-movement chip.
 * A null window means that horizon cannot be newly evaluated. The caller keeps the last chip.
 */
export function resolveTrend(input: {
  m10: { move: number; efficiency: number } | null;
  m15: { move: number; efficiency: number } | null;
  held: TrendReading | null;
}): TrendReading | null {
  const q10 = input.m10 && qualifiesTrend(10, input.m10.move, input.m10.efficiency) ? input.m10 : null;
  const q15 = input.m15 && qualifiesTrend(15, input.m15.move, input.m15.efficiency) ? input.m15 : null;
  if (q10 && q15) {
    if (Math.sign(q10.move) !== Math.sign(q15.move)) return null;
    return { horizon: 15, direction: q15.move > 0 ? 1 : -1, move: q15.move, efficiency: q15.efficiency };
  }
  if (q15) return { horizon: 15, direction: q15.move > 0 ? 1 : -1, move: q15.move, efficiency: q15.efficiency };
  if (q10) return { horizon: 10, direction: q10.move > 0 ? 1 : -1, move: q10.move, efficiency: q10.efficiency };
  const held = input.held;
  if (!held) return null;
  const current = held.horizon === 15 ? input.m15 : input.m10;
  if (!current) return held;
  if (current.move === 0 || Math.sign(current.move) !== held.direction) return null;
  if (current.efficiency < TREND_EFF_HOLD) return null;
  return { ...held, move: current.move, efficiency: current.efficiency };
}

export type PnfStatus = "incomplete" | "opposed" | "quiet" | "tag";

export type PnfResult = {
  status: PnfStatus;
  direction: 1 | -1 | null;
  response: number | null;
  delta5: number | null;
  side: GrossSide | null;
  sideUsd: number | null;
};

export function priceNotFollowing(
  gross: GrossQuad,
  delta5: number | null,
  grossMin = PNF_GROSS_USD,
  responseMin = PNF_RESPONSE_PTS,
): PnfResult {
  const empty: PnfResult = { status: "incomplete", direction: null, response: null, delta5, side: null, sideUsd: null };
  if (gross.cb == null || gross.cs == null || gross.pb == null || gross.ps == null) return empty;
  const up = gross.cb > grossMin || gross.ps > grossMin;
  const down = gross.cs > grossMin || gross.pb > grossMin;
  if (up && down) return { ...empty, status: "opposed" };
  if (!up && !down) return { ...empty, status: "quiet" };
  if (delta5 == null || !Number.isFinite(delta5)) return empty;
  const direction: 1 | -1 = up ? 1 : -1;
  const response = direction * delta5;
  const sides: GrossSide[] = direction === 1 ? ["cb", "ps"] : ["cs", "pb"];
  let side: GrossSide = sides[0]!;
  let sideUsd = gross[side] ?? 0;
  for (const candidate of sides) {
    const usd = gross[candidate] ?? 0;
    if (usd > sideUsd) {
      side = candidate;
      sideUsd = usd;
    }
  }
  if (!(sideUsd > grossMin)) {
    side = sides.find((s) => (gross[s] ?? 0) > grossMin) ?? side;
    sideUsd = gross[side] ?? sideUsd;
  }
  return {
    status: response < responseMin ? "tag" : "quiet",
    direction,
    response,
    delta5,
    side,
    sideUsd,
  };
}

export function sideSign(side: GrossSide): 1 | -1 {
  return SIDE_SIGN[side];
}

export type RailPoint = { id: string; price: number };

/**
 * Lane index for each mark, in input order. Marks closer than `minGap`
 * (fraction of the rail) take the next free lane so their labels do not stack.
 */
export function assignRailLanes(marks: readonly { id: string; x: number }[], minGap = 0.18): number[] {
  const order = marks.map((mark, index) => ({ index, x: mark.x, id: mark.id }));
  order.sort((a, b) => a.x - b.x || a.id.localeCompare(b.id) || a.index - b.index);
  const laneEnds: number[] = [];
  const lanes = new Array<number>(marks.length);
  for (const mark of order) {
    let lane = 0;
    while (lane < laneEnds.length && mark.x < laneEnds[lane]! + minGap) lane += 1;
    laneEnds[lane] = mark.x;
    lanes[mark.index] = lane;
  }
  return lanes;
}

/** Horizontal label anchor. Edge marks grow inward so the words stay in the rail. */
export function railLabelShift(x: number): string {
  if (x <= 0.12) return "0%";
  if (x >= 0.88) return "-100%";
  return "-50%";
}

export function railPositions(spot: number | null, points: readonly RailPoint[]): { id: string; x: number; price: number }[] {
  if (points.length === 0) return [];
  if (spot == null || !Number.isFinite(spot)) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      min = Math.min(min, p.price);
      max = Math.max(max, p.price);
    }
    const pad = Math.max(1, (max - min) * 0.1);
    const lo = min - pad;
    const span = max + pad - lo || 1;
    return points.map((p) => ({ id: p.id, price: p.price, x: (p.price - lo) / span }));
  }
  let d = 0;
  for (const p of points) d = Math.max(d, Math.abs(p.price - spot));
  const half = d === 0 ? 1 : d * 1.1;
  const lo = spot - half;
  const span = half * 2;
  return points.map((p) => ({ id: p.id, price: p.price, x: (p.price - lo) / span }));
}

export function wallDistance(wall: number | null, spot: number | null): number | null {
  if (wall == null || spot == null) return null;
  return wall - spot;
}

export function wallDrift(now: number | null, open: number | null): number | null {
  if (now == null || open == null) return null;
  return now - open;
}

export function formatSpot(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatWall(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

export function formatSignedPts(n: number | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(digits)}`;
}

export function formatGross(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(a / 1e3).toFixed(1)}K`;
  if (a === 0) return "$0";
  return `$${a.toFixed(0)}`;
}

export function formatNet(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Object.is(n, -0) || n === 0) return "$0";
  const sign = n > 0 ? "+" : "−";
  const a = Math.abs(n);
  const body =
    a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`;
  return `${sign}${body}`;
}

export function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export function formatEtMinute(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

export function formatAge(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "Age unavailable";
  const whole = Math.floor(sec);
  if (whole < 90) return whole === 1 ? "Age 1 second" : `Age ${whole} seconds`;
  const min = Math.floor(sec / 60);
  return min === 1 ? "Age 1 minute" : `Age ${min} minutes`;
}

export const SIDE_LABEL: Record<GrossSide, string> = {
  cb: "Calls bought",
  cs: "Calls sold",
  pb: "Puts bought",
  ps: "Puts sold",
};
