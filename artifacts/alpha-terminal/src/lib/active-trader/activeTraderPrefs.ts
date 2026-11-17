import type { AtAutoSendPrefs } from "./atAutoSend";

export type { AtAutoSendPrefs };
export type AtTemplateKind = "Single" | "OCO" | "TRG w/ bracket";
export type AtOrderType = "LIMIT" | "MKT";
export type AtLimitAnchor = "Mid" | "Bid" | "Ask";
export type BracketOffsetMode = "percent" | "points" | "dollars";

export interface BracketLegPrefs {
  enabled: boolean;
  mode: BracketOffsetMode;
  offset: number;
}

export interface ActiveTraderTemplatePrefs {
  template: AtTemplateKind;
  qty: number;
  orderType: AtOrderType;
  limitAnchor: AtLimitAnchor;
  takeProfit: BracketLegPrefs;
  stopLoss: BracketLegPrefs;
  autoSend: AtAutoSendPrefs;
}

const STORAGE_KEY = "activeTraderPrefs:v4";

const DEFAULTS: ActiveTraderTemplatePrefs = {
  template: "TRG w/ bracket",
  qty: 1,
  orderType: "LIMIT",
  limitAnchor: "Mid",
  takeProfit: { enabled: true, mode: "percent", offset: 10 },
  stopLoss: { enabled: false, mode: "percent", offset: -10 },
  autoSend: { enabled: false, armed: false },
};

export function loadActiveTraderPrefs(symbolClass: "index" | "equity"): ActiveTraderTemplatePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Record<string, ActiveTraderTemplatePrefs>;
    return { ...DEFAULTS, ...(parsed[symbolClass] ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveActiveTraderPrefs(symbolClass: "index" | "equity", prefs: ActiveTraderTemplatePrefs): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, ActiveTraderTemplatePrefs>) : {};
    parsed[symbolClass] = prefs;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}