import { cn } from "@/lib/utils";
import { SCANNER_LAYER1_GRID_CLASS, scannerNumericFontStyle } from "./scannerCard.utils";

/** Column labels for the collapsed scanner universe table (layer 1 list). */
export function ScannerLayer1ColumnHeader({ id }: { id?: string }) {
  return (
    <div
      id={id}
      className={cn(
        SCANNER_LAYER1_GRID_CLASS,
        "border-b border-zinc-800/45 bg-zinc-900/35 font-semibold uppercase tracking-wide text-muted-foreground",
      )}
      style={scannerNumericFontStyle}
    >
      <span className="block min-h-[1em]" aria-hidden />
      <span className="min-w-0 leading-tight" title="Ticker symbol (company name on second line in each row)">
        Ticker
      </span>
      <span className="text-right leading-tight" title="Last traded price">
        Last
      </span>
      <span className="text-right leading-tight" title="Dollar change vs prior close">
        $ Δ
      </span>
      <span className="text-right leading-tight" title="Percent change vs prior close">
        % Δ
      </span>
      <span className="text-right leading-tight" title="Implied volatility rank — where IV sits vs its own range over the past year (0–100)">
        IVR
      </span>
      <span className="min-w-0 truncate text-center leading-tight" title="Upcoming catalyst (e.g. earnings within the next two weeks)">
        Catalyst
      </span>
      <span className="text-right leading-tight" title="Composite scanner score (0–100) — tier dot reflects strength">
        Score
      </span>
      <span className="text-right leading-tight" title="Today's volume; smaller gray text is volume vs 20-day average (e.g. 1.2×)">
        Volume
      </span>
    </div>
  );
}
