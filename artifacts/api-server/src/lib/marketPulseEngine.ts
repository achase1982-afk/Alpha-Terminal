// ============================================================
// MARKET PULSE DETERMINISTIC SCORING ENGINE v2.0
// ============================================================
// 27 symbols across 7 clusters. All math is deterministic.
// Gemini only consumes the output for narrative. Gemini does NOT do math.
// ============================================================

// ---------- TYPES ----------

export type ClusterName = 'rates' | 'credit' | 'volLevel' | 'volTerm' | 'breadth' | 'riskAppetite' | 'macro';

export interface IndicatorConfig {
  symbol: string;
  cluster: ClusterName;
  enabled: boolean;
  label: string;
}

export const INDICATOR_CONFIG: IndicatorConfig[] = [
  { symbol: '$TNX',   cluster: 'rates',        enabled: true, label: '10Y Yield' },
  { symbol: '$TYX',   cluster: 'rates',        enabled: true, label: '30Y Yield' },
  { symbol: '/ZB',    cluster: 'rates',        enabled: true, label: '30Y Treasury Futures' },
  { symbol: '/ZT',    cluster: 'rates',        enabled: true, label: '2Y Treasury Futures' },

  { symbol: 'HYG',    cluster: 'credit',       enabled: true, label: 'HY Corporate Bond ETF' },
  { symbol: 'LQD',    cluster: 'credit',       enabled: true, label: 'IG Corporate Bond ETF' },
  { symbol: 'IEF',    cluster: 'credit',       enabled: true, label: '7-10Y Treasury ETF' },

  { symbol: '$VIX',   cluster: 'volLevel',     enabled: true, label: 'CBOE Volatility Index' },
  { symbol: '$VVIX',  cluster: 'volLevel',     enabled: true, label: 'VIX of VIX' },

  { symbol: '$VIX9D', cluster: 'volTerm',      enabled: true, label: 'CBOE 9-Day VIX' },
  { symbol: '$VIX3M', cluster: 'volTerm',      enabled: true, label: 'CBOE 3-Month VIX' },
  { symbol: '$SKEW',  cluster: 'volTerm',      enabled: true, label: 'CBOE Skew Index' },

  { symbol: '$ADVN',  cluster: 'breadth',      enabled: true, label: 'NYSE Advancing Issues' },
  { symbol: '$DECN',  cluster: 'breadth',      enabled: true, label: 'NYSE Declining Issues' },
  { symbol: '$TRIN',  cluster: 'breadth',      enabled: true, label: 'Arms Index' },
  { symbol: '$TICK',  cluster: 'breadth',      enabled: true, label: 'NYSE Tick' },
  { symbol: '$ADD',   cluster: 'breadth',      enabled: true, label: 'NYSE Advance-Decline' },

  { symbol: '/ES',    cluster: 'riskAppetite', enabled: true, label: 'E-mini S&P 500' },
  { symbol: '/NQ',    cluster: 'riskAppetite', enabled: true, label: 'E-mini Nasdaq 100' },
  { symbol: '/YM',    cluster: 'riskAppetite', enabled: true, label: 'Mini Dow Jones' },
  { symbol: '/RTY',   cluster: 'riskAppetite', enabled: true, label: 'E-mini Russell 2000' },

  { symbol: '/GC',    cluster: 'macro',        enabled: true, label: 'Gold Futures' },
  { symbol: '/CL',    cluster: 'macro',        enabled: true, label: 'WTI Crude Oil' },
  { symbol: '/BZ',    cluster: 'macro',        enabled: true, label: 'Brent Crude Oil' },
  { symbol: '/ZQ',    cluster: 'macro',        enabled: true, label: '30-Day Fed Funds' },
  // $UVOL, $DVOL, $TVOL removed -- Schwab does not serve these symbols
  // HYD removed -- redundant with HYG and LQD
];

export interface MarketIndicators {
  vix: number | null;
  vixChange: number | null;
  vvix: number | null;
  vvixChange: number | null;
  vix3m: number | null;
  vix3mChange: number | null;
  vix9d: number | null;
  vix9dChange: number | null;
  skew: number | null;

  tnx: number | null;
  tnxChange: number | null;
  tyx: number | null;
  tyxChange: number | null;
  zb: number | null;
  zbChange: number | null;
  zt: number | null;
  ztChange: number | null;

  hyg: number | null;
  hygChange: number | null;
  lqd: number | null;
  lqdChange: number | null;
  ief: number | null;
  iefChange: number | null;

  advn: number | null;
  decn: number | null;
  tick: number | null;
  trin: number | null;
  add: number | null;

  es: number | null;
  esChange: number | null;
  nq: number | null;
  nqChange: number | null;
  ym: number | null;
  ymChange: number | null;
  rty: number | null;
  rtyChange: number | null;

  gc: number | null;
  gcChange: number | null;
  cl: number | null;
  clChange: number | null;
  bz: number | null;
  bzChange: number | null;
  zq: number | null;
  zqChange: number | null;

  dataTimestamps?: Record<string, number>;
}

export type DataQuality = 'FRESH' | 'STALE' | 'MISSING';
export type BiasLabel = 'STRONGLY_BULLISH' | 'MODERATELY_BULLISH' | 'SLIGHTLY_BULLISH' | 'NEUTRAL' | 'SLIGHTLY_BEARISH' | 'MODERATELY_BEARISH' | 'STRONGLY_BEARISH' | 'NO_EDGE';
export type Direction = 'UP' | 'DOWN' | 'FLAT' | 'COMPRESSING' | 'EXPANDING' | 'CONTANGO' | 'INVERTED' | 'POSITIVE' | 'NEGATIVE';
export type RiskState = 'PRESS' | 'NORMAL' | 'REDUCED' | 'NO_TRADE';
export type RegimeLabel = 'RISK_ON' | 'RISK_OFF' | 'TRANSITION' | 'NO_READ';
export type TodayEdge = 'BULLISH_EDGE' | 'BEARISH_EDGE' | 'NEUTRAL_EDGE' | 'NO_EDGE';
export type SizeRecommendation = 'FULL_SIZE' | 'HALF_SIZE' | 'NO_TRADE';

export interface ClusterResult {
  score: number;
  dataQuality: DataQuality;
  direction: Direction;
  headline: string;
  keyDataPoints: string[];
  rulesApplied: string[];
}

export interface EngineOutput {
  timestamp: string;
  engineVersion: string;
  clusters: Record<ClusterName, ClusterResult>;
  compositeScore: number;
  bias: BiasLabel;
  confidenceScore: number;
  maxConfidence: number;
  todayEdge: TodayEdge;
  sizeRecommendation: SizeRecommendation;
  hasDivergence: boolean;
  divergenceNote: string | null;
  structuralRegime: RegimeLabel;
  riskState: RiskState;
  riskReason: string;
  levelsToWatch: Array<{
    symbol: string;
    level: number;
    direction: 'ABOVE' | 'BELOW';
    significance: string;
  }>;
  weights: Record<ClusterName, number>;
}

// ---------- CONSTANTS ----------

const ENGINE_VERSION = 'v2.0.0';
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

const CLUSTER_WEIGHTS: Record<ClusterName, number> = {
  rates:        20,
  credit:       15,
  volLevel:     15,
  volTerm:      10,
  breadth:      15,
  riskAppetite: 15,
  macro:        10,
};

// ---------- HELPERS ----------

function checkDataQuality(
  value: number | null,
  timestampMs?: number
): DataQuality {
  if (value === null || value === undefined) return 'MISSING';
  if (timestampMs) {
    const age = Date.now() - timestampMs;
    if (age > STALE_THRESHOLD_MS) return 'STALE';
  }
  return 'FRESH';
}

function clamp(score: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(score * 100) / 100));
}

function fmt(val: number | null, prefix: string, suffix: string = ''): string {
  if (val === null) return `${prefix} N/A`;
  return `${prefix} ${val > 0 ? '+' : ''}${val.toFixed(2)}${suffix}`;
}

function worstOf(qualities: DataQuality[]): DataQuality {
  if (qualities.includes('MISSING')) return 'STALE';
  if (qualities.includes('STALE')) return 'STALE';
  return 'FRESH';
}

// ---------- CLUSTER 1: RATES (Weight 20) ----------

function scoreRates(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];

  const tnxQ = checkDataQuality(data.tnx);
  const tyxQ = checkDataQuality(data.tyx);
  const zbQ = checkDataQuality(data.zb);
  const ztQ = checkDataQuality(data.zt);

  if (tnxQ === 'MISSING' && tyxQ === 'MISSING' && zbQ === 'MISSING' && ztQ === 'MISSING') {
    return { score: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Rates data unavailable', keyDataPoints: [], rulesApplied: ['All rates data missing'] };
  }

  if (data.tnxChange !== null) {
    if (data.tnxChange <= -1.0) { score += 1.0; rules.push('TNX down >1%: +1.0'); }
    else if (data.tnxChange <= -0.5) { score += 0.75; rules.push('TNX down 0.5-1%: +0.75'); }
    else if (data.tnxChange <= -0.1) { score += 0.5; rules.push('TNX down 0.1-0.5%: +0.5'); }
    else if (data.tnxChange >= 1.0) { score -= 1.0; rules.push('TNX up >1%: -1.0'); }
    else if (data.tnxChange >= 0.5) { score -= 0.75; rules.push('TNX up 0.5-1%: -0.75'); }
    else if (data.tnxChange >= 0.1) { score -= 0.5; rules.push('TNX up 0.1-0.5%: -0.5'); }
    points.push(fmt(data.tnxChange, '$TNX', '%'));
  }

  if (data.tyxChange !== null && data.tnxChange !== null) {
    const sameDir = (data.tnxChange > 0 && data.tyxChange > 0) || (data.tnxChange < 0 && data.tyxChange < 0);
    if (!sameDir && Math.abs(data.tnxChange) > 0.1 && Math.abs(data.tyxChange) > 0.1) {
      score -= 0.25;
      rules.push('TNX/TYX divergence: -0.25');
    }
    points.push(fmt(data.tyxChange, '$TYX', '%'));
  } else if (data.tyxChange !== null) {
    points.push(fmt(data.tyxChange, '$TYX', '%'));
  }

  if (data.zbChange !== null && data.ztChange !== null) {
    const bondsRallying = data.zbChange > 0 && data.ztChange > 0;
    const bondsSelling = data.zbChange < 0 && data.ztChange < 0;

    if (score > 0 && bondsRallying) { score += 0.25; rules.push('Bond futures confirm yield decline: +0.25'); }
    else if (score > 0 && bondsSelling) { score -= 0.25; rules.push('Bond futures contradict yield decline: -0.25'); }
    else if (score < 0 && bondsSelling) { score -= 0.25; rules.push('Bond futures confirm yield rise: -0.25'); }
    else if (score < 0 && bondsRallying) { score += 0.25; rules.push('Bond futures contradict yield rise: +0.25'); }
    points.push(fmt(data.zbChange, '/ZB', '%'));
    points.push(fmt(data.ztChange, '/ZT', '%'));
  } else {
    if (data.zbChange !== null) points.push(fmt(data.zbChange, '/ZB', '%'));
    if (data.ztChange !== null) points.push(fmt(data.ztChange, '/ZT', '%'));
  }

  const finalScore = clamp(score, -2.0, 2.0);
  const direction: Direction = finalScore > 0.25 ? 'DOWN' : finalScore < -0.25 ? 'UP' : 'FLAT';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Yields falling sharply, strong risk-on signal';
  else if (finalScore >= 0.5) headline = 'Yields declining, supportive for equities';
  else if (finalScore <= -1.5) headline = 'Yields surging, risk-off pressure';
  else if (finalScore <= -0.5) headline = 'Yields rising, headwind for equities';
  else headline = 'Yields relatively stable, neutral signal';

  return { score: finalScore, dataQuality: worstOf([tnxQ, tyxQ, zbQ, ztQ]), direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- CLUSTER 2: CREDIT (Weight 15) ----------

function scoreCredit(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];

  const hygQ = checkDataQuality(data.hyg);
  const lqdQ = checkDataQuality(data.lqd);
  const iefQ = checkDataQuality(data.ief);

  if (hygQ === 'MISSING' && lqdQ === 'MISSING' && iefQ === 'MISSING') {
    return { score: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Credit data unavailable', keyDataPoints: [], rulesApplied: ['All credit data missing'] };
  }

  if (data.hygChange !== null) {
    if (data.hygChange > 0.5) { score += 2.0; rules.push('HYG up >0.5%: +2.0'); }
    else if (data.hygChange > 0.2) { score += 1.0; rules.push('HYG up 0.2-0.5%: +1.0'); }
    else if (data.hygChange < -0.5) { score -= 2.0; rules.push('HYG down >0.5%: -2.0'); }
    else if (data.hygChange < -0.2) { score -= 1.0; rules.push('HYG down 0.2-0.5%: -1.0'); }
    points.push(fmt(data.hygChange, 'HYG', '%'));
  }

  if (data.lqdChange !== null) {
    if (data.lqdChange > 0.3) { score += 0.5; rules.push('LQD up >0.3%: +0.5'); }
    else if (data.lqdChange < -0.3) { score -= 0.5; rules.push('LQD down >0.3%: -0.5'); }
    points.push(fmt(data.lqdChange, 'LQD', '%'));
  }

  if (data.iefChange !== null) {
    if (data.iefChange > 0.3) { score += 0.25; rules.push('IEF up >0.3%: +0.25'); }
    else if (data.iefChange < -0.3) { score -= 0.25; rules.push('IEF down >0.3%: -0.25'); }
    points.push(fmt(data.iefChange, 'IEF', '%'));
  }

  const finalScore = clamp(score, -2.0, 2.0);
  const direction: Direction = finalScore > 0.25 ? 'UP' : finalScore < -0.25 ? 'DOWN' : 'FLAT';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Credit surging, strong risk-on confirmation';
  else if (finalScore >= 0.5) headline = 'Credit improving, supportive backdrop';
  else if (finalScore <= -1.5) headline = 'Credit deteriorating sharply, risk-off';
  else if (finalScore <= -0.5) headline = 'Credit weakening, caution warranted';
  else headline = 'Credit stable, neutral signal';

  return { score: finalScore, dataQuality: worstOf([hygQ, lqdQ, iefQ]), direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- CLUSTER 3: VOL LEVEL (Weight 15) ----------

function scoreVolLevel(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];

  const vixQ = checkDataQuality(data.vix);
  if (vixQ === 'MISSING') {
    return { score: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Volatility data unavailable', keyDataPoints: [], rulesApplied: ['VIX data missing'] };
  }

  if (data.vix !== null) {
    if (data.vix < 15) { score += 0.5; rules.push('VIX <15 (low vol): +0.5'); }
    else if (data.vix < 20) { score += 0.25; rules.push('VIX 15-20 (normal): +0.25'); }
    else if (data.vix < 25) { /* neutral */ }
    else if (data.vix < 30) { score -= 0.5; rules.push('VIX 25-30 (high): -0.5'); }
    else if (data.vix < 35) { score -= 1.0; rules.push('VIX 30-35 (very high): -1.0'); }
    else { score -= 1.5; rules.push('VIX >35 (extreme): -1.5'); }
    points.push(`$VIX ${data.vix.toFixed(2)}`);
  }

  if (data.vixChange !== null) {
    if (data.vixChange <= -5) { score += 1.5; rules.push('VIX down >5% intraday: +1.5'); }
    else if (data.vixChange <= -3) { score += 0.75; rules.push('VIX down 3-5% intraday: +0.75'); }
    else if (data.vixChange >= 5) { score -= 1.5; rules.push('VIX up >5% intraday: -1.5'); }
    else if (data.vixChange >= 3) { score -= 0.75; rules.push('VIX up 3-5% intraday: -0.75'); }
    points.push(fmt(data.vixChange, '$VIX change', '%'));
  }

  if (data.vvixChange !== null) {
    if (data.vvixChange <= -3) { score += 0.5; rules.push('VVIX down >3%: +0.5'); }
    else if (data.vvixChange >= 3) { score -= 0.5; rules.push('VVIX up >3%: -0.5'); }
    points.push(fmt(data.vvixChange, '$VVIX change', '%'));
  }

  const finalScore = clamp(score, -2.5, 2.5);
  const direction: Direction = finalScore > 0.25 ? 'COMPRESSING' : finalScore < -0.25 ? 'EXPANDING' : 'FLAT';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Vol compressing sharply, strong risk-on';
  else if (finalScore >= 0.5) headline = 'Vol declining, reduced market fear';
  else if (finalScore <= -1.5) headline = 'Vol expanding sharply, elevated fear';
  else if (finalScore <= -0.5) headline = 'Vol rising, increasing uncertainty';
  else headline = 'Volatility stable, neutral signal';

  return { score: finalScore, dataQuality: vixQ, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- CLUSTER 4: VOL TERM (Weight 10) ----------

function scoreVolTerm(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];

  const vixQ = checkDataQuality(data.vix);
  const vix9dQ = checkDataQuality(data.vix9d);

  if (vixQ === 'MISSING' || (vix9dQ === 'MISSING' && checkDataQuality(data.vix3m) === 'MISSING')) {
    return { score: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Term structure data unavailable', keyDataPoints: [], rulesApplied: ['Insufficient term structure data'] };
  }

  if (data.vix9d !== null && data.vix !== null) {
    if (data.vix9d < data.vix) { score += 1.0; rules.push('VIX9D < VIX (contango): +1.0'); }
    else if (data.vix9d > data.vix * 1.05) { score -= 1.0; rules.push('VIX9D > VIX (backwardation): -1.0'); }
    points.push(`$VIX9D ${data.vix9d.toFixed(2)} vs $VIX ${data.vix.toFixed(2)}`);
  }

  if (data.skew !== null) {
    if (data.skew > 150) { score -= 1.0; rules.push(`SKEW ${data.skew.toFixed(2)} (>150 extreme tail risk): -1.0`); }
    else if (data.skew > 140) { score -= 0.5; rules.push(`SKEW ${data.skew.toFixed(2)} (140-150 elevated tail risk): -0.5`); }
    else if (data.skew < 110) { score += 0.25; rules.push(`SKEW ${data.skew.toFixed(2)} (<110 low tail demand): +0.25`); }
    points.push(`$SKEW ${data.skew.toFixed(2)}`);
  }

  if (data.vix3m !== null) {
    points.push(`$VIX3M ${data.vix3m.toFixed(2)}`);
  }

  const finalScore = clamp(score, -2.0, 2.0);
  const direction: Direction = finalScore > 0.25 ? 'CONTANGO' : finalScore < -0.25 ? 'INVERTED' : 'FLAT';

  let headline = '';
  if (finalScore >= 1.0) headline = 'Term structure healthy, no near-term panic';
  else if (finalScore >= 0.25) headline = 'Term structure mostly normal';
  else if (finalScore <= -1.0) headline = 'Term structure inverted, hedging demand elevated';
  else if (finalScore <= -0.25) headline = 'Term structure showing caution';
  else headline = 'Term structure flat, inconclusive';

  return { score: finalScore, dataQuality: vix9dQ === 'MISSING' ? 'STALE' : vix9dQ, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- CLUSTER 5: BREADTH (Weight 15) ----------

function scoreBreadth(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];

  const hasAny = data.advn !== null || data.decn !== null || data.tick !== null || data.trin !== null;
  if (!hasAny) {
    return { score: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Breadth data unavailable', keyDataPoints: [], rulesApplied: ['All breadth data missing'] };
  }

  if (data.advn !== null && data.decn !== null && data.decn > 0) {
    const adRatio = data.advn / data.decn;
    if (adRatio > 3) { score += 2.0; rules.push(`AD ratio ${adRatio.toFixed(2)} (>3): +2.0`); }
    else if (adRatio > 2) { score += 1.5; rules.push(`AD ratio ${adRatio.toFixed(2)} (2-3): +1.5`); }
    else if (adRatio > 1.5) { score += 0.75; rules.push(`AD ratio ${adRatio.toFixed(2)} (1.5-2): +0.75`); }
    else if (adRatio < 0.33) { score -= 2.0; rules.push(`AD ratio ${adRatio.toFixed(2)} (<0.33): -2.0`); }
    else if (adRatio < 0.5) { score -= 1.5; rules.push(`AD ratio ${adRatio.toFixed(2)} (0.33-0.5): -1.5`); }
    else if (adRatio < 0.67) { score -= 0.75; rules.push(`AD ratio ${adRatio.toFixed(2)} (0.5-0.67): -0.75`); }
    points.push(`$ADVN ${data.advn}`, `$DECN ${data.decn}`);
  }

  if (data.trin !== null) {
    if (data.trin < 0.5) { score += 1.0; rules.push(`TRIN ${data.trin.toFixed(4)} (<0.5 strongly bullish vol breadth): +1.0`); }
    else if (data.trin < 1.0) { score += 0.5; rules.push(`TRIN ${data.trin.toFixed(4)} (0.5-1.0 bullish vol breadth): +0.5`); }
    else if (data.trin >= 1.5 && data.trin < 2.0) { score -= 0.5; rules.push(`TRIN ${data.trin.toFixed(4)} (1.5-2.0 mildly bearish): -0.5`); }
    else if (data.trin >= 2.0 && data.trin < 2.5) { score -= 1.0; rules.push(`TRIN ${data.trin.toFixed(4)} (2.0-2.5 bearish): -1.0`); }
    else if (data.trin >= 2.5 && data.trin < 3.0) { score -= 1.5; rules.push(`TRIN ${data.trin.toFixed(4)} (2.5-3.0 very bearish): -1.5`); }
    else if (data.trin >= 3.0) { score -= 2.0; rules.push(`TRIN ${data.trin.toFixed(4)} (>=3.0 extreme bearish): -2.0`); }
    points.push(`$TRIN ${data.trin.toFixed(4)}`);
  }

  if (data.trin !== null && data.trin >= 3.0 && score > 0) {
    score = 0;
    rules.push('TRIN >=3.0 cluster cap: score clamped to 0');
  }

  if (data.tick !== null) {
    if (data.tick > 500) { score += 0.5; rules.push(`TICK ${data.tick} (>500): +0.5`); }
    else if (data.tick < -500) { score -= 0.5; rules.push(`TICK ${data.tick} (<-500): -0.5`); }
    points.push(`$TICK ${data.tick}`);
  }

  if (data.add !== null) {
    points.push(`$ADD ${data.add}`);
  }

  const finalScore = clamp(score, -3.0, 3.0);
  const direction: Direction = finalScore > 0.25 ? 'POSITIVE' : finalScore < -0.25 ? 'NEGATIVE' : 'FLAT';

  const freshCount = [data.advn, data.decn, data.tick, data.trin, data.add].filter(v => v !== null).length;
  const dataQuality: DataQuality = freshCount >= 3 ? 'FRESH' : freshCount >= 1 ? 'STALE' : 'MISSING';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Breadth strongly bullish, broad participation';
  else if (finalScore >= 0.5) headline = 'Breadth positive, healthy internals';
  else if (finalScore <= -1.5) headline = 'Breadth deeply negative, broad selling';
  else if (finalScore <= -0.5) headline = 'Breadth weak, limited participation';
  else headline = 'Breadth mixed, no clear signal';

  return { score: finalScore, dataQuality, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- CLUSTER 6: RISK APPETITE (Weight 15) ----------

function scoreRiskAppetite(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];

  const changes = [data.esChange, data.nqChange, data.rtyChange, data.ymChange].filter(c => c !== null) as number[];
  if (changes.length < 2) {
    return { score: 0, dataQuality: changes.length === 0 ? 'MISSING' : 'STALE', direction: 'FLAT', headline: 'Risk appetite data insufficient', keyDataPoints: [], rulesApplied: ['Insufficient futures data'] };
  }

  const allPositive = changes.every(c => c > 0);
  const allNegative = changes.every(c => c < 0);
  const avg = changes.reduce((a, b) => a + b, 0) / changes.length;

  if (allPositive && avg > 1.0) { score += 1.5; rules.push(`All futures up, avg +${avg.toFixed(2)}%: +1.5`); }
  else if (allPositive && avg > 0.5) { score += 1.0; rules.push(`All futures up, avg +${avg.toFixed(2)}%: +1.0`); }
  else if (allPositive) { score += 0.5; rules.push(`All futures up, avg +${avg.toFixed(2)}%: +0.5`); }
  else if (allNegative && avg < -1.0) { score -= 1.5; rules.push(`All futures down, avg ${avg.toFixed(2)}%: -1.5`); }
  else if (allNegative && avg < -0.5) { score -= 1.0; rules.push(`All futures down, avg ${avg.toFixed(2)}%: -1.0`); }
  else if (allNegative) { score -= 0.5; rules.push(`All futures down, avg ${avg.toFixed(2)}%: -0.5`); }

  if (data.rtyChange !== null && data.esChange !== null) {
    const rtyVsEs = data.rtyChange - data.esChange;
    if (rtyVsEs > 0.5) { score += 0.5; rules.push(`RTY outperforming ES by ${rtyVsEs.toFixed(2)}%: +0.5`); }
    else if (rtyVsEs < -0.5) { score -= 0.5; rules.push(`RTY underperforming ES by ${Math.abs(rtyVsEs).toFixed(2)}%: -0.5`); }
  }

  if (data.nqChange !== null && data.esChange !== null && data.rtyChange !== null && data.ymChange !== null) {
    const nqVsOthers = data.nqChange - ((data.esChange + data.rtyChange + data.ymChange) / 3);
    if (nqVsOthers > 1.0) { score -= 0.25; rules.push(`NQ leading others by ${nqVsOthers.toFixed(2)}% (narrow): -0.25`); }
  }

  if (data.esChange !== null) points.push(fmt(data.esChange, '/ES', '%'));
  if (data.nqChange !== null) points.push(fmt(data.nqChange, '/NQ', '%'));
  if (data.ymChange !== null) points.push(fmt(data.ymChange, '/YM', '%'));
  if (data.rtyChange !== null) points.push(fmt(data.rtyChange, '/RTY', '%'));

  const finalScore = clamp(score, -2.0, 2.0);
  const direction: Direction = finalScore > 0.25 ? 'POSITIVE' : finalScore < -0.25 ? 'NEGATIVE' : 'FLAT';
  const freshCount = [data.es, data.nq, data.ym, data.rty].filter(v => v !== null).length;
  const dataQuality: DataQuality = freshCount >= 3 ? 'FRESH' : freshCount >= 1 ? 'STALE' : 'MISSING';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Equity futures surging, strong risk-on';
  else if (finalScore >= 0.5) headline = 'Equity futures positive, risk appetite healthy';
  else if (finalScore <= -1.5) headline = 'Equity futures selling off, risk aversion';
  else if (finalScore <= -0.5) headline = 'Equity futures weak, cautious positioning';
  else headline = 'Equity futures mixed, no clear direction';

  return { score: finalScore, dataQuality, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- CLUSTER 7: MACRO (Weight 10) ----------

function scoreMacro(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];

  const hasAny = data.gc !== null || data.cl !== null || data.bz !== null || data.zq !== null;
  if (!hasAny) {
    return { score: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Macro data unavailable', keyDataPoints: [], rulesApplied: ['All macro data missing'] };
  }

  if (data.gcChange !== null) {
    if (data.gcChange > 1.5) { score -= 0.5; rules.push(`Gold up ${data.gcChange.toFixed(2)}% (risk-off hedging): -0.5`); }
    else if (data.gcChange > 0.75) { score -= 0.25; rules.push(`Gold up ${data.gcChange.toFixed(2)}% (mild caution): -0.25`); }
    else if (data.gcChange < -0.75) { score += 0.25; rules.push(`Gold down ${data.gcChange.toFixed(2)}% (risk-on): +0.25`); }
    points.push(fmt(data.gcChange, '/GC', '%'));
  }

  if (data.clChange !== null && data.bzChange !== null) {
    const avgOil = (data.clChange + data.bzChange) / 2;
    if (avgOil > 2.0) { score -= 0.5; rules.push(`Oil avg up ${avgOil.toFixed(2)}% (inflation/supply risk): -0.5`); }
    else if (avgOil < -2.0) { score -= 0.5; rules.push(`Oil avg down ${avgOil.toFixed(2)}% (demand destruction): -0.5`); }
    else if (avgOil < -1.0) { score -= 0.25; rules.push(`Oil avg down ${avgOil.toFixed(2)}% (demand concern): -0.25`); }
    points.push(fmt(data.clChange, '/CL', '%'));
    points.push(fmt(data.bzChange, '/BZ', '%'));
  } else {
    if (data.clChange !== null) points.push(fmt(data.clChange, '/CL', '%'));
    if (data.bzChange !== null) points.push(fmt(data.bzChange, '/BZ', '%'));
  }

  if (data.zqChange !== null) {
    if (data.zqChange > 0.01) { score += 0.5; rules.push('Fed funds up (dovish shift): +0.5'); }
    else if (data.zqChange < -0.01) { score -= 0.5; rules.push('Fed funds down (hawkish shift): -0.5'); }
    points.push(fmt(data.zqChange, '/ZQ', '%'));
  }

  const finalScore = clamp(score, -1.5, 1.5);
  const direction: Direction = finalScore > 0.25 ? 'POSITIVE' : finalScore < -0.25 ? 'NEGATIVE' : 'FLAT';
  const freshCount = [data.gc, data.cl, data.bz, data.zq].filter(v => v !== null).length;
  const dataQuality: DataQuality = freshCount >= 2 ? 'FRESH' : freshCount >= 1 ? 'STALE' : 'MISSING';

  let headline = '';
  if (finalScore >= 0.5) headline = 'Macro signals supportive, pro-risk commodities';
  else if (finalScore >= 0.25) headline = 'Macro slightly positive, constructive backdrop';
  else if (finalScore <= -0.5) headline = 'Macro headwinds, safe-haven bids / demand concerns';
  else if (finalScore <= -0.25) headline = 'Macro slightly negative, caution warranted';
  else headline = 'Macro neutral, no strong directional signal';

  return { score: finalScore, dataQuality, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- COMPOSITE, CONFIDENCE, BIAS ----------

function calculateComposite(clusters: Record<ClusterName, ClusterResult>): number {
  let composite = 0;
  for (const [name, cluster] of Object.entries(clusters) as [ClusterName, ClusterResult][]) {
    const weight = CLUSTER_WEIGHTS[name] / 100;
    composite += cluster.score * weight;
  }
  return Math.round(composite * 100) / 100;
}

function calculateConfidence(clusters: Record<ClusterName, ClusterResult>, composite: number): number {
  let confidence = Math.min(100, Math.round(Math.abs(composite) * 40));

  const scores = Object.values(clusters).map(c => c.score);
  const positiveCount = scores.filter(s => s > 0).length;
  const negativeCount = scores.filter(s => s < 0).length;
  const disagreementPairs = Math.min(positiveCount, negativeCount);
  const disagreementPenalty = disagreementPairs * 10;
  confidence = Math.max(0, confidence - disagreementPenalty);

  return confidence;
}

function determineBias(composite: number, confidence: number): BiasLabel {
  if (composite > 1.75 && confidence >= 75) return 'STRONGLY_BULLISH';
  if (composite > 0.75) return 'MODERATELY_BULLISH';
  if (composite > 0.25) return 'SLIGHTLY_BULLISH';
  if (composite >= -0.25) return 'NEUTRAL';
  if (composite >= -0.75) return 'SLIGHTLY_BEARISH';
  if (composite >= -1.75) return 'MODERATELY_BEARISH';
  if (composite < -1.75 && confidence >= 75) return 'STRONGLY_BEARISH';
  return 'NEUTRAL';
}

function determineTodayEdge(composite: number, confidence: number): TodayEdge {
  if (confidence < 40) return 'NO_EDGE';
  if (composite > 0.5) return 'BULLISH_EDGE';
  if (composite < -0.5) return 'BEARISH_EDGE';
  return 'NEUTRAL_EDGE';
}

function determineSizeRecommendation(confidence: number): SizeRecommendation {
  if (confidence < 40) return 'NO_TRADE';
  if (confidence < 60) return 'HALF_SIZE';
  return 'FULL_SIZE';
}

function detectDivergence(clusters: Record<ClusterName, ClusterResult>): { has: boolean; note: string | null } {
  const entries = Object.entries(clusters) as [string, ClusterResult][];
  const bullish = entries.filter(([_, c]) => c.score >= 1.0);
  const bearish = entries.filter(([_, c]) => c.score <= -1.0);

  if (bullish.length > 0 && bearish.length > 0) {
    const bullNames = bullish.map(([n]) => n).join(', ');
    const bearNames = bearish.map(([n]) => n).join(', ');
    return { has: true, note: `Signal conflict: ${bullNames} bullish vs ${bearNames} bearish. Mixed signals reduce conviction.` };
  }
  return { has: false, note: null };
}

function determineRegime(clusters: Record<ClusterName, ClusterResult>, composite: number): RegimeLabel {
  const freshCount = Object.values(clusters).filter(c => c.dataQuality === 'FRESH').length;
  if (freshCount < 3) return 'NO_READ';
  if (composite >= 0.5) return 'RISK_ON';
  if (composite <= -0.5) return 'RISK_OFF';
  return 'TRANSITION';
}

function determineRiskState(composite: number, confidence: number, hasDivergence: boolean): { state: RiskState; reason: string } {
  if (confidence < 40) return { state: 'NO_TRADE', reason: 'Insufficient data or confidence for positioning' };
  if (hasDivergence) return { state: 'REDUCED', reason: 'Cross-asset divergence warrants reduced exposure' };
  if (Math.abs(composite) >= 1.0 && confidence >= 70) return { state: 'PRESS', reason: 'Strong aligned signals with high confidence support full positioning' };
  if (Math.abs(composite) >= 0.5) return { state: 'NORMAL', reason: 'Moderate signal strength supports standard positioning' };
  return { state: 'REDUCED', reason: 'Weak or mixed signals warrant reduced exposure' };
}

function generateLevelsToWatch(data: MarketIndicators, clusters: Record<ClusterName, ClusterResult>): EngineOutput['levelsToWatch'] {
  const levels: EngineOutput['levelsToWatch'] = [];

  if (data.vix !== null) {
    if (clusters.volLevel.score > 0) {
      levels.push({ symbol: '$VIX', level: Math.ceil(data.vix + 2), direction: 'ABOVE', significance: 'VIX reversal above this level would signal renewed fear' });
    } else {
      levels.push({ symbol: '$VIX', level: Math.floor(data.vix - 2), direction: 'BELOW', significance: 'VIX break below this level would confirm fear subsiding' });
    }
  }

  if (data.tnx !== null) {
    levels.push({
      symbol: '$TNX',
      level: Math.round((data.tnx + (clusters.rates.score > 0 ? 1.0 : -1.0)) * 100) / 100,
      direction: clusters.rates.score > 0 ? 'ABOVE' : 'BELOW',
      significance: clusters.rates.score > 0 ? 'Yield reversal above this level would negate rates tailwind' : 'Yield break below this level would flip rates supportive',
    });
  }

  if (data.hyg !== null) {
    levels.push({ symbol: 'HYG', level: Math.round((data.hyg - 0.3) * 100) / 100, direction: 'BELOW', significance: 'Break below this level would signal credit deterioration' });
  }

  if (data.es !== null) {
    levels.push({
      symbol: '/ES',
      level: Math.round(data.es * (clusters.riskAppetite.score > 0 ? 0.99 : 1.01)),
      direction: clusters.riskAppetite.score > 0 ? 'BELOW' : 'ABOVE',
      significance: clusters.riskAppetite.score > 0 ? 'Break below this level would negate risk-on thesis' : 'Break above this level would negate risk-off thesis',
    });
  }

  return levels;
}

// ---------- MAIN ENGINE FUNCTION ----------

export function runMarketPulseEngine(
  data: MarketIndicators,
  _previousBias?: BiasLabel
): EngineOutput {
  const clusters: Record<ClusterName, ClusterResult> = {
    rates: scoreRates(data),
    credit: scoreCredit(data),
    volLevel: scoreVolLevel(data),
    volTerm: scoreVolTerm(data),
    breadth: scoreBreadth(data),
    riskAppetite: scoreRiskAppetite(data),
    macro: scoreMacro(data),
  };

  const compositeScore = calculateComposite(clusters);
  const confidenceScore = calculateConfidence(clusters, compositeScore);

  const bias: BiasLabel = confidenceScore < 40 ? 'NO_EDGE' : determineBias(compositeScore, confidenceScore);
  const todayEdge = determineTodayEdge(compositeScore, confidenceScore);
  const sizeRecommendation = determineSizeRecommendation(confidenceScore);
  const divergence = detectDivergence(clusters);
  const structuralRegime = determineRegime(clusters, compositeScore);
  const { state: riskState, reason: riskReason } = determineRiskState(compositeScore, confidenceScore, divergence.has);
  const levelsToWatch = generateLevelsToWatch(data, clusters);

  return {
    timestamp: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    clusters,
    compositeScore,
    bias,
    confidenceScore,
    maxConfidence: 100,
    todayEdge,
    sizeRecommendation,
    hasDivergence: divergence.has,
    divergenceNote: divergence.note,
    structuralRegime,
    riskState,
    riskReason,
    levelsToWatch,
    weights: CLUSTER_WEIGHTS,
  };
}
