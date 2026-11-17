/**
 * Dev/test fixture for chain order sheet screenshots. Import only from `src/dev-only/*`.
 * Must not ship enabled in production (see `verify-chain-order-fixture-prod`).
 */

import type { OptionsContract } from "@/components/OptionsTab";
import type { OptionTick } from "@/lib/options-stream-store";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";

export const FIXTURE_SPX_SPOT = 7540;
export const FIXTURE_MARKER = "CHAIN_ORDER_FIXTURE_SPX_DEV_ONLY";
const EXPIRY = "2026-11-17";
const ROOT = "SPX";

type LegQuote = { bid: number; ask: number; delta: number; gamma: number; theta: number; vega: number };

function strikeRow(
  strike: number,
  callQ: LegQuote,
  putQ: LegQuote,
): { strike: number; call: OptionsContract; put: OptionsContract } {
  const callKey = buildSchwabOptionKey(ROOT, EXPIRY, strike, "C");
  const putKey = buildSchwabOptionKey(ROOT, EXPIRY, strike, "P");
  return {
    strike,
    call: {
      strike,
      expiration: EXPIRY,
      schwabSymbol: callKey,
      streamKey: callKey,
      bid: callQ.bid,
      ask: callQ.ask,
      delta: callQ.delta,
      gamma: callQ.gamma,
      theta: callQ.theta,
      vega: callQ.vega,
      volume: 800,
      openInterest: 4200,
    },
    put: {
      strike,
      expiration: EXPIRY,
      schwabSymbol: putKey,
      streamKey: putKey,
      bid: putQ.bid,
      ask: putQ.ask,
      delta: putQ.delta,
      gamma: putQ.gamma,
      theta: putQ.theta,
      vega: putQ.vega,
      volume: 750,
      openInterest: 3900,
    },
  };
}

function buildStrikes(): number[] {
  const out: number[] = [];
  for (let s = 7560; s >= 7520; s -= 5) out.push(s);
  return out;
}

export function buildSpxChainOrderFixtureContracts(): { calls: OptionsContract[]; puts: OptionsContract[] } {
  const quotes: Record<number, { c: LegQuote; p: LegQuote }> = {
    7520: {
      c: { bid: 4.8, ask: 4.95, delta: 0.62, gamma: 0.018, theta: -0.42, vega: 0.11 },
      p: { bid: 0.88, ask: 0.92, delta: -0.09, gamma: 0.012, theta: -0.28, vega: 0.09 },
    },
    7525: {
      c: { bid: 4.2, ask: 4.35, delta: 0.58, gamma: 0.02, theta: -0.44, vega: 0.12 },
      p: { bid: 0.4, ask: 0.45, delta: -0.09, gamma: 0.012, theta: -0.28, vega: 0.09 },
    },
    7530: {
      c: { bid: 3.55, ask: 3.7, delta: 0.52, gamma: 0.022, theta: -0.46, vega: 0.13 },
      p: { bid: 1.55, ask: 1.62, delta: -0.14, gamma: 0.016, theta: -0.32, vega: 0.11 },
    },
    7535: {
      c: { bid: 2.95, ask: 3.05, delta: 0.46, gamma: 0.024, theta: -0.48, vega: 0.14 },
      p: { bid: 1.82, ask: 1.88, delta: -0.18, gamma: 0.018, theta: -0.34, vega: 0.12 },
    },
    7540: {
      c: { bid: 2.42, ask: 2.48, delta: 0.38, gamma: 0.026, theta: -0.5, vega: 0.15 },
      p: { bid: 2.25, ask: 2.32, delta: -0.22, gamma: 0.02, theta: -0.36, vega: 0.13 },
    },
    7545: {
      c: { bid: 1.95, ask: 2.02, delta: 0.31, gamma: 0.025, theta: -0.48, vega: 0.14 },
      p: { bid: 2.68, ask: 2.75, delta: -0.27, gamma: 0.021, theta: -0.35, vega: 0.13 },
    },
    7550: {
      c: { bid: 1.35, ask: 1.42, delta: 0.24, gamma: 0.022, theta: -0.45, vega: 0.13 },
      p: { bid: 3.12, ask: 3.2, delta: -0.32, gamma: 0.019, theta: -0.33, vega: 0.12 },
    },
    7555: {
      c: { bid: 0.45, ask: 0.5, delta: 0.18, gamma: 0.018, theta: -0.4, vega: 0.11 },
      p: { bid: 3.55, ask: 3.62, delta: -0.37, gamma: 0.017, theta: -0.31, vega: 0.11 },
    },
    7560: {
      c: { bid: 0.82, ask: 0.88, delta: 0.12, gamma: 0.014, theta: -0.35, vega: 0.09 },
      p: { bid: 4.05, ask: 4.12, delta: -0.42, gamma: 0.015, theta: -0.29, vega: 0.1 },
    },
  };

  const calls: OptionsContract[] = [];
  const puts: OptionsContract[] = [];
  for (const strike of buildStrikes()) {
    const q = quotes[strike];
    if (!q) continue;
    const row = strikeRow(strike, q.c, q.p);
    if (row.call) calls.push(row.call);
    if (row.put) puts.push(row.put);
  }
  return { calls, puts };
}

export function buildSpxChainOrderFixtureTicks(): OptionTick[] {
  const { calls, puts } = buildSpxChainOrderFixtureContracts();
  const now = Date.now();
  const ticks: OptionTick[] = [];
  for (const c of [...calls, ...puts]) {
    const key = c.streamKey ?? c.schwabSymbol;
    if (!key) continue;
    const mid = c.bid != null && c.ask != null ? (c.bid + c.ask) / 2 : null;
    ticks.push({
      key,
      bid: c.bid ?? null,
      ask: c.ask ?? null,
      last: mid,
      bidSize: null,
      askSize: null,
      volume: c.volume ?? null,
      openInterest: c.openInterest ?? null,
      iv: null,
      delta: c.delta ?? null,
      gamma: c.gamma ?? null,
      theta: c.theta ?? null,
      vega: c.vega ?? null,
      mark: mid,
      change: null,
      ts: now,
    });
  }
  return ticks;
}