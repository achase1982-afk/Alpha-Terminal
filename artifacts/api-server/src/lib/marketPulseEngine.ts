// ============================================================
// MARKET PULSE DETERMINISTIC SCORING ENGINE v2.6
// ============================================================
// 60 symbols across 7 clusters + 1 options post-processing layer.
// All math is deterministic and clamp-verified.
// AI consumes JSON output for narrative ONLY. AI does NOT do math.
// ============================================================

export type ClusterName = 'rates' | 'credit' | 'volLevel' | 'volTerm' | 'breadth' | 'riskAppetite' | 'macro';

export type DataQuality = 'FRESH' | 'STALE' | 'MISSING';
export type BiasLabel = 'STRONGLY_BULLISH' | 'MODERATELY_BULLISH' | 'SLIGHTLY_BULLISH' | 'NEUTRAL' | 'SLIGHTLY_BEARISH' | 'MODERATELY_BEARISH' | 'STRONGLY_BEARISH' | 'NO_EDGE';
export type Direction = 'UP' | 'DOWN' | 'FLAT' | 'COMPRESSING' | 'EXPANDING' | 'STABLE' | 'CONTANGO' | 'INVERTED' | 'POSITIVE' | 'NEGATIVE' | 'BROAD_PARTICIPATION' | 'BROAD_DETERIORATION' | 'MIXED';
export type RiskState = 'PRESS' | 'NORMAL' | 'REDUCED' | 'NO_TRADE';
export type RegimeLabel = 'RISK_ON' | 'RISK_OFF' | 'TRANSITION' | 'NO_READ';
export type TodayEdge = 'BULLISH_EDGE' | 'BEARISH_EDGE' | 'NEUTRAL_EDGE' | 'NO_EDGE';
export type SizeRecommendation = 'FULL_SIZE' | 'HALF_SIZE' | 'NO_TRADE';
export type MomentumLabel = 'ACCELERATING' | 'IMPROVING' | 'STABLE' | 'FADING' | 'DETERIORATING' | 'FIRST_READ' | 'STALE_COMPARISON' | 'SESSION_GAP';

export type IVDirection = 'SELL_PREMIUM' | 'NEUTRAL_IV' | 'BUY_PREMIUM';
export type BroadSentiment = 'EXTREME_FEAR' | 'ELEVATED_FEAR' | 'NEUTRAL' | 'EXTREME_GREED';
export type InstitutionalHedging = 'INSTITUTIONS_HEDGING_HARD' | 'INSTITUTIONS_HEDGING' | 'INSTITUTIONAL_NEUTRAL' | 'INSTITUTIONS_COMPLACENT';

export interface MarketIndicators {
  vix: number | null;
  vixChange: number | null;
  vvix: number | null;
  vvixChange: number | null;
  vix1d: number | null;
  vix1dChange: number | null;
  vix3m: number | null;
  vix3mChange: number | null;
  vix9d: number | null;
  vix9dChange: number | null;
  vxn: number | null;
  vxnChange: number | null;
  rvx: number | null;
  rvxChange: number | null;
  ovx: number | null;
  ovxChange: number | null;
  gvz: number | null;
  gvzChange: number | null;
  vixFut: number | null;
  vixFutChange: number | null;

  tnx: number | null;
  tnxChange: number | null;
  tyx: number | null;
  tyxChange: number | null;
  irx: number | null;
  irxChange: number | null;
  zb: number | null;
  zbChange: number | null;
  zt: number | null;
  ztChange: number | null;
  zf: number | null;
  zfChange: number | null;
  zn: number | null;
  znChange: number | null;
  zq: number | null;
  zqChange: number | null;

  hyg: number | null;
  hygChange: number | null;
  lqd: number | null;
  lqdChange: number | null;
  ief: number | null;
  iefChange: number | null;
  tlt: number | null;
  tltChange: number | null;

  tick: number | null;
  trin: number | null;
  add: number | null;
  advn: number | null;
  decn: number | null;
  uvol: number | null;
  dvol: number | null;
  ticki: number | null;
  trinq: number | null;
  addq: number | null;
  advnq: number | null;
  decnq: number | null;
  uvolq: number | null;
  dvolq: number | null;

  es: number | null;
  esChange: number | null;
  nq: number | null;
  nqChange: number | null;
  ym: number | null;
  ymChange: number | null;
  rty: number | null;
  rtyChange: number | null;
  spy: number | null;
  spyChange: number | null;
  qqq: number | null;
  qqqChange: number | null;
  iwm: number | null;
  iwmChange: number | null;

  gc: number | null;
  gcChange: number | null;
  cl: number | null;
  clChange: number | null;
  hg: number | null;
  hgChange: number | null;
  dx: number | null;
  dxChange: number | null;
  sixE: number | null;
  sixEChange: number | null;
  sixJ: number | null;
  sixJChange: number | null;

  cpce: number | null;
  cpci: number | null;

  dataTimestamps?: Record<string, number>;
}

export interface ClusterResult {
  score: number;
  raw: number;
  dataQuality: DataQuality;
  direction: Direction;
  headline: string;
  keyDataPoints: string[];
  rulesApplied: string[];
}

export interface BreadthDetail {
  nyseScore: number;
  nasdaqScore: number;
  exchangeDivergence: boolean;
}

export interface MomentumData {
  delta: number | null;
  label: MomentumLabel;
  previousComposite: number | null;
  previousTimestamp: string | null;
  timeDeltaMinutes: number | null;
}

export interface OptionsLayer {
  ivRank: number | null;
  premiumDirection: IVDirection | null;
  broadSentiment: BroadSentiment | null;
  institutionalHedging: InstitutionalHedging | null;
  tickerFlags: string[];
  avoidShortPremium: boolean;
  avoidReason: string | null;
  tradeTypeRecommendation: string;
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
  divergenceDetail: { bullishClusters: string[]; bearishClusters: string[] };
  secondaryFlags: string[];
  structuralRegime: RegimeLabel;
  riskState: RiskState;
  riskReason: string;
  riskStateReasoning: string[];
  breadthDetail: BreadthDetail;
  momentum: MomentumData;
  optionsLayer: OptionsLayer;
  levelsToWatch: Array<{
    symbol: string;
    level: number;
    direction: 'ABOVE' | 'BELOW';
    significance: string;
  }>;
  dataQuality: {
    freshCount: number;
    staleCount: number;
    missingCount: number;
    missingClusters: string[];
    staleClusters: string[];
    experimentalAvailable: Record<string, boolean>;
  };
  weights: Record<ClusterName, number>;
}

// ---------- CONSTANTS ----------

const ENGINE_VERSION = 'v2.6';
const STALE_THRESHOLD_MS = 15 * 60 * 1000;
const OVERFLOW_GUARD = 9_007_199_254_740;

const CLUSTER_WEIGHTS: Record<ClusterName, number> = {
  rates:        18,
  credit:       12,
  volLevel:     15,
  volTerm:      12,
  breadth:      18,
  riskAppetite: 15,
  macro:        10,
};

const KNOWN_STALE_SYMBOLS = new Set([
  '$TNX', '$TYX', '$IRX', '$ADVN', '$DECN', '$TICK', '$TRIN', '$ADD',
  '$VVIX', '$VIX9D', '$VIX1D', '$VIX3M', '$VXN', '$RVX',
  '$TICKI', '$TRINQ', '$ADDQ', '$ADVNQ', '$DECNQ',
  '$UVOL', '$DVOL', '$UVOLQ', '$DVOLQ',
  '$PCUSEQTR', '$PCUSINXR',
]);

export type SessionType = 'RTH' | 'PRE_MARKET' | 'OVERNIGHT' | 'WEEKEND';

// ---------- MOMENTUM RING BUFFER ----------

interface CompositeEntry {
  composite: number;
  timestamp: string;
  session: SessionType;
  epochMs: number;
}

const compositeHistory: CompositeEntry[] = [];
const MAX_HISTORY = 20;
const HISTORY_TTL_MS = 4 * 60 * 60 * 1000;

function pushComposite(composite: number, session: SessionType) {
  const now = Date.now();
  const entry: CompositeEntry = {
    composite,
    timestamp: new Date().toISOString(),
    session,
    epochMs: now,
  };
  compositeHistory.push(entry);
  while (compositeHistory.length > MAX_HISTORY) compositeHistory.shift();
  while (compositeHistory.length > 0 && (now - compositeHistory[0].epochMs) > HISTORY_TTL_MS) {
    compositeHistory.shift();
  }
}

function computeMomentum(currentComposite: number, currentSession: SessionType): MomentumData {
  if (compositeHistory.length === 0) {
    return { delta: null, label: 'FIRST_READ', previousComposite: null, previousTimestamp: null, timeDeltaMinutes: null };
  }
  const prev = compositeHistory[compositeHistory.length - 1];
  const timeDeltaMinutes = Math.round((Date.now() - prev.epochMs) / 60000);

  if (timeDeltaMinutes > 120) {
    return { delta: null, label: 'STALE_COMPARISON', previousComposite: prev.composite, previousTimestamp: prev.timestamp, timeDeltaMinutes };
  }
  if (prev.session !== currentSession) {
    return { delta: null, label: 'SESSION_GAP', previousComposite: prev.composite, previousTimestamp: prev.timestamp, timeDeltaMinutes };
  }

  const delta = Math.round((currentComposite - prev.composite) * 10000) / 10000;
  let label: MomentumLabel;
  if (delta >= 0.30) label = 'ACCELERATING';
  else if (delta >= 0.10) label = 'IMPROVING';
  else if (delta > -0.10) label = 'STABLE';
  else if (delta > -0.30) label = 'FADING';
  else label = 'DETERIORATING';

  return { delta, label, previousComposite: prev.composite, previousTimestamp: prev.timestamp, timeDeltaMinutes };
}

// ---------- HELPERS ----------

function checkDataQuality(
  value: number | null,
  timestampMs?: number,
  session?: SessionType,
  symbol?: string
): DataQuality {
  if (value === null || value === undefined) return 'MISSING';
  if (typeof value === 'number' && Math.abs(value) > OVERFLOW_GUARD) return 'STALE';
  if (timestampMs) {
    const age = Date.now() - timestampMs;
    if (age > STALE_THRESHOLD_MS) return 'STALE';
  }
  if (session && session !== 'RTH' && symbol && KNOWN_STALE_SYMBOLS.has(symbol)) {
    return 'STALE';
  }
  return 'FRESH';
}

function clamp(score: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(score * 10000) / 10000));
}

function fmt(val: number | null, prefix: string, suffix: string = ''): string {
  if (val === null) return `${prefix} N/A`;
  return `${prefix} ${val > 0 ? '+' : ''}${val.toFixed(2)}${suffix}`;
}

function worstOf(qualities: DataQuality[]): DataQuality {
  if (qualities.includes('MISSING')) return 'MISSING';
  if (qualities.includes('STALE')) return 'STALE';
  return 'FRESH';
}

function safeDiv(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return a / b;
}

function overflowGuard(v: number | null): number | null {
  if (v === null) return null;
  if (Math.abs(v) > OVERFLOW_GUARD) return null;
  return v;
}

// ---------- CLUSTER 1: RATES  Weight: 18%  Clamp: [-2.0, +2.0] ----------

function scoreRates(data: MarketIndicators, session: SessionType): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];

  const tnxQ = checkDataQuality(data.tnx, undefined, session, '$TNX');
  const tyxQ = checkDataQuality(data.tyx, undefined, session, '$TYX');
  const irxQ = checkDataQuality(data.irx, undefined, session, '$IRX');
  const zbQ = checkDataQuality(data.zb);
  const ztQ = checkDataQuality(data.zt);
  const zfQ = checkDataQuality(data.zf);
  const znQ = checkDataQuality(data.zn);
  const zqQ = checkDataQuality(data.zq);

  const allMissing = tnxQ === 'MISSING' && tyxQ === 'MISSING' && zbQ === 'MISSING' && ztQ === 'MISSING';
  if (allMissing) {
    return { score: 0, raw: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Rates data unavailable', keyDataPoints: [], rulesApplied: ['All rates data missing'] };
  }

  const tnxStale = tnxQ === 'STALE' || tnxQ === 'MISSING';
  const tyxStale = tyxQ === 'STALE' || tyxQ === 'MISSING';
  const preMarketGate = tnxStale && tyxStale;

  // STEP 1 — Primary yield signal
  if (data.tnxChange !== null && !tnxStale) {
    const c = data.tnxChange;
    if (c <= -1.0) { score += 1.0; rules.push('TNX <= -1.0%: +1.0'); }
    else if (c <= -0.5) { score += 0.75; rules.push('TNX <= -0.5%: +0.75'); }
    else if (c <= -0.1) { score += 0.5; rules.push('TNX <= -0.1%: +0.5'); }
    else if (c >= 1.0) { score -= 1.0; rules.push('TNX >= +1.0%: -1.0'); }
    else if (c >= 0.5) { score -= 0.75; rules.push('TNX >= +0.5%: -0.75'); }
    else if (c >= 0.1) { score -= 0.5; rules.push('TNX >= +0.1%: -0.5'); }
    else { rules.push('TNX flat: 0'); }
    points.push(fmt(data.tnxChange, '$TNX', '%'));
  } else if (data.zbChange !== null) {
    const c = data.zbChange;
    if (c >= 0.3) { score += 0.75; rules.push('/ZB fallback >= +0.3%: +0.75'); }
    else if (c >= 0.1) { score += 0.5; rules.push('/ZB fallback >= +0.1%: +0.5'); }
    else if (c <= -0.3) { score -= 0.75; rules.push('/ZB fallback <= -0.3%: -0.75'); }
    else if (c <= -0.1) { score -= 0.5; rules.push('/ZB fallback <= -0.1%: -0.5'); }
    else { rules.push('/ZB fallback flat: 0'); }
    points.push(fmt(data.zbChange, '/ZB fallback', '%'));
  }

  // STEP 2 — Yield curve inversion ($IRX vs $TNX) — skip if pre-market gate
  if (!preMarketGate && irxQ !== 'STALE' && irxQ !== 'MISSING' && data.irx !== null && data.tnx !== null) {
    if (data.irx > data.tnx) {
      score -= 0.5;
      rules.push('YIELD_CURVE_INVERTED: IRX > TNX: -0.5');
    } else if (Math.abs(data.irx - data.tnx) <= 1.0) {
      score -= 0.25;
      rules.push('YIELD_CURVE_FLATTENING: |IRX-TNX| <= 1.0: -0.25');
    } else if (data.tnx > data.irx && (data.tnx - data.irx) > 5.0) {
      score += 0.25;
      rules.push('Yield curve steep (TNX-IRX > 5.0): +0.25');
    }
    points.push(`$IRX ${data.irx.toFixed(2)} vs $TNX ${data.tnx.toFixed(2)}`);
  }

  // STEP 3 — Curve shape ($TYX vs $TNX % changes) — skip if pre-market gate
  if (!preMarketGate && data.tnxChange !== null && data.tyxChange !== null) {
    const curveDiff = data.tnxChange - data.tyxChange;
    const bothFalling = data.tnxChange < 0 && data.tyxChange < 0;
    const bothRising = data.tnxChange > 0 && data.tyxChange > 0;
    const oppositeDir = Math.abs(data.tnxChange) >= 0.1 && Math.abs(data.tyxChange) >= 0.1 &&
      ((data.tnxChange > 0 && data.tyxChange < 0) || (data.tnxChange < 0 && data.tyxChange > 0));

    if (oppositeDir) {
      score -= 0.25;
      rules.push('CURVE_DISTORTION: opposite directions: -0.25');
    } else if (bothFalling && curveDiff > 0.1) {
      score += 0.25;
      rules.push('Bull steepener (both falling, TYX more): +0.25');
    } else if (bothFalling && curveDiff < -0.1) {
      score -= 0.25;
      rules.push('Bear flattener (both falling, TNX more): -0.25');
    } else if (bothRising && curveDiff < -0.1) {
      score -= 0.25;
      rules.push('Bear steepener (both rising, TYX more): -0.25');
    } else if (bothRising && curveDiff > 0.1) {
      score -= 0.25;
      rules.push('Bear flattener (both rising, TNX more): -0.25');
    }
    points.push(fmt(data.tyxChange, '$TYX', '%'));
  }

  // STEP 4 — Bond futures confirmation (/ZT, /ZF, /ZN, /ZB)
  const bondChanges = [data.ztChange, data.zfChange, data.znChange, data.zbChange].filter(c => c !== null) as number[];
  const bondRallying = bondChanges.filter(c => c > 0).length;
  const ratesIntermediate = score;

  if (bondChanges.length > 0) {
    if (ratesIntermediate > 0) {
      if (bondRallying >= 3) { score += 0.25; rules.push(`${bondRallying} bonds rallying (bullish confirm): +0.25`); }
      else if (bondRallying === 0) { score -= 0.25; rules.push('0 bonds rallying (bullish contradiction): -0.25'); }
    } else if (ratesIntermediate < 0) {
      if (bondRallying <= 1) { score -= 0.25; rules.push(`${bondRallying} bonds rallying (bearish confirm): -0.25`); }
      else if (bondRallying === 4) { score += 0.25; rules.push('All 4 bonds rallying (bearish contradiction): +0.25'); }
    }
    if (data.ztChange !== null) points.push(fmt(data.ztChange, '/ZT', '%'));
    if (data.zfChange !== null) points.push(fmt(data.zfChange, '/ZF', '%'));
    if (data.znChange !== null) points.push(fmt(data.znChange, '/ZN', '%'));
    if (data.zbChange !== null) points.push(fmt(data.zbChange, '/ZB', '%'));
  }

  // STEP 5 — Fed Funds (/ZQ % change)
  if (data.zqChange !== null) {
    if (data.zqChange >= 0.02) { score += 0.25; rules.push('/ZQ >= +0.02% (dovish): +0.25'); }
    else if (data.zqChange <= -0.02) { score -= 0.25; rules.push('/ZQ <= -0.02% (hawkish): -0.25'); }
    points.push(fmt(data.zqChange, '/ZQ', '%'));
  }

  const raw = score;
  const finalScore = clamp(score, -2.0, 2.0);

  let headline = '';
  if (finalScore >= 1.5) headline = 'Yields falling sharply — strong risk-on';
  else if (finalScore >= 0.5) headline = 'Yields declining — supportive for equities';
  else if (finalScore <= -1.5) headline = 'Yields surging — recession risk elevated';
  else if (finalScore <= -0.5) headline = 'Yields rising — headwind for equities';
  else headline = 'Yields stable — neutral signal';

  const direction: Direction = finalScore > 0.25 ? 'DOWN' : finalScore < -0.25 ? 'UP' : 'FLAT';

  return { score: finalScore, raw, dataQuality: worstOf([tnxQ, tyxQ, zbQ, ztQ, zfQ, znQ, zqQ, irxQ]), direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- CLUSTER 2: CREDIT  Weight: 12%  Clamp: [-2.0, +2.0] ----------

function scoreCredit(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];
  const flags: string[] = [];

  const hygQ = checkDataQuality(data.hyg);
  const lqdQ = checkDataQuality(data.lqd);
  const iefQ = checkDataQuality(data.ief);
  const tltQ = checkDataQuality(data.tlt);

  if (hygQ === 'MISSING' && lqdQ === 'MISSING' && iefQ === 'MISSING' && tltQ === 'MISSING') {
    return { score: 0, raw: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Credit data unavailable', keyDataPoints: [], rulesApplied: ['All credit data missing'] };
  }

  // HYG
  const hygChg = data.hygChange;
  if (hygChg !== null) {
    if (hygChg >= 0.5) { score += 2.0; rules.push('HYG >= +0.5%: +2.0'); }
    else if (hygChg >= 0.2) { score += 1.0; rules.push('HYG >= +0.2%: +1.0'); }
    else if (hygChg <= -0.5) { score -= 2.0; rules.push('HYG <= -0.5%: -2.0'); }
    else if (hygChg <= -0.2) { score -= 1.0; rules.push('HYG <= -0.2%: -1.0'); }
    else { rules.push('HYG flat: 0'); }
    points.push(fmt(hygChg, 'HYG', '%'));
  }

  // LQD
  if (data.lqdChange !== null) {
    if (data.lqdChange >= 0.3) { score += 0.5; rules.push('LQD >= +0.3%: +0.5'); }
    else if (data.lqdChange <= -0.3) { score -= 0.5; rules.push('LQD <= -0.3%: -0.5'); }
    points.push(fmt(data.lqdChange, 'LQD', '%'));
  }

  // IEF — HYG-direction dependent
  if (data.iefChange !== null && hygChg !== null) {
    if (hygChg >= 0.1) {
      if (data.iefChange >= 0.3) { score += 0.25; rules.push('IEF >= +0.3% (HYG up): +0.25'); }
      else if (data.iefChange <= -0.3) { score -= 0.25; rules.push('IEF <= -0.3% (HYG up): -0.25'); }
    } else if (hygChg <= -0.1) {
      if (data.iefChange <= -0.3) { score -= 0.25; rules.push('IEF <= -0.3% (HYG down, everything selling): -0.25'); }
    }
    points.push(fmt(data.iefChange, 'IEF', '%'));
  }

  // TLT — HYG-direction dependent
  if (data.tltChange !== null && hygChg !== null) {
    if (hygChg >= 0.1) {
      if (data.tltChange >= 0.5) { score += 0.5; rules.push('TLT >= +0.5% (HYG up): +0.5'); }
      else if (data.tltChange <= -0.5) { score -= 0.5; rules.push('TLT <= -0.5% (HYG up): -0.5'); }
    } else if (hygChg <= -0.1) {
      if (data.tltChange <= -0.5) { score -= 0.5; rules.push('TLT <= -0.5% (HYG down, everything selling): -0.5'); }
    }
    points.push(fmt(data.tltChange, 'TLT', '%'));
  }

  // Flags
  if (hygChg !== null && hygChg >= 0.2 && ((data.iefChange !== null && data.iefChange >= 0.2) || (data.tltChange !== null && data.tltChange >= 0.2))) {
    flags.push('CREDIT_FLIGHT_TO_SAFETY');
  }
  if (data.tltChange !== null && data.tltChange >= 0.5 && hygChg !== null && hygChg <= -0.3) {
    flags.push('CREDIT_STRESS_CONFIRMED');
  }

  const raw = score;
  const finalScore = clamp(score, -2.0, 2.0);
  const direction: Direction = finalScore > 0.25 ? 'UP' : finalScore < -0.25 ? 'DOWN' : 'FLAT';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Credit surging — strong risk-on';
  else if (finalScore >= 0.5) headline = 'Credit improving — supportive backdrop';
  else if (finalScore <= -1.5) headline = 'Credit deteriorating — risk-off alert';
  else if (finalScore <= -0.5) headline = 'Credit weakening — caution warranted';
  else headline = 'Credit stable — neutral signal';

  const result: ClusterResult = { score: finalScore, raw, dataQuality: worstOf([hygQ, lqdQ, iefQ, tltQ]), direction, headline, keyDataPoints: points, rulesApplied: [...rules, ...flags.map(f => `FLAG: ${f}`)] };
  return result;
}

// ---------- CLUSTER 3: VOL LEVEL  Weight: 15%  Clamp: [-2.0, +2.0] ----------

function scoreVolLevel(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];

  const vixQ = checkDataQuality(data.vix);
  if (vixQ === 'MISSING') {
    return { score: 0, raw: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Volatility data unavailable', keyDataPoints: [], rulesApplied: ['VIX data missing'] };
  }

  // STEP 1 — $VIX absolute level
  if (data.vix !== null) {
    if (data.vix < 15) { score += 0.5; rules.push('VIX < 15: +0.5'); }
    else if (data.vix < 20) { score += 0.25; rules.push('VIX < 20: +0.25'); }
    else if (data.vix < 25) { rules.push('VIX 20-25: 0'); }
    else if (data.vix < 30) { score -= 0.5; rules.push('VIX 25-30: -0.5'); }
    else if (data.vix < 35) { score -= 1.0; rules.push('VIX 30-35: -1.0'); }
    else { score -= 1.5; rules.push('VIX >= 35: -1.5'); }
    points.push(`$VIX ${data.vix.toFixed(2)}`);
  }

  // STEP 2 — $VIX intraday % change
  if (data.vixChange !== null) {
    const c = data.vixChange;
    if (c <= -5) { score += 1.5; rules.push('VIX chg <= -5%: +1.5'); }
    else if (c <= -3) { score += 0.75; rules.push('VIX chg <= -3%: +0.75'); }
    else if (c <= -1) { score += 0.25; rules.push('VIX chg <= -1%: +0.25'); }
    else if (c >= 5) { score -= 1.5; rules.push('VIX chg >= +5%: -1.5'); }
    else if (c >= 3) { score -= 0.75; rules.push('VIX chg >= +3%: -0.75'); }
    else if (c >= 1) { score -= 0.25; rules.push('VIX chg >= +1%: -0.25'); }
    points.push(fmt(data.vixChange, '$VIX chg', '%'));
  }

  // STEP 3 — $VVIX % change
  if (data.vvixChange !== null) {
    if (data.vvixChange <= -3) { score += 0.5; rules.push('VVIX chg <= -3%: +0.5'); }
    else if (data.vvixChange >= 3) { score -= 0.5; rules.push('VVIX chg >= +3%: -0.5'); }
    points.push(fmt(data.vvixChange, '$VVIX chg', '%'));
  }

  // STEP 4 — Cross-vol ($VXN, $RVX vs $VIX)
  if (data.vix !== null) {
    const vxnHigh = data.vxn !== null && data.vxn >= data.vix + 5;
    const rvxHigh = data.rvx !== null && data.rvx >= data.vix + 5;
    if (vxnHigh && rvxHigh) {
      score -= 0.5;
      rules.push('TECH_VOL_ELEVATED + SMALLCAP_VOL_ELEVATED: -0.5');
    } else if (vxnHigh) {
      score -= 0.25;
      rules.push('TECH_VOL_ELEVATED (VXN >= VIX+5): -0.25');
    } else if (rvxHigh) {
      score -= 0.25;
      rules.push('SMALLCAP_VOL_ELEVATED (RVX >= VIX+5): -0.25');
    } else if (data.vxn !== null && data.rvx !== null && data.vxn < data.vix && data.rvx < data.vix) {
      score += 0.25;
      rules.push('VXN & RVX < VIX: +0.25');
    }
    if (data.vxn !== null) points.push(`$VXN ${data.vxn.toFixed(2)}`);
    if (data.rvx !== null) points.push(`$RVX ${data.rvx.toFixed(2)}`);
  }

  // STEP 5 — Commodity vol ($OVX, $GVZ)
  if (data.ovx !== null) {
    if (data.ovx >= 60) { score -= 0.5; rules.push('OVX >= 60: -0.5'); }
    else if (data.ovx >= 45) { score -= 0.25; rules.push('OVX >= 45: -0.25'); }
    points.push(`$OVX ${data.ovx.toFixed(2)}`);
  }
  if (data.gvz !== null) {
    if (data.gvz >= 25) { score -= 0.25; rules.push('GVZ >= 25: -0.25'); }
    points.push(`$GVZ ${data.gvz.toFixed(2)}`);
  }
  if (data.ovx !== null && data.gvz !== null && data.ovx < 30 && data.gvz < 15) {
    score += 0.25;
    rules.push('OVX < 30 & GVZ < 15: +0.25');
  }

  // STEP 6 — /VIX futures vs $VIX spot
  if (data.vixFut !== null && data.vix !== null) {
    const spread = data.vixFut - data.vix;
    if (spread >= 2.0) { score += 0.5; rules.push(`/VIX-$VIX spread ${spread.toFixed(2)} (steep contango): +0.5`); }
    else if (spread >= 0.5) { score += 0.25; rules.push(`/VIX-$VIX spread ${spread.toFixed(2)} (mild contango): +0.25`); }
    else if (spread <= -2.0) { score -= 0.5; rules.push(`/VIX-$VIX spread ${spread.toFixed(2)} (steep backwardation): -0.5`); }
    else if (spread <= -0.5) { score -= 0.25; rules.push(`/VIX-$VIX spread ${spread.toFixed(2)} (mild backwardation): -0.25`); }
    points.push(`/VIX ${data.vixFut.toFixed(2)} vs $VIX ${data.vix.toFixed(2)}`);
  }

  const raw = score;
  const finalScore = clamp(score, -2.0, 2.0);
  let direction: Direction;
  if (finalScore >= 0.25) direction = 'COMPRESSING';
  else if (finalScore <= -0.25) direction = 'EXPANDING';
  else direction = 'STABLE';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Vol compressing sharply, strong risk-on';
  else if (finalScore >= 0.5) headline = 'Vol declining, reduced market fear';
  else if (finalScore <= -1.5) headline = 'Vol expanding sharply, elevated fear';
  else if (finalScore <= -0.5) headline = 'Vol rising, increasing uncertainty';
  else headline = 'Volatility stable, neutral signal';

  return { score: finalScore, raw, dataQuality: vixQ, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- CLUSTER 4: VOL TERM STRUCTURE  Weight: 12%  Clamp: [-2.0, +2.0] ----------

function scoreVolTerm(data: MarketIndicators): ClusterResult {
  const rules: string[] = [];
  const points: string[] = [];
  const componentScores: number[] = [];
  const componentNames: string[] = [];

  // Component A — VIX1D / VIX9D ratio
  if (data.vix1d !== null && data.vix9d !== null && data.vix9d > 0) {
    const ratio = data.vix1d / data.vix9d;
    let s = 0;
    if (ratio < 0.85) { s = 2.0; rules.push(`A: VIX1D/VIX9D ${ratio.toFixed(3)} < 0.85: +2.0`); }
    else if (ratio < 0.95) { s = 1.0; rules.push(`A: VIX1D/VIX9D ${ratio.toFixed(3)} < 0.95: +1.0`); }
    else if (ratio < 1.05) { s = 0; rules.push(`A: VIX1D/VIX9D ${ratio.toFixed(3)} flat: 0`); }
    else if (ratio < 1.15) { s = -1.0; rules.push(`A: VIX1D/VIX9D ${ratio.toFixed(3)} < 1.15: -1.0`); }
    else { s = -2.0; rules.push(`A: VIX1D/VIX9D ${ratio.toFixed(3)} >= 1.15: -2.0`); }
    componentScores.push(s);
    componentNames.push('A');
    points.push(`$VIX1D ${data.vix1d.toFixed(2)} / $VIX9D ${data.vix9d.toFixed(2)} = ${ratio.toFixed(3)}`);
  }

  // Component B — VIX9D / VIX ratio
  if (data.vix9d !== null && data.vix !== null && data.vix > 0) {
    const ratio = data.vix9d / data.vix;
    let s = 0;
    if (ratio < 0.90) { s = 2.0; rules.push(`B: VIX9D/VIX ${ratio.toFixed(3)} < 0.90: +2.0`); }
    else if (ratio < 0.95) { s = 1.0; rules.push(`B: VIX9D/VIX ${ratio.toFixed(3)} < 0.95: +1.0`); }
    else if (ratio < 1.05) { s = 0; rules.push(`B: VIX9D/VIX ${ratio.toFixed(3)} flat: 0`); }
    else if (ratio < 1.10) { s = -1.0; rules.push(`B: VIX9D/VIX ${ratio.toFixed(3)} < 1.10: -1.0`); }
    else { s = -2.0; rules.push(`B: VIX9D/VIX ${ratio.toFixed(3)} >= 1.10: -2.0`); }
    componentScores.push(s);
    componentNames.push('B');
    points.push(`$VIX9D ${data.vix9d.toFixed(2)} / $VIX ${data.vix.toFixed(2)} = ${ratio.toFixed(3)}`);
  }

  // Component C — VIX / VIX3M ratio
  if (data.vix !== null && data.vix3m !== null && data.vix3m > 0) {
    const ratio = data.vix / data.vix3m;
    let s = 0;
    if (ratio < 0.85) { s = 2.0; rules.push(`C: VIX/VIX3M ${ratio.toFixed(3)} < 0.85: +2.0`); }
    else if (ratio < 0.95) { s = 1.0; rules.push(`C: VIX/VIX3M ${ratio.toFixed(3)} < 0.95: +1.0`); }
    else if (ratio < 1.05) { s = 0; rules.push(`C: VIX/VIX3M ${ratio.toFixed(3)} flat: 0`); }
    else if (ratio < 1.15) { s = -1.0; rules.push(`C: VIX/VIX3M ${ratio.toFixed(3)} < 1.15: -1.0`); }
    else { s = -2.0; rules.push(`C: VIX/VIX3M ${ratio.toFixed(3)} >= 1.15: -2.0`); }
    componentScores.push(s);
    componentNames.push('C');
    points.push(`$VIX ${data.vix.toFixed(2)} / $VIX3M ${data.vix3m.toFixed(2)} = ${ratio.toFixed(3)}`);
  }

  // Component D — /VIX vs $VIX
  if (data.vixFut !== null && data.vix !== null) {
    const spread = data.vixFut - data.vix;
    let s = 0;
    if (spread >= 2.0) { s = 2.0; rules.push(`E: /VIX-$VIX ${spread.toFixed(2)} >= 2.0 (steep contango): +2.0`); }
    else if (spread >= 0.5) { s = 1.0; rules.push(`E: /VIX-$VIX ${spread.toFixed(2)} >= 0.5 (mild contango): +1.0`); }
    else if (Math.abs(spread) < 0.5) { s = 0; rules.push(`E: /VIX-$VIX ${spread.toFixed(2)} flat: 0`); }
    else if (spread <= -2.0) { s = -2.0; rules.push(`E: /VIX-$VIX ${spread.toFixed(2)} <= -2.0 (steep backwardation): -2.0`); }
    else { s = -1.0; rules.push(`E: /VIX-$VIX ${spread.toFixed(2)} <= -0.5 (mild backwardation): -1.0`); }
    componentScores.push(s);
    componentNames.push('E');
    points.push(`/VIX ${data.vixFut.toFixed(2)} vs $VIX ${data.vix.toFixed(2)} spread=${spread.toFixed(2)}`);
  }

  if (componentScores.length < 2) {
    return { score: 0, raw: 0, dataQuality: 'STALE', direction: 'FLAT', headline: 'Term structure data insufficient', keyDataPoints: points, rulesApplied: [...rules, `Only ${componentScores.length} components active (need 2)`] };
  }

  const avg = componentScores.reduce((a, b) => a + b, 0) / componentScores.length;
  rules.push(`VolTerm avg of ${componentScores.length} components [${componentNames.join(',')}]: ${avg.toFixed(4)}`);

  const raw = avg;
  const finalScore = clamp(avg, -2.0, 2.0);
  let direction: Direction;
  if (finalScore >= 0.25) direction = 'CONTANGO';
  else if (finalScore <= -0.25) direction = 'INVERTED';
  else direction = 'FLAT';

  // FULL_TERM_INVERSION flag
  const abcActive = componentNames.includes('A') && componentNames.includes('B') && componentNames.includes('C');
  const abcNeg = abcActive && componentScores[componentNames.indexOf('A')] < 0 && componentScores[componentNames.indexOf('B')] < 0 && componentScores[componentNames.indexOf('C')] < 0;
  if (abcNeg) {
    rules.push('FLAG: FULL_TERM_INVERSION');
  }

  let headline = '';
  if (finalScore >= 1.0) headline = 'Term structure healthy contango, no near-term panic';
  else if (finalScore >= 0.25) headline = 'Term structure mostly normal, mild contango';
  else if (finalScore <= -1.0) headline = 'Term structure inverted, hedging demand elevated';
  else if (finalScore <= -0.25) headline = 'Term structure showing caution, backwardation forming';
  else headline = 'Term structure flat, inconclusive';

  return { score: finalScore, raw, dataQuality: componentScores.length >= 3 ? 'FRESH' : 'STALE', direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- CLUSTER 5: BREADTH  Weight: 18%  Clamp: [-2.0, +2.0] ----------

function scoreSingleExchangeBreadth(
  tick: number | null, trin: number | null, add: number | null,
  advn: number | null, decn: number | null, uvol: number | null, dvol: number | null,
  prefix: string, rules: string[], points: string[]
): { score: number; count: number } {
  const componentScores: number[] = [];

  // TICK
  if (tick !== null) {
    let s = 0;
    if (tick >= 1000) { s = 2.0; }
    else if (tick >= 600) { s = 1.0; }
    else if (tick >= 200) { s = 0.5; }
    else if (tick > -200) { s = 0; }
    else if (tick >= -600) { s = -0.5; }
    else if (tick >= -1000) { s = -1.0; }
    else { s = -2.0; }
    componentScores.push(s);
    rules.push(`${prefix}TICK ${tick}: ${s >= 0 ? '+' : ''}${s}`);
    points.push(`${prefix}TICK ${tick}`);
  }

  // TRIN
  if (trin !== null) {
    let s = 0;
    if (trin < 0.80) { s = 2.0; }
    else if (trin < 1.00) { s = 1.0; }
    else if (trin < 1.20) { s = -1.0; }
    else { s = -2.0; }
    componentScores.push(s);
    rules.push(`${prefix}TRIN ${trin.toFixed(2)}: ${s >= 0 ? '+' : ''}${s}`);
    points.push(`${prefix}TRIN ${trin.toFixed(2)}`);
  }

  // ADD
  if (add !== null) {
    let s = 0;
    if (add >= 1500) { s = 2.0; }
    else if (add >= 800) { s = 1.0; }
    else if (add >= 200) { s = 0.5; }
    else if (add > -200) { s = 0; }
    else if (add >= -800) { s = -0.5; }
    else if (add >= -1500) { s = -1.0; }
    else { s = -2.0; }
    componentScores.push(s);
    rules.push(`${prefix}ADD ${add}: ${s >= 0 ? '+' : ''}${s}`);
    points.push(`${prefix}ADD ${add}`);
  }

  // ADVN/DECN
  if (advn !== null && decn !== null && decn > 0) {
    const ratio = advn / decn;
    let s = 0;
    if (ratio >= 3.0) { s = 2.0; }
    else if (ratio >= 2.0) { s = 1.0; }
    else if (ratio >= 0.5) { s = 0; }
    else if (ratio >= 0.33) { s = -1.0; }
    else { s = -2.0; }
    componentScores.push(s);
    rules.push(`${prefix}ADVN/DECN ${ratio.toFixed(2)}: ${s >= 0 ? '+' : ''}${s}`);
    points.push(`${prefix}ADVN ${advn}`, `${prefix}DECN ${decn}`);
  }

  // UVOL/DVOL
  const uv = overflowGuard(uvol);
  const dv = overflowGuard(dvol);
  if (uv !== null && dv !== null && dv > 0) {
    const ratio = uv / dv;
    let s = 0;
    if (ratio >= 4.0) { s = 2.0; }
    else if (ratio >= 2.0) { s = 1.0; }
    else if (ratio >= 0.5) { s = 0; }
    else if (ratio >= 0.25) { s = -1.0; }
    else { s = -2.0; }
    componentScores.push(s);
    rules.push(`${prefix}UVOL/DVOL ${ratio.toFixed(2)}: ${s >= 0 ? '+' : ''}${s}`);
    points.push(`${prefix}UVOL ${uv}`, `${prefix}DVOL ${dv}`);
  }

  if (componentScores.length === 0) return { score: 0, count: 0 };
  const avg = componentScores.reduce((a, b) => a + b, 0) / componentScores.length;
  return { score: avg, count: componentScores.length };
}

function scoreBreadth(data: MarketIndicators): { cluster: ClusterResult; detail: BreadthDetail } {
  const rules: string[] = [];
  const points: string[] = [];

  const nyse = scoreSingleExchangeBreadth(data.tick, data.trin, data.add, data.advn, data.decn, data.uvol, data.dvol, '$', rules, points);
  const nasdaq = scoreSingleExchangeBreadth(data.ticki, data.trinq, data.addq, data.advnq, data.decnq, data.uvolq, data.dvolq, '$Q_', rules, points);

  if (nyse.count === 0 && nasdaq.count === 0) {
    return {
      cluster: { score: 0, raw: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Breadth data unavailable', keyDataPoints: [], rulesApplied: ['Both exchanges missing'] },
      detail: { nyseScore: 0, nasdaqScore: 0, exchangeDivergence: false },
    };
  }

  let breadthRaw: number;
  if (nyse.count > 0 && nasdaq.count > 0) {
    breadthRaw = (nyse.score + nasdaq.score) / 2;
    rules.push(`Breadth = avg(NYSE ${nyse.score.toFixed(3)}, NASDAQ ${nasdaq.score.toFixed(3)}) = ${breadthRaw.toFixed(3)}`);
  } else if (nyse.count > 0) {
    breadthRaw = nyse.score;
    rules.push(`Breadth = NYSE only: ${breadthRaw.toFixed(3)}`);
  } else {
    breadthRaw = nasdaq.score;
    rules.push(`Breadth = NASDAQ only: ${breadthRaw.toFixed(3)}`);
  }

  let exchangeDivergence = false;
  if (nyse.count > 0 && nasdaq.count > 0 && Math.abs(nyse.score - nasdaq.score) >= 1.5) {
    breadthRaw -= 0.25;
    exchangeDivergence = true;
    rules.push(`EXCHANGE_DIVERGENCE: |${nyse.score.toFixed(2)} - ${nasdaq.score.toFixed(2)}| >= 1.5: -0.25`);
  }

  const raw = breadthRaw;
  const finalScore = clamp(breadthRaw, -2.0, 2.0);
  let direction: Direction;
  if (finalScore >= 0.5) direction = 'BROAD_PARTICIPATION';
  else if (finalScore <= -0.5) direction = 'BROAD_DETERIORATION';
  else direction = 'MIXED';

  const totalCount = nyse.count + nasdaq.count;
  const dataQuality: DataQuality = totalCount >= 4 ? 'FRESH' : totalCount >= 1 ? 'STALE' : 'MISSING';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Breadth strongly bullish, broad participation';
  else if (finalScore >= 0.5) headline = 'Breadth positive, healthy internals';
  else if (finalScore <= -1.5) headline = 'Breadth deeply negative, broad selling';
  else if (finalScore <= -0.5) headline = 'Breadth weak, limited participation';
  else headline = 'Breadth mixed, no clear signal';

  return {
    cluster: { score: finalScore, raw, dataQuality, direction, headline, keyDataPoints: points, rulesApplied: rules },
    detail: { nyseScore: nyse.score, nasdaqScore: nasdaq.score, exchangeDivergence },
  };
}

// ---------- CLUSTER 6: RISK APPETITE  Weight: 15%  Clamp: [-2.0, +2.0] ----------

function scoreRiskAppetite(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];

  // STEP 1 — Futures directional
  const futChanges = [
    { sym: '/ES', val: data.esChange },
    { sym: '/NQ', val: data.nqChange },
    { sym: '/YM', val: data.ymChange },
    { sym: '/RTY', val: data.rtyChange },
  ].filter(c => c.val !== null) as { sym: string; val: number }[];

  if (futChanges.length < 2) {
    return { score: 0, raw: 0, dataQuality: futChanges.length === 0 ? 'MISSING' : 'STALE', direction: 'FLAT', headline: 'Risk appetite data insufficient', keyDataPoints: [], rulesApplied: ['Insufficient futures data'] };
  }

  const allPositive = futChanges.every(c => c.val >= 0);
  const allNegative = futChanges.every(c => c.val <= 0);
  const avg = futChanges.reduce((a, c) => a + c.val, 0) / futChanges.length;

  if (allPositive && avg >= 1.0) { score += 1.5; rules.push(`All futures up, avg +${avg.toFixed(2)}%: +1.5`); }
  else if (allPositive && avg >= 0.5) { score += 1.0; rules.push(`All futures up, avg +${avg.toFixed(2)}%: +1.0`); }
  else if (allPositive) { score += 0.5; rules.push(`All futures up, avg +${avg.toFixed(2)}%: +0.5`); }
  else if (allNegative && avg <= -1.0) { score -= 1.5; rules.push(`All futures down, avg ${avg.toFixed(2)}%: -1.5`); }
  else if (allNegative && avg <= -0.5) { score -= 1.0; rules.push(`All futures down, avg ${avg.toFixed(2)}%: -1.0`); }
  else if (allNegative) { score -= 0.5; rules.push(`All futures down, avg ${avg.toFixed(2)}%: -0.5`); }
  else { rules.push(`Futures mixed, avg ${avg.toFixed(2)}%: 0`); }

  // STEP 2 — /RTY leadership
  if (data.rtyChange !== null && data.esChange !== null) {
    const rtyDiff = data.rtyChange - data.esChange;
    if (rtyDiff >= 0.5) { score += 0.5; rules.push(`RTY leading ES by +${rtyDiff.toFixed(2)}%: +0.5`); }
    else if (rtyDiff <= -0.5) { score -= 0.5; rules.push(`RTY lagging ES by ${rtyDiff.toFixed(2)}%: -0.5`); }
  }

  // STEP 3 — /NQ concentration
  if (data.nqChange !== null && data.esChange !== null && data.ymChange !== null && data.rtyChange !== null) {
    const nqDiff = data.nqChange - ((data.esChange + data.ymChange + data.rtyChange) / 3);
    if (nqDiff >= 1.0) { score -= 0.25; rules.push(`NQ leading by ${nqDiff.toFixed(2)}% (narrow): -0.25`); }
    else if (nqDiff <= -1.0) { score -= 0.25; rules.push(`NQ lagging by ${Math.abs(nqDiff).toFixed(2)}% (rotation stress): -0.25`); }
  }

  // STEP 4 — Cash confirmation
  if (data.spyChange !== null && data.esChange !== null) {
    if (Math.abs(data.spyChange - data.esChange) >= 0.3) {
      score -= 0.25;
      rules.push(`|SPY-ES| >= 0.3% (divergence): -0.25`);
    }
  }
  if (data.iwmChange !== null && data.spyChange !== null) {
    if (data.iwmChange - data.spyChange >= 0.5) {
      score += 0.25;
      rules.push(`IWM outperforming SPY by ${(data.iwmChange - data.spyChange).toFixed(2)}%: +0.25`);
    }
  }
  if (data.qqqChange !== null && data.spyChange !== null && data.iwmChange !== null) {
    if (data.qqqChange - data.spyChange >= 1.0 && data.iwmChange < data.spyChange) {
      score -= 0.25;
      rules.push('QQQ outperforming +1% while IWM underperforming: -0.25');
    }
  }

  for (const c of futChanges) points.push(fmt(c.val, c.sym, '%'));
  if (data.spyChange !== null) points.push(fmt(data.spyChange, 'SPY', '%'));
  if (data.qqqChange !== null) points.push(fmt(data.qqqChange, 'QQQ', '%'));
  if (data.iwmChange !== null) points.push(fmt(data.iwmChange, 'IWM', '%'));

  const raw = score;
  const finalScore = clamp(score, -2.0, 2.0);
  const direction: Direction = finalScore > 0.25 ? 'POSITIVE' : finalScore < -0.25 ? 'NEGATIVE' : 'FLAT';
  const freshCount = [data.es, data.nq, data.ym, data.rty].filter(v => v !== null).length;
  const dataQuality: DataQuality = freshCount >= 3 ? 'FRESH' : freshCount >= 1 ? 'STALE' : 'MISSING';

  let headline = '';
  if (finalScore >= 1.5) headline = 'Broad equity rally — risk appetite strong';
  else if (finalScore >= 0.5) headline = 'Futures positive — risk-on posture';
  else if (finalScore <= -1.5) headline = 'Broad equity selloff — risk-off';
  else if (finalScore <= -0.5) headline = 'Futures under pressure — defensive tone';
  else headline = 'Futures mixed — no directional conviction';

  return { score: finalScore, raw, dataQuality, direction, headline, keyDataPoints: points, rulesApplied: rules };
}

// ---------- CLUSTER 7: MACRO  Weight: 10%  Clamp: [-1.5, +1.5] ----------

function scoreMacro(data: MarketIndicators): ClusterResult {
  let score = 0;
  const rules: string[] = [];
  const points: string[] = [];
  const flags: string[] = [];

  const hasAny = data.gc !== null || data.cl !== null || data.hg !== null || data.dx !== null || data.sixJ !== null;
  if (!hasAny) {
    return { score: 0, raw: 0, dataQuality: 'MISSING', direction: 'FLAT', headline: 'Macro data unavailable', keyDataPoints: [], rulesApplied: ['All macro data missing'] };
  }

  // /GC Gold
  if (data.gcChange !== null) {
    const c = data.gcChange;
    if (c <= -1.0) { score += 0.5; rules.push(`Gold <= -1.0%: +0.5`); }
    else if (c <= -0.5) { score += 0.25; rules.push(`Gold <= -0.5%: +0.25`); }
    else if (c >= 1.0) { score -= 0.5; rules.push(`Gold >= +1.0%: -0.5`); }
    else if (c >= 0.5) { score -= 0.25; rules.push(`Gold >= +0.5%: -0.25`); }
    points.push(fmt(data.gcChange, '/GC', '%'));
  }

  // /HG Copper
  if (data.hgChange !== null) {
    const c = data.hgChange;
    if (c >= 1.5) { score += 0.5; rules.push(`Copper >= +1.5%: +0.5`); }
    else if (c >= 0.5) { score += 0.25; rules.push(`Copper >= +0.5%: +0.25`); }
    else if (c <= -1.5) { score -= 0.5; rules.push(`Copper <= -1.5%: -0.5`); }
    else if (c <= -0.5) { score -= 0.25; rules.push(`Copper <= -0.5%: -0.25`); }
    points.push(fmt(data.hgChange, '/HG', '%'));
  }

  // Oil (/CL only — /BZ removed, no data source)
  if (data.clChange !== null) {
    const c = data.clChange;
    if (c >= 3.0) { score -= 0.5; rules.push(`Oil >= +3.0%: -0.5`); }
    else if (c >= 1.5) { score -= 0.25; rules.push(`Oil >= +1.5%: -0.25`); }
    else if (c >= 0) { score += 0.25; rules.push(`Oil flat/mild up: +0.25`); }
    else if (c >= -1.5) { score += 0.25; rules.push(`Oil mild down: +0.25`); }
    else if (c >= -3.0) { score -= 0.25; rules.push(`Oil <= -1.5%: -0.25`); }
    else { score -= 0.5; rules.push(`Oil < -3.0%: -0.5`); }
    points.push(fmt(data.clChange, '/CL', '%'));
  }

  // /DX Dollar
  if (data.dxChange !== null) {
    const c = data.dxChange;
    if (c <= -0.5) { score += 0.5; rules.push(`Dollar <= -0.5%: +0.5`); }
    else if (c <= -0.2) { score += 0.25; rules.push(`Dollar <= -0.2%: +0.25`); }
    else if (c >= 0.5) { score -= 0.5; rules.push(`Dollar >= +0.5%: -0.5`); }
    else if (c >= 0.2) { score -= 0.25; rules.push(`Dollar >= +0.2%: -0.25`); }
    points.push(fmt(data.dxChange, '/DX', '%'));
  }

  // /6J Yen (rising yen = risk-off)
  if (data.sixJChange !== null) {
    const c = data.sixJChange;
    if (c >= 0.5) { score -= 0.5; rules.push(`Yen >= +0.5% (risk-off): -0.5`); }
    else if (c >= 0.2) { score -= 0.25; rules.push(`Yen >= +0.2%: -0.25`); }
    else if (c <= -0.5) { score += 0.5; rules.push(`Yen <= -0.5% (risk-on): +0.5`); }
    else if (c <= -0.2) { score += 0.25; rules.push(`Yen <= -0.2%: +0.25`); }
    points.push(fmt(data.sixJChange, '/6J', '%'));
  }

  // /6E Euro confirmation
  if (data.sixEChange !== null && data.dxChange !== null) {
    const sameDir = (data.sixEChange >= 0.1 && data.dxChange >= 0.1) || (data.sixEChange <= -0.1 && data.dxChange <= -0.1);
    if (sameDir) {
      score -= 0.25;
      flags.push('FX_DISLOCATION');
      rules.push('FX_DISLOCATION (6E & DX same direction): -0.25');
    }
    points.push(fmt(data.sixEChange, '/6E', '%'));
  }

  // Macro flags
  if (data.gcChange !== null && data.gcChange >= 0.5 && data.dxChange !== null && data.dxChange >= 0.3) {
    flags.push('GOLD_DOLLAR_SPIKE');
  }
  if (data.hgChange !== null && data.hgChange <= -0.5 && data.clChange !== null && data.clChange <= -0.5) {
    if (data.sixJChange !== null && data.sixJChange >= 0.2) {
      flags.push('GLOBAL_GROWTH_SCARE');
    }
  }

  const raw = score;
  const finalScore = clamp(score, -1.5, 1.5);
  const direction: Direction = finalScore > 0.25 ? 'POSITIVE' : finalScore < -0.25 ? 'NEGATIVE' : 'FLAT';
  const freshCount = [data.gc, data.cl, data.hg, data.dx, data.sixJ].filter(v => v !== null).length;
  const dataQuality: DataQuality = freshCount >= 3 ? 'FRESH' : freshCount >= 1 ? 'STALE' : 'MISSING';

  let headline = '';
  if (finalScore >= 1.0) headline = 'Global risk-on — dollar weak, copper strong';
  else if (finalScore >= 0.5) headline = 'Macro supportive — mild risk-on flows';
  else if (finalScore <= -1.0) headline = 'Global risk-off — stress across FX/commodities';
  else if (finalScore <= -0.5) headline = 'Macro headwinds — defensive flows building';
  else headline = 'Macro backdrop neutral';

  return { score: finalScore, raw, dataQuality, direction, headline, keyDataPoints: points, rulesApplied: [...rules, ...flags.map(f => `FLAG: ${f}`)] };
}

// ---------- COMPOSITE SCORE ----------

function calculateComposite(clusters: Record<ClusterName, ClusterResult>): number {
  let composite = 0;
  for (const [name, cluster] of Object.entries(clusters) as [ClusterName, ClusterResult][]) {
    const weight = CLUSTER_WEIGHTS[name] / 100;
    composite += cluster.score * weight;
  }
  return Math.round(composite * 10000) / 10000;
}

// ---------- CONFIDENCE ----------

function calculateConfidence(
  clusters: Record<ClusterName, ClusterResult>,
  composite: number,
  hasDivergence: boolean,
  session: SessionType
): { confidence: number; maxPossible: number } {
  const base = Math.min(95, Math.round(Math.abs(composite) * 85));

  // Agreement multiplier
  let agreementMult = 1.0;
  if (Math.abs(composite) >= 0.01) {
    for (const cluster of Object.values(clusters)) {
      const isOpposite = (composite > 0 && cluster.score < 0) || (composite < 0 && cluster.score > 0);
      if (isOpposite) {
        if (Math.abs(cluster.score) >= 1.0) { agreementMult -= 0.15; }
        else if (Math.abs(cluster.score) >= 0.5) { agreementMult -= 0.10; }
      }
    }
    agreementMult = Math.max(0.40, agreementMult);
  }

  // Data quality multiplier
  let dataQualityMult = 1.0;
  for (const cluster of Object.values(clusters)) {
    if (cluster.dataQuality === 'MISSING') dataQualityMult -= 0.15;
    else if (cluster.dataQuality === 'STALE') dataQualityMult -= 0.05;
  }
  dataQualityMult = Math.max(0.50, dataQualityMult);

  let rawConf = Math.round(base * agreementMult * dataQualityMult);

  // Structural caps
  if (hasDivergence) rawConf = Math.min(rawConf, 60);

  const volTermCluster = clusters.volTerm;
  const volLevelCluster = clusters.volLevel;
  if (volTermCluster.direction === 'INVERTED' && volLevelCluster.direction === 'EXPANDING') {
    rawConf = Math.min(rawConf, 50);
  }

  const freshClusterCount = Object.values(clusters).filter(c => c.dataQuality === 'FRESH').length;
  if (freshClusterCount < 5) {
    rawConf = Math.min(rawConf, 40 + freshClusterCount * 10);
  }

  // GAP-RISK GUARD
  if (session === 'PRE_MARKET' && clusters.riskAppetite.score >= 1.0 &&
      (clusters.breadth.dataQuality === 'STALE' || clusters.breadth.dataQuality === 'MISSING')) {
    rawConf -= 10;
  }

  const confidence = Math.max(0, Math.min(100, rawConf));
  const maxPossible = Math.round(100 * dataQualityMult);

  return { confidence, maxPossible };
}

// ---------- BIAS LABEL ----------

function determineBias(composite: number, confidence: number): BiasLabel {
  if (confidence < 20) return 'NO_EDGE';
  if (composite >= 1.50 && confidence >= 75) return 'STRONGLY_BULLISH';
  if (composite >= 0.75) return 'MODERATELY_BULLISH';
  if (composite >= 0.30) return 'SLIGHTLY_BULLISH';
  if (composite > -0.30) return 'NEUTRAL';
  if (composite >= -0.75) return 'SLIGHTLY_BEARISH';
  if (composite >= -1.50) return 'MODERATELY_BEARISH';
  if (composite < -1.50 && confidence >= 75) return 'STRONGLY_BEARISH';
  return 'MODERATELY_BEARISH';
}

// ---------- TODAY'S EDGE ----------

function determineTodayEdge(composite: number, confidence: number): TodayEdge {
  if (confidence < 20) return 'NO_EDGE';
  if (composite >= 0.5) return 'BULLISH_EDGE';
  if (composite <= -0.5) return 'BEARISH_EDGE';
  return 'NEUTRAL_EDGE';
}

// ---------- DIVERGENCE ----------

function detectDivergence(clusters: Record<ClusterName, ClusterResult>): {
  has: boolean;
  note: string | null;
  detail: { bullishClusters: string[]; bearishClusters: string[] };
} {
  const entries = Object.entries(clusters) as [string, ClusterResult][];
  const bullish = entries.filter(([_, c]) => c.score >= 0.75).map(([n]) => n);
  const bearish = entries.filter(([_, c]) => c.score <= -0.75).map(([n]) => n);

  if (bullish.length > 0 && bearish.length > 0) {
    return {
      has: true,
      note: `Signal conflict: ${bullish.join(', ')} bullish vs ${bearish.join(', ')} bearish`,
      detail: { bullishClusters: bullish, bearishClusters: bearish },
    };
  }
  return { has: false, note: null, detail: { bullishClusters: bullish, bearishClusters: bearish } };
}

// ---------- STRUCTURAL REGIME ----------

function determineRegime(clusters: Record<ClusterName, ClusterResult>, composite: number): RegimeLabel {
  const freshCount = Object.values(clusters).filter(c => c.dataQuality === 'FRESH').length;
  if (freshCount < 3) return 'NO_READ';
  if (composite >= 0.5) return 'RISK_ON';
  if (composite <= -0.5) return 'RISK_OFF';
  return 'TRANSITION';
}

// ---------- RISK STATE ----------

function determineRiskState(
  composite: number,
  confidence: number,
  hasDivergence: boolean,
  clusters: Record<ClusterName, ClusterResult>,
  session: SessionType
): { state: RiskState; reason: string; reasoning: string[] } {
  const reasoning: string[] = [];

  if (confidence < 20) {
    reasoning.push(`confidence ${confidence} below NO_TRADE threshold`);
    const missing = Object.entries(clusters).filter(([_, c]) => c.dataQuality === 'MISSING' || c.dataQuality === 'STALE');
    if (missing.length > 0) reasoning.push(`${missing.length} clusters STALE/MISSING, data insufficient`);
    return { state: 'NO_TRADE', reason: 'Insufficient data or confidence', reasoning };
  }

  if (hasDivergence) {
    const bullish = Object.entries(clusters).filter(([_, c]) => c.score >= 0.75).map(([n]) => n);
    const bearish = Object.entries(clusters).filter(([_, c]) => c.score <= -0.75).map(([n]) => n);
    reasoning.push(`hasDivergence: ${bullish.join(',')} bullish vs ${bearish.join(',')} bearish`);
    reasoning.push('confidence capped at 60');
    return { state: 'REDUCED', reason: 'Cross-asset divergence warrants reduced exposure', reasoning };
  }

  if (Math.abs(composite) >= 1.0 && confidence >= 70) {
    reasoning.push(`composite ${composite >= 0 ? '+' : ''}${composite.toFixed(2)} with confidence ${confidence}`);
    reasoning.push('no divergence, all clusters aligned');
    return { state: 'PRESS', reason: 'Strong aligned signals support full positioning', reasoning };
  }

  if (Math.abs(composite) >= 0.5) {
    reasoning.push(`composite ${composite >= 0 ? '+' : ''}${composite.toFixed(2)}`);
    if (session === 'PRE_MARKET' && clusters.breadth.dataQuality !== 'FRESH') {
      reasoning.push('pre-market: breadth unconfirmed');
    }
    return { state: 'NORMAL', reason: 'Moderate signal strength supports standard positioning', reasoning };
  }

  reasoning.push(`composite ${composite >= 0 ? '+' : ''}${composite.toFixed(2)} below threshold`);
  return { state: 'REDUCED', reason: 'Weak or mixed signals warrant reduced exposure', reasoning };
}

// ---------- SIZE RECOMMENDATION ----------

function determineSizeRecommendation(riskState: RiskState): SizeRecommendation {
  if (riskState === 'PRESS' || riskState === 'NORMAL') return 'FULL_SIZE';
  if (riskState === 'REDUCED') return 'HALF_SIZE';
  return 'NO_TRADE';
}

// ---------- OPTIONS POST-PROCESSING LAYER ----------

function computeOptionsLayer(
  data: MarketIndicators,
  bias: BiasLabel,
  composite: number,
  volTermDirection: Direction,
  volLevelDirection: Direction,
  secondaryFlags: string[]
): OptionsLayer {
  const tickerFlags: string[] = [];

  // STEP 1 — IVR
  let ivRank: number | null = null;
  if (data.vix !== null) {
    if (data.vix >= 35) ivRank = 90;
    else if (data.vix >= 30) ivRank = 75;
    else if (data.vix >= 25) ivRank = 55;
    else if (data.vix >= 20) ivRank = 40;
    else if (data.vix >= 18) ivRank = 30;
    else if (data.vix >= 15) ivRank = 20;
    else ivRank = 10;
  }

  let premiumDirection: IVDirection | null = null;
  if (ivRank !== null) {
    if (ivRank >= 50) premiumDirection = 'SELL_PREMIUM';
    else if (ivRank >= 25) premiumDirection = 'NEUTRAL_IV';
    else premiumDirection = 'BUY_PREMIUM';
  }

  // STEP 2 — Broad sentiment ($CPCE)
  let broadSentiment: BroadSentiment | null = null;
  if (data.cpce !== null) {
    if (data.cpce >= 0.90) broadSentiment = 'EXTREME_FEAR';
    else if (data.cpce >= 0.75) broadSentiment = 'ELEVATED_FEAR';
    else if (data.cpce >= 0.55) broadSentiment = 'NEUTRAL';
    else broadSentiment = 'EXTREME_GREED';
  }

  // STEP 3 — Institutional ($CPCI)
  let institutionalHedging: InstitutionalHedging | null = null;
  if (data.cpci !== null) {
    if (data.cpci >= 1.5) institutionalHedging = 'INSTITUTIONS_HEDGING_HARD';
    else if (data.cpci >= 1.1) institutionalHedging = 'INSTITUTIONS_HEDGING';
    else if (data.cpci >= 0.8) institutionalHedging = 'INSTITUTIONAL_NEUTRAL';
    else institutionalHedging = 'INSTITUTIONS_COMPLACENT';
  }

  // STEP 4 — (Ticker-specific PCR flags removed — no data sources for PCSPY/PCQQQ/PCIWM)

  // STEP 5 — AVOID_SHORT_PREMIUM
  let avoidShortPremium = false;
  let avoidReason: string | null = null;

  if (volTermDirection === 'INVERTED' && volLevelDirection === 'EXPANDING') {
    avoidShortPremium = true;
    avoidReason = 'Vol term inverted + vol expanding';
  } else if (data.vvixChange !== null && data.vvixChange >= 5) {
    avoidShortPremium = true;
    avoidReason = 'VVIX surging >= +5%';
  } else if (secondaryFlags.includes('CREDIT_STRESS_CONFIRMED')) {
    avoidShortPremium = true;
    avoidReason = 'Credit stress confirmed';
  }

  // STEP 6 — Trade type recommendation
  let tradeTypeRecommendation = '';
  const bullish = bias === 'STRONGLY_BULLISH' || bias === 'MODERATELY_BULLISH' || bias === 'SLIGHTLY_BULLISH';
  const bearish = bias === 'STRONGLY_BEARISH' || bias === 'MODERATELY_BEARISH' || bias === 'SLIGHTLY_BEARISH';

  if (avoidShortPremium) {
    tradeTypeRecommendation = 'Vol/credit unsafe. Buy spreads only or sit out.';
  } else if (broadSentiment === 'EXTREME_FEAR' && composite >= 0) {
    tradeTypeRecommendation = 'Capitulation setup — mean-reversion long';
  } else if (broadSentiment === 'EXTREME_GREED' && composite <= 0.5) {
    tradeTypeRecommendation = 'Complacency warning — reduce or hedge longs';
  } else if (institutionalHedging === 'INSTITUTIONS_HEDGING_HARD' && bullish) {
    tradeTypeRecommendation = 'Institutional hedging elevated — defined-risk only';
  } else if (bias === 'STRONGLY_BULLISH' && premiumDirection === 'SELL_PREMIUM') {
    tradeTypeRecommendation = 'Sell puts or bull put spreads. Defined-risk recommended.';
  } else if (bias === 'STRONGLY_BULLISH' && premiumDirection === 'BUY_PREMIUM') {
    tradeTypeRecommendation = 'Long calls or bull call spreads.';
  } else if (bias === 'MODERATELY_BULLISH' && premiumDirection === 'SELL_PREMIUM') {
    tradeTypeRecommendation = 'Bull put spreads on preferred tickers.';
  } else if (bias === 'MODERATELY_BULLISH' && premiumDirection === 'BUY_PREMIUM') {
    tradeTypeRecommendation = 'Bull call spreads on preferred tickers.';
  } else if (bias === 'SLIGHTLY_BULLISH') {
    tradeTypeRecommendation = 'Lean bullish — reduced size, defined-risk only.';
  } else if (bias === 'STRONGLY_BEARISH' && premiumDirection === 'SELL_PREMIUM') {
    tradeTypeRecommendation = 'Sell calls or bear call spreads. Defined-risk recommended.';
  } else if (bias === 'STRONGLY_BEARISH' && premiumDirection === 'BUY_PREMIUM') {
    tradeTypeRecommendation = 'Long puts or bear put spreads.';
  } else if (bias === 'MODERATELY_BEARISH' && premiumDirection === 'SELL_PREMIUM') {
    tradeTypeRecommendation = 'Bear call spreads on preferred tickers.';
  } else if (bias === 'MODERATELY_BEARISH' && premiumDirection === 'BUY_PREMIUM') {
    tradeTypeRecommendation = 'Bear put spreads on preferred tickers.';
  } else if (bias === 'SLIGHTLY_BEARISH') {
    tradeTypeRecommendation = 'Lean bearish — defined-risk only, small size.';
  } else if ((bias === 'NEUTRAL' || bias === 'NO_EDGE') && premiumDirection === 'SELL_PREMIUM' && !avoidShortPremium) {
    tradeTypeRecommendation = 'No directional edge. Iron condors if IV elevated.';
  } else {
    tradeTypeRecommendation = 'No conviction. Sit out.';
  }

  return {
    ivRank,
    premiumDirection,
    broadSentiment,
    institutionalHedging,
    tickerFlags,
    avoidShortPremium,
    avoidReason,
    tradeTypeRecommendation,
  };
}

// ---------- SECONDARY FLAGS COLLECTOR ----------

function collectSecondaryFlags(
  clusters: Record<ClusterName, ClusterResult>,
  momentum: MomentumData,
  bias: BiasLabel,
  session: SessionType,
  breadthDetail: BreadthDetail
): string[] {
  const flags: string[] = [];

  for (const cluster of Object.values(clusters)) {
    for (const rule of cluster.rulesApplied) {
      if (rule.startsWith('FLAG: ')) {
        flags.push(rule.replace('FLAG: ', ''));
      }
    }
  }

  if (breadthDetail.exchangeDivergence) flags.push('EXCHANGE_DIVERGENCE');

  if (session === 'PRE_MARKET' && clusters.riskAppetite.score >= 1.0 &&
      (clusters.breadth.dataQuality === 'STALE' || clusters.breadth.dataQuality === 'MISSING')) {
    flags.push('GAP_RISK_UNCONFIRMED');
  }

  // Momentum flags
  const bullish = bias === 'STRONGLY_BULLISH' || bias === 'MODERATELY_BULLISH' || bias === 'SLIGHTLY_BULLISH';
  const bearish = bias === 'STRONGLY_BEARISH' || bias === 'MODERATELY_BEARISH' || bias === 'SLIGHTLY_BEARISH';

  if (bullish && momentum.label === 'DETERIORATING') flags.push('BULLISH_MOMENTUM_FADING');
  if (bullish && momentum.label === 'ACCELERATING') flags.push('BULLISH_MOMENTUM_BUILDING');
  if (bearish && momentum.label === 'DETERIORATING') flags.push('BEARISH_MOMENTUM_BUILDING');
  if (bearish && momentum.label === 'IMPROVING') flags.push('BEARISH_MOMENTUM_FADING');

  return [...new Set(flags)];
}

// ---------- LEVELS TO WATCH ----------

function generateLevelsToWatch(data: MarketIndicators, clusters: Record<ClusterName, ClusterResult>): EngineOutput['levelsToWatch'] {
  const levels: EngineOutput['levelsToWatch'] = [];

  if (data.vix !== null) {
    levels.push({
      symbol: '$VIX',
      level: Math.round((data.vix + (clusters.volLevel.score > 0 ? 2 : -2)) * 100) / 100,
      direction: clusters.volLevel.score > 0 ? 'ABOVE' : 'BELOW',
      significance: `VIX current ± 2 pts`,
    });
  }

  if (data.tnx !== null) {
    levels.push({
      symbol: '$TNX',
      level: Math.round((data.tnx + (clusters.rates.score > 0 ? 0.1 : -0.1)) * 100) / 100,
      direction: clusters.rates.score > 0 ? 'ABOVE' : 'BELOW',
      significance: `TNX current ± 0.10%`,
    });
  }

  if (data.irx !== null && data.tnx !== null) {
    levels.push({
      symbol: '$IRX',
      level: data.tnx,
      direction: 'ABOVE',
      significance: 'IRX vs TNX inversion trigger',
    });
  }

  if (data.hyg !== null) {
    levels.push({
      symbol: 'HYG',
      level: Math.round((data.hyg * 0.997) * 100) / 100,
      direction: 'BELOW',
      significance: 'HYG current - 0.3%',
    });
  }

  if (data.es !== null) {
    levels.push({
      symbol: '/ES',
      level: Math.round(data.es * (clusters.riskAppetite.score > 0 ? 0.99 : 1.01)),
      direction: clusters.riskAppetite.score > 0 ? 'BELOW' : 'ABOVE',
      significance: '/ES current ± 1%',
    });
  }

  if (data.add !== null) {
    levels.push({ symbol: '$ADD', level: 0, direction: 'BELOW', significance: 'ADD zero line' });
  }

  if (data.trin !== null) {
    levels.push({ symbol: '$TRIN', level: 1.0, direction: 'ABOVE', significance: 'TRIN 1.0 line' });
  }

  if (data.hg !== null) {
    levels.push({
      symbol: '/HG',
      level: Math.round((data.hg * 0.99) * 10000) / 10000,
      direction: 'BELOW',
      significance: '/HG current - 1.0%',
    });
  }

  if (data.dx !== null) {
    levels.push({
      symbol: '/DX',
      level: Math.round((data.dx * 1.005) * 1000) / 1000,
      direction: 'ABOVE',
      significance: '/DX current + 0.5%',
    });
  }

  return levels;
}

// ---------- MAIN ENGINE FUNCTION ----------

export function runMarketPulseEngine(
  data: MarketIndicators,
  _previousBias?: BiasLabel,
  session?: SessionType
): EngineOutput {
  const currentSession: SessionType = session ?? 'RTH';

  const breadthResult = scoreBreadth(data);

  const clusters: Record<ClusterName, ClusterResult> = {
    rates: scoreRates(data, currentSession),
    credit: scoreCredit(data),
    volLevel: scoreVolLevel(data),
    volTerm: scoreVolTerm(data),
    breadth: breadthResult.cluster,
    riskAppetite: scoreRiskAppetite(data),
    macro: scoreMacro(data),
  };

  const compositeScore = calculateComposite(clusters);
  const divergence = detectDivergence(clusters);
  const { confidence: confidenceScore, maxPossible } = calculateConfidence(clusters, compositeScore, divergence.has, currentSession);

  const bias = determineBias(compositeScore, confidenceScore);
  const todayEdge = determineTodayEdge(compositeScore, confidenceScore);
  const structuralRegime = determineRegime(clusters, compositeScore);
  const { state: riskState, reason: riskReason, reasoning: riskStateReasoning } = determineRiskState(compositeScore, confidenceScore, divergence.has, clusters, currentSession);
  const sizeRecommendation = determineSizeRecommendation(riskState);
  const momentum = computeMomentum(compositeScore, currentSession);
  pushComposite(compositeScore, currentSession);

  const secondaryFlags = collectSecondaryFlags(clusters, momentum, bias, currentSession, breadthResult.detail);

  const optionsLayer = computeOptionsLayer(
    data, bias, compositeScore,
    clusters.volTerm.direction, clusters.volLevel.direction,
    secondaryFlags
  );

  const levelsToWatch = generateLevelsToWatch(data, clusters);

  // Data quality summary
  const clusterValues = Object.values(clusters);
  const freshCount = clusterValues.filter(c => c.dataQuality === 'FRESH').length;
  const staleCount = clusterValues.filter(c => c.dataQuality === 'STALE').length;
  const missingCount = clusterValues.filter(c => c.dataQuality === 'MISSING').length;
  const missingClusters = Object.entries(clusters).filter(([_, c]) => c.dataQuality === 'MISSING').map(([n]) => n);
  const staleClusters = Object.entries(clusters).filter(([_, c]) => c.dataQuality === 'STALE').map(([n]) => n);

  return {
    timestamp: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    clusters,
    compositeScore,
    bias,
    confidenceScore,
    maxConfidence: maxPossible,
    todayEdge,
    sizeRecommendation,
    hasDivergence: divergence.has,
    divergenceNote: divergence.note,
    divergenceDetail: divergence.detail,
    secondaryFlags,
    structuralRegime,
    riskState,
    riskReason,
    riskStateReasoning,
    breadthDetail: breadthResult.detail,
    momentum,
    optionsLayer,
    levelsToWatch,
    dataQuality: {
      freshCount,
      staleCount,
      missingCount,
      missingClusters,
      staleClusters,
      experimentalAvailable: {},
    },
    weights: CLUSTER_WEIGHTS,
  };
}

// ---------- DEBUG / FORMAT ----------

export function formatClusterDebugLine(result: EngineOutput): string {
  const c = result.clusters;
  return `CLUSTER SCORES: rates=${c.rates.score} credit=${c.credit.score} volLevel=${c.volLevel.score} volTerm=${c.volTerm.score} breadth=${c.breadth.score} riskApp=${c.riskAppetite.score} macro=${c.macro.score} COMPOSITE=${result.compositeScore} CONFIDENCE=${result.confidenceScore}/${result.maxConfidence}`;
}

export function verifyEngineScoring(): { passed: boolean; output: string } {
  const lines: string[] = [];
  let allPassed = true;

  const testData: MarketIndicators = {
    vix: 25.13, vixChange: null,
    vvix: null, vvixChange: null,
    vix1d: null, vix1dChange: null,
    vix3m: 25.51, vix3mChange: null,
    vix9d: 24.19, vix9dChange: null,
    vxn: null, vxnChange: null,
    rvx: null, rvxChange: null,
    ovx: null, ovxChange: null,
    gvz: null, gvzChange: null,
    vixFut: null, vixFutChange: null,
    tnx: 43.5, tnxChange: 0.19,
    tyx: 47.0, tyxChange: 0.27,
    irx: 36.0, irxChange: null,
    zb: 118.0, zbChange: -0.16,
    zt: 103.0, ztChange: 0.00,
    zf: null, zfChange: null,
    zn: null, znChange: null,
    zq: null, zqChange: null,
    hyg: 78.0, hygChange: 0.14,
    lqd: 110.0, lqdChange: 0.13,
    ief: 95.0, iefChange: 0.01,
    tlt: 86.0, tltChange: 0.05,
    advn: 2177, decn: 570,
    tick: 239, trin: 0.92, add: 1607,
    uvol: null, dvol: null,
    ticki: null, trinq: null, addq: null,
    advnq: null, decnq: null,
    uvolq: null, dvolq: null,
    es: 5400, esChange: 0.61,
    nq: 18500, nqChange: 0.86,
    ym: 42000, ymChange: 0.59,
    rty: 2100, rtyChange: 1.15,
    spy: 540, spyChange: 0.58,
    qqq: 460, qqqChange: 0.82,
    iwm: 210, iwmChange: 1.10,
    gc: null, gcChange: null,
    cl: null, clChange: null,
    hg: null, hgChange: null,
    dx: null, dxChange: null,
    sixE: null, sixEChange: null,
    sixJ: null, sixJChange: null,
    cpce: null, cpci: null,
  };

  const result = runMarketPulseEngine(testData, undefined, 'RTH');

  lines.push('=== v2.6 VERIFICATION AUDIT ===');
  lines.push('');
  lines.push(formatClusterDebugLine(result));
  lines.push(`Bias: ${result.bias}`);
  lines.push(`Risk State: ${result.riskState}`);
  lines.push(`Engine Version: ${result.engineVersion}`);
  lines.push(`Divergence: ${result.hasDivergence}`);
  lines.push(`Secondary Flags: ${result.secondaryFlags.join(', ') || 'none'}`);
  lines.push(`Options: ${result.optionsLayer.tradeTypeRecommendation}`);
  lines.push(`Momentum: ${result.momentum.label}`);
  lines.push('');

  if (result.engineVersion !== 'v2.6') {
    lines.push(`FAIL: engine version ${result.engineVersion} !== v2.6`);
    allPassed = false;
  } else {
    lines.push('PASS: engine version = v2.6');
  }

  lines.push(`Overall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);

  return { passed: allPassed, output: lines.join('\n') };
}
