import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Box,
  ChevronDown,
  ChevronRight,
  Minus,
  Zap,
} from "lucide-react";
import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import { ScannerCardActions } from "./ScannerCardActions";
import { ScannerCardEventTimeline, useScannerSymbolEvents } from "./ScannerCardEventTimeline";
import { ScannerCardPanel, ScannerCardPanelRow } from "./ScannerCardPanel";
import type { ScannerCardAction } from "./scannerCard.types";
import {
  dashCell,
  formatCompactInt,
  formatDollarRange,
  formatIvPct,
  formatRatio,
  formatSignedMoney,
  formatSignedPct,
  meaningfulVolVsAvgMultiplier,
  scannerNumericFontStyle,
  volumeVsAvgMultiplier,
} from "./scannerCard.utils";

function IvBar({ ivr, dense }: { ivr: number | null; dense?: boolean }) {
  if (ivr == null || !Number.isFinite(ivr)) {
    return <span className="font-mono tabular-nums text-zinc-600">{dashCell()}</span>;
  }
  const pct = Math.min(100, Math.max(0, ivr));
  return (
    <div className="flex min-w-0 items-center justify-end gap-1">
      <div className={cn("h-1 shrink-0 overflow-hidden rounded-full bg-zinc-800", dense ? "w-10" : "w-14")}>
        <div className="h-full rounded-full bg-amber-500/90" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 text-right font-mono tabular-nums text-zinc-200">{Math.round(ivr)}</span>
    </div>
  );
}

function termLabel(shape: NonNullable<ScannerCardData["termStructure"]>["shape"]): string {
  if (shape === "contango") return "Contango";
  if (shape === "backwardation") return "Backwardation";
  return "Flat";
}

function formatCpNotionalRatio(callN: number, putN: number): string {
  if (callN <= 0 && putN <= 0) return dashCell();
  if (putN <= 0) return `${callN.toFixed(0)}:0`;
  const r = callN / putN;
  return `${r.toFixed(1)}:1`;
}

function strikeChip(s: { strike: number; callPut: "C" | "P"; notional: number }): string {
  const strikeStr = Number.isInteger(s.strike) ? String(s.strike) : s.strike.toFixed(2).replace(/\.?0+$/, "");
  return `$${strikeStr}${s.callPut} ${formatCompactInt(s.notional)}`;
}

/**
 * V3 expanded layout: event headline → live timeline → directional bias → chips → reference (collapsed) → actions.
 */
export function ScannerCardDetail({
  data,
  onAction,
}: {
  data: ScannerCardData;
  onAction: (action: ScannerCardAction) => void;
}) {
  const eventsState = useScannerSymbolEvents(data.symbol);
  const [referenceOpen, setReferenceOpen] = useState(false);

  const ts = data.termStructure;
  const earn = data.nextEarnings;
  const flow = data.flow;
  const tech = data.technical;

  const primary = flow?.primaryEventType ?? null;
  const netDir = flow?.netDirection ?? "neutral";
  const eventsToday = flow?.eventsToday ?? 0;

  const dirIcon =
    netDir === "bullish" ? (
      <ArrowUpRight className="h-4 w-4 shrink-0 text-terminal-success" aria-hidden />
    ) : netDir === "bearish" ? (
      <ArrowDownRight className="h-4 w-4 shrink-0 text-terminal-danger" aria-hidden />
    ) : netDir === "mixed" ? (
      <ArrowRight className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
    ) : (
      <Minus className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    );

  const dirLabelCls =
    netDir === "bullish"
      ? "text-terminal-success"
      : netDir === "bearish"
        ? "text-terminal-danger"
        : netDir === "mixed"
          ? "text-amber-300/95"
          : "text-muted-foreground";

  const dirText =
    netDir === "bullish" ? "Bullish" : netDir === "bearish" ? "Bearish" : netDir === "mixed" ? "Mixed" : "Neutral";

  const summary = eventsState.payload?.summary;
  const bias = useMemo(() => {
    if (!summary) return null;
    const bull = summary.bullishNotional;
    const bear = summary.bearishNotional;
    const t = bull + bear;
    const bullPct = t > 0 ? Math.round((bull / t) * 1000) / 10 : 50;
    const bearPct = t > 0 ? Math.round((bear / t) * 1000) / 10 : 50;
    return { bull, bear, bullPct, bearPct };
  }, [summary]);

  const volMult =
    meaningfulVolVsAvgMultiplier(data.volume, data.avgVolume20d) ?? volumeVsAvgMultiplier(data.volume, data.avgVolume20d);
  const ivrChip = data.ivr != null && Number.isFinite(data.ivr) ? `${Math.round(data.ivr)}` : dashCell();
  const earnChip = earn != null && Number.isFinite(earn.daysTo) ? `in ${Math.round(earn.daysTo)}d` : dashCell();
  const topStrikeChip = flow?.topStrikeLabel?.trim() ? flow.topStrikeLabel : dashCell();

  const todayLine = useMemo(() => {
    if (!summary) return null;
    const totalAll = summary.callNotional + summary.putNotional;
    const ratio = formatCpNotionalRatio(summary.callNotional, summary.putNotional);
    return `Today: ${summary.totalEvents} events · $${totalAll.toLocaleString(undefined, { maximumFractionDigits: 0 })} notional · C:P ${ratio}`;
  }, [summary]);

  return (
    <div className="space-y-2 border-t border-zinc-800/80 bg-[#080808]/95 px-2 pb-1.5 pt-1.5">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 pb-2 text-xs font-semibold uppercase tracking-wide">
        {primary === "sweep" ? (
          <>
            <Zap className="h-4 w-4 text-amber-400" aria-hidden />
            <span className="text-amber-200/95">SWEEP</span>
          </>
        ) : primary === "block" ? (
          <>
            <Box className="h-4 w-4 text-zinc-400" aria-hidden />
            <span className="text-zinc-200">BLOCK</span>
          </>
        ) : (
          <span className="text-zinc-500">Flow</span>
        )}
        <span className="text-zinc-600">·</span>
        {dirIcon}
        <span className={cn("normal-case tracking-tight", dirLabelCls)}>{dirText}</span>
        <span className="ml-auto font-mono text-[11px] font-bold normal-case text-zinc-300">{eventsToday} events</span>
      </div>

      <ScannerCardPanel title="Event timeline (4h)" dense>
        <ScannerCardEventTimeline eventsState={eventsState} />
      </ScannerCardPanel>

      <div className="rounded border border-zinc-800/80 bg-zinc-950/35 px-2 py-1.5">
        <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Directional bias</div>
        {eventsState.error ? (
          <p className="mt-2 text-[11px] text-red-400/80">{eventsState.error}</p>
        ) : eventsState.loading || !bias ? (
          <div className="mt-2 h-16 animate-pulse rounded bg-zinc-900/50" />
        ) : (
          <>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full bg-terminal-success/85"
                style={{ width: `${Math.min(100, Math.max(0, bias.bullPct))}%` }}
              />
              <div
                className="h-full bg-terminal-danger/85"
                style={{ width: `${Math.min(100, Math.max(0, bias.bearPct))}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-400">
              <span className="text-terminal-success">{bias.bullPct}% bull</span>
              <span className="text-terminal-danger">{bias.bearPct}% bear</span>
            </div>
            <div className="mt-2 font-mono text-xs text-zinc-200">
              Net Δ$
              {summary?.netDeltaDollar != null && Number.isFinite(summary.netDeltaDollar)
                ? formatSignedMoney(summary.netDeltaDollar)
                : dashCell()}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
              <div>
                <div className="font-bold uppercase tracking-wider text-terminal-success/90">Top bullish</div>
                <ul className="mt-1 space-y-0.5 font-mono text-zinc-300">
                  {(summary?.topBullishStrikes ?? []).map((s, i) => (
                    <li key={`b-${i}`}>{strikeChip(s)}</li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-bold uppercase tracking-wider text-terminal-danger/90">Top bearish</div>
                <ul className="mt-1 space-y-0.5 font-mono text-zinc-300">
                  {(summary?.topBearishStrikes ?? []).map((s, i) => (
                    <li key={`r-${i}`}>{strikeChip(s)}</li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {[
          { k: "IVR", v: ivrChip },
          { k: "Earnings", v: earnChip },
          { k: "Vol", v: volMult === dashCell() ? dashCell() : `${volMult} avg` },
          { k: "Top", v: topStrikeChip },
        ].map((c) => (
          <div
            key={c.k}
            className="rounded border border-zinc-800/70 bg-zinc-950/50 px-2 py-1 text-center font-mono text-[10px]"
          >
            <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">{c.k}</div>
            <div className="mt-0.5 truncate text-[11px] text-zinc-200" title={String(c.v)}>
              {c.v}
            </div>
          </div>
        ))}
      </div>

      {todayLine ? (
        <div className="rounded border border-zinc-800/60 bg-black/40 px-2 py-1 font-mono text-[10px] text-zinc-400">
          {todayLine}
        </div>
      ) : null}

      <div className="rounded border border-zinc-800/70">
        <button
          type="button"
          onClick={() => setReferenceOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-zinc-400 hover:text-zinc-200"
        >
          <span>Reference data</span>
          {referenceOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        {referenceOpen ? (
          <div className="grid gap-1 border-t border-zinc-800/60 p-1 sm:grid-cols-2">
            <ScannerCardPanel title="Vol Context" dense>
              <ScannerCardPanelRow dense label="IV30" value={formatIvPct(data.iv30)} />
              <ScannerCardPanelRow dense label="IVR" value={<IvBar ivr={data.ivr} dense />} />
              <ScannerCardPanelRow
                dense
                label="IV Percentile"
                value={
                  data.ivPercentile != null && Number.isFinite(data.ivPercentile)
                    ? `${Math.round(data.ivPercentile)}`
                    : dashCell()
                }
              />
              <ScannerCardPanelRow dense label="HV30" value={formatIvPct(data.hv30)} />
              <ScannerCardPanelRow
                dense
                label="IV vs HV"
                value={
                  data.ivVsHv != null && Number.isFinite(data.ivVsHv)
                    ? formatRatio(data.ivVsHv)
                    : data.iv30 != null &&
                        data.hv30 != null &&
                        Number.isFinite(data.iv30) &&
                        Number.isFinite(data.hv30) &&
                        data.hv30 !== 0
                      ? formatRatio(data.iv30 / data.hv30)
                      : dashCell()
                }
              />
              <ScannerCardPanelRow
                dense
                label="Term Structure"
                value={ts ? `${termLabel(ts.shape)} (${formatRatio(ts.ratio)})` : dashCell()}
              />
            </ScannerCardPanel>
            <ScannerCardPanel title="Technical" dense>
              <ScannerCardPanelRow
                dense
                label="52w Range"
                value={tech != null ? formatDollarRange(tech.fiftyTwoWeekLow, tech.fiftyTwoWeekHigh) : dashCell()}
              />
              <ScannerCardPanelRow
                dense
                label="Off 52w High"
                value={
                  tech != null && tech.offFiftyTwoWeekHighPct != null && Number.isFinite(tech.offFiftyTwoWeekHighPct)
                    ? formatSignedPct(tech.offFiftyTwoWeekHighPct)
                    : dashCell()
                }
              />
              <ScannerCardPanelRow
                dense
                label="vs 20MA"
                value={
                  tech != null && tech.vsTwentyMaPct != null && Number.isFinite(tech.vsTwentyMaPct)
                    ? formatSignedPct(tech.vsTwentyMaPct)
                    : dashCell()
                }
              />
              <ScannerCardPanelRow
                dense
                label="vs 50MA"
                value={
                  tech != null && tech.vsFiftyMaPct != null && Number.isFinite(tech.vsFiftyMaPct)
                    ? formatSignedPct(tech.vsFiftyMaPct)
                    : dashCell()
                }
              />
              <ScannerCardPanelRow
                dense
                label="vs 200MA"
                value={
                  tech != null && tech.vsTwoHundredMaPct != null && Number.isFinite(tech.vsTwoHundredMaPct)
                    ? formatSignedPct(tech.vsTwoHundredMaPct)
                    : dashCell()
                }
              />
              <ScannerCardPanelRow
                dense
                label="5d Return"
                value={
                  tech != null && tech.fiveDayReturnPct != null && Number.isFinite(tech.fiveDayReturnPct)
                    ? formatSignedPct(tech.fiveDayReturnPct)
                    : dashCell()
                }
              />
              <ScannerCardPanelRow
                dense
                label="30d Return"
                value={
                  tech != null && tech.thirtyDayReturnPct != null && Number.isFinite(tech.thirtyDayReturnPct)
                    ? formatSignedPct(tech.thirtyDayReturnPct)
                    : dashCell()
                }
              />
            </ScannerCardPanel>
          </div>
        ) : null}
      </div>

      <div style={scannerNumericFontStyle}>
        <ScannerCardActions symbol={data.symbol} onAction={onAction} />
      </div>
    </div>
  );
}
