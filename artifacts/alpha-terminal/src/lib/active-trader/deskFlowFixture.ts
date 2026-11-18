import type { DeskFlowBar, DeskFlowSnapshot, DeskStockTapeSnapshot } from "./deskFlowTypes";

const BARS: DeskFlowBar[] = [
  {
    barStartMs: 0,
    callPremBought: 0.4e6,
    callPremSold: -0.3e6,
    putPremBought: -1.2e6,
    putPremSold: -1.1e6,
    netCall: 0.1e6,
    netPut: -2.3e6,
  },
];

/** Tessa Nov 17 snapshot + spark heights for mock. */
export function buildSpxFlowFixture(now = Date.now()): DeskFlowSnapshot {
  return {
    bars: BARS,
    lastBarMs: now - 62_000,
    estimated: true,
    delayed: true,
    stale: false,
    ageSec: 62,
  };
}

export function spxFlowDisplayTotals(snapshot: DeskFlowSnapshot) {
  return {
    callsBought1m: 5.9e6,
    putsSold1m: 18.1e6,
    callsBought5m: 9.6e6,
    putsSold5m: 19.8e6,
    callsHr: 14.2e6,
    putsHr: 31.5e6,
    sparkCalls: [0.4, -0.3, 0.8, 1.1, 0.2, -0.6, 0.5, 0.9, 1.4, 0.3, 0.7, 1.2, 0.6, 1.8, 5.9],
    sparkPuts: [-1.2, 0.6, -0.9, -2.1, -0.4, 1.0, -1.5, -0.8, -2.6, -0.3, -1.1, -0.7, -0.2, -1.0, -18.1],
    spxPts5m: 0.8,
    spxPts1m: 0.2,
    spxPtsHr: -4.1,
    priceNotFollowing: true,
  };
}

export function buildNvdaTapeFixture(): DeskStockTapeSnapshot {
  return {
    buyersLift1m: 2.4e6,
    sellersHit1m: 1.1e6,
    buyersLift5m: 6.2e6,
    sellersHit5m: 3.8e6,
    sparkBuy: [0.2, 0.4, 0.3, 0.5, 0.6, 0.8, 0.4, 0.3, 0.5, 0.9, 0.4, 0.6, 0.7, 0.5, 2.4],
    sparkSell: [-0.1, -0.2, -0.3, -0.2, -0.4, -0.3, -0.5, -0.4, -0.3, -0.6, -0.2, -0.4, -0.5, -0.3, -1.1],
    estimated: true,
  };
}