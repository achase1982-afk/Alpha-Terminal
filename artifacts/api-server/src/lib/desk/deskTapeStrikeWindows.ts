import type { DeskChainNormalized } from "./deskSchwabChains.js";
import { isDeskAllowedOptionKey } from "./deskTapeFrameFilter.js";
import { deskSessionDateEt } from "./deskEt.js";

/** Same windows as the SPX index chain feed handler (local recorder parity). */
export type DeskStrikeWindow =
  | { kind: "all" }
  | { kind: "range"; minStrike: number; maxStrike: number };

export const DESK_SPXW_WIDE = { minStrike: 3000, maxStrike: 10_000 } as const;
export const DESK_MONTHLY_BAND = { minStrike: 6965, maxStrike: 7835 } as const;

export function isSpxMonthlyOccSymbol(symbol: string): boolean {
  const u = symbol.trim().toUpperCase();
  return u.startsWith("SPX") && !u.startsWith("SPXW");
}

export function deskStrikeWindowForExpiry(
  expiryYmd: string,
  contracts: DeskChainNormalized[],
  sessionToday = deskSessionDateEt(),
): DeskStrikeWindow {
  if (expiryYmd === sessionToday) {
    return { kind: "all" };
  }
  const hasMonthly = contracts.some((c) => c.symbol && isSpxMonthlyOccSymbol(c.symbol));
  if (hasMonthly) {
    return { kind: "range", ...DESK_MONTHLY_BAND };
  }
  return { kind: "range", ...DESK_SPXW_WIDE };
}

export function filterDeskChainByStrikeWindow(
  contracts: DeskChainNormalized[],
  window: DeskStrikeWindow,
): DeskChainNormalized[] {
  let rows = contracts.filter((c) => c.symbol && isDeskAllowedOptionKey(c.symbol));
  if (window.kind === "range") {
    rows = rows.filter((c) => c.strike >= window.minStrike && c.strike <= window.maxStrike);
  }
  return rows;
}

export type DeskOptionPick = { expiry: string; symbol: string; strike: number };

export function sortPicksByExpiryThenSpot(picks: DeskOptionPick[], spot: number): DeskOptionPick[] {
  return [...picks].sort(
    (a, b) =>
      a.expiry.localeCompare(b.expiry) ||
      Math.abs(a.strike - spot) - Math.abs(b.strike - spot) ||
      a.strike - b.strike ||
      a.symbol.localeCompare(b.symbol),
  );
}

/** Nearest expiries and ATM-first within expiry; drop far dates and far OTM when over budget. */
export function trimDeskOptionsToBudget(
  picks: DeskOptionPick[],
  budget: number,
  spot: number,
): { symbols: string[]; capReason: string | null; perExpiry: Record<string, number> } {
  if (budget <= 0) {
    return { symbols: [], capReason: "schwab_levelone_options_budget_0", perExpiry: {} };
  }
  const sorted = sortPicksByExpiryThenSpot(picks, spot);
  const symbols: string[] = [];
  const seen = new Set<string>();
  const perExpiry: Record<string, number> = {};

  for (const p of sorted) {
    if (symbols.length >= budget) break;
    if (seen.has(p.symbol)) continue;
    seen.add(p.symbol);
    symbols.push(p.symbol);
    perExpiry[p.expiry] = (perExpiry[p.expiry] ?? 0) + 1;
  }

  let capReason: string | null = null;
  if (sorted.length > budget) {
    capReason = `schwab_levelone_options_budget_${budget}`;
  }
  return { symbols, capReason, perExpiry };
}