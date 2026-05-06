import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
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
    return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-600" aria-hidden />;
  }
  let cls = "bg-zinc-500";
  if (score >= 70) cls = "bg-emerald-400 shadow-[0_0_4px_hsl(var(--terminal-success)/0.35)]";
  else if (score >= 40) cls = "bg-amber-400";
  else cls = "bg-red-400";
  return <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", cls)} aria-hidden />;
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
  const displayName = data.name?.trim();

  return (
    <div
      className="flex min-w-0 flex-nowrap items-center gap-x-1.5 overflow-x-auto px-2.5 py-2 text-sm sm:gap-x-2 sm:px-3"
      style={scannerNumericFontStyle}
    >
      <span className="w-2 shrink-0 text-center text-zinc-600/45" aria-hidden>
        <ChevronRight className={cn("mx-auto h-2.5 w-2.5 transition-transform", expanded && "rotate-90")} />
      </span>

      <span className="shrink-0 font-bold tracking-tight text-foreground">{data.symbol}</span>

      {displayName ? (
        <span
          className={cn(
            "min-w-0 max-w-[10rem] shrink truncate text-muted-foreground sm:max-w-[12rem]",
            "max-[480px]:portrait:hidden",
          )}
          title={displayName}
        >
          {displayName}
        </span>
      ) : null}

      <span
        className={cn(
          "min-w-[3.25rem] shrink-0 text-right tabular-nums",
          priceStr === dashCell() ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {priceStr}
      </span>

      <div
        className={cn(
          "flex min-w-[6.5rem] shrink-0 items-center justify-end gap-0.5 whitespace-nowrap text-right tabular-nums",
          hasCh ? (up ? "text-terminal-success" : "text-terminal-danger") : "text-muted-foreground",
        )}
      >
        {hasCh ? (
          <>
            {up ? <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5 shrink-0" aria-hidden />}
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
          "min-w-[2rem] shrink-0 text-right tabular-nums",
          ivrStr === dashCell() ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {ivrStr}
      </span>

      <div className="flex w-[5.5rem] shrink-0 justify-center">
        {pill ? (
          <span className="inline-flex items-center whitespace-nowrap rounded-full border border-amber-500/45 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-200/95 sm:text-xs">
            {pill}
          </span>
        ) : null}
      </div>

      <div className="flex min-w-[2.25rem] shrink-0 items-center justify-end gap-0.5 tabular-nums">
        <TierDotSmall score={data.score} />
        {data.score != null && Number.isFinite(data.score) ? (
          <span className="font-semibold text-foreground">{Math.round(data.score)}</span>
        ) : null}
      </div>

      <div className="ml-auto shrink-0 whitespace-nowrap text-right tabular-nums sm:ml-0">
        <span className={volStr === dashCell() ? "text-muted-foreground" : "text-foreground"}>{volStr}</span>
        {volMult !== dashCell() ? <span className="ml-1 text-muted-foreground">({volMult})</span> : null}
      </div>
    </div>
  );
}
