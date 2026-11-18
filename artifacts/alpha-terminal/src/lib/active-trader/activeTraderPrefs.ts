import type { AtAutoSendPrefs } from "./atAutoSend";

export type { AtAutoSendPrefs };
export type AtTemplateKind = "Single" | "OCO" | "TRG w/ bracket";
export type AtOrderType = "LIMIT" | "MKT";
export type AtLimitAnchor = "Mid" | "Bid" | "Ask";
export type BracketOffsetMode = "percent" | "points" | "dollars";
export type AtLadderMode = "single" | "vertical";
export type AtVerticalWidth = 5 | 10 | 25;
export type AtExitDuration = "DAY" | "GOOD_TILL_CANCEL";
export type AtStopLossOrderType = "STOP" | "STOP_LIMIT";

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
  ladderMode: AtLadderMode;
  verticalWidth: AtVerticalWidth;
  /** TIF for OCO / trigger children (Schwab 1st-trigger sample uses GTC). */
  exitDuration: AtExitDuration;
  stopLossOrderType: AtStopLossOrderType;
  /** Limit offset from stop trigger (STOP_LIMIT only), in premium dollars. */
  stopLimitOffset: number;
}

const STORAGE_KEY = "activeTraderPrefs:v6";

const DEFAULTS: ActiveTraderTemplatePrefs = {
  template: "TRG w/ bracket",
  qty: 1,
  orderType: "LIMIT",
  limitAnchor: "Mid",
  takeProfit: { enabled: true, mode: "percent", offset: 10 },
  stopLoss: { enabled: false, mode: "percent", offset: -10 },
  autoSend: { enabled: false, armed: false },
  ladderMode: "single",
  verticalWidth: 5,
  exitDuration: "GOOD_TILL_CANCEL",
  stopLossOrderType: "STOP",
  stopLimitOffset: 0.05,
};

function sanitizeAutoSend(prefs: ActiveTraderTemplatePrefs): ActiveTraderTemplatePrefs {
  return {
    ...prefs,
    autoSend: { ...prefs.autoSend, armed: false },
  };
}

export function loadActiveTraderPrefs(symbolClass: "index" | "equity"): ActiveTraderTemplatePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Record<string, ActiveTraderTemplatePrefs>;
    return sanitizeAutoSend({ ...DEFAULTS, ...(parsed[symbolClass] ?? {}) });
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveActiveTraderPrefs(symbolClass: "index" | "equity", prefs: ActiveTraderTemplatePrefs): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, ActiveTraderTemplatePrefs>) : {};
    parsed[symbolClass] = sanitizeAutoSend(prefs);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}