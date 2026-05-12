import { cn } from "@/lib/utils";
import { SCANNER_LAYER1_CARD_GRID_CLASS, scannerNumericFontStyle } from "./scannerCard.utils";

/** Column guide for the collapsed scanner universe list — layout matches `ScannerCardRow`. */
export function ScannerLayer1ColumnHeader({ id }: { id?: string }) {
  return (
    <div
      id={id}
      className={cn(
        SCANNER_LAYER1_CARD_GRID_CLASS,
        "border-b border-zinc-800/45 bg-zinc-900/35 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-xs",
      )}
      style={scannerNumericFontStyle}
    >
      <span className="w-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="leading-snug" title="Ticker and company name">
          Symbol
        </span>
        <span className="shrink-0 leading-snug" title="Last price and session change">
          Last / Δ
        </span>
      </div>
    </div>
  );
}
