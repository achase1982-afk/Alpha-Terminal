import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import {
  SCANNER_LAYER1_CARD_GRID_CLASS,
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
    <div className={cn(SCANNER_LAYER1_CARD_GRID_CLASS, "text-foreground")} style={scannerNumericFontStyle}>
      {/* Chevron spans ticker + name rows */}
      <span className="col-start-1 row-start-1 row-span-2 flex justify-center pt-0.5 text-zinc-600/45" aria-hidden>
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
      </span>

      <div className="col-start-2 row-start-1 min-w-0 self-end truncate font-bold tracking-tight text-foreground">
        {data.symbol}
      </div>

      <span
        className={cn(
          "col-start-6 row-start-1 row-span-2 self-center justify-self-end text-base font-semibold tracking-tight",
          priceStr === dashCell() ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {priceStr}
      </span>

      <div
        className="col-start-2 row-start-2 min-w-0 truncate text-xs leading-snug text-muted-foreground"
        title={displayName || undefined}
      >
        {displayName ?? "\u00a0"}
      </div>

      {/* Row 3 — strictly $ / % / IVR (never shares a row with Name) */}
      <div className={cn("col-start-3 row-start-3 flex items-center justify-end gap-1 tracking-tight", chgCls)}>
        {hasCh ? (
          up ? (
            <TrendingUp className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <TrendingDown className="h-4 w-4 shrink-0" aria-hidden />
          )
        ) : null}
        <span>{hasCh ? formatSignedMoney(chAbs) : dashCell()}</span>
      </div>

      <span className={cn("col-start-4 row-start-3 self-center justify-self-center tracking-tight", chgCls)}>
        {hasCh ? formatSignedPct(chPct) : dashCell()}
      </span>

      <span
        className={cn(
          "col-start-5 row-start-3 justify-self-end tracking-tight",
          ivrStr === dashCell() ? "text-muted-foreground" : "text-foreground",
        )}
        title={ivrStr !== dashCell() ? "Implied volatility rank (0–100)" : undefined}
      >
        {ivrStr}
      </span>

      {/* Row 4 */}
      <div className="col-start-2 row-start-4 min-w-0 justify-self-start">
        {pill ? (
          <span
            className="inline-flex max-w-full truncate rounded-full border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-200/95"
            title={pill}
          >
            {pill}
          </span>
        ) : (
          <span className="text-muted-foreground">{dashCell()}</span>
        )}
      </div>

      <div
        className="col-start-4 row-start-4 flex items-center justify-center gap-1 tracking-tight"
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

      <div className="col-start-6 row-start-4 flex min-w-0 flex-col items-end justify-center gap-0 leading-snug">
        <span className={cn("tracking-tight", volStr === dashCell() ? "text-muted-foreground" : "text-foreground")}>
          {volStr}
        </span>
        {volMult !== dashCell() ? (
          <span className="text-xs tracking-tight text-muted-foreground" title="Volume vs 20-day average">
            {volMult} avg
          </span>
        ) : null}
      </div>
    </div>
  );
}
