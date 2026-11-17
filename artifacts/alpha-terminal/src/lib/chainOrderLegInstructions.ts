import type { StrategyLeg } from "@/components/StrategyBuilder";

export type ChainLegInstruction =
  | "BUY_TO_OPEN"
  | "SELL_TO_OPEN"
  | "BUY_TO_CLOSE"
  | "SELL_TO_CLOSE";

export interface SchwabPositionRow {
  symbol: string;
  longQuantity?: number;
  shortQuantity?: number;
}

export interface SchwabAccountRow {
  hashValue: string | null;
  positions: SchwabPositionRow[];
}

export interface ResolvedChainLegSlice {
  instruction: ChainLegInstruction;
  quantity: number;
}

export interface ResolveChainLegResult {
  slices: ResolvedChainLegSlice[];
  error?: string;
}

function positionQty(
  positions: SchwabPositionRow[],
  schwabSymbol: string,
): { long: number; short: number } {
  for (const pos of positions) {
    if (pos.symbol !== schwabSymbol && pos.symbol.trim() !== schwabSymbol.trim()) continue;
    return { long: pos.longQuantity ?? 0, short: pos.shortQuantity ?? 0 };
  }
  return { long: 0, short: 0 };
}

/**
 * Map chain bid/ask tap + qty to open/close slices using only the selected trading account.
 * Close qty never exceeds held size; remainder opens (or stays open-only).
 */
export function resolveChainLegInstructions(
  schwabSymbol: string,
  side: "bid" | "ask",
  quantity: number,
  accounts: SchwabAccountRow[],
  tradingAccountHash: string | null,
): ResolveChainLegResult {
  const qty = Math.max(1, Math.floor(quantity) || 1);
  const openBuy = side === "ask";
  const defaultOpen: ChainLegInstruction = openBuy ? "BUY_TO_OPEN" : "SELL_TO_OPEN";

  if (!tradingAccountHash) {
    return { slices: [{ instruction: defaultOpen, quantity: qty }] };
  }

  const acct = accounts.find((a) => a.hashValue != null && a.hashValue === tradingAccountHash);
  if (!acct) {
    return { slices: [{ instruction: defaultOpen, quantity: qty }] };
  }

  const { long, short } = positionQty(acct.positions, schwabSymbol);

  if (openBuy && short > 0) {
    const closeQty = Math.min(qty, short);
    const openQty = qty - closeQty;
    const slices: ResolvedChainLegSlice[] = [];
    if (closeQty > 0) slices.push({ instruction: "BUY_TO_CLOSE", quantity: closeQty });
    if (openQty > 0) slices.push({ instruction: "BUY_TO_OPEN", quantity: openQty });
    return { slices };
  }

  if (!openBuy && long > 0) {
    const closeQty = Math.min(qty, long);
    const openQty = qty - closeQty;
    const slices: ResolvedChainLegSlice[] = [];
    if (closeQty > 0) slices.push({ instruction: "SELL_TO_CLOSE", quantity: closeQty });
    if (openQty > 0) slices.push({ instruction: "SELL_TO_OPEN", quantity: openQty });
    return { slices };
  }

  return { slices: [{ instruction: defaultOpen, quantity: qty }] };
}

export function assertChainLegBudget(
  currentLegCount: number,
  newSlices: ResolvedChainLegSlice[],
  maxLegs: number,
): string | null {
  const added = newSlices.length;
  if (currentLegCount + added > maxLegs) {
    return `Max ${maxLegs} legs — reduce quantity or clear selections before mixing open and close.`;
  }
  return null;
}