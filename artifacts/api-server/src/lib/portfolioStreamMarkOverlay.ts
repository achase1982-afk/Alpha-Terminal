import { getOptionTick, getQuoteBySymbol, normalizeEquityKey } from "./schwabStreamer.js";

export type PortfolioPositionRow = {
  symbol?: string;
  underlyingSymbol?: string;
  assetType?: string;
  marketValue?: number;
  quantity?: number;
  averagePrice?: number;
  streamMark?: number | null;
  streamMarkTs?: number | null;
};

function optionMultiplier(assetType: string | undefined): number {
  if (assetType === "FUTURE_OPTION") return 1;
  return 100;
}

/** Overlay stream L1 marks onto Schwab REST position rows (in place). */
export function overlayPortfolioMarksFromStream(
  mapped: Array<{ positions?: PortfolioPositionRow[] }>,
): void {
  const now = Date.now();
  for (const acct of mapped) {
    for (const p of acct.positions ?? []) {
      if (!p.symbol) continue;
      if (p.assetType === "OPTION" || p.assetType === "INDEX_OPTION" || p.assetType === "FUTURE_OPTION") {
        const tick = getOptionTick(p.symbol);
        const mark =
          tick?.mark ??
          tick?.last ??
          (tick?.bid != null && tick?.ask != null ? (tick.bid + tick.ask) / 2 : null);
        if (mark != null && Number.isFinite(mark)) {
          p.streamMark = mark;
          p.streamMarkTs = tick?.ts ?? now;
          const qty = Math.abs(p.quantity ?? 0);
          const mult = optionMultiplier(p.assetType);
          if (qty > 0) p.marketValue = mark * qty * mult;
        }
        continue;
      }
      const sym = normalizeEquityKey(p.symbol);
      const snap = getQuoteBySymbol(sym);
      const mark = snap?.last ?? null;
      if (mark != null && Number.isFinite(mark)) {
        p.streamMark = mark;
        p.streamMarkTs = snap?.ts ?? now;
        const qty = Math.abs(p.quantity ?? 0);
        if (qty > 0) p.marketValue = mark * qty;
      }
    }
  }
}