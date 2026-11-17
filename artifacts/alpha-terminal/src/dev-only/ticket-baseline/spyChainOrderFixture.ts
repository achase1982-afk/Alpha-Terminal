/**
 * SPY chain fixture for ticket baseline / chain sheet screenshots.
 * Dev-only — see TICKET_BASELINE_FIXTURE_DEV_ONLY prod guard.
 */

import type { OptionsContract } from "@/components/OptionsTab";
import type { OptionTick } from "@/lib/options-stream-store";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";
import { TICKET_BASELINE_FIXTURE_MARKER } from "@/lib/dev-only/ticketBaselineFixtureBridge";

export { TICKET_BASELINE_FIXTURE_MARKER };

export const FIXTURE_SPY_SPOT = 602.5;
const EXPIRY = "2026-12-19";
const ROOT = "SPY";

type LegQuote = {
  bid: number;
  ask: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
};

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
      iv: callQ.iv,
      volume: 1200,
      openInterest: 8200,
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
      iv: putQ.iv,
      volume: 1100,
      openInterest: 7900,
    },
  };
}

function withIv(q: Omit<LegQuote, "iv"> & { iv?: number }): LegQuote {
  return { ...q, iv: q.iv ?? 0.22 };
}

export function buildSpyChainOrderFixtureContracts(): { calls: OptionsContract[]; puts: OptionsContract[] } {
  const strikes = [590, 595, 600, 605, 610];
  const calls: OptionsContract[] = [];
  const puts: OptionsContract[] = [];
  for (const strike of strikes) {
    const atm = strike === 600;
    const row = strikeRow(
      strike,
      withIv({
        bid: atm ? 3.72 : 5.2,
        ask: atm ? 3.8 : 5.28,
        delta: atm ? 0.52 : 0.62,
        gamma: 0.04,
        theta: -0.08,
        vega: 0.15,
      }),
      withIv({
        bid: atm ? 3.45 : 2.1,
        ask: atm ? 3.52 : 2.18,
        delta: atm ? -0.48 : -0.38,
        gamma: 0.04,
        theta: -0.07,
        vega: 0.14,
      }),
    );
    calls.push(row.call);
    puts.push(row.put);
  }
  return { calls, puts };
}

export function buildSpyChainOrderFixtureTicks(): OptionTick[] {
  const { calls, puts } = buildSpyChainOrderFixtureContracts();
  const out: OptionTick[] = [];
  const stamp = Date.now();
  for (const c of [...calls, ...puts]) {
    const key = c.streamKey ?? c.schwabSymbol;
    if (!key) continue;
    const mid = c.bid != null && c.ask != null ? (c.bid + c.ask) / 2 : null;
    out.push({
      key,
      bid: c.bid ?? null,
      ask: c.ask ?? null,
      last: mid,
      bidSize: null,
      askSize: null,
      volume: c.volume ?? null,
      openInterest: c.openInterest ?? null,
      iv: c.iv ?? null,
      delta: c.delta ?? null,
      gamma: c.gamma ?? null,
      theta: c.theta ?? null,
      vega: c.vega ?? null,
      mark: mid,
      change: null,
      ts: stamp,
    });
  }
  return out;
}

export const FIXTURE_SPY_CALL_600 = buildSchwabOptionKey(ROOT, EXPIRY, 600, "C");