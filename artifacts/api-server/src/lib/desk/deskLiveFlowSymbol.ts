import { schwabFuturesKey } from "../schwabStreamer.js";

export type DeskFlowAssetKind = "spx" | "equity" | "futures";

export type DeskFlowSymbol = {
  kind: DeskFlowAssetKind;
  /** Client-facing symbol (e.g. SPX, NVDA, /ES). */
  sym: string;
};

export function parseDeskFlowSymbol(raw: string): { ok: true; parsed: DeskFlowSymbol } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "symbol required" };

  let u = trimmed.toUpperCase();
  if (u === "SPX" || u === "$SPX") {
    return { ok: true, parsed: { kind: "spx", sym: "SPX" } };
  }

  if (u.startsWith("/")) {
    if (!/^\/[A-Z][A-Z0-9]{0,5}$/.test(u)) {
      return { ok: false, error: "invalid_futures_symbol" };
    }
    void schwabFuturesKey(u);
    return { ok: true, parsed: { kind: "futures", sym: u } };
  }

  const equityCheck = trimmed.toUpperCase();
  if (!/^\$?[A-Z][A-Z0-9.$\-/]{0,14}$/.test(equityCheck)) {
    return { ok: false, error: "invalid_equity_symbol" };
  }
  const equitySym = equityCheck.replace(/^\$/, "");
  return { ok: true, parsed: { kind: "equity", sym: equitySym } };
}

export function deskFlowNormalizeEquityKey(sym: string): string {
  return sym.trim().toUpperCase().replace(/^\$/, "");
}