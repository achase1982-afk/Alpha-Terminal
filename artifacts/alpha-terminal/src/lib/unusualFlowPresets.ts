export interface UnusualFlowFilters {
  minUnusualStrikes: number;
  minVoiRatio: number;
  minStrikeVolume: number;
  minNotionalPerStrike: number;
  minDteExcl0: number;
  maxDte: number;
  skew: 'any' | 'bull' | 'bear' | 'balanced';
  patternSweep: boolean;
  patternBlock: boolean;
  patternRegular: boolean;
  minSweeps: number;
  minBlocks: number;
  excludeEtfs: boolean;
  aggressor: 'any' | 'buyer' | 'seller';
  excludeMid: boolean;
  minExpiryConcentrationPct: number;
  minStrikeConcentrationPct: number;
  minRelativeOptionsAdv: number;
  minUnderlyingVolVsAdv: number;
}

export type PresetId = 'momentum' | 'swing' | 'whale';

export const DEFAULT_FILTERS: UnusualFlowFilters = {
  minUnusualStrikes: 1,
  minVoiRatio: 3,
  minStrikeVolume: 500,
  minNotionalPerStrike: 250_000,
  minDteExcl0: 3,
  maxDte: 365,
  skew: 'any',
  patternSweep: true,
  patternBlock: true,
  patternRegular: true,
  minSweeps: 0,
  minBlocks: 0,
  excludeEtfs: true,
  aggressor: 'any',
  excludeMid: false,
  minExpiryConcentrationPct: 0,
  minStrikeConcentrationPct: 0,
  minRelativeOptionsAdv: 0,
  minUnderlyingVolVsAdv: 0,
};

export const PRESETS: Record<PresetId, { label: string; subtitle: string; accent: string; toastLine: string; filters: UnusualFlowFilters }> = {
  momentum: {
    label: 'Momentum',
    subtitle: 'Near-term aggressive bets (3–14 DTE)',
    accent: '#FFB800',
    toastLine: 'Applied Momentum preset (VOI 3x+, 3–14 DTE, 250K+ notional).',
    filters: {
      ...DEFAULT_FILTERS,
      minVoiRatio: 3,
      minStrikeVolume: 500,
      minNotionalPerStrike: 250_000,
      minDteExcl0: 3,
      maxDte: 14,
      aggressor: 'buyer',
      excludeMid: true,
      patternSweep: true,
      patternBlock: true,
      patternRegular: false,
      minExpiryConcentrationPct: 50,
      minUnderlyingVolVsAdv: 1.3,
      excludeEtfs: true,
    },
  },
  swing: {
    label: 'Swing',
    subtitle: 'Larger, slower institutional positioning (21–60 DTE)',
    accent: '#66e0ff',
    toastLine: 'Applied Swing preset (VOI 2x+, 21–60 DTE, 500K+ notional).',
    filters: {
      ...DEFAULT_FILTERS,
      minVoiRatio: 2,
      minStrikeVolume: 500,
      minNotionalPerStrike: 500_000,
      minDteExcl0: 21,
      maxDte: 60,
      aggressor: 'any',
      excludeMid: true,
      patternSweep: true,
      patternBlock: true,
      patternRegular: false,
      minExpiryConcentrationPct: 60,
      minRelativeOptionsAdv: 3,
      excludeEtfs: true,
    },
  },
  whale: {
    label: 'Whale',
    subtitle: 'Follow seven-figure prints of any horizon',
    accent: '#a78bfa',
    toastLine: 'Applied Whale preset (1M+ notional, blocks only, top-expiry concentration 70%).',
    filters: {
      ...DEFAULT_FILTERS,
      minVoiRatio: 2,
      minStrikeVolume: 1_000,
      minNotionalPerStrike: 1_000_000,
      minDteExcl0: 1,
      maxDte: Number.POSITIVE_INFINITY,
      aggressor: 'any',
      excludeMid: true,
      patternSweep: false,
      patternBlock: true,
      patternRegular: false,
      minBlocks: 1,
      minExpiryConcentrationPct: 70,
      minStrikeConcentrationPct: 70,
      minRelativeOptionsAdv: 5,
      excludeEtfs: true,
    },
  },
};

export const PRESET_ORDER: PresetId[] = ['momentum', 'swing', 'whale'];

// JSON.stringify turns Infinity into null. Round-trip helpers preserve the
// "no cap" semantic for maxDte across localStorage persistence.
export function serializeFilters(f: UnusualFlowFilters): string {
  return JSON.stringify({ ...f, maxDte: Number.isFinite(f.maxDte) ? f.maxDte : -1 });
}
export function deserializeFilters(raw: string): Partial<UnusualFlowFilters> {
  const parsed = JSON.parse(raw) as Partial<UnusualFlowFilters>;
  if (typeof parsed.maxDte === 'number' && parsed.maxDte < 0) parsed.maxDte = Number.POSITIVE_INFINITY;
  return parsed;
}

function approxEqualNum(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) && !Number.isFinite(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 1e-6;
}

export function filtersMatchPreset(f: UnusualFlowFilters, p: UnusualFlowFilters): boolean {
  const keys = Object.keys(p) as Array<keyof UnusualFlowFilters>;
  return keys.every(k => {
    const a = f[k]; const b = p[k];
    if (typeof a === 'number' && typeof b === 'number') return approxEqualNum(a, b);
    return a === b;
  });
}

export function detectPreset(f: UnusualFlowFilters): PresetId | null {
  for (const id of PRESET_ORDER) {
    if (filtersMatchPreset(f, PRESETS[id].filters)) return id;
  }
  return null;
}

function distance(f: UnusualFlowFilters, p: UnusualFlowFilters): number {
  let d = 0;
  (Object.keys(p) as Array<keyof UnusualFlowFilters>).forEach(k => {
    const a = f[k]; const b = p[k];
    if (typeof a === 'number' && typeof b === 'number') {
      const scale = Math.max(1, Math.abs(b));
      d += Math.abs(a - b) / scale;
    } else if (a !== b) {
      d += 1;
    }
  });
  return d;
}

export function closestPreset(f: UnusualFlowFilters): PresetId {
  let best: PresetId = 'momentum'; let bestD = Infinity;
  for (const id of PRESET_ORDER) {
    const d = distance(f, PRESETS[id].filters);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}
