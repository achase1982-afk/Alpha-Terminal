import type { IBSymbolDef } from "./ibBreadthSymbols.js";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";

/**
 * Cboe Global Markets aggregate BBO (Cboe One / similar consolidated feed in IBKR).
 *
 * **Exchange routing (verify in Client Portal + TWS):** IBKR documentation does not
 * consistently publish a single exchange string for “Cboe One” in the public Campus
 * landing pages. This build uses **`CBOE`** as the `Contract.exchange` for US `STK`
 * symbols, which matches common IBKR contract routing for Cboe-listed consolidated
 * feeds in API examples. If `reqContractDetails` / live subscription returns error
 * **200** or **101**, try **`SMART`** with the appropriate market data subscription, or
 * confirm the exact venue string in **TWS API Reference → Contract** and **Market Data
 * Subscriptions** on IBKR Campus: https://ibkrcampus.com/ibkr-api-page/trader-workstation-api/
 *
 * `reqMktData` signature (Java/C++ parity): `reqMktData(tickerId, contract, genericTickList, snapshot, regulatorySnapshot)`
 * — see streaming market data overview: https://interactivebrokers.github.io/tws-api/market_data.html
 */
export const CBOE_ONE_EXCHANGE = "CBOE" as const;

export const CBOE_ONE_REQ_ID_BASE = 15_000;

export const CBOE_ONE_SYMBOLS: IBSymbolDef[] = LIQUID_CORE_SYMBOL_STRINGS.map((sym, i) => ({
  reqId: CBOE_ONE_REQ_ID_BASE + i,
  symbol: sym,
  ibSymbol: sym,
  secType: "STK",
  exchange: CBOE_ONE_EXCHANGE,
  displaySymbol: sym,
  category: "CBOE_ONE",
  description: "Cboe One / CBOE consolidated BBO stream",
  enabled: true,
}));

export const CBOE_ONE_REQID_TO_SYMBOL = new Map<number, string>(
  CBOE_ONE_SYMBOLS.map((d) => [d.reqId, d.displaySymbol]),
);
