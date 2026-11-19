export type AtStockSide = "BUY" | "SELL";

export type AtStockDraft = {
  side: AtStockSide;
  shares: number;
  limitPrice: number | null;
};

const drafts = new Map<string, AtStockDraft>();

function key(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function emptyStockDraft(): AtStockDraft {
  return { side: "BUY", shares: 1, limitPrice: null };
}

export function readStockDraft(symbol: string): AtStockDraft {
  return drafts.get(key(symbol)) ?? emptyStockDraft();
}

export function writeStockDraft(symbol: string, draft: AtStockDraft): AtStockDraft {
  const next: AtStockDraft = {
    side: draft.side,
    shares: Number.isFinite(draft.shares) && draft.shares > 0 ? Math.floor(draft.shares) : 1,
    limitPrice:
      draft.limitPrice != null && Number.isFinite(draft.limitPrice) && draft.limitPrice > 0
        ? draft.limitPrice
        : null,
  };
  drafts.set(key(symbol), next);
  return next;
}

/** Shares × limit. Equity tickets use no option multiplier and no option fee. */
export function stockLimitNotional(draft: AtStockDraft): number | null {
  if (draft.limitPrice == null || !(draft.shares > 0)) return null;
  return Math.round(draft.shares * draft.limitPrice * 100) / 100;
}
