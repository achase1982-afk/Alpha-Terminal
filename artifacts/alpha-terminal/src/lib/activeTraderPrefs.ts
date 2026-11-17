/**
 * Sticky exit templates. Armed / auto-send is intentionally absent:
 * that state must not survive a refresh, account change, symbol change, or new session.
 */

export const ACTIVE_TRADER_PREFS_KEY = "alpha-terminal:active-trader-prefs:v1";

export interface ExitTemplate {
  name: string;
  tpEnabled: boolean;
  slEnabled: boolean;
  tpPercent: string;
  slPercent: string;
}

export interface ActiveTraderPrefs {
  version: 1;
  tpEnabled: boolean;
  slEnabled: boolean;
  tpPercent: string;
  slPercent: string;
  templates: ExitTemplate[];
}

export const DEFAULT_ACTIVE_TRADER_PREFS: ActiveTraderPrefs = {
  version: 1,
  tpEnabled: true,
  slEnabled: true,
  tpPercent: "25",
  slPercent: "15",
  templates: [],
};

export function loadActiveTraderPrefs(): ActiveTraderPrefs {
  try {
    const raw = localStorage.getItem(ACTIVE_TRADER_PREFS_KEY);
    if (!raw) return { ...DEFAULT_ACTIVE_TRADER_PREFS, templates: [] };
    const parsed = JSON.parse(raw) as Partial<ActiveTraderPrefs>;
    if (parsed.version !== 1) return { ...DEFAULT_ACTIVE_TRADER_PREFS, templates: [] };
    return {
      version: 1,
      tpEnabled: parsed.tpEnabled !== false,
      slEnabled: parsed.slEnabled !== false,
      tpPercent: typeof parsed.tpPercent === "string" ? parsed.tpPercent : "25",
      slPercent: typeof parsed.slPercent === "string" ? parsed.slPercent : "15",
      templates: Array.isArray(parsed.templates)
        ? parsed.templates.filter((t): t is ExitTemplate => !!t && typeof t.name === "string").slice(0, 12)
        : [],
    };
  } catch {
    return { ...DEFAULT_ACTIVE_TRADER_PREFS, templates: [] };
  }
}

export function saveActiveTraderPrefs(prefs: ActiveTraderPrefs): void {
  const stored: ActiveTraderPrefs = {
    version: 1,
    tpEnabled: prefs.tpEnabled,
    slEnabled: prefs.slEnabled,
    tpPercent: prefs.tpPercent,
    slPercent: prefs.slPercent,
    templates: prefs.templates,
  };
  localStorage.setItem(ACTIVE_TRADER_PREFS_KEY, JSON.stringify(stored));
}
