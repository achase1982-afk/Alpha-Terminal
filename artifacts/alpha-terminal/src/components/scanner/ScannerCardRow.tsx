import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import {
  SCANNER_LAYER1_GRID_CLASS,
  catalystPillLabel,
  dashCell,
  formatCompactInt,
  formatPrice,
  formatSignedMoney,
  formatSignedPct,
  scannerNumericFontStyle,
  scannerScoreTierDotClassName,
  volumeVsAvgMultiplier,
} from "./scannerCard.utils";

export function ScannerCardRow({ data, expanded }: { data: ScannerCardData; expanded: boolean }) {
  const pill = catalystPillLabel(data);
  const volMult = volumeVsAvgMultiplier(data.volume, data.avgVolume20d);
  const chAbs = data.changeAbs;
  const chPct = data.changePct;
  const hasCh = chAbs != null && chPct != null && Number.isFinite(chAbs) && Number.isFinite(chPct);
  const up = hasCh && (chPct as number) >= 0;

  const priceStr = formatPrice(data.price);
  const ivrStr = data.ivr != null && Number.isFinite(data.ivr) ? String(Math.round(data.ivr)) : dashCell();
  const volStr = formatCompactInt(data.volume);
  const displayName = data.name?.trim();
  const chgCls = hasCh ? (up ? "text-terminal-success" : "text-terminal-danger") : "text-muted-foreground";

  return (
    <div className={cn(SCANNER_LAYER1_GRID_CLASS, "text-foreground")} style={scannerNumericFontStyle}>
      <span className="flex justify-center text-zinc-600/45" aria-hidden>
        <ChevronRight className={cn("h-2.5 w-2.5 transition-transform", expanded && "rotate-90")} />
      </span>

      <div className="min-w-0">
        <div className="truncate font-bold tracking-tight text-foreground">{data.symbol}</div>
        {displayName ? (
          <div className="truncate text-[9px] leading-snug text-muted-foreground sm:text-[10px]" title={displayName}>
            {displayName}
          </div>
        ) : null}
      </div>

      <span
        className={cn(
          "text-right tabular-nums tracking-tight",
          priceStr === dashCell() ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {priceStr}
      </span>

      <div className={cn("flex items-center justify-end gap-0.5 tabular-nums tracking-tight", chgCls)}>
        {hasCh ? (
          up ? (
            <TrendingUp className="h-3 w-3 shrink-0" aria-hidden />
          ) : (
            <TrendingDown className="h-3 w-3 shrink-0" aria-hidden />
          )
        ) : null}
        <span>{hasCh ? formatSignedMoney(chAbs) : dashCell()}</span>
      </div>

      <span className={cn("text-right tabular-nums tracking-tight", chgCls)}>
        {hasCh ? formatSignedPct(chPct) : dashCell()}
      </span>

      <span
        className={cn(
          "text-right tabular-nums tracking-tight",
          ivrStr === dashCell() ? "text-muted-foreground" : "text-foreground",
        )}
        title={ivrStr !== dashCell() ? "Implied volatility rank (0–100)" : undefined}
      >
        {ivrStr}
      </span>

      <div className="flex min-w-0 justify-center px-0.5">
        {pill ? (
          <span
            className="max-w-full truncate rounded-full border border-amber-500/45 bg-amber-500/10 px-1.5 py-px text-[9px] font-bold text-amber-200/95 sm:px-2 sm:py-0.5 sm:text-[10px]"
            title={pill}
          >
            {pill}
          </span>
        ) : (
          <span className="text-muted-foreground">{dashCell()}</span>
        )}
      </div>

      <div
        className="flex items-center justify-end gap-0.5 tabular-nums tracking-tight"
        title={
          data.score != null && Number.isFinite(data.score)
            ? `Composite scanner score ${Math.round(data.score)} / 100`
            : undefined
        }
      >
        <span className={scannerScoreTierDotClassName(data.score, "sm")} aria-hidden />
        {data.score != null && Number.isFinite(data.score) ? (
          <span className="font-semibold text-foreground">{Math.round(data.score)}</span>
        ) : (
          <span className="font-semibold text-muted-foreground">{dashCell()}</span>
        )}
      </div>

      <div className="flex min-w-0 flex-col items-end justify-center gap-0 leading-tight">
        <span className={cn("tabular-nums tracking-tight", volStr === dashCell() ? "text-muted-foreground" : "text-foreground")}>
          {volStr}
        </span>
        {volMult !== dashCell() ? (
          <span className="text-[9px] tabular-nums text-muted-foreground sm:text-[10px]" title="Volume vs 20-day average">
            {volMult} avg
          </span>
        ) : null}
      </div>
    </div>
  );
}
