import type { ScannerCardData } from "@/lib/unifiedScanTypes";
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
    return <span className="text-zinc-600 tabular-nums" style={scannerNumericFontStyle}>{dashCell()}</span>;
  }
  const span = range.high - range.low;
  let markerPct = 50;
  if (price != null && Number.isFinite(price)) {
    markerPct = Math.min(100, Math.max(0, ((price - range.low) / span) * 100));
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-zinc-400 tabular-nums text-[10px] shrink-0" style={scannerNumericFontStyle}>
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
    <div className="space-y-1.5 text-[11px]" style={scannerNumericFontStyle}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-zinc-200 font-medium">{data.name?.trim() || dashCell()}</span>
        <span className="text-zinc-500">
          {sectorText}
          <span className="text-zinc-600"> · {industryText}</span>
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-0.5">Day range</div>
          <DayRangeBar range={data.dayRange} price={data.price} />
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 items-baseline">
          <span className="text-zinc-500">Vol vs 20d avg</span>
          <span className="text-right text-zinc-200 tabular-nums">{volMult}</span>
          <span className="text-zinc-500">Volume</span>
          <span className="text-right text-zinc-200 tabular-nums">{formatCompactInt(data.volume)}</span>
          <span className="text-zinc-500">20d avg</span>
          <span className="text-right text-zinc-200 tabular-nums">{formatCompactInt(data.avgVolume20d)}</span>
        </div>
      </div>
    </div>
  );
}
