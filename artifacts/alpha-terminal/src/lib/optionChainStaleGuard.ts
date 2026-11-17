/** Normalize chain / tape symbols for same-ticker comparisons ($SPX vs SPX). */
export function normalizeOptionChainSymbol(symbol: string): string {
  return symbol.replace(/^\$/, "").trim().toUpperCase();
}

export function optionChainMatchesActiveSymbol(
  chainSymbol: string | undefined,
  activeSymbol: string,
): boolean {
  if (!chainSymbol?.trim()) return true;
  return normalizeOptionChainSymbol(chainSymbol) === normalizeOptionChainSymbol(activeSymbol);
}