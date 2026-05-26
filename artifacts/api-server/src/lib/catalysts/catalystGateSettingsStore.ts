import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_CATALYST_GATE_SETTINGS,
  normalizeCatalystGateSettings,
  type CatalystGateSettings,
} from "@workspace/catalysts-types";

const SETTINGS_PATH = path.join(
  process.cwd(),
  ".data",
  "catalyst-gate-settings.json",
);

let cached: CatalystGateSettings = { ...DEFAULT_CATALYST_GATE_SETTINGS };

export function getCatalystGateSettings(): CatalystGateSettings {
  return { ...cached };
}

export async function loadCatalystGateSettings(): Promise<CatalystGateSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<CatalystGateSettings>;
    cached = normalizeCatalystGateSettings(parsed);
  } catch {
    cached = { ...DEFAULT_CATALYST_GATE_SETTINGS };
  }
  return getCatalystGateSettings();
}

export async function saveCatalystGateSettings(
  next: Partial<CatalystGateSettings>,
): Promise<CatalystGateSettings> {
  cached = normalizeCatalystGateSettings({ ...cached, ...next });
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(cached, null, 2), "utf8");
  return getCatalystGateSettings();
}
