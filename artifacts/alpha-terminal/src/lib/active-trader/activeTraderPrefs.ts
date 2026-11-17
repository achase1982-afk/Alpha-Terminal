export type AtTemplateKind = "Single" | "OCO" | "TRG w/ bracket";
export type AtOrderType = "LIMIT" | "MKT";
export type AtLimitAnchor = "Mid" | "Bid" | "Ask";

export interface ActiveTraderTemplatePrefs {
  template: AtTemplateKind;
  qty: number;
  orderType: AtOrderType;
  limitAnchor: AtLimitAnchor;
}

const STORAGE_KEY = "activeTraderPrefs:v2";

const DEFAULTS: ActiveTraderTemplatePrefs = {
  template: "Single",
  qty: 1,
  orderType: "LIMIT",
  limitAnchor: "Mid",
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