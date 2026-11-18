import { resolveAtGlanceMode, type AtGlanceMode } from "./atGlanceMode";

/** Same precision rules as Active Trader symbol header (`fmtSpot`). */
export function formatAtGlanceSpot(symbol: string, price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "—";
  const mode = resolveAtGlanceMode(symbol);
  const digits = spotFractionDigits(mode, symbol, price);
  return price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function spotFractionDigits(_mode: AtGlanceMode, _symbol: string, _price: number): number {
  return 2;
}