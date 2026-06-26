import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Config } from "./types.js";

const CONFIG_PATH = path.resolve(process.cwd(), "config.yaml");

// Canonical defaults — all strategy params live here
const DEFAULTS: Config = {
  symbol: "",
  symbols: [],
  accountHash: "",
  setup: "swing",

  // Engine selection
  engine: "deterministic",
  modelId: "claude-opus-4-8",

  // Opening range (legacy ORB)
  orWindowMinutes: 15,
  rvolThreshold: 1.5,
  stopMode: "or_low",
  atrK: 1.0,
  rTarget: 1.5,
  minTargetOverSpread: 3,

  // Momentum setup (active "swing" strategy)
  breakoutLookback: 10,
  momVolRatioMin: 1.5,
  momRvolMin: 1.0,
  momRsiMin: 55,
  momRsiMax: 70,
  momStopAtrMult: 1.5,
  momTrailAtrMult: 1.0,
  volumeProfileLookbackDays: 20,

  // Legacy swing knobs (unused by momentum; kept for ORB / back-compat)
  bodyAvgWindow: 10,
  volAvgWindow: 20,
  directionLookback: 5,
  vwapBandAtrMult: 2.0,
  belowVwapStretchThreshold: 0.6,
  volDryingThreshold: 1.0,
  reversalVolRatioMin: 1.2,
  rsiEntryMin: 25,
  rsiEntryMax: 55,
  swingTargetRail: "vwap",
  stopBelowRailAtrMult: 0.5,

  // Dollar risk (operative controls for both engines)
  totalBudget: 1000,
  maxPerTrade: 300,
  dailyMaxLoss: 100,
  pollIntervalSec: 60,
  lossStreakLimit: 3,
  cooldownMinutes: 60,
  tradesPerDay: 40,
  enableShorts: false,

  // Session controls
  enableExtendedHours: false,
  flattenAtClose: true,

  // Execution
  cancelTimeoutSeconds: 30,
  timeStop: "15:55",
  logDb: "autotrader/engine.db",
};

let _cfg: Config | null = null;

/** Normalize, dedupe and upper-case a symbol list. */
function normalizeSymbols(value: unknown, legacySymbol: string): string[] {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [...list, legacySymbol]) {
    if (typeof raw !== "string") continue;
    const sym = raw.trim().toUpperCase();
    if (!sym || seen.has(sym) || !/^[A-Z.\-]{1,12}$/.test(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out.slice(0, 50);
}

function validate(cfg: Config): void {
  if (!cfg.symbols.length) throw new Error("config.yaml: at least one symbol is required");
  if (!cfg.accountHash) {
    throw new Error("config.yaml: accountHash is required (the engine places real orders)");
  }
  if (cfg.setup !== "orb" && cfg.setup !== "swing") {
    throw new Error('config.yaml: setup must be "orb" or "swing"');
  }
  if (cfg.engine !== "deterministic" && cfg.engine !== "llm") {
    throw new Error('config.yaml: engine must be "deterministic" or "llm"');
  }
  if (cfg.maxPerTrade <= 0) throw new Error("config.yaml: maxPerTrade must be > 0");
  if (cfg.totalBudget <= 0) throw new Error("config.yaml: totalBudget must be > 0");
  if (cfg.dailyMaxLoss <= 0) throw new Error("config.yaml: dailyMaxLoss must be > 0");
  if (cfg.pollIntervalSec < 5) throw new Error("config.yaml: pollIntervalSec must be ≥ 5");
  if (cfg.rTarget <= 0) throw new Error("config.yaml: rTarget must be > 0");
  if (cfg.orWindowMinutes < 1 || cfg.orWindowMinutes > 60) {
    throw new Error("config.yaml: orWindowMinutes must be 1–60");
  }
  if (cfg.stopMode !== "or_low" && cfg.stopMode !== "atr") {
    throw new Error('config.yaml: stopMode must be "or_low" or "atr"');
  }
  if (cfg.vwapBandAtrMult <= 0) throw new Error("config.yaml: vwapBandAtrMult must be > 0");
  if (cfg.swingTargetRail !== "vwap" && cfg.swingTargetRail !== "upper") {
    throw new Error('config.yaml: swingTargetRail must be "vwap" or "upper"');
  }
}

export function loadConfig(): Config {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = parseYaml(raw) as Partial<Config>;
  const cfg: Config = { ...DEFAULTS, ...parsed };
  cfg.symbol = (cfg.symbol ?? "").toUpperCase();
  cfg.symbols = normalizeSymbols(parsed.symbols, cfg.symbol);
  // Keep the legacy scalar in sync so downstream code that still reads it works.
  cfg.symbol = cfg.symbols[0] ?? "";
  validate(cfg);
  _cfg = cfg;
  return cfg;
}

export function getConfig(): Config {
  if (!_cfg) throw new Error("Engine config not loaded — call loadConfig() first");
  return _cfg;
}

export function updateConfig(patch: Partial<Config>): Config {
  if (!_cfg) throw new Error("Engine config not loaded");
  _cfg = { ..._cfg, ...patch };
  return _cfg;
}

/** True if config.yaml exists at the repo root. */
export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

/** Return the parsed YAML as-is for the config API endpoint. */
export function readRawConfig(): Record<string, unknown> {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return parseYaml(fs.readFileSync(CONFIG_PATH, "utf8")) ?? {};
}

/** Write a patch back to config.yaml (preserves unrelated fields). */
export function writeConfigPatch(patch: Record<string, unknown>): void {
  const existing = readRawConfig();
  const updated = { ...existing, ...patch };
  fs.writeFileSync(CONFIG_PATH, stringifyYaml(updated), "utf8");
  _cfg = null; // force reload on next getConfig()
}
