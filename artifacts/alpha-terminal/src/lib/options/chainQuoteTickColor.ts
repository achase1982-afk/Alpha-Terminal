import type { QuoteArrow } from "@/lib/active-trader/useQuoteMoveArrows";
import { UP, DOWN } from "@/components/options/optionsTheme";
import { CHAIN_LADDER_CELL_COLOR } from "@/lib/options/strikeColumnChrome";

/** Bid/ask resting + tick flash colors (Thinkorswim-style: bid red, ask green). */
export function chainLivePriceColor(
  side: "bid" | "ask",
  arrow: QuoteArrow,
  dimmed: boolean,
): string {
  if (dimmed) return CHAIN_LADDER_CELL_COLOR;
  if (arrow === "up") return UP;
  if (arrow === "down") return DOWN;
  return side === "bid" ? DOWN : UP;
}