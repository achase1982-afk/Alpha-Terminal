export type DeskFlowBar = {
  barStartMs: number;
  callPremBought: number;
  callPremSold: number;
  putPremBought: number;
  putPremSold: number;
  netCall: number;
  netPut: number;
  polledAtMs?: number;
  src?: string;
};

export type DeskFlowSnapshot = {
  bars: DeskFlowBar[];
  lastBarMs: number | null;
  estimated: boolean;
  delayed: boolean;
  stale: boolean;
  ageSec: number | null;
};

export type DeskStockTapeSnapshot = {
  buyersLift1m: number;
  sellersHit1m: number;
  buyersLift5m: number;
  sellersHit5m: number;
  sparkBuy: number[];
  sparkSell: number[];
  estimated: boolean;
};