import { resolveAtGlanceMode } from "./atGlanceMode";

/** Symbol query param for `/api/desk/v1/stream/flow`. */
export function deskFlowStreamSymbol(symbol: string): string {
  const mode = resolveAtGlanceMode(symbol);
  if (mode === "futures") {
    const u = symbol.trim().toUpperCase();
    return u.startsWith("/") ? u : `/${u}`;
  }
  if (mode === "index") return "SPX";
  return symbol.replace(/^\$/, "").toUpperCase();
}