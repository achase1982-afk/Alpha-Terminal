/**
 * Live pulse inputs: Schwab + IB caches → dataMap → MarketIndicators.
 * Shared by HTTP routes and the snapshot scanner worker (regime shock parity).
 */
import { type MarketIndicators } from "./marketPulseEngine.js";
import { getSnapshot, addSymbols as addSchwabSymbols, addFuturesSymbols as addSchwabFuturesSymbols, type LiveQuote } from "./schwabStreamer.js";
import { getIBSnapshot, getIBCachedQuote, registerPermanentSymbols } from "./ibStreamer.js";
import { getSchwabIndexQuote, registerSchwabIndexSymbols } from "./schwabIndexQuotes.js";
import { getSyntheticBreadth } from "./syntheticBreadth.js";
import { getSyntheticDxyPrevClose } from "./syntheticDxy.js";
import { getEquityPCRatio, getIndexPCRatio } from "./polygonPutCallRatio.js";

export interface PulseSymbol {
  display: string;
  api: string;
  category: "equity" | "vol" | "breadth" | "futures" | "currency" | "commodity" | "rates" | "credit";
  description: string;
}

export const PULSE_SYMBOLS: PulseSymbol[] = [
  { display: "SPY", api: "SPY", category: "equity", description: "S&P 500 ETF — broad market barometer" },
  { display: "QQQ", api: "QQQ", category: "equity", description: "Nasdaq-100 ETF — tech/growth leadership" },
  { display: "IWM", api: "IWM", category: "equity", description: "Russell 2000 ETF — small-cap risk appetite" },

  { display: "$VIX", api: "$VIX", category: "vol", description: "CBOE VIX — S&P implied vol (30-day), fear gauge" },
  { display: "$VVIX", api: "$VVIX", category: "vol", description: "VVIX — vol-of-vol, tail risk premium indicator" },
  { display: "$VIX1D", api: "$VIX1D", category: "vol", description: "CBOE 1-Day VIX — ultra-short implied vol" },
  { display: "$VIX9D", api: "$VIX9D", category: "vol", description: "CBOE 9-Day VIX — near-term implied vol" },
  { display: "$VIX3M", api: "$VIX3M", category: "vol", description: "CBOE 3-Month VIX — medium-term implied vol" },
  { display: "$VXN", api: "$VXN", category: "vol", description: "CBOE Nasdaq VIX — tech sector implied vol" },
  { display: "$RVX", api: "$RVX", category: "vol", description: "CBOE Russell 2000 VIX — small-cap implied vol" },
  { display: "$OVX", api: "$OVX", category: "vol", description: "CBOE Oil VIX — crude oil implied vol" },
  { display: "$GVZ", api: "$GVZ", category: "vol", description: "CBOE Gold VIX — gold implied vol" },
  { display: "/VX", api: "/VX", category: "vol", description: "CBOE VIX front-month future — term-structure anchor vs $VIX" },

  { display: "$PCUSEQTR", api: "$PCUSEQTR", category: "vol", description: "CBOE Equity Put/Call Ratio (Polygon SPY options)" },
  { display: "$PCUSINXR", api: "$PCUSINXR", category: "vol", description: "CBOE Index Put/Call Ratio (Polygon SPX options)" },

  { display: "$TICK", api: "$TICK", category: "breadth", description: "NYSE TICK — stocks upticking minus downticking" },
  { display: "$ADD", api: "$ADD", category: "breadth", description: "NYSE A/D Line — advancers minus decliners" },
  { display: "$TRIN", api: "$TRIN", category: "breadth", description: "NYSE TRIN/Arms Index — <1.0 bullish, >1.0 bearish" },
  { display: "$ADVN", api: "$ADVN", category: "breadth", description: "NYSE Advancing Issues" },
  { display: "$DECN", api: "$DECN", category: "breadth", description: "NYSE Declining Issues" },
  { display: "$UVOL", api: "$UVOL", category: "breadth", description: "NYSE Up Volume" },
  { display: "$DVOL", api: "$DVOL", category: "breadth", description: "NYSE Down Volume" },

  { display: "$TICKI", api: "$TICKI", category: "breadth", description: "NASDAQ TICK" },
  { display: "$ADDQ", api: "$ADDQ", category: "breadth", description: "NASDAQ A/D Line" },
  { display: "$TRINQ", api: "$TRINQ", category: "breadth", description: "NASDAQ TRIN" },
  { display: "$ADVNQ", api: "$ADVNQ", category: "breadth", description: "NASDAQ Advancing Issues" },
  { display: "$DECNQ", api: "$DECNQ", category: "breadth", description: "NASDAQ Declining Issues" },
  { display: "$UVOLQ", api: "$UVOLQ", category: "breadth", description: "NASDAQ Up Volume" },
  { display: "$DVOLQ", api: "$DVOLQ", category: "breadth", description: "NASDAQ Down Volume" },

  { display: "$TNX", api: "$TNX", category: "rates", description: "10-Year Treasury Yield Index" },
  { display: "$TYX", api: "$TYX", category: "rates", description: "30-Year Treasury Yield Index" },
  { display: "$IRX", api: "$IRX", category: "rates", description: "13-Week T-Bill Yield Index" },
  { display: "/ZB", api: "/ZB", category: "rates", description: "30Y Treasury Bond Futures" },
  { display: "/ZT", api: "/ZT", category: "rates", description: "2Y Treasury Note Futures" },
  { display: "/ZF", api: "/ZF", category: "rates", description: "5Y Treasury Note Futures" },
  { display: "/ZN", api: "/ZN", category: "rates", description: "10Y Treasury Note Futures" },
  { display: "/ZQ", api: "/ZQ", category: "rates", description: "30-Day Fed Funds Futures" },

  { display: "HYG", api: "HYG", category: "credit", description: "iShares High Yield Corporate Bond ETF" },
  { display: "LQD", api: "LQD", category: "credit", description: "iShares Investment Grade Corporate Bond ETF" },
  { display: "IEF", api: "IEF", category: "credit", description: "iShares 7-10 Year Treasury Bond ETF" },
  { display: "TLT", api: "TLT", category: "credit", description: "iShares 20+ Year Treasury Bond ETF" },

  { display: "/ES", api: "/ES", category: "futures", description: "E-mini S&P 500 Futures" },
  { display: "/NQ", api: "/NQ", category: "futures", description: "E-mini Nasdaq-100 Futures" },
  { display: "/YM", api: "/YM", category: "futures", description: "Mini Dow Jones Futures" },
  { display: "/RTY", api: "/RTY", category: "futures", description: "E-mini Russell 2000 Futures" },

  { display: "/GC", api: "/GC", category: "commodity", description: "Gold Futures — safe-haven / real rates proxy" },
  { display: "/CL", api: "/CL", category: "commodity", description: "Crude Oil Futures (WTI)" },
  { display: "/BZ", api: "/BZ", category: "commodity", description: "Brent Crude Oil Futures (Schwab WS)" },
  { display: "/HG", api: "/HG", category: "commodity", description: "Copper Futures — global growth proxy" },

  { display: "/DX", api: "/DX", category: "currency", description: "US Dollar Index Futures" },
  { display: "/6E", api: "/6E", category: "currency", description: "Euro FX Futures" },
  { display: "/6J", api: "/6J", category: "currency", description: "Japanese Yen Futures — risk-off proxy" },

  { display: "$DXY", api: "$DXY", category: "currency", description: "US Dollar Index (synthetic from /6E)" },
];

const INDEX_TO_SCHWAB: Record<string, string> = {
  VIX: "$VIX",
  VVIX: "$VVIX",
  SPX: "$SPX",
  NDX: "$NDX",
  RUT: "$RUT",
  DJI: "$DJI",
  DJIA: "$DJI",
  COMP: "$COMP",
  DXY: "$DXY",
  TNX: "$TNX",
  TYX: "$TYX",
  IRX: "$IRX",
  VXN: "$VXN",
  RVX: "$RVX",
  OVX: "$OVX",
  GVZ: "$GVZ",
  TICK: "$TICK",
  ADD: "$ADD",
  TRIN: "$TRIN",
  OEX: "$OEX",
  MNX: "$MNX",
  XSP: "$XSP",
  VIX1D: "$VIX1D",
  VIX9D: "$VIX9D",
  VIX3M: "$VIX3M",
  ADVN: "$ADVN",
  DECN: "$DECN",
  UVOL: "$UVOL",
  DVOL: "$DVOL",
  TICKI: "$TICKI",
  ADDQ: "$ADDQ",
  TRINQ: "$TRINQ",
  ADVNQ: "$ADVNQ",
  DECNQ: "$DECNQ",
  UVOLQ: "$UVOLQ",
  DVOLQ: "$DVOLQ",
};

export function symbolToSchwabApi(userSymbol: string): string {
  const upper = userSymbol.toUpperCase().trim().replace(/\.X$/, "");
  return INDEX_TO_SCHWAB[upper] ?? upper;
}

/** Symbols that only ever arrived over the IBKR stream; Schwab REST is the source now. */
export const INDEX_ONLY_PULSE_SYMBOLS: readonly string[] = PULSE_SYMBOLS.filter(
  (s) =>
    s.display.startsWith("$") &&
    s.display !== "$DXY" &&
    s.display !== "$PCUSEQTR" &&
    s.display !== "$PCUSINXR",
).map((s) => s.display);

// IBKR keeps these registered when a gateway happens to be connected, but it is
// no longer required: the Schwab REST poller below is the primary source.
registerPermanentSymbols(
  PULSE_SYMBOLS.filter((s) => s.category === "breadth" || (s.category === "vol" && s.display.startsWith("$"))).map((s) => s.display),
);
registerSchwabIndexSymbols(INDEX_ONLY_PULSE_SYMBOLS);

export function ensurePulseSubscriptions(): void {
  const equitySyms: string[] = [];
  const futuresSyms: string[] = [];
  for (const s of PULSE_SYMBOLS) {
    if (s.category === "breadth" || (s.category === "vol" && s.display.startsWith("$"))) continue;
    if (s.display.startsWith("/")) {
      futuresSyms.push(s.display);
    } else {
      equitySyms.push(s.api);
    }
  }
  if (equitySyms.length > 0) addSchwabSymbols(equitySyms);
  if (futuresSyms.length > 0) addSchwabFuturesSymbols(futuresSyms);
}
ensurePulseSubscriptions();

export function readFromWebSocketCache(userSymbols?: string[]): {
  dataMap: Map<string, Record<string, unknown>>;
  displayToApi: Map<string, string>;
  hitCount: number;
} {
  const ibSnapshot = getIBSnapshot();
  const ibCacheBySymbol = new Map<string, LiveQuote>();
  for (const q of ibSnapshot) {
    ibCacheBySymbol.set(q.symbol, q);
  }

  const schwabSnapshot = getSnapshot();
  const schwabCacheBySymbol = new Map<string, LiveQuote>();
  for (const q of schwabSnapshot) {
    schwabCacheBySymbol.set(q.symbol, q);
  }

  let pairs: Array<{ display: string; api: string }>;
  if (userSymbols && userSymbols.length > 0) {
    pairs = userSymbols.map((s) => ({
      display: s.toUpperCase().trim(),
      api: symbolToSchwabApi(s),
    }));
  } else {
    pairs = PULSE_SYMBOLS.map((s) => ({ display: s.display, api: s.api }));
  }

  const displayToApi = new Map<string, string>(pairs.map((p) => [p.display, p.api]));
  const dataMap = new Map<string, Record<string, unknown>>();
  let hitCount = 0;

  for (const pair of pairs) {
    let q: LiveQuote | null | undefined = null;

    // Schwab stream first, then the Schwab REST index cache, and only then
    // IBKR. IBKR used to be mandatory for the `$` symbols; it is now an
    // opportunistic extra, so the pulse survives with no gateway at all.
    q = schwabCacheBySymbol.get(pair.display) ?? schwabCacheBySymbol.get(pair.api);

    if (!q || q.last === null) {
      const idx = getSchwabIndexQuote(pair.display);
      if (idx) {
        q = {
          symbol: pair.display,
          last: idx.last,
          regularLast: idx.last,
          extendedLast: null,
          bid: null,
          ask: null,
          bidSize: null,
          askSize: null,
          change: idx.change,
          changePct: idx.changePct,
          volume: idx.volume,
          high: idx.high,
          low: idx.low,
          close: idx.close,
          ts: idx.ts,
          quoteSource: "SCHWAB",
        };
      }
    }

    if (!q || q.last === null) {
      q = ibCacheBySymbol.get(pair.display) ?? getIBCachedQuote(pair.display);
    }

    if (q && q.last !== null) {
      hitCount++;
      dataMap.set(pair.display, {
        lastPrice: q.last,
        mark: q.last,
        closePrice: q.close,
        close: q.close,
        netChange: q.change,
        markChange: q.change,
        netPercentChange: q.changePct,
        markPercentChange: q.changePct,
        highPrice: q.high,
        high: q.high,
        lowPrice: q.low,
        low: q.low,
        totalVolume: q.volume,
        volume: q.volume,
        bidPrice: q.bid,
        askPrice: q.ask,
      });
    }
  }

  const eqPC = getEquityPCRatio();
  if (eqPC && eqPC.ratio !== null) {
    hitCount += dataMap.has("$PCUSEQTR") ? 0 : 1;
    dataMap.set("$PCUSEQTR", {
      lastPrice: eqPC.ratio,
      mark: eqPC.ratio,
      closePrice: null,
      close: null,
      netChange: null,
      markChange: null,
      netPercentChange: null,
      markPercentChange: null,
      highPrice: null,
      high: null,
      lowPrice: null,
      low: null,
      totalVolume: eqPC.putVolume + eqPC.callVolume,
      volume: eqPC.putVolume + eqPC.callVolume,
      bidPrice: null,
      askPrice: null,
      putVolume: eqPC.putVolume,
      callVolume: eqPC.callVolume,
      source: "polygon",
    });
  }
  const idxPC = getIndexPCRatio();
  if (idxPC && idxPC.ratio !== null) {
    hitCount += dataMap.has("$PCUSINXR") ? 0 : 1;
    dataMap.set("$PCUSINXR", {
      lastPrice: idxPC.ratio,
      mark: idxPC.ratio,
      closePrice: null,
      close: null,
      netChange: null,
      markChange: null,
      netPercentChange: null,
      markPercentChange: null,
      highPrice: null,
      high: null,
      lowPrice: null,
      low: null,
      totalVolume: idxPC.putVolume + idxPC.callVolume,
      volume: idxPC.putVolume + idxPC.callVolume,
      bidPrice: null,
      askPrice: null,
      putVolume: idxPC.putVolume,
      callVolume: idxPC.callVolume,
      source: "polygon",
    });
  }

  // Breadth fallback. These indices reached this process only over IBKR; when
  // they are absent the Liquid Core proxy fills the ratio slots the pulse engine
  // actually scores. Anything Schwab does serve above wins and is left alone.
  const breadthProxy = getSyntheticBreadth();
  if (breadthProxy) {
    const setIfMissing = (sym: string, value: number | null) => {
      if (value === null) return;
      const existing = dataMap.get(sym);
      if (existing && typeof existing["lastPrice"] === "number") return;
      dataMap.set(sym, {
        lastPrice: value,
        mark: value,
        closePrice: null,
        close: null,
        netChange: null,
        markChange: null,
        netPercentChange: null,
        markPercentChange: null,
        highPrice: null,
        high: null,
        lowPrice: null,
        low: null,
        totalVolume: null,
        volume: null,
        bidPrice: null,
        askPrice: null,
        synthetic: true,
        derivedFrom: breadthProxy.source,
      });
      hitCount++;
    };
    if (breadthProxy.nyse) {
      setIfMissing("$ADVN", breadthProxy.nyse.advn);
      setIfMissing("$DECN", breadthProxy.nyse.decn);
      setIfMissing("$UVOL", breadthProxy.nyse.uvol);
      setIfMissing("$DVOL", breadthProxy.nyse.dvol);
      setIfMissing("$ADD", breadthProxy.nyse.add);
      setIfMissing("$TRIN", breadthProxy.nyse.trin);
    }
    if (breadthProxy.nasdaq) {
      setIfMissing("$ADVNQ", breadthProxy.nasdaq.advn);
      setIfMissing("$DECNQ", breadthProxy.nasdaq.decn);
      setIfMissing("$UVOLQ", breadthProxy.nasdaq.uvol);
      setIfMissing("$DVOLQ", breadthProxy.nasdaq.dvol);
      setIfMissing("$ADDQ", breadthProxy.nasdaq.add);
      setIfMissing("$TRINQ", breadthProxy.nasdaq.trin);
    }
  }

  if (!dataMap.has("$DXY") || !dataMap.get("$DXY")?.["lastPrice"]) {
    const sixE = schwabCacheBySymbol.get("/6E") ?? ibCacheBySymbol.get("/6E");
    if (sixE && sixE.last && sixE.close && sixE.close > 0) {
      const eurChangePct = ((sixE.last - sixE.close) / sixE.close) * 100;
      const DXY_PREV_CLOSE = getSyntheticDxyPrevClose();
      const dxyChangePct = -eurChangePct * 0.576;
      const syntheticDxy = Math.round(DXY_PREV_CLOSE * (1 + dxyChangePct / 100) * 1000) / 1000;
      const dxyChange = Math.round((syntheticDxy - DXY_PREV_CLOSE) * 1000) / 1000;
      dataMap.set("$DXY", {
        lastPrice: syntheticDxy,
        mark: syntheticDxy,
        closePrice: DXY_PREV_CLOSE,
        close: DXY_PREV_CLOSE,
        netChange: dxyChange,
        markChange: dxyChange,
        netPercentChange: Math.round(dxyChangePct * 10000) / 10000,
        markPercentChange: Math.round(dxyChangePct * 10000) / 10000,
        highPrice: null,
        high: null,
        lowPrice: null,
        low: null,
        totalVolume: null,
        volume: null,
        bidPrice: null,
        askPrice: null,
        synthetic: true,
        derivedFrom: "/6E",
      });
      hitCount++;
    }
  }

  return { dataMap, displayToApi, hitCount };
}

export function extractMarketIndicators(dataMap: Map<string, Record<string, unknown>>): MarketIndicators {
  const num = (sym: string, field: string): number | null => {
    const entry = dataMap.get(sym) ?? dataMap.get(sym.replace(/^\$/, ""));
    if (!entry) return null;
    const v = entry[field];
    return typeof v === "number" && isFinite(v) ? v : null;
  };

  const lastOrMark = (sym: string): number | null => {
    return num(sym, "lastPrice") ?? num(sym, "mark") ?? num(sym, "closePrice") ?? num(sym, "close") ?? null;
  };

  const pctChange = (sym: string): number | null => {
    return num(sym, "netPercentChange") ?? num(sym, "markPercentChange") ?? null;
  };

  const yieldIndex = (sym: string): number | null => {
    const raw = lastOrMark(sym);
    if (raw === null) return null;
    return raw > 10 ? Math.round((raw / 10) * 10000) / 10000 : raw;
  };

  const advn = lastOrMark("$ADVN");
  const decn = lastOrMark("$DECN");
  const addRaw = lastOrMark("$ADD");
  const add = addRaw !== null ? addRaw : advn !== null && decn !== null ? advn - decn : null;
  const tickVal = lastOrMark("$TICK");
  const trinVal = lastOrMark("$TRIN");

  const advnq = lastOrMark("$ADVNQ");
  const decnq = lastOrMark("$DECNQ");
  const addqRaw = lastOrMark("$ADDQ");
  const addq = addqRaw !== null ? addqRaw : advnq !== null && decnq !== null ? advnq - decnq : null;

  return {
    vix: lastOrMark("$VIX"),
    vixChange: pctChange("$VIX"),
    vvix: lastOrMark("$VVIX"),
    vvixChange: pctChange("$VVIX"),
    vix1d: lastOrMark("$VIX1D"),
    vix1dChange: pctChange("$VIX1D"),
    vix3m: lastOrMark("$VIX3M"),
    vix3mChange: pctChange("$VIX3M"),
    vix9d: lastOrMark("$VIX9D"),
    vix9dChange: pctChange("$VIX9D"),
    vxn: lastOrMark("$VXN"),
    vxnChange: pctChange("$VXN"),
    rvx: lastOrMark("$RVX"),
    rvxChange: pctChange("$RVX"),
    ovx: lastOrMark("$OVX"),
    ovxChange: pctChange("$OVX"),
    gvz: lastOrMark("$GVZ"),
    gvzChange: pctChange("$GVZ"),
    // /VX is the front-month VIX future. This used to read $VIX, which made the
    // term-structure component compare the index to itself and always score 0.
    vixFut: lastOrMark("/VX"),
    vixFutChange: pctChange("/VX"),

    tnx: yieldIndex("$TNX"),
    tnxChange: pctChange("$TNX"),
    tyx: yieldIndex("$TYX"),
    tyxChange: pctChange("$TYX"),
    irx: yieldIndex("$IRX"),
    irxChange: pctChange("$IRX"),
    zb: lastOrMark("/ZB"),
    zbChange: pctChange("/ZB"),
    zt: lastOrMark("/ZT"),
    ztChange: pctChange("/ZT"),
    zf: lastOrMark("/ZF"),
    zfChange: pctChange("/ZF"),
    zn: lastOrMark("/ZN"),
    znChange: pctChange("/ZN"),
    zq: lastOrMark("/ZQ"),
    zqChange: pctChange("/ZQ"),

    hyg: lastOrMark("HYG"),
    hygChange: pctChange("HYG"),
    lqd: lastOrMark("LQD"),
    lqdChange: pctChange("LQD"),
    ief: lastOrMark("IEF"),
    iefChange: pctChange("IEF"),
    tlt: lastOrMark("TLT"),
    tltChange: pctChange("TLT"),

    advn,
    decn,
    tick: tickVal,
    trin: trinVal,
    add,
    uvol: lastOrMark("$UVOL"),
    dvol: lastOrMark("$DVOL"),
    ticki: lastOrMark("$TICKI"),
    trinq: lastOrMark("$TRINQ"),
    addq,
    advnq,
    decnq,
    uvolq: lastOrMark("$UVOLQ"),
    dvolq: lastOrMark("$DVOLQ"),

    es: lastOrMark("/ES"),
    esChange: pctChange("/ES"),
    nq: lastOrMark("/NQ"),
    nqChange: pctChange("/NQ"),
    ym: lastOrMark("/YM"),
    ymChange: pctChange("/YM"),
    rty: lastOrMark("/RTY"),
    rtyChange: pctChange("/RTY"),
    spy: lastOrMark("SPY"),
    spyChange: pctChange("SPY"),
    qqq: lastOrMark("QQQ"),
    qqqChange: pctChange("QQQ"),
    iwm: lastOrMark("IWM"),
    iwmChange: pctChange("IWM"),

    gc: lastOrMark("/GC"),
    gcChange: pctChange("/GC"),
    cl: lastOrMark("/CL"),
    clChange: pctChange("/CL"),
    bz: lastOrMark("/BZ"),
    bzChange: pctChange("/BZ"),
    hg: lastOrMark("/HG"),
    hgChange: pctChange("/HG"),
    dx: lastOrMark("$DXY") ?? lastOrMark("/DX"),
    dxChange: pctChange("$DXY") ?? pctChange("/DX"),
    sixE: lastOrMark("/6E"),
    sixEChange: pctChange("/6E"),
    sixJ: lastOrMark("/6J"),
    sixJChange: pctChange("/6J"),

    cpce: lastOrMark("$PCUSEQTR"),
    cpci: lastOrMark("$PCUSINXR"),
  };
}

export function getLiveMarketIndicatorsForPulse(): {
  indicators: MarketIndicators;
  hitCount: number;
  dataMap: Map<string, Record<string, unknown>>;
} {
  const { dataMap, hitCount } = readFromWebSocketCache();
  return {
    indicators: extractMarketIndicators(dataMap),
    hitCount,
    dataMap,
  };
}

export interface RegimeInputDegradation {
  /** Pulse symbols with no usable value from any source this read. */
  missingSymbols: string[];
  /** Slots filled by the Liquid Core breadth proxy rather than an exchange feed. */
  syntheticSymbols: string[];
  /** True when breadth came from the proxy rather than the exchange indices. */
  breadthIsProxy: boolean;
  /** True when the term-structure anchor /VX is absent. */
  vixFutureMissing: boolean;
}

/**
 * What the regime is currently missing and what is standing in for it. Surfaced
 * to the strategist so a thin data read is never mistaken for a flat market.
 */
export function describeRegimeInputDegradation(
  dataMap: Map<string, Record<string, unknown>>,
): RegimeInputDegradation {
  const missingSymbols: string[] = [];
  const syntheticSymbols: string[] = [];

  for (const def of PULSE_SYMBOLS) {
    const entry = dataMap.get(def.display);
    const priced = entry && typeof entry["lastPrice"] === "number";
    if (!priced) {
      missingSymbols.push(def.display);
      continue;
    }
    if (entry?.["synthetic"] === true) syntheticSymbols.push(def.display);
  }

  return {
    missingSymbols,
    syntheticSymbols,
    breadthIsProxy: syntheticSymbols.some((s) => s.startsWith("$ADVN") || s.startsWith("$DECN") || s.startsWith("$UVOL")),
    vixFutureMissing: !dataMap.get("/VX"),
  };
}
