import { schwabFuturesKey } from "../schwabStreamer.js";

const FUTURES_ALIASES = new Set(["ES", "NQ", "MES", "MNQ", "RTY", "YM", "/ES", "/NQ", "/MES", "/MNQ", "/RTY", "/YM"]);

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

  if (u.startsWith("/") || FUTURES_ALIASES.has(u)) {
    const display = u.startsWith("/") ? u : `/${u}`;
    if (!/^\/[A-Z0-9]{1,6}$/.test(display)) {
      return { ok: false, error: "invalid_futures_symbol" };
    }
    void schwabFuturesKey(display);
    return { ok: true, parsed: { kind: "futures", sym: display } };
  }

  if (!/^\$?[A-Z][A-Z0-9.\-]{0,11}$/.test(u)) {
    return { ok: false, error: "invalid_equity_symbol" };
  }
  u = u.replace(/^\$/, "");
  return { ok: true, parsed: { kind: "equity", sym: u } };
}

export function deskFlowNormalizeEquityKey(sym: string): string {
  return sym.trim().toUpperCase().replace(/^\$/, "");
}