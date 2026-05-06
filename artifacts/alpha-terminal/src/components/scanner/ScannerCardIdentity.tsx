import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import {
  dashCell,
  formatCompactInt,
  scannerNumericFontStyle,
  volumeVsAvgMultiplier,
} from "./scannerCard.utils";

function DayRangeBar({
  range,
  price,
}: {
  range: { low: number; high: number } | null;
  price: number | null;
}) {
  if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high) || range.high <= range.low) {
    return <span className="text-muted-foreground tabular-nums" style={scannerNumericFontStyle}>{dashCell()}</span>;
  }
  const span = range.high - range.low;
  let markerPct = 50;
  if (price != null && Number.isFinite(price)) {
    markerPct = Math.min(100, Math.max(0, ((price - range.low) / span) * 100));
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-muted-foreground tabular-nums text-xs shrink-0" style={scannerNumericFontStyle}>
        {range.low.toFixed(2)} – {range.high.toFixed(2)}
      </span>
      <div className="flex-1 min-w-[48px] h-1.5 rounded-full bg-zinc-800 relative overflow-hidden">
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary rounded-full shadow-[0_0_4px_hsl(var(--primary))]"
          style={{ left: `${markerPct}%`, transform: "translateX(-50%)" }}
        />
      </div>
    </div>
  );
}

export function ScannerCardIdentity({ data }: { data: ScannerCardData }) {
  const sectorText = data.sector?.trim() ? data.sector : dashCell();
  /** `ScannerCardData` does not yet include industry; reserved for future layers. */
  const industryText = dashCell();
  const volMult = volumeVsAvgMultiplier(data.volume, data.avgVolume20d);

  return (
    <div className="space-y-1.5 text-sm" style={scannerNumericFontStyle}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          className={cn(
            "font-medium",
            data.name?.trim() ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {data.name?.trim() || dashCell()}
        </span>
        <span className="text-muted-foreground">
          {sectorText}
          <span className="text-muted-foreground/80"> · {industryText}</span>
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Day range</div>
          <DayRangeBar range={data.dayRange} price={data.price} />
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 items-baseline">
          <span className="text-muted-foreground">Vol vs 20d avg</span>
          <span className={cn("text-right tabular-nums", volMult === dashCell() ? "text-muted-foreground" : "text-foreground")}>{volMult}</span>
          <span className="text-muted-foreground">Volume</span>
          <span className={cn("text-right tabular-nums", formatCompactInt(data.volume) === dashCell() ? "text-muted-foreground" : "text-foreground")}>{formatCompactInt(data.volume)}</span>
          <span className="text-muted-foreground">20d avg</span>
          <span className={cn("text-right tabular-nums", formatCompactInt(data.avgVolume20d) === dashCell() ? "text-muted-foreground" : "text-foreground")}>{formatCompactInt(data.avgVolume20d)}</span>
        </div>
      </div>
    </div>
  );
}
