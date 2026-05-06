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
      <span className="font-mono tabular-nums text-zinc-600" style={scannerNumericFontStyle}>
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
      className="shrink-0 font-mono tabular-nums text-zinc-300 hidden sm:inline text-[11px]"
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
      <span className="shrink-0 font-mono tabular-nums text-[11px] text-zinc-300">
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
      className="flex flex-wrap items-center gap-x-1 gap-y-0 font-mono text-[12px] leading-snug text-zinc-300 min-w-0"
      style={scannerNumericFontStyle}
    >
      <span className={cn("shrink-0 font-medium text-zinc-100", name === dashCell() && "text-zinc-600")}>{name}</span>
      {hasSector ? (
        <>
          <span className="shrink-0 text-zinc-600" aria-hidden>
            ·
          </span>
          <span className="max-w-[42%] shrink truncate text-zinc-400" title={sector}>
            {sector}
          </span>
        </>
      ) : null}
      <span className="shrink-0 text-zinc-600" aria-hidden>
        ·
      </span>
      <DayRangeBar range={data.dayRange} price={data.price} compact />
      <span className="shrink-0 text-zinc-600" aria-hidden>
        ·
      </span>
      <span className="shrink-0 text-zinc-400">vs 20d</span>
      <span className={cn("shrink-0 tabular-nums", volMult === dashCell() ? "text-zinc-600" : "text-zinc-200")}>{volMult}</span>
    </div>
  );
}
