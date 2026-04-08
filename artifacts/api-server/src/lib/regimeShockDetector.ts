import type { MarketIndicators } from "./marketPulseEngine.js";
import { logFailure } from "./telemetry.js";

export type ShockState = "NORMAL" | "WARNING" | "ACTIVE" | "COOLING";

export type TriggerName =
  | "VIX_SPIKE"
  | "ES_CRASH"
  | "CREDIT_SPREAD_BLOW"
  | "SKEW_COLLAPSE"
  | "BREADTH_FLIP"
  | "PCSPY_EXTREME";

export interface ShockTriggerEvent {
  trigger: TriggerName;
  value: number;
  threshold: number;
  firedAt: number;
}

export interface ShockDetectorOutput {
  shockState: ShockState;
  activeTriggers: ShockTriggerEvent[];
  shockActivatedAt: number | null;
  shockActive: boolean;
  previousState: ShockState;
  transitionedAt: number | null;
}

const WINDOW_MS = 30 * 60 * 1000;
const COOLING_MS = 60 * 60 * 1000;
const WARNING_THRESHOLD = 2;
const ACTIVE_THRESHOLD = 3;
const ROLLING_DAYS = 20;
const MIN_ROLLING_DAYS = 5;
const BOOTSTRAP_SIGMA = 2.0;
const CREDIT_SIGMA = 1.5;
const PCSPY_SIGMA = 2.0;

interface RollingBuffer {
  values: number[];
  maxSize: number;
}

function pushRolling(buf: RollingBuffer, val: number) {
  buf.values.push(val);
  if (buf.values.length > buf.maxSize) {
    buf.values.shift();
  }
}

function rollingStats(buf: RollingBuffer): { mean: number; std: number } | null {
  if (buf.values.length < MIN_ROLLING_DAYS) return null;
  const n = buf.values.length;
  const mean = buf.values.reduce((a, b) => a + b, 0) / n;
  const variance = buf.values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  return { mean, std: std || 0.0001 };
}

let currentState: ShockState = "NORMAL";
let triggerHistory: ShockTriggerEvent[] = [];
let shockActivatedAt: number | null = null;
let coolingEnteredAt: number | null = null;
let lastTransitionAt: number | null = null;

let prevAdd: number | null = null;
let prevAddq: number | null = null;
let prevSkew: number | null = null;

const creditSpreadBuffer: RollingBuffer = { values: [], maxSize: ROLLING_DAYS };
const pcspyBuffer: RollingBuffer = { values: [], maxSize: ROLLING_DAYS };

let lastCreditPushDay: string | null = null;
let lastPcspyPushDay: string | null = null;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function pruneWindow(now: number) {
  triggerHistory = triggerHistory.filter(t => now - t.firedAt < WINDOW_MS);
}

function uniqueTriggersInWindow(): Set<TriggerName> {
  const names = new Set<TriggerName>();
  for (const t of triggerHistory) names.add(t.trigger);
  return names;
}

function fireTrigger(name: TriggerName, value: number, threshold: number, now: number) {
  const existing = triggerHistory.find(t => t.trigger === name);
  if (!existing) {
    triggerHistory.push({ trigger: name, value, threshold, firedAt: now });
  }
}

function evaluateTriggers(data: MarketIndicators, now: number) {
  if (data.vix !== null && data.vixChange !== null) {
    const prevVix = data.vix - data.vixChange;
    if (prevVix > 0) {
      const pctChange = (data.vixChange / prevVix) * 100;
      if (Math.abs(pctChange) >= 20) {
        fireTrigger("VIX_SPIKE", pctChange, 20, now);
      }
    }
  }

  if (data.es !== null && data.esChange !== null) {
    if (Math.abs(data.esChange) >= 2.0) {
      fireTrigger("ES_CRASH", data.esChange, -2.0, now);
    }
  }

  if (data.hyg !== null && data.ief !== null) {
    const spread = data.hyg - data.ief;
    const dk = todayKey();
    if (dk !== lastCreditPushDay) {
      pushRolling(creditSpreadBuffer, spread);
      lastCreditPushDay = dk;
    }
    const stats = rollingStats(creditSpreadBuffer);
    if (stats) {
      const sigma = creditSpreadBuffer.values.length < ROLLING_DAYS ? BOOTSTRAP_SIGMA : CREDIT_SIGMA;
      const zScore = (spread - stats.mean) / stats.std;
      if (zScore < -sigma) {
        fireTrigger("CREDIT_SPREAD_BLOW", zScore, -sigma, now);
      }
    }
  }

  if (data.skew !== null) {
    if (prevSkew !== null) {
      const drop = prevSkew - data.skew;
      if (drop >= 10) {
        fireTrigger("SKEW_COLLAPSE", data.skew, prevSkew - 10, now);
      }
    }
    prevSkew = data.skew;
  }

  let addFlipped = false;
  let addqFlipped = false;
  if (data.add !== null) {
    if (prevAdd !== null) {
      const flipped = (prevAdd > 0 && data.add < 0) || (prevAdd < 0 && data.add > 0);
      const magnitude = Math.abs(data.add - prevAdd);
      if (flipped && magnitude > 500) {
        addFlipped = true;
      }
    }
    prevAdd = data.add;
  }
  if (data.addq !== null) {
    if (prevAddq !== null) {
      const flipped = (prevAddq > 0 && data.addq < 0) || (prevAddq < 0 && data.addq > 0);
      const magnitude = Math.abs(data.addq - prevAddq);
      if (flipped && magnitude > 300) {
        addqFlipped = true;
      }
    }
    prevAddq = data.addq;
  }
  if (addFlipped && addqFlipped) {
    fireTrigger("BREADTH_FLIP", data.add ?? 0, 0, now);
  }

  if (data.pcspy !== null) {
    const dk = todayKey();
    if (dk !== lastPcspyPushDay) {
      pushRolling(pcspyBuffer, data.pcspy);
      lastPcspyPushDay = dk;
    }
    const stats = rollingStats(pcspyBuffer);
    if (stats) {
      const sigma = pcspyBuffer.values.length < ROLLING_DAYS ? BOOTSTRAP_SIGMA : PCSPY_SIGMA;
      const zScore = (data.pcspy - stats.mean) / stats.std;
      if (zScore > sigma) {
        fireTrigger("PCSPY_EXTREME", zScore, sigma, now);
      }
    }
  }
}

function transitionState(now: number): { newState: ShockState; transitioned: boolean } {
  const uniqueCount = uniqueTriggersInWindow().size;

  switch (currentState) {
    case "NORMAL": {
      if (uniqueCount >= ACTIVE_THRESHOLD) {
        currentState = "ACTIVE";
        shockActivatedAt = now;
        lastTransitionAt = now;
        return { newState: "ACTIVE", transitioned: true };
      }
      if (uniqueCount >= WARNING_THRESHOLD) {
        currentState = "WARNING";
        lastTransitionAt = now;
        return { newState: "WARNING", transitioned: true };
      }
      break;
    }
    case "WARNING": {
      if (uniqueCount >= ACTIVE_THRESHOLD) {
        currentState = "ACTIVE";
        shockActivatedAt = now;
        lastTransitionAt = now;
        return { newState: "ACTIVE", transitioned: true };
      }
      if (uniqueCount < WARNING_THRESHOLD) {
        currentState = "NORMAL";
        lastTransitionAt = now;
        return { newState: "NORMAL", transitioned: true };
      }
      break;
    }
    case "ACTIVE": {
      if (uniqueCount < ACTIVE_THRESHOLD) {
        currentState = "COOLING";
        coolingEnteredAt = now;
        lastTransitionAt = now;
        return { newState: "COOLING", transitioned: true };
      }
      break;
    }
    case "COOLING": {
      if (uniqueCount >= ACTIVE_THRESHOLD) {
        currentState = "ACTIVE";
        shockActivatedAt = now;
        lastTransitionAt = now;
        coolingEnteredAt = null;
        return { newState: "ACTIVE", transitioned: true };
      }
      if (uniqueCount > 0 && coolingEnteredAt) {
        coolingEnteredAt = now;
      }
      if (coolingEnteredAt && uniqueCount === 0 && now - coolingEnteredAt >= COOLING_MS) {
        currentState = "NORMAL";
        shockActivatedAt = null;
        coolingEnteredAt = null;
        lastTransitionAt = now;
        return { newState: "NORMAL", transitioned: true };
      }
      break;
    }
  }

  return { newState: currentState, transitioned: false };
}

export function evaluateRegimeShock(data: MarketIndicators): ShockDetectorOutput {
  const now = Date.now();
  const previousState = currentState;

  pruneWindow(now);
  evaluateTriggers(data, now);
  const { transitioned } = transitionState(now);

  if (transitioned && previousState !== currentState) {
    const triggers = [...triggerHistory].map(t => t.trigger);
    if (currentState === "ACTIVE") {
      void logFailure("MARKET_PULSE", "CRITICAL", `Regime shock ACTIVE — ${triggers.join(", ")}`, {
        previousState, newState: currentState, activeTriggers: triggers,
      });
    } else if (currentState === "WARNING") {
      void logFailure("MARKET_PULSE", "WARN", `Regime shock WARNING — ${triggers.join(", ")}`, {
        previousState, newState: currentState, activeTriggers: triggers,
      });
    } else if (currentState === "NORMAL" && previousState === "COOLING") {
      void logFailure("MARKET_PULSE", "INFO", "Regime shock resolved — back to NORMAL", {
        previousState, newState: currentState,
      });
    }
  }

  return {
    shockState: currentState,
    activeTriggers: [...triggerHistory],
    shockActivatedAt,
    shockActive: currentState === "ACTIVE",
    previousState,
    transitionedAt: transitioned ? now : lastTransitionAt,
  };
}

export function getShockState(): ShockState {
  return currentState;
}

export function resetShockDetector() {
  currentState = "NORMAL";
  triggerHistory = [];
  shockActivatedAt = null;
  coolingEnteredAt = null;
  lastTransitionAt = null;
  prevAdd = null;
  prevAddq = null;
  prevSkew = null;
}
