/** Strip leading `$` for UI labels; keep API/storage symbols unchanged. */
export function formatDisplaySymbol(symbol: string | null | undefined): string {
  if (!symbol) return "";
  return symbol.replace(/^\$/, "");
}