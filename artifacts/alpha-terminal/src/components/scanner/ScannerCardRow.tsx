import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Activity,
  Box,
  ChevronRight,
  Minus,
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
  scannerRowUrgencyScore,
  scannerSansFontStyle,
} from "./scannerCard.utils";

function formatLastEventShort(iso: string | null | undefined): string {
  if (iso == null || typeof iso !== "string" || !iso.trim()) return dashCell();
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return dashCell();
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  } catch {
    return dashCell();
  }
}

function primaryEventLabel(primary: "sweep" | "block" | null, eventsToday: number): { label: string; Icon: typeof Zap } {
  if (primary === "sweep") return { label: "SWEEP CLUSTER", Icon: Zap };
  if (primary === "block") return { label: "BLOCK", Icon: Box };
  if (eventsToday > 0) return { label: "ACCUMULATION", Icon: Activity };
  return { label: "FLOW", Icon: Activity };
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
  const chgCls = hasCh ? (up ? "text-[#4ade80]" : "text-[#fb7185]") : "text-zinc-500";

  const flow = data.flow;
  const eventsToday = flow?.eventsToday ?? 0;
  const primary = flow?.primaryEventType ?? null;
  const netDir = flow?.netDirection ?? "neutral";
  const lastEv = flow?.lastEventTs ?? null;
  const earnDays = data.nextEarnings?.daysTo;

  const { label: eventTypeLabel, Icon: EventIcon } = primaryEventLabel(primary, eventsToday);
  const urgency = scannerRowUrgencyScore({ score: data.score, flow: data.flow });

  const dirIcon =
    netDir === "bullish" ? (
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#4ade80]" aria-hidden />
    ) : netDir === "bearish" ? (
      <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-[#fb7185]" aria-hidden />
    ) : netDir === "mixed" ? (
      <span className="inline-block w-3.5 text-center text-[#FFB800]" aria-hidden>
        –
      </span>
    ) : (
      <Minus className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
    );

  const dirLabelCls =
    netDir === "bullish"
      ? "text-[#4ade80]"
      : netDir === "bearish"
        ? "text-[#fb7185]"
        : netDir === "mixed"
          ? "text-[#FFB800]"
          : "text-zinc-500";

  const dirLabel =
    netDir === "bullish" ? "Bullish" : netDir === "bearish" ? "Bearish" : netDir === "mixed" ? "Mixed" : "Neutral";

  const line2Visible = eventsToday >= 1;

  return (
    <div className={cn(SCANNER_LAYER1_CARD_GRID_CLASS, "border-b border-zinc-900 text-white")}>
      <span className="flex w-4 shrink-0 justify-center pt-1 text-zinc-600" aria-hidden>
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5" style={scannerSansFontStyle}>
        {/* Line 1 — identity & price (mockup: bold symbol, grey name, white last + green/red Δ) */}
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 leading-tight">
            <span className="text-base font-bold tracking-tight text-white">{data.symbol}</span>
            {displayName ? (
              <span className="ml-1.5 text-sm font-normal text-zinc-500" title={displayName}>
                {displayName}
              </span>
            ) : null}
          </div>
          <div className="shrink-0 text-right" style={scannerNumericFontStyle}>
            <div className={cn("text-base font-semibold tabular-nums tracking-tight text-white")}>{priceStr}</div>
            <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-xs font-medium tabular-nums", chgCls)}>
              <span>{hasCh ? formatSignedMoney(chAbs) : dashCell()}</span>
              <span>{hasCh ? formatSignedPct(chPct) : dashCell()}</span>
            </div>
          </div>
        </div>

        {/* Line 2 — event cluster + sentiment + event count + urgency bar (mockup) */}
        {line2Visible ? (
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white">
              <EventIcon className="h-3.5 w-3.5 shrink-0 text-[#FFB800]" aria-hidden />
              <span className="whitespace-nowrap">{eventTypeLabel}</span>
              <span className="text-zinc-600">·</span>
              <span className="inline-flex items-center gap-1 normal-case">
                {dirIcon}
                <span className={cn("text-[12px] font-semibold tracking-tight", dirLabelCls)}>{dirLabel}</span>
              </span>
            </div>
            <span className="shrink-0 whitespace-nowrap text-[11px] font-medium normal-case text-zinc-500">
              {eventsToday} events
            </span>
            <div className="flex min-w-[96px] max-w-[140px] flex-1 items-center gap-2">
              <div className="relative h-[5px] min-w-0 flex-1 overflow-hidden rounded-sm bg-zinc-800">
                <div
                  className="absolute inset-y-0 left-0 rounded-sm bg-[#FFB800]"
                  style={{ width: `${Math.min(100, Math.max(0, urgency))}%` }}
                />
              </div>
              <span
                className="w-7 shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-200"
                style={scannerNumericFontStyle}
              >
                {urgency}
              </span>
            </div>
          </div>
        ) : null}

        {/* Line 3 — Vol · IVR · Last · ER + chevron */}
        <div
          className="flex min-w-0 items-center justify-between gap-2 text-[11px] leading-snug text-zinc-500"
          style={scannerNumericFontStyle}
        >
          <div className="min-w-0 truncate">
            {volMult != null ? <span>Vol {volMult} avg</span> : <span>Vol {dashCell()} avg</span>}
            <span className="text-zinc-700"> · </span>
            <span>IVR {ivrStr}</span>
            <span className="text-zinc-700"> · </span>
            <span>Last {formatLastEventShort(lastEv)}</span>
            {earnDays != null && Number.isFinite(earnDays) && earnDays <= 10 ? (
              <>
                <span className="text-zinc-700"> · </span>
                <span className="font-sans font-semibold text-[#FFB800]">ER {Math.round(earnDays)}d</span>
              </>
            ) : null}
          </div>
          <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600" aria-hidden />
        </div>
      </div>
    </div>
  );
}
