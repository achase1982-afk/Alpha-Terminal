import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import {
  SCANNER_LAYER1_BODY_INDENT,
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
    <div className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5 text-sm text-foreground" style={scannerNumericFontStyle}>
      {/* Line 1: identity + last */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <span className="flex w-4 shrink-0 justify-center pt-0.5 text-zinc-600/45" aria-hidden>
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-bold tracking-tight text-foreground">{data.symbol}</div>
            {displayName ? (
              <div className="truncate text-xs leading-snug text-muted-foreground" title={displayName}>
                {displayName}
              </div>
            ) : null}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 tabular-nums text-base font-semibold tracking-tight",
            priceStr === dashCell() ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {priceStr}
        </span>
      </div>

      {/* Line 2: dollar % IVR */}
      <div className={cn("flex min-w-0 items-center justify-between gap-3", SCANNER_LAYER1_BODY_INDENT)}>
        <div className={cn("flex min-w-0 shrink-0 items-center gap-1 tabular-nums tracking-tight", chgCls)}>
          {hasCh ? (
            up ? (
              <TrendingUp className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <TrendingDown className="h-4 w-4 shrink-0" aria-hidden />
            )
          ) : null}
          <span>{hasCh ? formatSignedMoney(chAbs) : dashCell()}</span>
        </div>
        <span className={cn("min-w-0 flex-1 text-center tabular-nums tracking-tight", chgCls)}>
          {hasCh ? formatSignedPct(chPct) : dashCell()}
        </span>
        <span
          className={cn(
            "shrink-0 tabular-nums tracking-tight text-right",
            ivrStr === dashCell() ? "text-muted-foreground" : "text-foreground",
          )}
          title={ivrStr !== dashCell() ? "Implied volatility rank (0–100)" : undefined}
        >
          {ivrStr}
        </span>
      </div>

      {/* Line 3: catalyst · score · volume */}
      <div className={cn("flex min-w-0 items-start justify-between gap-2", SCANNER_LAYER1_BODY_INDENT)}>
        <div className="flex min-w-0 flex-[1.1] justify-start">
          {pill ? (
            <span
              className="inline-flex max-w-full items-center truncate rounded-full border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-200/95"
              title={pill}
            >
              {pill}
            </span>
          ) : (
            <span className="text-muted-foreground">{dashCell()}</span>
          )}
        </div>

        <div
          className="flex shrink-0 flex-none items-center justify-center gap-1 tabular-nums tracking-tight px-1"
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

        <div className="flex min-w-0 flex-[1.2] flex-col items-end justify-center gap-0 leading-snug">
          <span className={cn("tabular-nums tracking-tight", volStr === dashCell() ? "text-muted-foreground" : "text-foreground")}>
            {volStr}
          </span>
          {volMult !== dashCell() ? (
            <span className="text-xs tabular-nums text-muted-foreground" title="Volume vs 20-day average">
              {volMult} avg
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
