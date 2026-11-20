import type { AtAutoSendPrefs } from "./atAutoSend";

export type { AtAutoSendPrefs };
export type AtTemplateKind = "Single" | "OCO" | "TRG w/ bracket";
export type AtOrderType = "LIMIT" | "MKT";
export type AtLimitAnchor = "Mid" | "Bid" | "Ask";
export type BracketOffsetMode = "percent" | "points" | "dollars" | "stdev";
export type AtLadderMode = "single" | "vertical";
export type AtVerticalWidth = 1 | 5 | 10 | 25;
/**
 * How a ladder tap builds legs.
 * `off` picks the cell you tapped. Anything else fills that structure from the
 * tapped strike and moves it when you tap a different strike.
 */
export type AtStrategyBuild = "off" | "credit-spread" | "debit-spread" | "iron-condor";

export const AT_STRATEGY_BUILDS: { value: AtStrategyBuild; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "credit-spread", label: "Credit spread" },
  { value: "debit-spread", label: "Debit spread" },
  { value: "iron-condor", label: "Iron condor" },
];

export const AT_STRATEGY_WIDTHS: AtVerticalWidth[] = [1, 5, 10, 25];

export function strategyBuildLabel(value: AtStrategyBuild | undefined): string {
  return AT_STRATEGY_BUILDS.find((opt) => opt.value === (value ?? "off"))?.label ?? "Off";
}

export function ladderModeForStrategy(strategy: AtStrategyBuild | undefined): AtLadderMode {
  return strategy === "credit-spread" || strategy === "debit-spread" ? "vertical" : "single";
}
export type AtExitDuration = "DAY" | "GOOD_TILL_CANCEL";
export type AtEntryDuration = "DAY" | "GOOD_TILL_CANCEL" | "FILL_OR_KILL";
export type AtStopLossOrderType = "STOP" | "STOP_LIMIT";
/** Schwab orderType for the entry (parent) order. */
export type AtSchwabEntryType =
  | "LIMIT"
  | "MARKET"
  | "STOP"
  | "STOP_LIMIT"
  | "TRAILING_STOP"
  | "TRAILING_STOP_LIMIT";
/**
 * How the entry and exits are nested on Schwab.
 * AUTO follows the take-profit and stop-loss toggles.
 */
export type AtAdvancedRoute = "AUTO" | "SINGLE" | "TRIGGER" | "TRIGGER_OCO" | "OCO";
export type AtOrderSession = "NORMAL" | "AM" | "PM" | "SEAMLESS";
export type AtRouting = "BEST" | "NYSE" | "NASDAQ" | "ARCA" | "BATS";
export type AtAccountKind = "MARGIN" | "CASH";
export type AtSubmissionMode = "review" | "send";
export type AtTrailLinkType = "VALUE" | "PERCENT";

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
  /**
   * Structure a ladder tap builds. Missing or `off` means free leg selection.
   * A saved vertical ladder mode does not turn this on.
   */
  strategyBuild?: AtStrategyBuild;
  /** TIF for OCO / trigger children (Schwab 1st-trigger sample uses GTC). */
  exitDuration: AtExitDuration;
  stopLossOrderType: AtStopLossOrderType;
  /** Limit offset from stop trigger (STOP_LIMIT only), in premium dollars. */
  stopLimitOffset: number;
  /** Entry time in force. Defaults to Day. */
  entryDuration?: AtEntryDuration;
  /** Schwab entry orderType. When omitted, `orderType` (LIMIT / MKT) is used. */
  schwabEntryType?: AtSchwabEntryType;
  advancedRoute?: AtAdvancedRoute;
  session?: AtOrderSession;
  routing?: AtRouting;
  accountKind?: AtAccountKind;
  /** Review before sending, or post the order from the ticket with no confirm step. */
  submission?: AtSubmissionMode;
  trailOffset?: number;
  trailLinkType?: AtTrailLinkType;
}

const STORAGE_KEY = "activeTraderPrefs:v6";

const DEFAULTS: ActiveTraderTemplatePrefs = {
  template: "TRG w/ bracket",
  qty: 1,
  orderType: "LIMIT",
  limitAnchor: "Mid",
  takeProfit: { enabled: true, mode: "percent", offset: 25 },
  stopLoss: { enabled: false, mode: "percent", offset: -10 },
  autoSend: { enabled: false, armed: false },
  ladderMode: "single",
  verticalWidth: 5,
  strategyBuild: "off",
  exitDuration: "GOOD_TILL_CANCEL",
  stopLossOrderType: "STOP",
  stopLimitOffset: 0.05,
  entryDuration: "DAY",
  schwabEntryType: "LIMIT",
  advancedRoute: "AUTO",
  session: "NORMAL",
  routing: "BEST",
  accountKind: "MARGIN",
  submission: "review",
  trailOffset: 0.1,
  trailLinkType: "VALUE",
};

function sanitizeAutoSend(prefs: ActiveTraderTemplatePrefs): ActiveTraderTemplatePrefs {
  return {
    ...prefs,
    autoSend: { ...prefs.autoSend, armed: false },
  };
}

const STRATEGY_VALUES = new Set<string>(AT_STRATEGY_BUILDS.map((opt) => opt.value));
const WIDTH_VALUES = new Set<number>(AT_STRATEGY_WIDTHS);

/**
 * Free leg selection unless a strategy was saved on purpose.
 * An older vertical ladder mode is not that setting, so it does not keep pairing taps.
 */
export function withStrategyDefaults(prefs: ActiveTraderTemplatePrefs): ActiveTraderTemplatePrefs {
  const rawStrategy = prefs.strategyBuild;
  const strategyBuild = rawStrategy && STRATEGY_VALUES.has(rawStrategy) ? rawStrategy : "off";
  const verticalWidth = WIDTH_VALUES.has(prefs.verticalWidth) ? prefs.verticalWidth : 5;
  return {
    ...prefs,
    strategyBuild,
    verticalWidth,
    ladderMode: ladderModeForStrategy(strategyBuild),
  };
}

export function loadActiveTraderPrefs(symbolClass: "index" | "equity"): ActiveTraderTemplatePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Record<string, ActiveTraderTemplatePrefs>;
    return sanitizeAutoSend(withStrategyDefaults({ ...DEFAULTS, ...(parsed[symbolClass] ?? {}) }));
  } catch {
    return { ...DEFAULTS };
  }
}

/** Keep template and the LIMIT/MKT flag aligned with the defaults sheet. */
export function applyOrderDefaults(prefs: ActiveTraderTemplatePrefs): ActiveTraderTemplatePrefs {
  const route = prefs.advancedRoute ?? "AUTO";
  const tp = prefs.takeProfit.enabled;
  const sl = prefs.stopLoss.enabled;
  let template: AtTemplateKind = prefs.template;
  if (route === "OCO") template = "OCO";
  else if (route === "SINGLE" || (route === "AUTO" && !tp && !sl)) template = "Single";
  else template = "TRG w/ bracket";

  const entry = prefs.schwabEntryType ?? (prefs.orderType === "MKT" ? "MARKET" : "LIMIT");
  return withStrategyDefaults({
    ...DEFAULTS,
    ...prefs,
    template,
    orderType: entry === "MARKET" ? "MKT" : "LIMIT",
    schwabEntryType: entry,
    entryDuration: prefs.entryDuration ?? "DAY",
    advancedRoute: route,
    session: prefs.session ?? "NORMAL",
    routing: prefs.routing ?? "BEST",
    accountKind: prefs.accountKind ?? "MARGIN",
    submission: prefs.submission ?? "review",
    trailOffset: prefs.trailOffset ?? 0.1,
    trailLinkType: prefs.trailLinkType ?? "VALUE",
  });
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