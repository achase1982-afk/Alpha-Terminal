import { buildChartGeometry, priceSeries, type ChartGeometry } from "./chartModel";
import { legsFromPreset, naturalNet } from "./economics";
import { formatPremium } from "./format";
import { buildQuoteBook, fullStrikes, quotePrice, type BookSpec } from "./ladderBook";
import type {
  IpadExpiry,
  IpadFill,
  IpadFlowWire,
  IpadLadderQuote,
  IpadLevelsWire,
  IpadMarketSnapshot,
  IpadPosition,
  IpadPresetLeg,
  IpadScenarioId,
  IpadStagedLeg,
  IpadStrategy,
  IpadVerdictWire,
  IpadWireSnapshot,
  IpadWorkingOrder,
} from "./types";

export const EXPIRIES: readonly IpadExpiry[] = [
  { pill: "19 NOV PM · 0DTE", short: "0DTE · 19 NOV", leg: "19 NOV" },
  { pill: "20 NOV AM · 1DTE", short: "1DTE · 20 NOV", leg: "20 NOV" },
  { pill: "20 NOV PM · 1DTE", short: "1DTE · 20 NOV", leg: "20 NOV" },
];

const BEAR_AMPS = [
  -0.35, -0.55, -0.4, -0.7, -0.5, -0.3, -0.62, -0.8, -0.45, -0.58, -0.38, -0.85, -0.5, -0.66, -0.42,
  -0.72, -0.55, -0.36, -0.48, -0.78, -0.44, 0.88, 1, 0.94,
];

const BULL_AMPS = [
  -0.28, -0.4, -0.22, 0.35, 0.48, 0.42, 0.55, 0.62, 0.5, 0.7, 0.66, 0.58, 0.74, 0.8, 0.68, 0.86, 0.77,
  0.9, 0.84, 0.95, 0.88, 1, 0.92, 0.96,
];

export interface IpadScenario {
  id: IpadScenarioId;
  market: IpadMarketSnapshot;
  verdict: IpadVerdictWire;
  flow: IpadFlowWire;
  levels: IpadLevelsWire;
  book: Map<number, IpadLadderQuote>;
  chart: ChartGeometry;
  prices: number[];
  flowAmps: number[];
  atm: number;
  anchor: number;
  presets: Record<IpadStrategy, readonly IpadPresetLeg[]>;
  defaultStrategy: IpadStrategy;
  openingLegs: IpadStagedLeg[];
  openingLimit: number;
  positions: IpadPosition[];
  working: IpadWorkingOrder[];
  fills: IpadFill[];
  dayPnl: number;
}

function compile(input: {
  id: IpadScenarioId;
  market: IpadMarketSnapshot;
  verdict: IpadVerdictWire;
  flow: IpadFlowWire;
  levels: IpadLevelsWire;
  bookSpec: BookSpec;
  priceStops: ReadonlyArray<readonly [number, number]>;
  flowAmps: number[];
  line: string;
  atm: number;
  anchor: number;
  presets: Record<IpadStrategy, readonly IpadPresetLeg[]>;
  defaultStrategy: IpadStrategy;
  positions: IpadPosition[];
  working: IpadWorkingOrder[];
  fills: IpadFill[];
  dayPnl: number;
}): IpadScenario {
  const book = buildQuoteBook(input.bookSpec);
  const prices = priceSeries(input.priceStops);
  const chart = buildChartGeometry({
    prices,
    flowAmps: input.flowAmps,
    callWall: input.levels.callWall.strike,
    putWall: input.levels.putWall.strike,
    gammaFlip: input.levels.gammaFlip.strike,
    line: input.line,
    flowValue: formatPremium(input.flow.m5, true),
    flowColor: "#2EE58D",
  });
  const openingLegs = legsFromPreset((leg) => {
    const quote = book.get(leg.strike);
    return quote ? quotePrice(quote, leg) : 0.05;
  }, input.presets[input.defaultStrategy]);
  return {
    id: input.id,
    market: input.market,
    verdict: input.verdict,
    flow: input.flow,
    levels: input.levels,
    book,
    chart,
    prices,
    flowAmps: input.flowAmps,
    atm: input.atm,
    anchor: input.anchor,
    presets: input.presets,
    defaultStrategy: input.defaultStrategy,
    openingLegs,
    openingLimit: naturalNet(openingLegs, input.defaultStrategy),
    positions: input.positions,
    working: input.working,
    fills: input.fills,
    dayPnl: input.dayPnl,
  };
}

const bearFills: IpadFill[] = [
  { id: "f1", time: "11:41:06", description: "BOT 7,305 C / SLD 7,300 C", price: 2.1, pnl: 0 },
  { id: "f2", time: "11:12:44", description: "CLOSE 7,280/7,285 Put Cr (1x)", price: 0.7, pnl: 85 },
  { id: "f3", time: "10:36:18", description: "SLD 7,340/7,345 Call Cr (1x)", price: 1.45, pnl: 0 },
  { id: "f4", time: "09:52:03", description: "CLOSE 7,260/7,255 Put Cr (2x)", price: 1.1, pnl: 160 },
];

export const BEAR = compile({
  id: "bear",
  market: {
    symbol: "SPX",
    spot: 7268.68,
    changePts: -91.32,
    changePct: -1.24,
    fromOpen: -41.32,
    high: 7316.4,
    highTime: "9:34",
    low: 7261.96,
    lowTime: "11:38",
    vix: 24.8,
    vixChange: 2.7,
    vixLow: 21.8,
    vixHigh: 26.4,
  },
  verdict: {
    control: "bears",
    bearPct: 68,
    bullPct: 32,
    gamma: "dampened",
    tapeSmooth: { direction: "down", value: -20.2 },
    divergence: "apart",
  },
  flow: {
    dayNet: -4_100_000,
    dayTone: "bearish",
    m15: 2_600_000,
    m15Tag: "FLIP",
    m5: 900_000,
    calls: { bought: 880_000, sold: 310_000 },
    puts: { bought: 420_000, sold: 1_360_000 },
    tape: "TAPE: SHORT-TERM FLIPPING BULLISH",
    tapeTone: "gold",
  },
  levels: {
    hiZone: 7386,
    loZone: 7202.5,
    callWall: { strike: 7350, prev: 7450 },
    putWall: { strike: 7325, prev: 7300 },
    gammaFlip: { strike: 7210 },
  },
  bookSpec: {
    spot: 7268.68,
    callWall: 7350,
    putWall: 7325,
    callKnots: [
      [7210, 62.4],
      [7240, 36.8],
      [7270, 18.6],
      [7290, 11.4],
      [7300, 7.25],
      [7305, 4.85],
      [7325, 2.2],
      [7350, 0.75],
    ],
    putKnots: [
      [7210, 0.55],
      [7240, 1.85],
      [7265, 4.4],
      [7270, 7.1],
      [7290, 14.8],
      [7325, 36.2],
      [7350, 58.4],
    ],
  },
  priceStops: [
    [0, 7310],
    [4, 7316.4],
    [40, 7294],
    [80, 7278],
    [128, 7261.96],
    [144, 7268.68],
  ],
  flowAmps: BEAR_AMPS,
  line: "#FF5252",
  atm: 7270,
  anchor: 7325,
  presets: {
    call_credit: [
      { side: "SELL", right: "C", strike: 7300 },
      { side: "BUY", right: "C", strike: 7305 },
    ],
    put_credit: [
      { side: "SELL", right: "P", strike: 7270 },
      { side: "BUY", right: "P", strike: 7265 },
    ],
    debit: [
      { side: "BUY", right: "C", strike: 7270 },
      { side: "SELL", right: "C", strike: 7275 },
    ],
    single: [{ side: "BUY", right: "C", strike: 7270 }],
  },
  defaultStrategy: "call_credit",
  positions: [
    { id: "p1", title: "7,325/7,330 Call Cr (2x)", entry: 1.85, mark: 1.15, pnl: 140 },
    { id: "p2", title: "7,250/7,245 Put Cr (1x)", entry: 0.9, mark: 1.25, pnl: -35 },
  ],
  working: [{ id: "w1", status: "WORKING", summary: "19 NOV 7,280/7,285 C · 1x @ $1.55 CR" }],
  fills: bearFills,
  dayPnl: 420,
});

export const BULL = compile({
  id: "bull",
  market: {
    symbol: "SPX",
    spot: 7322.4,
    changePts: 53.72,
    changePct: 0.74,
    fromOpen: 48.1,
    high: 7326.8,
    highTime: "11:51",
    low: 7271.2,
    lowTime: "9:38",
    vix: 18.4,
    vixChange: -2.9,
    vixLow: 18.1,
    vixHigh: 21.6,
  },
  verdict: {
    control: "bulls",
    bearPct: 24,
    bullPct: 76,
    gamma: "supportive",
    tapeSmooth: { direction: "up", value: 18.4 },
    divergence: "aligned",
  },
  flow: {
    dayNet: 6_800_000,
    dayTone: "bullish",
    m15: 3_100_000,
    m15Tag: "TREND",
    m5: 1_400_000,
    calls: { bought: 1_920_000, sold: 410_000 },
    puts: { bought: 290_000, sold: 1_540_000 },
    tape: "TAPE: TREND CONFIRMED BULLISH",
    tapeTone: "green",
  },
  levels: {
    hiZone: 7410,
    loZone: 7255,
    callWall: { strike: 7350, prev: 7400 },
    putWall: { strike: 7300, prev: 7275 },
    gammaFlip: { strike: 7260 },
  },
  bookSpec: {
    spot: 7322.4,
    callWall: 7350,
    putWall: 7300,
    callKnots: [
      [7210, 120.5],
      [7260, 74.2],
      [7290, 44.6],
      [7320, 19.8],
      [7345, 6.4],
      [7350, 3.9],
    ],
    putKnots: [
      [7210, 0.4],
      [7260, 1.7],
      [7290, 4.15],
      [7295, 6.35],
      [7320, 16.4],
      [7350, 34.8],
    ],
  },
  priceStops: [
    [0, 7274.3],
    [8, 7271.2],
    [50, 7296],
    [100, 7314],
    [141, 7326.8],
    [144, 7322.4],
  ],
  flowAmps: BULL_AMPS,
  line: "#2EE58D",
  atm: 7320,
  anchor: 7350,
  presets: {
    call_credit: [
      { side: "SELL", right: "C", strike: 7345 },
      { side: "BUY", right: "C", strike: 7350 },
    ],
    put_credit: [
      { side: "SELL", right: "P", strike: 7295 },
      { side: "BUY", right: "P", strike: 7290 },
    ],
    debit: [
      { side: "BUY", right: "C", strike: 7320 },
      { side: "SELL", right: "C", strike: 7325 },
    ],
    single: [{ side: "BUY", right: "C", strike: 7320 }],
  },
  defaultStrategy: "put_credit",
  positions: [
    { id: "p1", title: "7,300/7,295 Put Cr (2x)", entry: 1.7, mark: 1.0, pnl: 140 },
    { id: "p2", title: "7,360/7,365 Call Cr (1x)", entry: 1.1, mark: 1.45, pnl: -35 },
  ],
  working: [{ id: "w1", status: "OCO WORK", summary: "19 NOV 7,340/7,335 P · 1x @ $1.40 CR" }],
  fills: bearFills,
  dayPnl: 420,
});

export const SCENARIOS: Record<IpadScenarioId, IpadScenario> = {
  bear: BEAR,
  bull: BULL,
};

export function toWire(scenario: IpadScenario): IpadWireSnapshot {
  return {
    market: scenario.market,
    verdict: scenario.verdict,
    flow: scenario.flow,
    levels: scenario.levels,
    ladder: fullStrikes().map((strike) => {
      const quote = scenario.book.get(strike);
      if (!quote) throw new Error(`Missing ladder quote ${strike}`);
      return quote;
    }),
    chart: { prices: scenario.prices, flowAmps: scenario.flowAmps },
  };
}

export function gammaBadge(gamma: IpadVerdictWire["gamma"]): string {
  return gamma === "dampened" ? "+γ · DAMPENED" : "+γ · SUPPORTIVE";
}

export function gammaRail(gamma: IpadVerdictWire["gamma"]): string {
  return gamma === "dampened" ? "+γ DAMPENED" : "+γ SUPPORTIVE";
}

export function verdictHero(control: IpadVerdictWire["control"]): string {
  return control === "bears" ? "BEARS IN CONTROL" : "BULLS IN CONTROL";
}

export function tapePill(verdict: IpadVerdictWire, choppy: boolean): string {
  if (choppy) return "15m ↔ CHOPPY +1.9";
  const arrow = verdict.tapeSmooth.direction === "down" ? "▼" : "▲";
  const value = verdict.tapeSmooth.value;
  const signed = `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
  return `15m ${arrow} SMOOTH ${signed}`;
}

export function divergenceLabel(verdict: IpadVerdictWire): string {
  return verdict.divergence === "apart" ? "PRICE NOT FOLLOWING" : "FLOW + SPOT ALIGNED";
}

export function chartStatusLabel(verdict: IpadVerdictWire): string {
  return verdict.divergence === "apart" ? "DIVERGENCE ACTIVE" : "TREND CONFIRMED";
}
