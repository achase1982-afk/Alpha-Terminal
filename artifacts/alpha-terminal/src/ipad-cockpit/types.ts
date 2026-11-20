/**
 * Wire contracts for the iPad 0DTE cockpit.
 * A live socket can replace `IpadWireSnapshot`. Ticket, blotter, and
 * demo toggles stay local until an order router is attached.
 */

export type IpadScenarioId = "bear" | "bull";

export type IpadRight = "C" | "P";

export type IpadSide = "BUY" | "SELL";

export type IpadStrategy = "call_credit" | "put_credit" | "debit" | "single";

export type IpadMetric = "OI" | "VOL";

export type IpadTick = "up" | "down";

export type IpadBlotterTab = "positions" | "working" | "fills";

export interface IpadMarketSnapshot {
  symbol: "SPX";
  spot: number;
  changePts: number;
  changePct: number;
  fromOpen: number;
  high: number;
  highTime: string;
  low: number;
  lowTime: string;
  vix: number;
  /** Positive means VIX is higher on the day. */
  vixChange: number;
  vixLow: number;
  vixHigh: number;
}

export interface IpadVerdictWire {
  control: "bears" | "bulls";
  bearPct: number;
  bullPct: number;
  gamma: "dampened" | "supportive";
  /** Smooth-regime 15m tape. The choppy alternate is a local toggle. */
  tapeSmooth: { direction: "down" | "up"; value: number };
  divergence: "apart" | "aligned";
}

export interface IpadFlowWire {
  dayNet: number;
  dayTone: "bearish" | "bullish";
  m15: number;
  m15Tag: "FLIP" | "TREND" | null;
  m5: number;
  calls: { bought: number; sold: number };
  puts: { bought: number; sold: number };
  /** Plain-English strip under the pressure bars. */
  tape: string;
  tapeTone: "gold" | "green";
}

export interface IpadWallWire {
  strike: number;
  /** Previous strike when the wall has migrated. */
  prev?: number;
}

export interface IpadLevelsWire {
  hiZone: number;
  loZone: number;
  callWall: IpadWallWire;
  putWall: IpadWallWire;
  gammaFlip: IpadWallWire;
}

export interface IpadLadderQuote {
  strike: number;
  callBid: number;
  callAsk: number;
  putBid: number;
  putAsk: number;
  callVol: number;
  putVol: number;
  callTick: IpadTick;
  putTick: IpadTick;
}

export interface IpadChartWire {
  /** Intraday spot samples from 9:30 through 11:54 ET. */
  prices: number[];
  /** Signed 5m net-flow amplitudes, length 24. Negative is sold. */
  flowAmps: number[];
}

export interface IpadWireSnapshot {
  market: IpadMarketSnapshot;
  verdict: IpadVerdictWire;
  flow: IpadFlowWire;
  levels: IpadLevelsWire;
  ladder: IpadLadderQuote[];
  chart: IpadChartWire;
}

export interface IpadPresetLeg {
  side: IpadSide;
  right: IpadRight;
  strike: number;
}

export interface IpadStagedLeg {
  id: string;
  side: IpadSide;
  right: IpadRight;
  strike: number;
  /** Bid if SELL, ask if BUY, at the moment the leg was staged. */
  price: number;
}

export interface IpadPosition {
  id: string;
  title: string;
  entry: number;
  mark: number;
  pnl: number;
}

export interface IpadWorkingOrder {
  id: string;
  status: "WORKING" | "OCO WORK";
  summary: string;
}

export interface IpadFill {
  id: string;
  time: string;
  description: string;
  price: number;
  pnl: number;
}

export interface IpadExpiry {
  pill: string;
  short: string;
  leg: string;
}
