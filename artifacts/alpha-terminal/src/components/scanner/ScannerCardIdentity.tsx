import { Fragment, type ReactNode } from "react";
import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import {
  dashCell,
  meaningfulVolVsAvgMultiplier,
  scannerNumericFontStyle,
} from "./scannerCard.utils";

function hasValidDayRange(range: ScannerCardData["dayRange"]): range is { low: number; high: number } {
  return (
    range != null &&
    Number.isFinite(range.low) &&
    Number.isFinite(range.high) &&
    range.high > range.low
  );
}

function DayRangeBar({
  range,
  price,
  compact,
}: {
  range: { low: number; high: number };
  price: number | null;
  compact?: boolean;
}) {
  const span = range.high - range.low;
  let markerPct = 50;
  if (price != null && Number.isFinite(price)) {
    markerPct = Math.min(100, Math.max(0, ((price - range.low) / span) * 100));
  }
  const loHi = (
    <span
      className="hidden shrink-0 font-mono text-[11px] tabular-nums text-zinc-300 sm:inline"
      style={scannerNumericFontStyle}
    >
      {range.low.toFixed(1)}–{range.high.toFixed(1)}
    </span>
  );
  const bar = (
    <div className="relative h-1.5 min-w-[48px] flex-1 overflow-hidden rounded-full bg-zinc-800">
      <div
        className="absolute bottom-0 top-0 w-0.5 rounded-full bg-primary shadow-[0_0_4px_hsl(var(--primary))]"
        style={{ left: `${markerPct}%`, transform: "translateX(-50%)" }}
      />
    </div>
  );
  if (compact) {
    return (
      <div className="flex max-w-[160px] min-w-0 flex-1 items-center gap-1" style={scannerNumericFontStyle}>
        {loHi}
        {bar}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2" style={scannerNumericFontStyle}>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-300">
        {range.low.toFixed(2)} – {range.high.toFixed(2)}
      </span>
      {bar}
    </div>
  );
}

/**
 * Identity line: only segments with real data, · between segments (v3 + polish).
 */
export function ScannerCardIdentity({ data }: { data: ScannerCardData }) {
  const name = data.name?.trim();
  const sector = data.sector?.trim();
  const volMult = meaningfulVolVsAvgMultiplier(data.volume, data.avgVolume20d);
  const rangeOk = hasValidDayRange(data.dayRange);

  const segments: ReactNode[] = [];
  if (name) {
    segments.push(
      <span key="name" className="shrink-0 font-medium text-zinc-100">
        {name}
      </span>,
    );
  }
  if (sector) {
    segments.push(
      <span key="sector" className="max-w-[42%] shrink truncate text-zinc-400" title={sector}>
        {sector}
      </span>,
    );
  }
  if (rangeOk) {
    segments.push(<DayRangeBar key="range" range={data.dayRange!} price={data.price} compact />);
  }
  if (volMult) {
    segments.push(
      <span key="vol" className="shrink-0 tabular-nums text-zinc-200">
        <span className="text-zinc-500">vs 20d </span>
        {volMult}
      </span>,
    );
  }

  if (segments.length === 0) {
    return (
      <div className="font-mono text-[12px] text-zinc-600" style={scannerNumericFontStyle}>
        {dashCell()}
      </div>
    );
  }

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0 font-mono text-[12px] leading-snug text-zinc-300"
      style={scannerNumericFontStyle}
    >
      {segments.map((node, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span className="shrink-0 text-zinc-600" aria-hidden>
              ·
            </span>
          ) : null}
          {node}
        </Fragment>
      ))}
    </div>
  );
}
