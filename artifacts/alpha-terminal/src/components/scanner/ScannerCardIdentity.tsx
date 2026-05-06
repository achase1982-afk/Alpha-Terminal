import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import {
  dashCell,
  scannerNumericFontStyle,
  volumeVsAvgMultiplier,
} from "./scannerCard.utils";

function DayRangeBar({
  range,
  price,
  compact,
}: {
  range: { low: number; high: number } | null;
  price: number | null;
  compact?: boolean;
}) {
  if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high) || range.high <= range.low) {
    return (
      <span className="text-sm font-mono tabular-nums text-gray-400" style={scannerNumericFontStyle}>
        {dashCell()}
      </span>
    );
  }
  const span = range.high - range.low;
  let markerPct = 50;
  if (price != null && Number.isFinite(price)) {
    markerPct = Math.min(100, Math.max(0, ((price - range.low) / span) * 100));
  }
  const loHi = (
    <span
      className="text-sm font-mono tabular-nums text-white shrink-0 hidden sm:inline"
      style={scannerNumericFontStyle}
    >
      {range.low.toFixed(1)}–{range.high.toFixed(1)}
    </span>
  );
  const bar = (
    <div className={`${compact ? "min-w-[48px]" : "min-w-[48px]"} flex-1 h-1.5 rounded-full bg-zinc-800 relative overflow-hidden`}>
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-primary rounded-full shadow-[0_0_4px_hsl(var(--primary))]"
        style={{ left: `${markerPct}%`, transform: "translateX(-50%)" }}
      />
    </div>
  );
  if (compact) {
    return (
      <div className="flex items-center gap-1 min-w-0 flex-1 max-w-[160px]" style={scannerNumericFontStyle}>
        {loHi}
        {bar}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 min-w-0" style={scannerNumericFontStyle}>
      <span className="text-sm font-mono tabular-nums text-white shrink-0">
        {range.low.toFixed(2)} – {range.high.toFixed(2)}
      </span>
      {bar}
    </div>
  );
}

/**
 * V3 mockup: single identity line — name · sector · day range + mini bar · vol vs 20d avg.
 */
export function ScannerCardIdentity({ data }: { data: ScannerCardData }) {
  const name = data.name?.trim() || dashCell();
  const sector = data.sector?.trim() || "";
  const volMult = volumeVsAvgMultiplier(data.volume, data.avgVolume20d);
  const hasSector = sector.length > 0;

  return (
    <div
      className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm min-w-0 leading-tight font-mono"
      style={scannerNumericFontStyle}
    >
      <span className={cn("font-medium shrink-0", name !== dashCell() ? "text-white" : "text-gray-400")}>{name}</span>
      {hasSector ? (
        <>
          <span className="text-zinc-500 shrink-0" aria-hidden>
            ·
          </span>
          <span className="text-white truncate max-w-[42%] shrink" title={sector}>
            {sector}
          </span>
        </>
      ) : null}
      <span className="text-zinc-500 shrink-0" aria-hidden>
        ·
      </span>
      <DayRangeBar range={data.dayRange} price={data.price} compact />
      <span className="text-zinc-500 shrink-0" aria-hidden>
        ·
      </span>
      <span className="text-white shrink-0">vs 20d</span>
      <span className={cn("tabular-nums shrink-0", volMult === dashCell() ? "text-gray-400" : "text-white")}>{volMult}</span>
    </div>
  );
}
