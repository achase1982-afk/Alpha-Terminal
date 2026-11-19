import type { OptionsContract } from "@/components/OptionsTab";
import type { OptionChainResponse } from "@workspace/api-client-react";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";
import { FIXTURE_SPX_SPOT } from "./spxFixture";

export const FIXTURE_EXPIRY_A = "2026-11-19";
export const FIXTURE_EXPIRY_B = "2026-11-20";
const ROOT = "SPX";


export const FIXTURE_NVDA_EXPIRY_A = "2026-11-18";
export const FIXTURE_NVDA_EXPIRY_B = "2026-11-21";

export function buildDualExpiryNvdaFixtureChain(): OptionChainResponse {
  const strikes = [175, 180, 182.5, 185, 190];
  const calls: OptionsContract[] = [];
  const puts: OptionsContract[] = [];
  const spot = 182.42;
  for (const exp of [FIXTURE_NVDA_EXPIRY_A, FIXTURE_NVDA_EXPIRY_B]) {
    const dte = exp === FIXTURE_NVDA_EXPIRY_A ? 0 : 3;
    for (const strike of strikes) {
      const mid = Math.max(0.5, Math.abs(spot - strike) * 0.15 + 1);
      calls.push(mkContract(strike, exp, true, dte, "NVDA"));
      puts.push(mkContract(strike, exp, false, dte, "NVDA"));
    }
  }
  return {
    calls,
    puts,
    underlyingPrice: spot,
    symbol: "NVDA",
  } as OptionChainResponse;
}

function mkContract(
  strike: number,
  exp: string,
  isCall: boolean,
  dte: number,
  root: string,
): OptionsContract {
  const key = buildSchwabOptionKey(root, exp, strike, isCall ? "C" : "P");
  const mid = isCall ? 12 + Math.max(0, 7540 - strike) * 0.01 : 10;
  return {
    strike,
    expiration: exp,
    dte,
    bid: Math.max(0.05, mid - 0.1),
    ask: mid + 0.1,
    volume: 100,
    openInterest: 500,
    schwabSymbol: key,
    streamKey: key,
  };
}

export function buildDualExpirySpxFixtureChain(): OptionChainResponse {
  const strikes = [7530, 7535, 7540, 7545, 7550];
  const calls: OptionsContract[] = [];
  const puts: OptionsContract[] = [];
  for (const exp of [FIXTURE_EXPIRY_A, FIXTURE_EXPIRY_B]) {
    const dte = exp === FIXTURE_EXPIRY_A ? 0 : 1;
    for (const strike of strikes) {
      calls.push(mkContract(strike, exp, true, dte, ROOT));
      puts.push(mkContract(strike, exp, false, dte, ROOT));
    }
  }
  return {
    calls,
    puts,
    underlyingPrice: FIXTURE_SPX_SPOT,
    symbol: "SPX",
  } as OptionChainResponse;
}