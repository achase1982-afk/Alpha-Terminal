import { cn } from "@/lib/utils";
import { SCANNER_LAYER1_BODY_INDENT, scannerNumericFontStyle } from "./scannerCard.utils";

/** Three-line column guide for the collapsed scanner universe list (matches `ScannerCardRow`). */
export function ScannerLayer1ColumnHeader({ id }: { id?: string }) {
  return (
    <div
      id={id}
      className="flex flex-col gap-1.5 border-b border-zinc-800/45 bg-zinc-900/35 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      style={scannerNumericFontStyle}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <span className="w-4 shrink-0" aria-hidden />
          <span className="min-w-0 leading-snug" title="Ticker symbol and full company name">
            Ticker · Name
          </span>
        </div>
        <span className="shrink-0 leading-snug text-right" title="Last traded price">
          Last
        </span>
      </div>

      <div className={cn("flex min-w-0 justify-between gap-3", SCANNER_LAYER1_BODY_INDENT)}>
        <span className="shrink-0" title="Dollar change vs prior close">
          $ Δ
        </span>
        <span className="min-w-0 flex-1 text-center" title="Percent change vs prior close">
          % Δ
        </span>
        <span className="shrink-0 text-right" title="Implied volatility rank (0–100)">
          IVR
        </span>
      </div>

      <div className={cn("flex min-w-0 justify-between gap-2", SCANNER_LAYER1_BODY_INDENT)}>
        <span className="min-w-0 flex-[1.1] truncate" title="Upcoming catalyst (e.g. earnings)">
          Catalyst
        </span>
        <span className="shrink-0 flex-none text-center px-1" title="Composite scanner score (0–100)">
          Score
        </span>
        <span className="min-w-0 flex-[1.2] text-right leading-snug" title="Today's volume; gray line is vs 20-day average">
          Volume
        </span>
      </div>
    </div>
  );
}
