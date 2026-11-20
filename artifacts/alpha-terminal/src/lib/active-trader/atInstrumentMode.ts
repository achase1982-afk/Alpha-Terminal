import { isFuturesDisplaySymbol } from "@/lib/futuresSchwabUi";
import { isIndexSymbol } from "./atGlanceMode";

/** Options and stock stay distinct. Futures is recognized so it is left alone. */
export type AtInstrumentClass = "index" | "equity" | "etf" | "futures" | "unknown";

export type AtInstrumentTemplate = "options" | "stock";

const EXPLICIT_KEY = "at-instrument-template-v1";

function normSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/**
 * Schwab reference assetType / assetMainType. Ticker spelling is not a class.
 * Futures keep the existing display-symbol rule and never gain a stock switch.
 */
export function instrumentClassFromAssetType(
  assetType: string | null | undefined,
  symbol: string,
): AtInstrumentClass {
  if (isFuturesDisplaySymbol(symbol)) return "futures";
  const raw = assetType?.trim().toUpperCase() ?? "";
  if (raw === "INDEX") return "index";
  if (raw === "ETF" || raw === "COLLECTIVE_INVESTMENT") return "etf";
  if (raw === "EQUITY") return "equity";
  return "unknown";
}

/**
 * Schwab metadata can lag on first paint. Plain tickers that are not index,
 * futures, or option roots still get the penny share ladder until verified.
 * SPX is an index as soon as the ticker changes. A missing asset type, or the
 * previous symbol's EQUITY type, must not keep the stock ladder.
 */
export function resolveInstrumentClass(
  assetType: string | null | undefined,
  symbol: string,
): AtInstrumentClass {
  if (isIndexSymbol(symbol)) return "index";
  const direct = instrumentClassFromAssetType(assetType, symbol);
  if (direct !== "unknown") return direct;
  const u = normSymbol(symbol);
  if (!u || u.startsWith("$") || u.includes("/")) return "unknown";
  return "equity";
}

export function stockTemplateAvailable(instrumentClass: AtInstrumentClass): boolean {
  return instrumentClass === "equity" || instrumentClass === "etf";
}

type ExplicitMap = Record<string, AtInstrumentTemplate>;

function readExplicitMap(): ExplicitMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(EXPLICIT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ExplicitMap;
  } catch {
    return {};
  }
}

export function loadExplicitInstrumentTemplate(symbol: string): AtInstrumentTemplate | null {
  const value = readExplicitMap()[normSymbol(symbol)];
  return value === "options" || value === "stock" ? value : null;
}

export function saveExplicitInstrumentTemplate(symbol: string, template: AtInstrumentTemplate): void {
  if (typeof localStorage === "undefined") return;
  const next = readExplicitMap();
  next[normSymbol(symbol)] = template;
  try {
    localStorage.setItem(EXPLICIT_KEY, JSON.stringify(next));
  } catch {
    /* the in-memory choice still applies for this visit */
  }
}

const entryFromChain = new Map<string, boolean>();

/** The options tab records whether this visit to Active Trader started on the chain. */
export function noteAtEntry(symbol: string, fromChain: boolean): void {
  entryFromChain.set(normSymbol(symbol), fromChain);
}

export function peekAtEntryFromChain(symbol: string): boolean {
  return entryFromChain.get(normSymbol(symbol)) === true;
}

export function resolveInstrumentTemplate(
  symbol: string,
  instrumentClass: AtInstrumentClass,
): AtInstrumentTemplate {
  if (!stockTemplateAvailable(instrumentClass)) return "options";
  const explicit = loadExplicitInstrumentTemplate(symbol);
  if (explicit) return explicit;
  return "stock";
}
