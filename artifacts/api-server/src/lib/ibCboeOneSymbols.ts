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

/** Dynamic Cboe One pool uses reqId range 15000–15049. */
export const CBOE_ONE_REQ_ID_BASE = 15_000;
