import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Config } from "./types.js";

const CONFIG_PATH = path.resolve(process.cwd(), "config.yaml");

// Canonical defaults — all strategy params live here
const DEFAULTS: Config = {
  symbol: "",
  accountHash: "",
  orWindowMinutes: 15,
  rvolThreshold: 1.5,
  stopMode: "or_low",
  atrK: 1.0,
  rTarget: 1.5,
  minTargetOverSpread: 3,
  dailyLossHaltPct: 0.03,
  riskPerTradePct: 0.01,
  maxPositionSizePct: 0.20,
  lossStreakLimit: 3,
  cooldownMinutes: 60,
  tradesPerDay: 3,
  enableShorts: false,
  runMode: "shadow",
  cancelTimeoutSeconds: 30,
  timeStop: "15:55",
  startingEquity: 1000,
  logDb: "autotrader/engine.db",
};

let _cfg: Config | null = null;

function validate(cfg: Config): void {
  if (!cfg.symbol) throw new Error("config.yaml: symbol is required");
  if (cfg.runMode === "live" && !cfg.accountHash) {
    throw new Error("config.yaml: accountHash is required for live mode");
  }
  if (cfg.rTarget <= 0) throw new Error("config.yaml: rTarget must be > 0");
  if (cfg.orWindowMinutes < 1 || cfg.orWindowMinutes > 60) {
    throw new Error("config.yaml: orWindowMinutes must be 1–60");
  }
  if (cfg.stopMode !== "or_low" && cfg.stopMode !== "atr") {
    throw new Error('config.yaml: stopMode must be "or_low" or "atr"');
  }
  if (cfg.runMode !== "shadow" && cfg.runMode !== "live") {
    throw new Error('config.yaml: runMode must be "shadow" or "live"');
  }
}

export function loadConfig(): Config {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const parsed = parseYaml(raw) as Partial<Config>;
  const cfg: Config = { ...DEFAULTS, ...parsed };
  cfg.symbol = (cfg.symbol ?? "").toUpperCase();
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
