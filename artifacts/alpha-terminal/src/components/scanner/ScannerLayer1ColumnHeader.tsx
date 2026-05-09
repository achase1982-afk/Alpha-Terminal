import { cn } from "@/lib/utils";
import { SCANNER_LAYER1_CARD_GRID_CLASS, scannerNumericFontStyle } from "./scannerCard.utils";

/** Column guide for the collapsed scanner universe list — grid matches `ScannerCardRow` exactly. */
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
      <span className="col-start-1 row-start-1 row-span-2 w-4 shrink-0" aria-hidden />

      <span className="col-start-2 row-start-1 self-end leading-snug" title="Ticker symbol">
        Ticker
      </span>
      <span
        className="col-start-6 row-start-1 row-span-2 self-center justify-self-end leading-snug"
        title="Last traded price"
      >
        Last
      </span>

      <span
        className="col-start-2 row-start-2 normal-case text-[10px] font-medium tracking-normal opacity-90 sm:text-[11px]"
        title="Company name"
      >
        Name
      </span>

      <span className="col-start-3 row-start-3 justify-self-end leading-snug" title="Dollar change vs prior close">
        $ Δ
      </span>
      <span className="col-start-4 row-start-3 justify-self-center leading-snug" title="Percent change vs prior close">
        % Δ
      </span>
      <span className="col-start-5 row-start-3 justify-self-end leading-snug" title="Implied volatility rank (0–100)">
        IVR
      </span>

      <span className="col-start-2 row-start-4 justify-self-start leading-snug" title="Upcoming catalyst">
        Catalyst
      </span>
      <span className="col-start-4 row-start-4 justify-self-center leading-snug" title="Composite scanner score (0–100)">
        Score
      </span>
      <span
        className="col-start-6 row-start-4 justify-self-end leading-snug"
        title="Today's volume; second line is vs 20-day average when shown"
      >
        Volume
      </span>
    </div>
  );
}
