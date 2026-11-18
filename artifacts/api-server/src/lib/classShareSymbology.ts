/** Class-share tickers only (not futures, not OCC options). */
export const CLASS_SHARE_SYMBOL_RE = /^[A-Z]{1,5}[./][A-Z]{1,2}$/;

export type ClassShareQuoteVendor =
  | "schwab"
  | "schwab2"
  | "tradier"
  | "alpaca"
  | "alpaca_paper";

export function isClassShareSymbol(symbol: string): boolean {
  const upper = symbol.toUpperCase().trim();
  if (!upper || upper.startsWith("/") || upper.includes(" ")) return false;
  return CLASS_SHARE_SYMBOL_RE.test(upper);
}

export function classShareToSlash(symbol: string): string {
  return symbol.toUpperCase().trim().replace(".", "/");
}

export function classShareToDot(symbol: string): string {
  return symbol.toUpperCase().trim().replace("/", ".");
}

export function classShareForVendor(symbol: string, vendor: ClassShareQuoteVendor): string {
  const upper = symbol.toUpperCase().trim();
  if (!isClassShareSymbol(upper)) return upper;
  if (vendor === "alpaca" || vendor === "alpaca_paper") {
    return classShareToDot(upper);
  }
  return classShareToSlash(upper);
}

/** Schwab stream + REST class-share wire symbol. */
export function classShareSchwabStreamKey(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  if (!isClassShareSymbol(upper)) return upper;
  return classShareToSlash(upper);
}