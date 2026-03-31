// ============================================================
// MARKET PULSE DETERMINISTIC SCORING ENGINE v1.0
// ============================================================
// This file contains NO AI calls. It is pure math and rules.
// Same input ALWAYS produces the same output.
// ============================================================

// ---------- TYPES ----------

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

  hyg: number | null;
  hygChange: number | null;
  lqd: number | null;
  lqdChange: number | null;
  ief: number | null;
  iefChange: number | null;
  nyicdx: number | null;
  nyicdxChange: number | null;

  advn: number | null;
  decn: number | null;
  tick: number | null;
  trin: number | null;
  add: number | null;

  uvol: number | null;
  dvol: number | null;

  dataTimestamps?: Record<string, number>;
}

export type DataQuality = 'FRESH' | 'STALE' | 'MISSING';
export type BiasLabel = 'STRONGLY_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONGLY_BEARISH' | 'NO_EDGE';
export type Direction = 'UP' | 'DOWN' | 'FLAT' | 'COMPRESSING' | 'EXPANDING' | 'CONTANGO' | 'INVERTED' | 'POSITIVE' | 'NEGATIVE';
export type RiskState = 'PRESS' | 'NORMAL' | 'REDUCED' | 'NO_TRADE';
export type RegimeLabel = 'RISK_ON' | 'RISK_OFF' | 'TRANSITION' | 'NO_READ';

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
  clusters: {
    rates: ClusterResult;
    credit: ClusterResult;
    volLevel: ClusterResult;
    volTermStructure: ClusterResult;
    breadth: ClusterResult;
  };
  compositeScore: number;
  bias: BiasLabel;
  confidenceScore: number;
  maxConfidence: number;
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
}

// ---------- CONSTANTS ----------

const ENGINE_VERSION = 'v1.0.0';
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

const WEIGHTS = {
  rates: 0.25,
  credit: 0.20,
  volLevel: 0.20,
  volTermStructure: 0.15,
  breadth: 0.20,
} as const;

const BIAS_THRESHOLDS = {
  STRONGLY_BULLISH: { enter: 1.00, exit: 0.85 },
  BULLISH:          { enter: 0.30, exit: 0.15 },
  NEUTRAL:          { enter: -0.29, exit: -0.29 },
  BEARISH:          { enter: -0.30, exit: -0.15 },
  STRONGLY_BEARISH: { enter: -1.00, exit: -0.85 },
} as const;

// ---------- HELPER FUNCTIONS ----------

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

function clampScore(score: number): number {
  return Math.max(-2, Math.min(2, Math.round(score * 4) / 4));
}

function fmt(val: number | null, prefix: string, suffix: string = ''): string {
  if (val === null) return `${prefix} N/A`;
  return `${prefix} ${val > 0 ? '+' : ''}${val.toFixed(2)}${suffix}`;
}

// ---------- CLUSTER SCORING FUNCTIONS ----------

function scoreRates(data: MarketIndicators): ClusterResult {
  const rules: string[] = [];
  let score = 0;
  const points: string[] = [];

  const tnxQ = checkDataQuality(data.tnx);
  const tyxQ = checkDataQuality(data.tyx);

  if (tnxQ === 'MISSING' && tyxQ === 'MISSING') {
    return {
      score: 0, dataQuality: 'MISSING', direction: 'FLAT',
      headline: 'Rates data unavailable', keyDataPoints: [], rulesApplied: ['All rates data missing'],
    };
  }

  if (data.tnxChange !== null) {
    if (data.tnxChange <= -2.0) { score += 2.0; rules.push('TNX down >2%: +2.0'); }
    else if (data.tnxChange <= -1.0) { score += 1.5; rules.push('TNX down 1-2%: +1.5'); }
    else if (data.tnxChange <= -0.5) { score += 1.0; rules.push('TNX down 0.5-1%: +1.0'); }
    else if (data.tnxChange <= -0.1) { score += 0.5; rules.push('TNX down 0.1-0.5%: +0.5'); }
    else if (data.tnxChange >= 2.0) { score -= 2.0; rules.push('TNX up >2%: -2.0'); }
    else if (data.tnxChange >= 1.0) { score -= 1.5; rules.push('TNX up 1-2%: -1.5'); }
    else if (data.tnxChange >= 0.5) { score -= 1.0; rules.push('TNX up 0.5-1%: -1.0'); }
    else if (data.tnxChange >= 0.1) { score -= 0.5; rules.push('TNX up 0.1-0.5%: -0.5'); }
    else { rules.push('TNX flat: 0'); }
    points.push(fmt(data.tnxChange, '$TNX', '%'));
  }

  if (data.tyxChange !== null) {
    if (data.tyxChange <= -1.0) { score += 0.5; rules.push('TYX down >1%: +0.5 (confirming)'); }
    else if (data.tyxChange >= 1.0) { score -= 0.5; rules.push('TYX up >1%: -0.5 (confirming)'); }
    points.push(fmt(data.tyxChange, '$TYX', '%'));
  }

  const finalScore = clampScore(score);
  const direction: Direction = finalScore > 0.25 ? 'DOWN' : finalScore < -0.25 ? 'UP' : 'FLAT';
  const worstQuality = tnxQ === 'MISSING' || tyxQ === 'MISSING' ? 'STALE' :
                       tnxQ === 'STALE' || tyxQ === 'STALE' ? 'STALE' : 'FRESH';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Yields falling sharply, strong risk-on signal';
  else if (finalScore >= 0.5) headline = 'Yields declining, supportive for equities';
  else if (finalScore <= -1.5) headline = 'Yields surging, risk-off pressure';
  else if (finalScore <= -0.5) headline = 'Yields rising, headwind for equities';
  else headline = 'Yields relatively stable, neutral signal';

  return { score: finalScore, dataQuality: worstQuality, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

function scoreCredit(data: MarketIndicators): ClusterResult {
  const rules: string[] = [];
  let score = 0;
  const points: string[] = [];

  const hygQ = checkDataQuality(data.hyg);
  const lqdQ = checkDataQuality(data.lqd);
  const iefQ = checkDataQuality(data.ief);

  if (hygQ === 'MISSING' && lqdQ === 'MISSING' && iefQ === 'MISSING') {
    return {
      score: 0, dataQuality: 'MISSING', direction: 'FLAT',
      headline: 'Credit data unavailable', keyDataPoints: [], rulesApplied: ['All credit data missing'],
    };
  }

  if (data.hygChange !== null) {
    if (data.hygChange >= 0.5) { score += 2.0; rules.push('HYG up >0.5%: +2.0'); }
    else if (data.hygChange >= 0.2) { score += 1.0; rules.push('HYG up 0.2-0.5%: +1.0'); }
    else if (data.hygChange >= 0.05) { score += 0.5; rules.push('HYG up 0.05-0.2%: +0.5'); }
    else if (data.hygChange <= -0.5) { score -= 2.0; rules.push('HYG down >0.5%: -2.0'); }
    else if (data.hygChange <= -0.2) { score -= 1.0; rules.push('HYG down 0.2-0.5%: -1.0'); }
    else if (data.hygChange <= -0.05) { score -= 0.5; rules.push('HYG down 0.05-0.2%: -0.5'); }
    else { rules.push('HYG flat: 0'); }
    points.push(fmt(data.hygChange, 'HYG', '%'));
  }

  if (data.lqdChange !== null) {
    if (data.lqdChange >= 0.3) { score += 0.5; rules.push('LQD up >0.3%: +0.5'); }
    else if (data.lqdChange <= -0.3) { score -= 0.5; rules.push('LQD down >0.3%: -0.5'); }
    points.push(fmt(data.lqdChange, 'LQD', '%'));
  }

  if (data.iefChange !== null) {
    if (data.iefChange >= 0.3) { score += 0.5; rules.push('IEF up >0.3%: +0.5'); }
    else if (data.iefChange <= -0.3) { score -= 0.5; rules.push('IEF down >0.3%: -0.5'); }
    points.push(fmt(data.iefChange, 'IEF', '%'));
  }

  const finalScore = clampScore(score);
  const direction: Direction = finalScore > 0.25 ? 'UP' : finalScore < -0.25 ? 'DOWN' : 'FLAT';
  const worstQuality = [hygQ, lqdQ, iefQ].includes('MISSING') ? 'STALE' :
                       [hygQ, lqdQ, iefQ].includes('STALE') ? 'STALE' : 'FRESH';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Credit surging, strong risk-on confirmation';
  else if (finalScore >= 0.5) headline = 'Credit improving, supportive backdrop';
  else if (finalScore <= -1.5) headline = 'Credit deteriorating sharply, risk-off';
  else if (finalScore <= -0.5) headline = 'Credit weakening, caution warranted';
  else headline = 'Credit stable, neutral signal';

  return { score: finalScore, dataQuality: worstQuality, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

function scoreVolLevel(data: MarketIndicators): ClusterResult {
  const rules: string[] = [];
  let score = 0;
  const points: string[] = [];

  const vixQ = checkDataQuality(data.vix);

  if (vixQ === 'MISSING') {
    return {
      score: 0, dataQuality: 'MISSING', direction: 'FLAT',
      headline: 'Volatility data unavailable', keyDataPoints: [], rulesApplied: ['VIX data missing'],
    };
  }

  if (data.vix !== null) {
    if (data.vix < 15) { score += 1.0; rules.push('VIX < 15 (low fear): +1.0'); }
    else if (data.vix < 20) { score += 0.5; rules.push('VIX 15-20 (moderate): +0.5'); }
    else if (data.vix < 25) { score += 0.0; rules.push('VIX 20-25 (elevated): 0'); }
    else if (data.vix < 30) { score -= 0.5; rules.push('VIX 25-30 (high): -0.5'); }
    else if (data.vix < 35) { score -= 1.0; rules.push('VIX 30-35 (very high): -1.0'); }
    else { score -= 1.5; rules.push('VIX >= 35 (extreme fear): -1.5'); }
    points.push(`$VIX ${data.vix.toFixed(2)}`);
  }

  if (data.vixChange !== null) {
    if (data.vixChange <= -5.0) { score += 1.5; rules.push('VIX down >5% intraday: +1.5'); }
    else if (data.vixChange <= -3.0) { score += 1.0; rules.push('VIX down 3-5%: +1.0'); }
    else if (data.vixChange <= -1.0) { score += 0.5; rules.push('VIX down 1-3%: +0.5'); }
    else if (data.vixChange >= 5.0) { score -= 1.5; rules.push('VIX up >5% intraday: -1.5'); }
    else if (data.vixChange >= 3.0) { score -= 1.0; rules.push('VIX up 3-5%: -1.0'); }
    else if (data.vixChange >= 1.0) { score -= 0.5; rules.push('VIX up 1-3%: -0.5'); }
    points.push(fmt(data.vixChange, '$VIX change', '%'));
  }

  if (data.vvixChange !== null) {
    if (data.vvixChange <= -3.0) { score += 0.5; rules.push('VVIX down >3%: +0.5'); }
    else if (data.vvixChange >= 3.0) { score -= 0.5; rules.push('VVIX up >3%: -0.5'); }
    points.push(fmt(data.vvixChange, '$VVIX change', '%'));
  }

  const finalScore = clampScore(score);
  const direction: Direction = finalScore > 0.25 ? 'COMPRESSING' : finalScore < -0.25 ? 'EXPANDING' : 'FLAT';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Vol compressing sharply, strong risk-on';
  else if (finalScore >= 0.5) headline = 'Vol declining, reduced market fear';
  else if (finalScore <= -1.5) headline = 'Vol expanding sharply, elevated fear';
  else if (finalScore <= -0.5) headline = 'Vol rising, increasing uncertainty';
  else headline = 'Volatility stable, neutral signal';

  return { score: finalScore, dataQuality: vixQ, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

function scoreVolTermStructure(data: MarketIndicators): ClusterResult {
  const rules: string[] = [];
  let score = 0;
  const points: string[] = [];

  const vixQ = checkDataQuality(data.vix);
  const vix9dQ = checkDataQuality(data.vix9d);
  const vix3mQ = checkDataQuality(data.vix3m);

  if (vixQ === 'MISSING' || (vix9dQ === 'MISSING' && vix3mQ === 'MISSING')) {
    return {
      score: 0, dataQuality: 'MISSING', direction: 'FLAT',
      headline: 'Term structure data unavailable', keyDataPoints: [], rulesApplied: ['Insufficient term structure data'],
    };
  }

  if (data.vix9d !== null && data.vix !== null) {
    const spread9d = data.vix9d - data.vix;
    if (spread9d < -2.0) { score += 1.5; rules.push('VIX9D << VIX (strong contango): +1.5'); }
    else if (spread9d < -0.5) { score += 1.0; rules.push('VIX9D < VIX (contango): +1.0'); }
    else if (spread9d < 0.5) { score += 0.0; rules.push('VIX9D ~ VIX (flat): 0'); }
    else if (spread9d < 2.0) { score -= 1.0; rules.push('VIX9D > VIX (mild inversion): -1.0'); }
    else { score -= 1.5; rules.push('VIX9D >> VIX (strong inversion): -1.5'); }
    points.push(`$VIX9D ${data.vix9d.toFixed(2)} vs $VIX ${data.vix.toFixed(2)}`);
  }

  if (data.vix3m !== null && data.vix !== null) {
    const spread3m = data.vix - data.vix3m;
    if (spread3m < -3.0) { score += 1.0; rules.push('VIX << VIX3M (strong contango): +1.0'); }
    else if (spread3m < -1.0) { score += 0.5; rules.push('VIX < VIX3M (contango): +0.5'); }
    else if (spread3m > 3.0) { score -= 1.0; rules.push('VIX >> VIX3M (strong backwardation): -1.0'); }
    else if (spread3m > 1.0) { score -= 0.5; rules.push('VIX > VIX3M (backwardation): -0.5'); }
    points.push(`$VIX3M ${data.vix3m.toFixed(2)}`);
  }

  if (data.skew !== null) {
    if (data.skew > 145) { score -= 0.5; rules.push('SKEW > 145 (tail hedging): -0.5'); }
    else if (data.skew < 120) { score += 0.25; rules.push('SKEW < 120 (complacent): +0.25'); }
    points.push(`$SKEW ${data.skew.toFixed(2)}`);
  }

  const finalScore = clampScore(score);
  const direction: Direction = finalScore > 0.25 ? 'CONTANGO' : finalScore < -0.25 ? 'INVERTED' : 'FLAT';

  let headline = '';
  if (finalScore >= 1.0) headline = 'Term structure healthy, no near-term panic';
  else if (finalScore >= 0.25) headline = 'Term structure mostly normal';
  else if (finalScore <= -1.0) headline = 'Term structure inverted, hedging demand elevated';
  else if (finalScore <= -0.25) headline = 'Term structure showing caution';
  else headline = 'Term structure flat, inconclusive';

  return {
    score: finalScore, dataQuality: vix9dQ === 'MISSING' ? 'STALE' : vix9dQ, direction, headline,
    keyDataPoints: points, rulesApplied: rules,
  };
}

function scoreBreadth(data: MarketIndicators): ClusterResult {
  const rules: string[] = [];
  let score = 0;
  const points: string[] = [];

  const hasAny = data.advn !== null || data.decn !== null || data.tick !== null || data.trin !== null;
  if (!hasAny) {
    return {
      score: 0, dataQuality: 'MISSING', direction: 'FLAT',
      headline: 'Breadth data unavailable', keyDataPoints: [], rulesApplied: ['All breadth data missing'],
    };
  }

  if (data.advn !== null && data.decn !== null && data.decn > 0) {
    const adRatio = data.advn / data.decn;
    if (adRatio >= 3.0) { score += 2.0; rules.push(`AD ratio ${adRatio.toFixed(2)} (>3.0): +2.0`); }
    else if (adRatio >= 2.0) { score += 1.5; rules.push(`AD ratio ${adRatio.toFixed(2)} (2-3): +1.5`); }
    else if (adRatio >= 1.3) { score += 0.75; rules.push(`AD ratio ${adRatio.toFixed(2)} (1.3-2): +0.75`); }
    else if (adRatio >= 0.8) { score += 0.0; rules.push(`AD ratio ${adRatio.toFixed(2)} (0.8-1.3): 0`); }
    else if (adRatio >= 0.5) { score -= 0.75; rules.push(`AD ratio ${adRatio.toFixed(2)} (0.5-0.8): -0.75`); }
    else if (adRatio >= 0.33) { score -= 1.5; rules.push(`AD ratio ${adRatio.toFixed(2)} (0.33-0.5): -1.5`); }
    else { score -= 2.0; rules.push(`AD ratio ${adRatio.toFixed(2)} (<0.33): -2.0`); }
    points.push(`$ADVN ${data.advn}`, `$DECN ${data.decn}`);
  }

  if (data.trin !== null) {
    if (data.trin < 0.5) { score += 1.0; rules.push(`TRIN ${data.trin.toFixed(2)} (<0.5): +1.0`); }
    else if (data.trin < 0.8) { score += 0.5; rules.push(`TRIN ${data.trin.toFixed(2)} (0.5-0.8): +0.5`); }
    else if (data.trin <= 1.2) { rules.push(`TRIN ${data.trin.toFixed(2)} (0.8-1.2): 0`); }
    else if (data.trin <= 2.0) { score -= 0.5; rules.push(`TRIN ${data.trin.toFixed(2)} (1.2-2.0): -0.5`); }
    else { score -= 1.0; rules.push(`TRIN ${data.trin.toFixed(2)} (>2.0): -1.0`); }
    points.push(`$TRIN ${data.trin.toFixed(4)}`);
  }

  if (data.tick !== null) {
    if (data.tick > 500) { score += 0.5; rules.push(`TICK ${data.tick} (>500): +0.5`); }
    else if (data.tick < -500) { score -= 0.5; rules.push(`TICK ${data.tick} (<-500): -0.5`); }
    points.push(`$TICK ${data.tick}`);
  }

  const finalScore = clampScore(score);
  const direction: Direction = finalScore > 0.25 ? 'POSITIVE' : finalScore < -0.25 ? 'NEGATIVE' : 'FLAT';

  const freshCount = [data.advn, data.decn, data.tick, data.trin].filter(v => v !== null).length;
  const dataQuality: DataQuality = freshCount >= 3 ? 'FRESH' : freshCount >= 1 ? 'STALE' : 'MISSING';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Breadth strongly bullish, broad participation';
  else if (finalScore >= 0.5) headline = 'Breadth positive, healthy internals';
  else if (finalScore <= -1.5) headline = 'Breadth deeply negative, broad selling';
  else if (finalScore <= -0.5) headline = 'Breadth weak, limited participation';
  else headline = 'Breadth mixed, no clear signal';

  return { score: finalScore, dataQuality, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- COMPOSITE SCORING ----------

function calculateComposite(clusters: EngineOutput['clusters']): number {
  const raw =
    clusters.rates.score * WEIGHTS.rates +
    clusters.credit.score * WEIGHTS.credit +
    clusters.volLevel.score * WEIGHTS.volLevel +
    clusters.volTermStructure.score * WEIGHTS.volTermStructure +
    clusters.breadth.score * WEIGHTS.breadth;

  return Math.round(raw * 100) / 100;
}

function calculateConfidence(clusters: EngineOutput['clusters']): { score: number; max: number } {
  const clusterList = Object.values(clusters);
  const freshCount = clusterList.filter(c => c.dataQuality === 'FRESH').length;
  const maxConfidence = (freshCount / 5) * 100;

  let confidence = maxConfidence;

  const avgMagnitude = clusterList.reduce((sum, c) => sum + Math.abs(c.score), 0) / clusterList.length;
  if (avgMagnitude < 0.5) {
    confidence *= 0.7;
  }

  const scores = clusterList.map(c => c.score);
  const hasStrongBull = scores.some(s => s >= 1.5);
  const hasStrongBear = scores.some(s => s <= -1.5);
  if (hasStrongBull && hasStrongBear) {
    confidence *= 0.6;
  }

  return {
    score: Math.round(Math.min(confidence, maxConfidence)),
    max: Math.round(maxConfidence),
  };
}

function determineBias(
  composite: number,
  confidence: number,
  previousBias?: BiasLabel
): BiasLabel {
  if (confidence < 40) return 'NO_EDGE';

  if (previousBias && previousBias !== 'NO_EDGE' && previousBias !== 'NEUTRAL') {
    const thresholds = BIAS_THRESHOLDS[previousBias];
    if (thresholds) {
      if (previousBias === 'STRONGLY_BULLISH' && composite >= thresholds.exit) return 'STRONGLY_BULLISH';
      if (previousBias === 'BULLISH' && composite >= thresholds.exit) return 'BULLISH';
      if (previousBias === 'BEARISH' && composite <= -Math.abs(thresholds.exit)) return 'BEARISH';
      if (previousBias === 'STRONGLY_BEARISH' && composite <= -Math.abs(thresholds.exit)) return 'STRONGLY_BEARISH';
    }
  }

  if (composite >= BIAS_THRESHOLDS.STRONGLY_BULLISH.enter) return 'STRONGLY_BULLISH';
  if (composite >= BIAS_THRESHOLDS.BULLISH.enter) return 'BULLISH';
  if (composite <= -Math.abs(BIAS_THRESHOLDS.STRONGLY_BEARISH.enter)) return 'STRONGLY_BEARISH';
  if (composite <= -Math.abs(BIAS_THRESHOLDS.BEARISH.enter)) return 'BEARISH';
  return 'NEUTRAL';
}

function detectDivergence(clusters: EngineOutput['clusters']): { has: boolean; note: string | null } {
  const entries = Object.entries(clusters) as [string, ClusterResult][];
  const bullish = entries.filter(([_, c]) => c.score >= 1.0);
  const bearish = entries.filter(([_, c]) => c.score <= -1.0);

  if (bullish.length > 0 && bearish.length > 0) {
    const bullNames = bullish.map(([n]) => n).join(', ');
    const bearNames = bearish.map(([n]) => n).join(', ');
    return {
      has: true,
      note: `Signal conflict: ${bullNames} bullish vs ${bearNames} bearish. Mixed signals reduce conviction.`,
    };
  }
  return { has: false, note: null };
}

function determineRegime(clusters: EngineOutput['clusters'], composite: number): RegimeLabel {
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

function generateLevelsToWatch(data: MarketIndicators, clusters: EngineOutput['clusters']): EngineOutput['levelsToWatch'] {
  const levels: EngineOutput['levelsToWatch'] = [];

  if (data.vix !== null) {
    if (clusters.volLevel.score > 0) {
      levels.push({
        symbol: '$VIX',
        level: Math.ceil(data.vix + 2),
        direction: 'ABOVE',
        significance: 'VIX reversal above this level would signal renewed fear',
      });
    } else {
      levels.push({
        symbol: '$VIX',
        level: Math.floor(data.vix - 2),
        direction: 'BELOW',
        significance: 'VIX break below this level would confirm fear subsiding',
      });
    }
  }

  if (data.tnx !== null) {
    levels.push({
      symbol: '$TNX',
      level: Math.round((data.tnx + (clusters.rates.score > 0 ? 1.0 : -1.0)) * 100) / 100,
      direction: clusters.rates.score > 0 ? 'ABOVE' : 'BELOW',
      significance: clusters.rates.score > 0
        ? 'Yield reversal above this level would negate rates tailwind'
        : 'Yield break below this level would flip rates supportive',
    });
  }

  if (data.hyg !== null) {
    levels.push({
      symbol: 'HYG',
      level: Math.round((data.hyg - 0.3) * 100) / 100,
      direction: 'BELOW',
      significance: 'Break below this level would signal credit deterioration',
    });
  }

  return levels;
}

// ---------- MAIN ENGINE FUNCTION ----------

export function runMarketPulseEngine(
  data: MarketIndicators,
  previousBias?: BiasLabel
): EngineOutput {
  console.log('[ENGINE INPUT]', JSON.stringify(data, null, 2));
  const clusters = {
    rates: scoreRates(data),
    credit: scoreCredit(data),
    volLevel: scoreVolLevel(data),
    volTermStructure: scoreVolTermStructure(data),
    breadth: scoreBreadth(data),
  };

  const compositeScore = calculateComposite(clusters);
  const { score: confidenceScore, max: maxConfidence } = calculateConfidence(clusters);
  const bias = determineBias(compositeScore, confidenceScore, previousBias);
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
    maxConfidence,
    hasDivergence: divergence.has,
    divergenceNote: divergence.note,
    structuralRegime,
    riskState,
    riskReason,
    levelsToWatch,
  };
}
