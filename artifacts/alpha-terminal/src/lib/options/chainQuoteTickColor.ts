import type { QuoteArrow } from "@/lib/active-trader/useQuoteMoveArrows";
import { UP, DOWN } from "@/components/options/optionsTheme";
import { CHAIN_LADDER_CELL_COLOR } from "@/lib/options/strikeColumnChrome";

/**
 * Quote text color follows the websocket price move on that cell.
 * A quiet or dead quote stays off-white. An up tick is green, a down tick is red.
 * Bid and ask are not painted by side.
 */
export function chainLivePriceColor(
  _side: "bid" | "ask",
  arrow: QuoteArrow,
  dimmed: boolean,
): string {
  if (dimmed || arrow == null) return CHAIN_LADDER_CELL_COLOR;
  return arrow === "up" ? UP : DOWN;
}
