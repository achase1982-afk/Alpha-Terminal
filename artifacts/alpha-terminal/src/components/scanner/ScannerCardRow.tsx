import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Box,
  ChevronRight,
  Minus,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import {
  SCANNER_LAYER1_CARD_GRID_CLASS,
  dashCell,
  formatPrice,
  formatSignedMoney,
  formatSignedPct,
  meaningfulVolVsAvgMultiplier,
  scannerNumericFontStyle,
} from "./scannerCard.utils";

function formatLastEventShort(iso: string | null | undefined): string {
  if (iso == null || typeof iso !== "string" || !iso.trim()) return dashCell();
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return dashCell();
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return dashCell();
  }
}

function formatNotionalShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return dashCell();
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function ScannerCardRow({ data, expanded }: { data: ScannerCardData; expanded: boolean }) {
  const volMult = meaningfulVolVsAvgMultiplier(data.volume, data.avgVolume20d);
  const chAbs = data.changeAbs;
  const chPct = data.changePct;
  const hasCh = chAbs != null && chPct != null && Number.isFinite(chAbs) && Number.isFinite(chPct);
  const up = hasCh && (chPct as number) >= 0;

  const priceStr = formatPrice(data.price);
  const ivrStr = data.ivr != null && Number.isFinite(data.ivr) ? String(Math.round(data.ivr)) : dashCell();
  const displayName = data.name?.trim();
  const chgCls = hasCh ? (up ? "text-terminal-success" : "text-terminal-danger") : "text-muted-foreground";

  const flow = data.flow;
  const eventsToday = flow?.eventsToday ?? 0;
  const sweepCt = flow?.sweepCount ?? flow?.sweeps4h ?? 0;
  const primary = flow?.primaryEventType ?? null;
  const netDir = flow?.netDirection ?? "neutral";
  const lastEv = flow?.lastEventTs ?? null;
  const earnDays = data.nextEarnings?.daysTo;

  const dirIcon =
    netDir === "bullish" ? (
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-terminal-success" aria-hidden />
    ) : netDir === "bearish" ? (
      <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-terminal-danger" aria-hidden />
    ) : netDir === "mixed" ? (
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
    ) : (
      <Minus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
    );

  const dirLabelCls =
    netDir === "bullish"
      ? "text-terminal-success"
      : netDir === "bearish"
        ? "text-terminal-danger"
        : netDir === "mixed"
          ? "text-amber-300/95"
          : "text-muted-foreground";

  const dirLabel =
    netDir === "bullish" ? "Bullish" : netDir === "bearish" ? "Bearish" : netDir === "mixed" ? "Mixed" : "Neutral";

  const line2Visible = primary != null;

  return (
    <div className={cn(SCANNER_LAYER1_CARD_GRID_CLASS, "text-foreground")} style={scannerNumericFontStyle}>
      <span className="flex w-4 shrink-0 justify-center pt-0.5 text-zinc-600/45" aria-hidden>
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Line 1 — identity & price */}
        <div className="flex min-w-0 items-end justify-between gap-2">
          <div className="min-w-0 leading-tight">
            <span className="font-bold tracking-tight text-foreground">{data.symbol}</span>
            {displayName ? (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground" title={displayName}>
                {displayName}
              </span>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div
              className={cn(
                "text-base font-semibold tracking-tight",
                priceStr === dashCell() ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {priceStr}
            </div>
            <div className={cn("flex items-center justify-end gap-1 text-xs tracking-tight", chgCls)}>
              {hasCh ? (
                up ? (
                  <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )
              ) : null}
              <span>{hasCh ? formatSignedMoney(chAbs) : dashCell()}</span>
              <span>{hasCh ? formatSignedPct(chPct) : dashCell()}</span>
            </div>
          </div>
        </div>

        {/* Line 2 — UAI signal */}
        {line2Visible ? (
          <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
            <div className="flex min-w-0 items-center gap-1.5 font-semibold uppercase tracking-wide">
              {primary === "sweep" ? (
                <>
                  <Zap className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                  <span className="text-amber-200/95">SWEEP</span>
                </>
              ) : (
                <>
                  <Box className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
                  <span className="text-zinc-200">BLOCK</span>
                  {flow?.largestEventNotional != null && Number.isFinite(flow.largestEventNotional) ? (
                    <span className="truncate font-mono font-normal normal-case tracking-tight text-muted-foreground">
                      {formatNotionalShort(flow.largestEventNotional)}
                    </span>
                  ) : null}
                </>
              )}
              <span className="mx-0.5 text-zinc-600" aria-hidden>
                ·
              </span>
              {dirIcon}
              <span className={cn("truncate font-semibold normal-case tracking-tight", dirLabelCls)}>{dirLabel}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="font-mono text-[11px] text-zinc-300">{eventsToday}</span>
              {sweepCt > 0 ? (
                <span
                  className="rounded border border-amber-500/50 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-200/95"
                  title="Sweeps in rolling window"
                >
                  {sweepCt} sw
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Line 3 — compact context */}
        <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] leading-snug text-muted-foreground">
          <div className="min-w-0 truncate font-mono">
            {volMult != null ? <span>Vol {volMult} avg</span> : <span>Vol {dashCell()} avg</span>}
            <span className="text-zinc-600"> · </span>
            <span>IVR {ivrStr}</span>
            <span className="text-zinc-600"> · </span>
            <span>Last {formatLastEventShort(lastEv)}</span>
            {earnDays != null && Number.isFinite(earnDays) && earnDays <= 10 ? (
              <>
                <span className="text-zinc-600"> · </span>
                <span className="text-amber-200/90">ER {Math.round(earnDays)}d</span>
              </>
            ) : null}
          </div>
          <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600/50" aria-hidden />
        </div>
      </div>
    </div>
  );
}
