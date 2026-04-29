import { logger } from "./logger.js";
import { getSnapshot, type LiveQuote } from "./schwabStreamer.js";
import { getIBSnapshot, getIBCachedQuote } from "./ibStreamer.js";

export type DeltaState = "AWAITING_BASELINE" | "HEALTHY" | "SOFTENING" | "FADING" | "REVERSING" | "DEGRADED";
export type SnapshotLabel = "PRE_MARKET" | "BASELINE" | "BASELINE_CONFIRM" | "INTRADAY" | "PRE_CLOSE";
export type TriggerType = "scheduled" | "manual" | "event";
export type TriggeredBy = "composite" | "participation" | null;

export interface DeltaHealthPayload {
  state: DeltaState;
  triggeredBy: TriggeredBy;
  D_final: number;
  D_scaled: number;
  B_interval: number;
  B_session: number;
  delta_p_session: number;
  delta_p_scaled_session: number;
  delta_x_session_pct: number;
  confidenceAdjustment: number;
  flags: string[];
  baselineTimestamp: string;
  baselineType: "primary" | "effective";
  primaryBaselineTimestamp: string;
  lastSnapshotTimestamp: string;
  snapshotsThisSession: number;
  todMultiplier: number;
  consecutiveNegativeIntervals: number;
  stateEnteredAt: string | null;
}

interface NormalizedValues {
  p: number | null;
  v: number;
  r: number | null;
  x: number | null;
}

interface RawIndicatorValues {
  ADVN: number | null;
  DECN: number | null;
  UVOL: number | null;
  DVOL: number | null;
  TRIN: number | null;
  VIX: number | null;
  ADVN_Q: number | null;
  DECN_Q: number | null;
  UVOL_Q: number | null;
  DVOL_Q: number | null;
  ES: number | null;
}

interface IndicatorTimestamps {
  ADVN: number;
  DECN: number;
  UVOL: number;
  DVOL: number;
  TRIN: number;
  VIX: number;
}

interface Snapshot {
  id: number;
  timestamp: number;
  label: SnapshotLabel;
  triggerType: TriggerType;
  degraded: boolean;
  raw: RawIndicatorValues;
  sourceTimestamps: Partial<IndicatorTimestamps>;
  sourceAges: Partial<Record<keyof IndicatorTimestamps, number>>;
  normalized: NormalizedValues;
  intervalDeltas: { delta_p: number; delta_v: number; delta_r: number; delta_x_pct: number } | null;
  sessionDeltas: { delta_p: number; delta_v: number; delta_r: number; delta_x_pct: number } | null;
  primarySessionDeltas?: { delta_p: number; delta_v: number; delta_r: number; delta_x_pct: number } | null;
  B_interval: number;
  B_session: number;
  D_final: number;
  D_scaled: number;
  delta_p_scaled: number;
  state: DeltaState;
  confidenceAdjustment: number;
  activeFlags: string[];
  consecutiveNegativeIntervals: number;
  eventMeta: Record<string, unknown> | null;
}

const HALF_DAY_DATES_2026 = [
  "2026-01-02",
  "2026-07-02",
  "2026-11-27",
  "2026-12-24",
];

const MAX_SNAPSHOTS = 50;

let snapshots: Snapshot[] = [];
let snapshotIdCounter = 0;
let currentState: DeltaState = "AWAITING_BASELINE";
let preDegradesState: DeltaState = "AWAITING_BASELINE";
let stateEnteredAt: number | null = null;
let triggeredBy: TriggeredBy = null;
let consecutiveNegativeIntervals = 0;
let consecutiveNeg_A = 0;
let consecutiveNeg_B = 0;
let riskIncreasingFlag = false;
let broadDeteriorationFlag = false;

let primaryBaseline: Snapshot | null = null;
let effectiveBaseline: Snapshot | null = null;
let baselineWasReset = false;

let lastClearDate = "";

const trinBuffer: Array<{ ts: number; value: number }> = [];
const TRIN_BUFFER_WINDOW = 300_000;

interface QueueItem {
  label: SnapshotLabel;
  triggerType: TriggerType;
  eventMeta?: Record<string, unknown>;
  enqueuedAt?: number;
}

const snapshotQueue: QueueItem[] = [];
let queueProcessing = false;

let scheduledTimers: ReturnType<typeof setTimeout>[] = [];

function nowET(): Date {
  const s = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(s);
}

function todayDateET(): string {
  const d = nowET();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function minutesSinceMidnightET(): number {
  const d = nowET();
  return d.getHours() * 60 + d.getMinutes();
}

function isHalfDay(): boolean {
  return HALF_DAY_DATES_2026.includes(todayDateET());
}

function isWeekday(): boolean {
  const d = nowET();
  const day = d.getDay();
  return day >= 1 && day <= 5;
}

function clearSessionIfNeeded() {
  const today = todayDateET();
  if (lastClearDate !== today) {
    snapshots = [];
    snapshotIdCounter = 0;
    currentState = "AWAITING_BASELINE";
    preDegradesState = "AWAITING_BASELINE";
    stateEnteredAt = null;
    triggeredBy = null;
    consecutiveNegativeIntervals = 0;
    consecutiveNeg_A = 0;
    consecutiveNeg_B = 0;
    riskIncreasingFlag = false;
    broadDeteriorationFlag = false;
    primaryBaseline = null;
    effectiveBaseline = null;
    baselineWasReset = false;
    trinBuffer.length = 0;
    snapshotQueue.length = 0;
    lastClearDate = today;
    logger.info("Delta engine session cleared for new day");
  }
}

function getTodMultiplier(): number {
  const mins = minutesSinceMidnightET();
  if (mins < 615 + 45) return 0.55;
  if (mins < 780) return 1.0;
  if (mins < 870) return 1.15;
  return 1.25;
}

function fetchRawIndicators(): { raw: RawIndicatorValues; timestamps: Partial<IndicatorTimestamps> } {
  const schwabSnap = getSnapshot();
  const schwabMap = new Map<string, LiveQuote>();
  for (const q of schwabSnap) schwabMap.set(q.symbol, q);

  const ibSnap = getIBSnapshot();
  const ibMap = new Map<string, LiveQuote>();
  for (const q of ibSnap) ibMap.set(q.symbol, q);

  function findQuote(symbols: string[]): LiveQuote | null {
    for (const s of symbols) {
      const q = schwabMap.get(s) ?? ibMap.get(s) ?? getIBCachedQuote(s);
      if (q && q.last !== null) return q;
    }
    return null;
  }

  const advnQ = findQuote(["$ADVN", "ADVN", "NYSE-ADVN"]);
  const decnQ = findQuote(["$DECN", "DECN", "NYSE-DECN"]);
  const uvolQ = findQuote(["$UVOL", "UVOL", "NYSE-UVOL"]);
  const dvolQ = findQuote(["$DVOL", "DVOL", "NYSE-DVOL"]);
  const trinQ = findQuote(["$TRIN", "TRIN", "NYSE-TRIN"]);
  const vixQ = findQuote(["$VIX", "VIX"]);
  const advnqQ = findQuote(["$ADVNQ", "ADVNQ", "NASDAQ-ADVN"]);
  const decnqQ = findQuote(["$DECNQ", "DECNQ", "NASDAQ-DECN"]);
  const uvolqQ = findQuote(["$UVOLQ", "UVOLQ", "NASDAQ-UVOL"]);
  const dvolqQ = findQuote(["$DVOLQ", "DVOLQ", "NASDAQ-DVOL"]);
  const esQ = findQuote(["/ES", "ES"]);

  const now = Date.now();
  const timestamps: Partial<IndicatorTimestamps> = {};
  if (advnQ) timestamps.ADVN = advnQ.ts ?? now;
  if (decnQ) timestamps.DECN = decnQ.ts ?? now;
  if (uvolQ) timestamps.UVOL = uvolQ.ts ?? now;
  if (dvolQ) timestamps.DVOL = dvolQ.ts ?? now;
  if (trinQ) timestamps.TRIN = trinQ.ts ?? now;
  if (vixQ) timestamps.VIX = vixQ.ts ?? now;

  if (trinQ && trinQ.last !== null) {
    const cutoff = now - TRIN_BUFFER_WINDOW;
    while (trinBuffer.length > 0 && trinBuffer[0].ts < cutoff) trinBuffer.shift();
    trinBuffer.push({ ts: now, value: trinQ.last });
  }

  return {
    raw: {
      ADVN: advnQ?.last ?? null,
      DECN: decnQ?.last ?? null,
      UVOL: uvolQ?.last ?? null,
      DVOL: dvolQ?.last ?? null,
      TRIN: trinQ?.last ?? null,
      VIX: vixQ?.last ?? null,
      ADVN_Q: advnqQ?.last ?? null,
      DECN_Q: decnqQ?.last ?? null,
      UVOL_Q: uvolqQ?.last ?? null,
      DVOL_Q: dvolqQ?.last ?? null,
      ES: esQ?.last ?? null,
    },
    timestamps,
  };
}

function computeSmoothedTrin(): number | null {
  const now = Date.now();
  const cutoff = now - TRIN_BUFFER_WINDOW;
  const valid = trinBuffer.filter(e => e.ts >= cutoff);
  if (valid.length === 0) return null;
  if (valid.length < 3) {
    logger.warn({ count: valid.length }, "Delta engine: fewer than 3 TRIN entries for EMA, using raw latest");
    return valid[valid.length - 1].value;
  }
  const alpha = 2 / (valid.length + 1);
  let ema = valid[0].value;
  for (let i = 1; i < valid.length; i++) {
    ema = alpha * valid[i].value + (1 - alpha) * ema;
  }
  return ema;
}

function normalize(raw: RawIndicatorValues): NormalizedValues {
  let p: number | null = null;
  const advn = raw.ADVN;
  const decn = raw.DECN;
  if (advn !== null && decn !== null) {
    const total = advn + decn;
    if (total > 0) {
      const pNyse = (advn - decn) / total;
      if (raw.ADVN_Q !== null && raw.DECN_Q !== null) {
        const totalQ = raw.ADVN_Q + raw.DECN_Q;
        if (totalQ > 0) {
          const pNasdaq = (raw.ADVN_Q - raw.DECN_Q) / totalQ;
          p = (pNyse + pNasdaq) / 2;
        } else {
          p = pNyse;
        }
      } else {
        p = pNyse;
      }
    }
  }

  let v = 0;
  const uvol = raw.UVOL ?? 0;
  const dvol = raw.DVOL ?? 0;
  if (uvol === 0 && dvol === 0) {
    v = 0;
  } else {
    let vNyse = Math.log((uvol + 1) / (dvol + 1));
    if (raw.UVOL_Q !== null && raw.DVOL_Q !== null) {
      const vNasdaq = Math.log((raw.UVOL_Q + 1) / (raw.DVOL_Q + 1));
      v = (vNyse + vNasdaq) / 2;
    } else {
      v = vNyse;
    }
  }

  const smoothedTrin = computeSmoothedTrin();
  let r: number | null = null;
  if (smoothedTrin !== null && smoothedTrin > 0) {
    r = -Math.log(smoothedTrin);
  }

  const x: number | null = raw.VIX;

  return { p, v, r, x };
}

function isDegraded(raw: RawIndicatorValues, timestamps: Partial<IndicatorTimestamps>): boolean {
  const now = Date.now();
  const requiredKeys: (keyof IndicatorTimestamps)[] = ["ADVN", "DECN", "UVOL", "DVOL", "TRIN", "VIX"];
  for (const key of requiredKeys) {
    const ts = timestamps[key];
    if (!ts) return true;
    if ((now - ts) > 120_000) return true;
  }
  if (raw.ADVN === null || raw.DECN === null || raw.UVOL === null || raw.DVOL === null || raw.TRIN === null || raw.VIX === null) return true;
  const advn = raw.ADVN ?? 0;
  const decn = raw.DECN ?? 0;
  if (advn + decn < 500) return true;
  if (raw.TRIN === 0) return true;
  if (raw.VIX === 0) return true;
  return false;
}

function computeDeltas(current: NormalizedValues, reference: NormalizedValues) {
  const delta_p = (current.p ?? 0) - (reference.p ?? 0);
  const delta_v = current.v - reference.v;
  const delta_r = (current.r ?? 0) - (reference.r ?? 0);
  const refX = reference.x ?? 0;
  const delta_x_pct = refX !== 0 ? ((current.x ?? 0) - refX) / refX : 0;
  return { delta_p, delta_v, delta_r, delta_x_pct };
}

function computeB(deltas: { delta_p: number; delta_v: number; delta_r: number }): number {
  return 0.45 * deltas.delta_p + 0.35 * deltas.delta_v + 0.20 * deltas.delta_r;
}

function processSnapshot(item: QueueItem) {
  clearSessionIfNeeded();

  const { raw, timestamps } = fetchRawIndicators();
  const degraded = isDegraded(raw, timestamps);
  const normalized = normalize(raw);

  const now = Date.now();
  const sourceAges: Partial<Record<keyof IndicatorTimestamps, number>> = {};
  for (const [k, ts] of Object.entries(timestamps)) {
    sourceAges[k as keyof IndicatorTimestamps] = Math.round((now - ts) / 1000);
  }

  const snap: Snapshot = {
    id: ++snapshotIdCounter,
    timestamp: now,
    label: item.label,
    triggerType: item.triggerType,
    degraded,
    raw,
    sourceTimestamps: timestamps,
    sourceAges,
    normalized,
    intervalDeltas: null,
    sessionDeltas: null,
    B_interval: 0,
    B_session: 0,
    D_final: 0,
    D_scaled: 0,
    delta_p_scaled: 0,
    state: currentState,
    confidenceAdjustment: 0,
    activeFlags: [],
    consecutiveNegativeIntervals,
    eventMeta: item.eventMeta ?? null,
  };

  if (item.label === "PRE_MARKET") {
    snap.state = "AWAITING_BASELINE";
    storeSnapshot(snap);
    logger.info({ id: snap.id, raw: snap.raw }, "Delta engine: PRE_MARKET snapshot stored (not scored)");
    return;
  }

  if (item.label === "BASELINE") {
    primaryBaseline = snap;
    effectiveBaseline = snap;
    baselineWasReset = false;
    currentState = "HEALTHY";
    stateEnteredAt = now;
    snap.state = "HEALTHY";
    snap.confidenceAdjustment = 0;
    storeSnapshot(snap);
    logger.info({ id: snap.id }, "Delta engine: BASELINE established");
    return;
  }

  if (item.label === "BASELINE_CONFIRM" && primaryBaseline) {
    const pDiff = Math.abs((normalized.p ?? 0) - (primaryBaseline.normalized.p ?? 0));
    const vDiff = Math.abs(normalized.v - primaryBaseline.normalized.v);
    const xRef = primaryBaseline.normalized.x ?? 0;
    const xPctDiff = xRef !== 0 ? Math.abs(((normalized.x ?? 0) - xRef) / xRef) : 0;

    if (pDiff > 0.05 || vDiff > 0.10 || xPctDiff > 0.03) {
      effectiveBaseline = snap;
      baselineWasReset = true;
      logger.info({ pDiff, vDiff, xPctDiff }, "Delta engine: effective baseline reset to BASELINE_CONFIRM");
    }
  }

  if (!effectiveBaseline) {
    snap.state = "AWAITING_BASELINE";
    storeSnapshot(snap);
    return;
  }

  if (degraded) {
    if (currentState !== "DEGRADED") {
      preDegradesState = currentState;
    }
    currentState = "DEGRADED";
    snap.state = "DEGRADED";
    snap.confidenceAdjustment = 0;
    storeSnapshot(snap);
    logger.warn({ id: snap.id }, "Delta engine: DEGRADED snapshot — skipping state transition");
    return;
  }

  if (currentState === "DEGRADED") {
    currentState = preDegradesState;
    logger.info({ restoredState: currentState }, "Delta engine: data quality recovered, restoring state");
  }

  const lastScored = getLastScoredSnapshot();

  let intervalThresholdScale = 1.0;
  if (lastScored) {
    const elapsedMs = now - lastScored.timestamp;
    const elapsedMin = elapsedMs / 60_000;
    if (elapsedMin > 60) {
      effectiveBaseline = snap;
      baselineWasReset = true;
      logger.info({ elapsedMin }, "Delta engine: hard baseline reset after >60 min data gap");
    } else if (elapsedMin > 30) {
      intervalThresholdScale = elapsedMin / 30;
    }
  }

  const sessionDelta = computeDeltas(normalized, effectiveBaseline.normalized);
  snap.sessionDeltas = sessionDelta;
  snap.B_session = computeB(sessionDelta);

  if (baselineWasReset && primaryBaseline && primaryBaseline !== effectiveBaseline) {
    snap.primarySessionDeltas = computeDeltas(normalized, primaryBaseline.normalized);
  }

  if (lastScored) {
    const intervalDelta = computeDeltas(normalized, lastScored.normalized);
    snap.intervalDeltas = intervalDelta;
    snap.B_interval = computeB(intervalDelta);
  } else {
    snap.intervalDeltas = { delta_p: 0, delta_v: 0, delta_r: 0, delta_x_pct: 0 };
    snap.B_interval = 0;
  }

  const D_interval = snap.B_interval;
  const D_session = snap.B_session;
  snap.D_final = 0.50 * D_interval + 0.50 * D_session;

  const todMult = getTodMultiplier();
  snap.D_scaled = snap.D_final * todMult;

  const delta_p_interval = snap.intervalDeltas?.delta_p ?? 0;
  const delta_p_session = sessionDelta.delta_p;
  const delta_p_scaled_interval = delta_p_interval * todMult;
  const delta_p_scaled_session = delta_p_session * todMult;
  snap.delta_p_scaled = delta_p_scaled_session;

  const D_s = snap.D_scaled;
  const dps_interval = delta_p_scaled_interval;
  const dps_session = delta_p_scaled_session;

  const intervalNeg_A = D_s < -0.015 * intervalThresholdScale;
  const intervalNeg_B = dps_interval < -0.025 * intervalThresholdScale;

  if (intervalNeg_A) {
    consecutiveNeg_A++;
  } else if (D_s >= 0) {
    consecutiveNeg_A = 0;
  }
  if (intervalNeg_B) {
    consecutiveNeg_B++;
  } else if (dps_interval >= 0) {
    consecutiveNeg_B = 0;
  }
  consecutiveNegativeIntervals = Math.max(consecutiveNeg_A, consecutiveNeg_B);
  snap.consecutiveNegativeIntervals = consecutiveNegativeIntervals;

  const prevState = currentState;
  runStateMachine(snap, D_s, D_session, dps_interval, dps_session, sessionDelta.delta_x_pct, intervalThresholdScale);

  snap.state = currentState;
  snap.confidenceAdjustment = getConfidenceAdjustment();

  updateFlags(snap, sessionDelta.delta_x_pct);
  snap.activeFlags = getActiveFlags();

  storeSnapshot(snap);
  logger.info({
    id: snap.id,
    label: snap.label,
    state: snap.state,
    D_final: round4(snap.D_final),
    D_scaled: round4(snap.D_scaled),
    delta_p_session: round4(delta_p_session),
    triggeredBy,
    prevState,
  }, "Delta engine snapshot processed");
}

function runStateMachine(
  snap: Snapshot,
  D_scaled: number,
  D_session_raw: number,
  dps_interval: number,
  dps_session: number,
  delta_x_session_pct: number,
  thresholdScale: number,
) {
  const sess_D = D_session_raw * getTodMultiplier();

  const consec2_A = consecutiveNeg_A >= 2;
  const consec2_B = consecutiveNeg_B >= 2;

  const pathA_interval_neg = D_scaled < -0.015 * thresholdScale;
  const pathA_session_neg = sess_D < -0.015;
  const pathB_interval_neg = dps_interval < -0.025 * thresholdScale;
  const pathB_session_neg = dps_session < -0.03;

  const pathA_interval_ok = D_scaled >= 0;
  const pathB_interval_ok = dps_interval >= 0;

  const currentOk = pathA_interval_ok && pathB_interval_ok;
  const prevScored = getPreviousScoredSnapshots(1);
  const prevOk = prevScored.length >= 1 &&
    (prevScored[0].D_scaled >= 0) && ((prevScored[0].intervalDeltas?.delta_p ?? 0) * getTodMultiplier() >= 0);
  const twoConsecOk = currentOk && prevOk;

  switch (currentState) {
    case "AWAITING_BASELINE":
      break;

    case "HEALTHY":
      if (pathA_interval_neg || pathA_session_neg) {
        currentState = "SOFTENING";
        stateEnteredAt = snap.timestamp;
        triggeredBy = "composite";
      } else if (pathB_interval_neg || pathB_session_neg) {
        currentState = "SOFTENING";
        stateEnteredAt = snap.timestamp;
        triggeredBy = "participation";
      }
      break;

    case "SOFTENING":
      if (currentOk) {
        currentState = "HEALTHY";
        stateEnteredAt = snap.timestamp;
        triggeredBy = null;
      } else if (
        (consec2_A && pathA_interval_neg) ||
        sess_D < -0.035 ||
        (consec2_B && pathB_interval_neg) ||
        dps_session < -0.06
      ) {
        currentState = "FADING";
        stateEnteredAt = snap.timestamp;
        if (sess_D < -0.035 || (consec2_A && pathA_interval_neg)) {
          triggeredBy = "composite";
        } else {
          triggeredBy = "participation";
        }
      }
      break;

    case "FADING":
      if (twoConsecOk) {
        currentState = "SOFTENING";
        stateEnteredAt = snap.timestamp;
      } else if (
        (sess_D < -0.08 && delta_x_session_pct > 0.03) ||
        (dps_session < -0.10 && delta_x_session_pct > 0.03)
      ) {
        currentState = "REVERSING";
        stateEnteredAt = snap.timestamp;
        if (sess_D < -0.08) {
          triggeredBy = "composite";
        } else {
          triggeredBy = "participation";
        }
      }
      break;

    case "REVERSING":
      if (twoConsecOk && (snap.intervalDeltas?.delta_x_pct ?? 0) < 0) {
        currentState = "FADING";
        stateEnteredAt = snap.timestamp;
      }
      break;

    case "DEGRADED":
      break;
  }
}

function getConfidenceAdjustment(): number {
  switch (currentState) {
    case "SOFTENING": return -10;
    case "FADING": return -20;
    case "REVERSING": return -35;
    default: return 0;
  }
}

function updateFlags(snap: Snapshot, delta_x_interval_pct: number) {
  const isFadingOrReversing = currentState === "FADING" || currentState === "REVERSING";
  const vixIntervalUp = (snap.intervalDeltas?.delta_x_pct ?? 0) > 0;

  if (isFadingOrReversing && vixIntervalUp) {
    riskIncreasingFlag = true;
  } else if (currentState === "HEALTHY" || currentState === "SOFTENING" || !vixIntervalUp) {
    riskIncreasingFlag = false;
  }

  const baselineEs = effectiveBaseline?.raw.ES ?? null;
  const esIntervalChange = snap.raw.ES !== null && baselineEs !== null
    ? ((snap.raw.ES - baselineEs) / baselineEs) * 100
    : 0;

  if (isFadingOrReversing && vixIntervalUp && esIntervalChange < -0.5) {
    broadDeteriorationFlag = true;
  } else {
    broadDeteriorationFlag = false;
  }
}

function getActiveFlags(): string[] {
  const flags: string[] = [];
  if (riskIncreasingFlag) flags.push("RISK_INCREASING");
  if (broadDeteriorationFlag) flags.push("BROAD_DETERIORATION");
  return flags;
}

function storeSnapshot(snap: Snapshot) {
  snapshots.push(snap);
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots = snapshots.slice(-MAX_SNAPSHOTS);
  }
}

function getLastScoredSnapshot(): Snapshot | null {
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const s = snapshots[i];
    if (!s.degraded && s.label !== "PRE_MARKET" && s.state !== "AWAITING_BASELINE") return s;
  }
  return null;
}

function getPreviousScoredSnapshots(count: number): Snapshot[] {
  const result: Snapshot[] = [];
  for (let i = snapshots.length - 1; i >= 0 && result.length < count; i--) {
    const s = snapshots[i];
    if (!s.degraded && s.label !== "PRE_MARKET" && s.state !== "AWAITING_BASELINE") {
      result.push(s);
    }
  }
  return result;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

const MAX_QUEUE = 3;

function enqueueSnapshot(item: QueueItem) {
  if (item.triggerType === "scheduled") {
    const now = Date.now();
    const recentScheduled = snapshotQueue.find(
      q => q.triggerType === "scheduled" && q.enqueuedAt && (now - q.enqueuedAt) < 60_000
    );
    if (recentScheduled) {
      recentScheduled.label = item.label;
      logger.info({ label: item.label }, "Delta engine: merged scheduled snapshot within 60s window");
      return;
    }
  }

  if (snapshotQueue.length >= MAX_QUEUE) {
    snapshotQueue.shift();
    logger.warn("Delta engine: queue overflow, dropping oldest item");
  }
  (item as QueueItem & { enqueuedAt: number }).enqueuedAt = Date.now();
  snapshotQueue.push(item);
  processQueue();
}

async function processQueue() {
  if (queueProcessing) return;
  queueProcessing = true;
  while (snapshotQueue.length > 0) {
    const item = snapshotQueue.shift()!;
    try {
      processSnapshot(item);
    } catch (err) {
      logger.error({ err }, "Delta engine: snapshot processing error");
    }
  }
  queueProcessing = false;
}

export function triggerManualSnapshot() {
  clearSessionIfNeeded();
  const label: SnapshotLabel = effectiveBaseline ? "INTRADAY" : "BASELINE";
  enqueueSnapshot({ label, triggerType: "manual" });
}

export function triggerEventSnapshot(eventMeta?: Record<string, unknown>) {
  clearSessionIfNeeded();
  const label: SnapshotLabel = effectiveBaseline ? "INTRADAY" : "BASELINE";
  enqueueSnapshot({ label, triggerType: "event", eventMeta });
}

export function getDeltaHealth(): DeltaHealthPayload | null {
  clearSessionIfNeeded();
  if (currentState === "AWAITING_BASELINE" && snapshots.length === 0) return null;

  const lastSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const todMult = getTodMultiplier();
  const scored = getLastScoredSnapshot();

  return {
    state: currentState,
    triggeredBy,
    D_final: round4(scored?.D_final ?? 0),
    D_scaled: round4(scored?.D_scaled ?? 0),
    B_interval: round4(scored?.B_interval ?? 0),
    B_session: round4(scored?.B_session ?? 0),
    delta_p_session: round4(scored?.primarySessionDeltas?.delta_p ?? scored?.sessionDeltas?.delta_p ?? 0),
    delta_p_scaled_session: round4(scored?.delta_p_scaled ?? 0),
    delta_x_session_pct: round4(scored?.sessionDeltas?.delta_x_pct ?? 0),
    confidenceAdjustment: getConfidenceAdjustment(),
    flags: getActiveFlags(),
    baselineTimestamp: effectiveBaseline
      ? new Date(effectiveBaseline.timestamp).toISOString()
      : "",
    baselineType: baselineWasReset ? "effective" : "primary",
    primaryBaselineTimestamp: primaryBaseline
      ? new Date(primaryBaseline.timestamp).toISOString()
      : "",
    lastSnapshotTimestamp: lastSnap
      ? new Date(lastSnap.timestamp).toISOString()
      : "",
    snapshotsThisSession: snapshots.length,
    todMultiplier: todMult,
    consecutiveNegativeIntervals,
    stateEnteredAt: stateEnteredAt ? new Date(stateEnteredAt).toISOString() : null,
  };
}

export function getSnapshotsForAI(): Array<{ label: string; timestamp: number; raw: RawIndicatorValues }> {
  return snapshots
    .filter(s => s.label === "PRE_MARKET")
    .map(s => ({ label: s.label, timestamp: s.timestamp, raw: s.raw }));
}

function buildSchedule() {
  for (const t of scheduledTimers) clearTimeout(t);
  scheduledTimers = [];

  if (!isWeekday()) {
    logger.info("Delta engine: weekend — no schedule");
    return;
  }

  const half = isHalfDay();
  const now = new Date();
  const todayStr = todayDateET();

  function scheduleAt(h: number, m: number, label: SnapshotLabel) {
    const etStr = `${todayStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
    const target = new Date(new Date(etStr + "-05:00").getTime());
    const isDST = (() => {
      const jan = new Date(`${todayStr.substring(0, 4)}-01-15T12:00:00-05:00`);
      const jul = new Date(`${todayStr.substring(0, 4)}-07-15T12:00:00-04:00`);
      const janOffset = jan.getTimezoneOffset();
      const julOffset = jul.getTimezoneOffset();
      const nowD = new Date();
      const nowOffset = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
        .formatToParts(nowD)
        .find(p => p.type === "timeZoneName")?.value;
      return nowOffset?.includes("-4") || nowOffset?.includes("EDT");
    })();
    const offset = isDST ? "-04:00" : "-05:00";
    const realTarget = new Date(`${todayStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00${offset}`);
    const delay = realTarget.getTime() - now.getTime();
    if (delay <= 0) return;
    const timer = setTimeout(() => {
      enqueueSnapshot({ label, triggerType: "scheduled" });
    }, delay);
    scheduledTimers.push(timer);
  }

  if (half) {
    const openMin = 570;
    const closeMin = 780;
    const baselineMin = openMin + 45;
    const preCloseMin = closeMin - 15;

    const baseH = Math.floor(baselineMin / 60);
    const baseM = baselineMin % 60;
    scheduleAt(baseH, baseM, "BASELINE");

    for (let m = baselineMin + 30; m < preCloseMin; m += 30) {
      scheduleAt(Math.floor(m / 60), m % 60, "INTRADAY");
    }
    scheduleAt(Math.floor(preCloseMin / 60), preCloseMin % 60, "PRE_CLOSE");
  } else {
    scheduleAt(9, 15, "PRE_MARKET");
    scheduleAt(10, 15, "BASELINE");
    scheduleAt(10, 45, "BASELINE_CONFIRM");

    for (let mins = 11 * 60 + 15; mins <= 15 * 60 + 15; mins += 30) {
      scheduleAt(Math.floor(mins / 60), mins % 60, "INTRADAY");
    }
    scheduleAt(15, 45, "PRE_CLOSE");
  }

  logger.info({ half, timers: scheduledTimers.length }, "Delta engine: schedule built");
}

let scheduleRebuildTimer: ReturnType<typeof setInterval> | null = null;

export function initDeltaEngine() {
  clearSessionIfNeeded();
  buildSchedule();

  if (scheduleRebuildTimer) clearInterval(scheduleRebuildTimer);
  scheduleRebuildTimer = setInterval(() => {
    clearSessionIfNeeded();
    buildSchedule();
  }, 6 * 3600_000);

  logger.info("Delta engine initialized");
}
