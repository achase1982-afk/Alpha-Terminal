import { cn } from "@/lib/utils";
import { SCANNER_LAYER1_CARD_GRID_CLASS, scannerNumericFontStyle, scannerSansFontStyle } from "./scannerCard.utils";

/** List chrome above universe rows — matches mockup “Symbol / Last” guide on true black. */
export function ScannerLayer1ColumnHeader({ id }: { id?: string }) {
  return (
    <div
      id={id}
      className={cn(
        SCANNER_LAYER1_CARD_GRID_CLASS,
        "border-b border-zinc-900 bg-black text-[10px] font-semibold uppercase tracking-widest text-zinc-500",
      )}
      style={{ ...scannerSansFontStyle, ...scannerNumericFontStyle }}
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
