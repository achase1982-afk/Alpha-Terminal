import { pathStats, premiumNet, type GrossQuad } from "./math";

/** Section 16.1 synthetic display fixture. Not a live quote and not a historical replay. */

const SPOT = 7268.68;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 21 one-minute closes, index 0 = T−20m, last = spot. Knots make 5m +1.2 and 15m −18.4. */
function fixtureCloses(): number[] {
  const p20 = SPOT + 22;
  const p15 = 7287.08;
  const p10 = SPOT + 8;
  const p5 = SPOT - 1.2;
  const p0 = SPOT;
  const out: number[] = [];
  for (let i = 0; i <= 20; i++) {
    const ago = 20 - i;
    if (ago >= 15) out.push(lerp(p20, p15, (20 - ago) / 5));
    else if (ago >= 10) out.push(lerp(p15, p10, (15 - ago) / 5));
    else if (ago >= 5) out.push(lerp(p10, p5, (10 - ago) / 5));
    else out.push(lerp(p5, p0, (5 - ago) / 5));
  }
  out[20] = SPOT;
  return out;
}

const CLOSES = fixtureCloses();

function windowMove(minutes: number): number | null {
  const stats = pathStats(CLOSES.slice(-(minutes + 1)));
  return stats ? stats.move : null;
}

export const FIXTURE_CLOSES = CLOSES;

export const FIXTURE_QUAD = {
  m1: { cb: 7.0e6, cs: 2.2e6, pb: 3.0e6, ps: 5.1e6 } satisfies GrossQuad,
  m5: { cb: 12.4e6, cs: 4.1e6, pb: 6.3e6, ps: 7.8e6 } satisfies GrossQuad,
  m15: { cb: 26.8e6, cs: 24.6e6, pb: 20.4e6, ps: 25.0e6 } satisfies GrossQuad,
  session: { cb: 104.2e6, cs: 131.8e6, pb: 92.0e6, ps: 95.0e6 } satisfies GrossQuad,
};

export function fixtureHistory(last: number, seed: number): number[] {
  const weights = [0.35, 0.42, 0.28, 0.55, 0.48, 0.62, 0.4, 0.7, 0.58, 0.66, 0.5, 0.74, 0.6, 0.82, 1];
  return weights.map((w, i) =>
    i === weights.length - 1 ? last : Math.round(last * w * (0.92 + ((seed + i) % 5) * 0.02)),
  );
}

export const FIXTURE = {
  label: "Synthetic fixture · not live",
  spot: SPOT,
  previousClose: 7360,
  rthOpen: 7310,
  high: 7316.4,
  highMinute: "09:34",
  low: 7261.96,
  lowMinute: "11:48",
  vix: 24.8,
  vixOpen: 22.1,
  vixLow: 21.8,
  vixHigh: 26.4,
  flow: FIXTURE_QUAD,
  nets: {
    m5: premiumNet(FIXTURE_QUAD.m5),
    m15: premiumNet(FIXTURE_QUAD.m15),
    session: premiumNet(FIXTURE_QUAD.session),
  },
  windows: {
    m1: windowMove(1),
    m5: windowMove(5),
    m10: windowMove(10),
    m15: windowMove(15),
    m20: windowMove(20),
  },
  closes: CLOSES,
  walls: {
    callOi: { now: 7350, open: 7450 },
    callVol: { now: 7325, open: 7340 },
    putOi: { now: 7325, open: 7300 },
    putVol: { now: 7265, open: 7280 },
  },
  flip: 7210,
  lowZoneTop: 7280,
  highZoneBottom: 7300,
  gex: -1.2e9,
  scope: "0DTE",
};
