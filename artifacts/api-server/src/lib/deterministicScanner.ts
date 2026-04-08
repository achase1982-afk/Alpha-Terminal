import { checkEventConflicts, getUpcomingEvents } from "./calendarEventChecker.js";
import { logFailure } from "./telemetry.js";

const SCHWAB_API = "https://api.schwabapi.com/marketdata/v1";
const SCHWAB_TRADER = "https://api.schwabapi.com/trader/v1";

interface Candle {
  close: number;
  volume: number;
  datetime: number;
}

interface QuoteData {
  symbol: string;
  lastPrice: number;
  netPercentChange: number;
  totalVolume: number;
  averageVolume10Day?: number;
  averageVolume?: number;
}

interface OptionsChainSummary {
  atmBid: number;
  atmAsk: number;
  atmMid: number;
  atmSpreadPct: number;
  ivr: number;
  atmIV: number;
  totalCallVolume: number;
  totalPutVolume: number;
  avgDailyOptionsVolume: number;
  hasWeeklyOptions: boolean;
}

export interface FilterResult {
  symbol: string;
  passed: boolean;
  reason?: string;
}

export interface ComponentScores {
  trendAlignment: number;
  relativeStrength: number;
  volumeConfirmation: number;
  ivrScore: number;
  optionsLiquidity: number;
}

export interface ScanCandidate {
  symbol: string;
  totalScore: number;
  components: ComponentScores;
  price: number;
  changePct: number;
  sector: string;
  keyStatLabel: string;
  keyStatValue: string;
  ivr: number;
  atmIV: number;
  atmSpreadPct: number;
  hasWeeklyOptions: boolean;
  upcomingEvents: Array<{ date: string; title: string; importance: string }>;
  microOverrideEligible: boolean;
  pulseComposite: number;
  pulseConfidence: number;
  pulseBias: string;
}

export interface ScanResult {
  candidates: ScanCandidate[];
  filterSummary: {
    totalScanned: number;
    passedFilters: number;
    scoredAboveThreshold: number;
    filterDetails: FilterResult[];
  };
  scanTimestamp: number;
  pulseBias: string;
  pulseComposite: number;
  pulseConfidence: number;
}

const SECTOR_MAP: Record<string, string> = {
  AAPL: "Technology", MSFT: "Technology", NVDA: "Technology", AMZN: "Consumer Discretionary", META: "Technology",
  GOOGL: "Technology", GOOG: "Technology", TSLA: "Consumer Discretionary", AVGO: "Technology", NFLX: "Communication Services",
  AMD: "Technology", CRM: "Technology", ORCL: "Technology", ADBE: "Technology", INTU: "Technology",
  NOW: "Technology", QCOM: "Technology", TXN: "Technology", AMAT: "Technology", MU: "Technology",
  LRCX: "Technology", PANW: "Technology", KLAC: "Technology", SNPS: "Technology", CDNS: "Technology",
  JPM: "Financials", BAC: "Financials", WFC: "Financials", GS: "Financials", MS: "Financials",
  SCHW: "Financials", C: "Financials", BLK: "Financials", SPGI: "Financials", CME: "Financials",
  ICE: "Financials", MCO: "Financials", AXP: "Financials", V: "Financials", MA: "Financials",
  UNH: "Healthcare", LLY: "Healthcare", ABBV: "Healthcare", MRK: "Healthcare", PFE: "Healthcare",
  JNJ: "Healthcare", ABT: "Healthcare", TMO: "Healthcare", ISRG: "Healthcare", SYK: "Healthcare",
  VRTX: "Healthcare", REGN: "Healthcare", AMGN: "Healthcare", BSX: "Healthcare", HCA: "Healthcare",
  DHR: "Healthcare", ZTS: "Healthcare", DXCM: "Healthcare", IDXX: "Healthcare", BIIB: "Healthcare",
  XOM: "Energy", CVX: "Energy", SLB: "Energy", FANG: "Energy", BKR: "Energy",
  PG: "Consumer Staples", KO: "Consumer Staples", PEP: "Consumer Staples", COST: "Consumer Staples",
  WMT: "Consumer Staples", CL: "Consumer Staples", MDLZ: "Consumer Staples", MCD: "Consumer Discretionary",
  HD: "Consumer Discretionary", LOW: "Consumer Discretionary", TGT: "Consumer Discretionary", SBUX: "Consumer Discretionary",
  BKNG: "Consumer Discretionary", ABNB: "Consumer Discretionary", DASH: "Consumer Discretionary",
  NEE: "Utilities", SO: "Utilities", DUK: "Utilities", AEP: "Utilities", XEL: "Utilities", EXC: "Utilities",
  LIN: "Materials", CAT: "Industrials", GE: "Industrials", DE: "Industrials", RTX: "Industrials",
  UNP: "Industrials", ETN: "Industrials", PH: "Industrials", WM: "Industrials",
  T: "Communication Services", VZ: "Communication Services", CMCSA: "Communication Services", TMUS: "Communication Services",
  PM: "Consumer Staples", BRK: "Financials", "BRK.B": "Financials",
  COIN: "Financials", MSTR: "Technology", PLTR: "Technology", CRWD: "Technology", NET: "Technology",
  DDOG: "Technology", SNOW: "Technology", SHOP: "Technology", SQ: "Financials",
  SOFI: "Financials", HOOD: "Financials", RIVN: "Consumer Discretionary", LCID: "Consumer Discretionary",
  SMCI: "Technology", ARM: "Technology", CEG: "Utilities", APP: "Technology", WDAY: "Technology",
  GME: "Consumer Discretionary", AMC: "Communication Services", MARA: "Financials", RIOT: "Financials",
  PYPL: "Financials", FI: "Financials", CB: "Financials", PGR: "Financials", MMC: "Financials",
};

function getSector(symbol: string): string {
  return SECTOR_MAP[symbol.toUpperCase()] ?? "Other";
}

async function fetchQuotesBatch(symbols: string[], accessToken: string): Promise<Map<string, QuoteData>> {
  const result = new Map<string, QuoteData>();
  const batchSize = 50;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const symbolList = batch.join(",");
    try {
      const res = await fetch(
        `${SCHWAB_API}/quotes?symbols=${encodeURIComponent(symbolList)}&fields=quote`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) {
        void logFailure("SCANNER", "WARN", `Scanner quote batch fetch failed: HTTP ${res.status}`, { endpoint: "/quotes", batchIndex: i, status: res.status });
        continue;
      }
      const json = await res.json() as Record<string, unknown>;
      for (const sym of batch) {
        const entry = json[sym] as Record<string, unknown> | undefined;
        const q = entry?.["quote"] as Record<string, unknown> | undefined;
        if (!q || !((q["lastPrice"] as number) > 0)) continue;
        result.set(sym, {
          symbol: sym,
          lastPrice: (q["lastPrice"] as number) ?? 0,
          netPercentChange: (q["netPercentChangeInDouble"] as number) ?? 0,
          totalVolume: (q["totalVolume"] as number) ?? 0,
          averageVolume10Day: (q["averageVolume10Day"] as number) ?? undefined,
          averageVolume: (q["averageVolume"] as number) ?? undefined,
        });
      }
    } catch { /* continue with next batch */ }
  }
  return result;
}

async function fetchPriceHistory(symbol: string, accessToken: string): Promise<Candle[]> {
  try {
    const params = new URLSearchParams({
      symbol,
      periodType: "month",
      period: "3",
      frequencyType: "daily",
      frequency: "1",
      needExtendedHoursData: "false",
    });
    const res = await fetch(`${SCHWAB_API}/pricehistory?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const json = await res.json() as { candles?: Array<Record<string, unknown>> };
    return (json.candles ?? []).map(c => ({
      close: (c["close"] as number) ?? 0,
      volume: (c["volume"] as number) ?? 0,
      datetime: (c["datetime"] as number) ?? 0,
    }));
  } catch {
    return [];
  }
}

async function fetchOptionsChainSummary(symbol: string, accessToken: string): Promise<OptionsChainSummary | null> {
  try {
    const params = new URLSearchParams({
      symbol,
      contractType: "ALL",
      strikeCount: "10",
      includeUnderlyingQuote: "true",
    });
    const res = await fetch(`${SCHWAB_API}/chains?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json() as Record<string, unknown>;
    const underlyingPrice = (json["underlyingPrice"] as number) ?? 0;
    if (underlyingPrice <= 0) return null;

    let atmBid = 0, atmAsk = 0, atmIV = 0;
    let totalCallVol = 0, totalPutVol = 0;
    let minStrikeDiff = Infinity;
    let allIVs: number[] = [];
    let expirationCount = 0;
    let totalContracts = 0;

    const processMap = (map: unknown, putCall: "CALL" | "PUT") => {
      if (!map || typeof map !== "object") return;
      for (const [, strikes] of Object.entries(map as Record<string, unknown>)) {
        expirationCount++;
        for (const [, opts] of Object.entries(strikes as Record<string, unknown>)) {
          for (const o of (opts as Array<Record<string, unknown>>)) {
            const strike = (o["strikePrice"] as number) ?? 0;
            const bid = (o["bid"] as number) ?? 0;
            const ask = (o["ask"] as number) ?? 0;
            const vol = (o["totalVolume"] as number) ?? 0;
            const iv = (o["volatility"] as number) ?? 0;

            totalContracts++;
            if (putCall === "CALL") totalCallVol += vol; else totalPutVol += vol;
            if (iv > 0 && iv < 900) allIVs.push(iv);

            const diff = Math.abs(strike - underlyingPrice);
            if (diff < minStrikeDiff && putCall === "CALL") {
              minStrikeDiff = diff;
              atmBid = bid;
              atmAsk = ask;
              atmIV = iv > 0 && iv < 900 ? iv : 0;
            }
          }
        }
      }
    };

    processMap(json["callExpDateMap"], "CALL");
    processMap(json["putExpDateMap"], "PUT");

    const atmMid = (atmBid + atmAsk) / 2;
    const atmSpreadPct = atmMid > 0 ? ((atmAsk - atmBid) / atmMid) * 100 : 100;

    allIVs.sort((a, b) => a - b);
    const ivr = allIVs.length >= 2
      ? Math.round(((atmIV - allIVs[0]) / (allIVs[allIVs.length - 1] - allIVs[0])) * 100)
      : 50;

    const hasWeeklyOptions = expirationCount > 4;

    return {
      atmBid, atmAsk, atmMid, atmSpreadPct,
      ivr: Math.max(0, Math.min(100, ivr)),
      atmIV: atmIV > 0 ? Math.round(atmIV * 100) / 100 : 0,
      totalCallVolume: totalCallVol,
      totalPutVolume: totalPutVol,
      avgDailyOptionsVolume: totalCallVol + totalPutVol,
      hasWeeklyOptions,
    };
  } catch {
    return null;
  }
}

async function fetchPortfolioSymbols(accessToken: string): Promise<Set<string>> {
  const held = new Set<string>();
  try {
    const traderRes = await fetch(`${SCHWAB_TRADER}/accounts?fields=positions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!traderRes.ok) return held;
    const accounts = await traderRes.json() as Array<Record<string, unknown>>;
    for (const acct of accounts) {
      const sa = acct["securitiesAccount"] as Record<string, unknown> | undefined;
      if (!sa) continue;
      const positions = (sa["positions"] as Array<Record<string, unknown>>) ?? [];
      for (const p of positions) {
        const inst = p["instrument"] as Record<string, unknown> | undefined;
        if (!inst) continue;
        const sym = (inst["underlyingSymbol"] as string) ?? (inst["symbol"] as string) ?? "";
        if (sym) held.add(sym.toUpperCase());
      }
    }
  } catch { /* ignore */ }
  return held;
}

function computeSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function computeAvgVolume(volumes: number[], period: number): number | null {
  if (volumes.length < period) return null;
  const slice = volumes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function computePercentChange(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const current = closes[closes.length - 1];
  const prior = closes[closes.length - 1 - days];
  if (prior <= 0) return null;
  return ((current - prior) / prior) * 100;
}

interface PulseContext {
  composite: number;
  confidence: number;
  bias: string;
}

function isBullishBias(bias: string): boolean {
  return bias.includes("BULLISH");
}

function isBearishBias(bias: string): boolean {
  return bias.includes("BEARISH");
}

function scoreTrendAlignment(
  price: number, sma20: number | null, sma50: number | null, pulse: PulseContext
): number {
  if (sma20 === null || sma50 === null) return 0;
  const bullish = isBullishBias(pulse.bias);
  const bearish = isBearishBias(pulse.bias);

  let aligned = 0;
  if (bullish) {
    if (price > sma20) aligned++;
    if (price > sma50) aligned++;
  } else if (bearish) {
    if (price < sma20) aligned++;
    if (price < sma50) aligned++;
  } else {
    if (price > sma20) aligned++;
    if (price > sma50) aligned++;
  }

  if (aligned === 2) return 25;
  if (aligned === 1) return 13;
  return 0;
}

function scoreRelativeStrength(
  tickerChange5d: number | null, spyChange5d: number | null, pulse: PulseContext
): { score: number; confirmed: boolean } {
  if (tickerChange5d === null || spyChange5d === null) return { score: 0, confirmed: false };

  const bullish = isBullishBias(pulse.bias);
  const bearish = isBearishBias(pulse.bias);

  let outperformance = 0;
  if (bullish) {
    outperformance = tickerChange5d - spyChange5d;
  } else if (bearish) {
    outperformance = spyChange5d - tickerChange5d;
  } else {
    outperformance = Math.abs(tickerChange5d) > Math.abs(spyChange5d)
      ? Math.abs(tickerChange5d) - Math.abs(spyChange5d) : 0;
  }

  const confirmed = outperformance > 0;
  const score = Math.round(Math.max(0, Math.min(20, outperformance * 4)));
  return { score, confirmed };
}

function scoreVolumeConfirmation(todayVolume: number, avgVolume: number | null): { score: number; ratio: number } {
  if (!avgVolume || avgVolume <= 0) return { score: 0, ratio: 0 };
  const ratio = todayVolume / avgVolume;
  if (ratio >= 1.5) return { score: 20, ratio };
  if (ratio >= 1.0) return { score: Math.round(((ratio - 1.0) / 0.5) * 20), ratio };
  return { score: 0, ratio };
}

function scoreIVR(ivr: number, pulse: PulseContext): number {
  const bullish = isBullishBias(pulse.bias);
  const bearish = isBearishBias(pulse.bias);

  const premiumSelling = pulse.composite > 0
    ? ivr >= 30
    : ivr >= 50;

  if (premiumSelling) {
    return Math.round(Math.min(20, (ivr / 100) * 20));
  } else {
    return Math.round(Math.min(20, ((100 - ivr) / 100) * 20));
  }
}

function scoreOptionsLiquidity(chain: OptionsChainSummary | null): number {
  if (!chain) return 0;
  let score = 0;
  const optionsVol = chain.totalCallVolume + chain.totalPutVolume;
  if (optionsVol >= 10000) score += 8;
  else if (optionsVol >= 1000) score += Math.round((optionsVol / 10000) * 8);

  if (chain.atmSpreadPct <= 2) score += 7;
  else if (chain.atmSpreadPct <= 5) score += Math.round(((5 - chain.atmSpreadPct) / 3) * 7);
  else if (chain.atmSpreadPct <= 10) score += Math.round(((10 - chain.atmSpreadPct) / 5) * 3);

  return Math.min(15, score);
}

export async function runDeterministicScan(
  symbols: string[],
  accessToken: string,
  traderToken: string | null,
  pulse: PulseContext,
  log: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void },
): Promise<ScanResult> {
  const scanStart = Date.now();

  const quoteMap = await fetchQuotesBatch(symbols, accessToken);

  const portfolioSymbols = traderToken
    ? await fetchPortfolioSymbols(traderToken)
    : new Set<string>();

  const filterResults: FilterResult[] = [];
  const passedSymbols: string[] = [];

  for (const sym of symbols) {
    const quote = quoteMap.get(sym);

    if (!quote) {
      filterResults.push({ symbol: sym, passed: false, reason: "No quote data available" });
      continue;
    }

    const evCheck = checkEventConflicts(sym, 5, "BULL_PUT_SPREAD", null);
    const hasNearEarnings = evCheck.eventConflicts.some(c => c.eventType === "earnings");
    if (hasNearEarnings) {
      filterResults.push({ symbol: sym, passed: false, reason: "Earnings within 5 trading days" });
      continue;
    }

    if (portfolioSymbols.has(sym.toUpperCase())) {
      filterResults.push({ symbol: sym, passed: false, reason: "Open position in portfolio" });
      continue;
    }

    filterResults.push({ symbol: sym, passed: true });
    passedSymbols.push(sym);
  }

  log.info({ total: symbols.length, passed: passedSymbols.length, filtered: symbols.length - passedSymbols.length }, "Scanner Stage 1: Universe filter complete");

  let spyCandles: Candle[] = [];
  try {
    spyCandles = await fetchPriceHistory("SPY", accessToken);
  } catch { /* ignore */ }
  const spyCloses = spyCandles.map(c => c.close);
  const spyChange5d = computePercentChange(spyCloses, 5);

  const concurrency = 5;
  const scoredResults: Array<{
    symbol: string;
    totalScore: number;
    components: ComponentScores;
    quote: QuoteData;
    chain: OptionsChainSummary | null;
    candles: Candle[];
    volumeRatio: number;
    rsConfirmed: boolean;
  }> = [];

  for (let i = 0; i < passedSymbols.length; i += concurrency) {
    const batch = passedSymbols.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (sym) => {
        const quote = quoteMap.get(sym)!;
        const [candles, chain] = await Promise.all([
          fetchPriceHistory(sym, accessToken),
          fetchOptionsChainSummary(sym, accessToken),
        ]);

        if (!chain) {
          const idx = filterResults.findIndex(f => f.symbol === sym);
          if (idx >= 0) {
            filterResults[idx] = { symbol: sym, passed: false, reason: "Options chain unavailable — cannot validate liquidity" };
          }
          return null;
        }

        if (chain.atmSpreadPct > 10) {
          const idx = filterResults.findIndex(f => f.symbol === sym);
          if (idx >= 0) {
            filterResults[idx] = { symbol: sym, passed: false, reason: `ATM spread too wide (${chain.atmSpreadPct.toFixed(1)}%)` };
          }
          return null;
        }

        const closes = candles.map(c => c.close);
        const volumes = candles.map(c => c.volume);

        if (closes.length < 50) {
          const idx = filterResults.findIndex(f => f.symbol === sym);
          if (idx >= 0) {
            filterResults[idx] = { symbol: sym, passed: false, reason: "Insufficient price history (<50 days)" };
          }
          return null;
        }

        const sma20 = computeSMA(closes, 20);
        const sma50 = computeSMA(closes, 50);
        const avgVol20 = computeAvgVolume(volumes, 20);
        const tickerChange5d = computePercentChange(closes, 5);

        const trendAlignment = scoreTrendAlignment(quote.lastPrice, sma20, sma50, pulse);
        const { score: relativeStrength, confirmed: rsConfirmed } = scoreRelativeStrength(tickerChange5d, spyChange5d, pulse);
        const { score: volumeConfirmation, ratio: volumeRatio } = scoreVolumeConfirmation(quote.totalVolume, avgVol20);
        const ivrScore = scoreIVR(chain?.ivr ?? 50, pulse);
        const optionsLiquidity = scoreOptionsLiquidity(chain);

        const totalScore = Math.round(trendAlignment + relativeStrength + volumeConfirmation + ivrScore + optionsLiquidity);

        return {
          symbol: sym,
          totalScore,
          components: { trendAlignment, relativeStrength, volumeConfirmation, ivrScore, optionsLiquidity },
          quote,
          chain,
          candles,
          volumeRatio,
          rsConfirmed,
        };
      })
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        scoredResults.push(r.value);
      }
    }
  }

  log.info({ scored: scoredResults.length }, "Scanner Stage 2: Technical scoring complete");

  scoredResults.sort((a, b) => b.totalScore - a.totalScore);
  const aboveThreshold = scoredResults.filter(r => r.totalScore >= 60);
  const top5 = aboveThreshold.slice(0, 5);

  log.info({ aboveThreshold: aboveThreshold.length, top5: top5.length }, "Scanner Stage 3: Ranking complete");

  const candidates: ScanCandidate[] = top5.map(r => {
    const upcoming = getUpcomingEvents(30).filter(e =>
      e.title.toLowerCase().includes(r.symbol.toLowerCase()) || e.importance === "HIGH"
    ).slice(0, 5).map(e => ({ date: e.date, title: e.title, importance: e.importance }));

    const tickerEvents = checkEventConflicts(r.symbol, 30, "BULL_PUT_SPREAD", null);
    const tickerSpecificEvents = tickerEvents.eventConflicts
      .filter(c => c.ticker?.toUpperCase() === r.symbol.toUpperCase())
      .map(c => ({ date: c.date, title: c.eventTitle, importance: c.importance }));

    const allUpcoming = [...tickerSpecificEvents, ...upcoming]
      .filter((v, i, a) => a.findIndex(e => e.date === v.date && e.title === v.title) === i)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);

    let keyStatLabel = "";
    let keyStatValue = "";
    const maxComponent = Object.entries(r.components).reduce((a, b) => a[1] > b[1] ? a : b);
    if (maxComponent[0] === "volumeConfirmation" && r.volumeRatio > 1) {
      keyStatLabel = "Volume";
      keyStatValue = `${r.volumeRatio.toFixed(1)}x avg`;
    } else if (maxComponent[0] === "ivrScore" && r.chain) {
      keyStatLabel = "IVR";
      keyStatValue = `${r.chain.ivr.toFixed(1)}%`;
    } else if (maxComponent[0] === "trendAlignment") {
      keyStatLabel = "Trend";
      keyStatValue = "Aligned";
    } else if (maxComponent[0] === "relativeStrength") {
      keyStatLabel = "RS";
      keyStatValue = `vs SPY`;
    } else {
      keyStatLabel = "Score";
      keyStatValue = `${Math.round(r.totalScore)}`;
    }

    const isBullishSetup = r.quote.netPercentChange > 0;
    const pulseBullish = isBullishBias(pulse.bias);
    const pulseBearish = isBearishBias(pulse.bias);
    const inverseToMacro = (pulseBullish && !isBullishSetup) || (pulseBearish && isBullishSetup);

    const microOverrideEligible =
      r.totalScore >= 90 &&
      r.volumeRatio >= 1.5 &&
      r.rsConfirmed &&
      !inverseToMacro;

    return {
      symbol: r.symbol,
      totalScore: r.totalScore,
      components: r.components,
      price: r.quote.lastPrice,
      changePct: r.quote.netPercentChange,
      sector: getSector(r.symbol),
      keyStatLabel,
      keyStatValue,
      ivr: Math.round((r.chain?.ivr ?? 0) * 10) / 10,
      atmIV: r.chain?.atmIV ?? 0,
      atmSpreadPct: r.chain?.atmSpreadPct ?? 0,
      hasWeeklyOptions: r.chain?.hasWeeklyOptions ?? false,
      upcomingEvents: allUpcoming,
      microOverrideEligible,
      pulseComposite: pulse.composite,
      pulseConfidence: pulse.confidence,
      pulseBias: pulse.bias,
    };
  });

  log.info({ candidates: candidates.length, scanMs: Date.now() - scanStart }, "Scanner Stage 4: Enrichment complete");

  if (candidates.length === 0 && symbols.length > 0) {
    void logFailure("SCANNER", "INFO", `Scanner returned 0 candidates from ${symbols.length} symbols`, { totalScanned: symbols.length, passedFilters: scoredResults.length, aboveThreshold: aboveThreshold.length });
  }

  const passedCount = filterResults.filter(f => f.passed).length;
  const actualPassedAfterChainFilter = scoredResults.length;

  return {
    candidates,
    filterSummary: {
      totalScanned: symbols.length,
      passedFilters: actualPassedAfterChainFilter,
      scoredAboveThreshold: aboveThreshold.length,
      filterDetails: filterResults,
    },
    scanTimestamp: Date.now(),
    pulseBias: pulse.bias,
    pulseComposite: pulse.composite,
    pulseConfidence: pulse.confidence,
  };
}
