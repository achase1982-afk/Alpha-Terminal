import { ChevronDown, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import {
  catalystPillLabel,
  dashCell,
  formatCompactInt,
  formatPrice,
  formatSignedMoney,
  formatSignedPct,
  scannerNumericFontStyle,
  volumeVsAvgMultiplier,
} from "./scannerCard.utils";

function TierDotSmall({ score }: { score: number | null }) {
  if (score == null || !Number.isFinite(score)) {
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-600 shrink-0" aria-hidden />;
  }
  let cls = "bg-zinc-500";
  if (score >= 75) cls = "bg-emerald-400";
  else if (score >= 50) cls = "bg-amber-400";
  else if (score >= 25) cls = "bg-zinc-400";
  else cls = "bg-red-400";
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full shrink-0", cls)} aria-hidden />;
}

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

  return (
    <div
      className="flex flex-nowrap items-center gap-x-2 sm:gap-x-3 overflow-x-auto py-2.5 px-3 text-sm min-w-0"
      style={scannerNumericFontStyle}
    >
      <span className="text-muted-foreground shrink-0" aria-hidden>
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </span>

      <span className="font-bold text-foreground shrink-0 tracking-tight">{data.symbol}</span>

      <span
        className={cn(
          "truncate max-w-[8rem] sm:max-w-[12rem] shrink min-w-[2ch]",
          data.name?.trim() ? "text-muted-foreground" : "text-muted-foreground/90",
        )}
      >
        {data.name?.trim() || dashCell()}
      </span>

      <span
        className={cn(
          "text-right tabular-nums shrink-0 min-w-[3.25rem]",
          priceStr === dashCell() ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {priceStr}
      </span>

      <div
        className={cn(
          "text-right tabular-nums shrink-0 min-w-[6.5rem] flex items-center justify-end gap-0.5 whitespace-nowrap",
          hasCh ? (up ? "text-terminal-success" : "text-terminal-danger") : "text-muted-foreground",
        )}
      >
        {hasCh ? (
          <>
            {up ? <TrendingUp className="w-3.5 h-3.5 shrink-0" aria-hidden /> : <TrendingDown className="w-3.5 h-3.5 shrink-0" aria-hidden />}
            <span>
              {formatSignedMoney(chAbs)} {formatSignedPct(chPct)}
            </span>
          </>
        ) : (
          dashCell()
        )}
      </div>

      <span
        className={cn(
          "text-right tabular-nums shrink-0 min-w-[2rem]",
          ivrStr === dashCell() ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {ivrStr}
      </span>

      <div className="shrink-0 w-[5.5rem] flex justify-center">
        {pill ? (
          <span className="inline-flex items-center rounded-full border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-200/95 whitespace-nowrap">
            {pill}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-1 tabular-nums shrink-0 min-w-[2.25rem]">
        <TierDotSmall score={data.score} />
        {data.score != null && Number.isFinite(data.score) ? (
          <span className="text-foreground font-semibold">{Math.round(data.score)}</span>
        ) : null}
      </div>

      <div className="text-right tabular-nums shrink-0 whitespace-nowrap ml-auto sm:ml-0">
        <span className={volStr === dashCell() ? "text-muted-foreground" : "text-foreground"}>{volStr}</span>
        {volMult !== dashCell() ? <span className="text-muted-foreground ml-1">({volMult})</span> : null}
      </div>
    </div>
  );
}
