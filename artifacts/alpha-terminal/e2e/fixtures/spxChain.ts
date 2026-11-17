import type { OptionChainResponse, OptionContract } from "@workspace/api-client-react";

const EXP = "2026-11-18:0";

function padSymbol(underlying: string): string {
  return underlying.toUpperCase().padEnd(6, " ");
}

function schwabKey(underlying: string, strike: number, cp: "C" | "P"): string {
  return `${padSymbol(underlying)}261118${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

function leg(
  strike: number,
  cp: "C" | "P",
  bid?: number,
  ask?: number,
  underlying = "SPX",
): OptionContract {
  return {
    strike,
    expiration: EXP,
    bid,
    ask,
    last: bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask,
    volume: 120 + (strike % 7) * 11,
    openInterest: 800 + strike,
    iv: 0.18,
    delta: cp === "C" ? 0.45 + (strike - 5900) * 0.02 : -0.45 - (strike - 5900) * 0.02,
    dte: 0,
    schwabSymbol: schwabKey(underlying, strike, cp),
  } as OptionContract;
}

/** ~40 strikes, 0DTE SPX with ATM crossed and one one-sided call. */
export function buildSpx0DteChain(): OptionChainResponse {
  const strikes: number[] = [];
  for (let s = 5850; s <= 5949; s += 1) strikes.push(s);

  const calls: OptionContract[] = strikes.map((strike) => {
    if (strike === 5900) return leg(strike, "C", 3.8, 3.2);
    if (strike === 5905) return leg(strike, "C", 0.22, undefined);
    if (strike === 5895) return leg(strike, "C", undefined, 0.18);
    return leg(strike, "C", 1.2 + (5900 - strike) * 0.08, 1.28 + (5900 - strike) * 0.08);
  });

  const puts: OptionContract[] = strikes.map((strike) => {
    if (strike === 5900) return leg(strike, "P", 3.4, 2.9);
    return leg(strike, "P", 1.1 + (strike - 5900) * 0.06, 1.18 + (strike - 5900) * 0.06);
  });

  return {
    symbol: "SPX",
    underlyingPrice: 5900.5,
    calls,
    puts,
  };
}

/** ATM 0DTE call with crossed REST bid/ask in the fixture. */
export const SPX_ATM_CALL_SYMBOL = schwabKey("SPX", 5900, "C");

export const SPX_5910_CALL_SYMBOL = schwabKey("SPX", 5910, "C");

export function streamKeysFromChain(chain: OptionChainResponse): string[] {
  const keys = new Set<string>();
  for (const c of chain.calls) {
    const sym = (c as OptionContract & { schwabSymbol?: string }).schwabSymbol;
    if (sym) keys.add(sym);
  }
  for (const p of chain.puts) {
    const sym = (p as OptionContract & { schwabSymbol?: string }).schwabSymbol;
    if (sym) keys.add(sym);
  }
  return [...keys];
}