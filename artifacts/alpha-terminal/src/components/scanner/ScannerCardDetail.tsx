import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Minus } from "lucide-react";
import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import { ScannerCardActions } from "./ScannerCardActions";
import { ScannerCardEventTimeline, useScannerSymbolEvents } from "./ScannerCardEventTimeline";
import { ScannerCardPanel, ScannerCardPanelRow } from "./ScannerCardPanel";
import type { ScannerCardAction } from "./scannerCard.types";
import {
  dashCell,
  formatDollarRange,
  formatIvPct,
  formatRatio,
  formatSignedMoney,
  formatSignedPct,
  formatNotionalTickerUi,
  meaningfulVolVsAvgMultiplier,
  scannerNumericFontStyle,
  scannerPrimaryEventLabel,
  scannerSansFontStyle,
  volumeVsAvgMultiplier,
} from "./scannerCard.utils";

function mmDdYmd(ymd: string): string {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd;
  return `${m[2]}/${m[3]}`;
}

function IvBar({ ivr, dense }: { ivr: number | null; dense?: boolean }) {
  if (ivr == null || !Number.isFinite(ivr)) {
    return <span className="font-mono tabular-nums text-zinc-600">{dashCell()}</span>;
  }
  const pct = Math.min(100, Math.max(0, ivr));
  return (
    <div className="flex min-w-0 items-center justify-end gap-1">
      <div className={cn("h-1 shrink-0 overflow-hidden rounded-full bg-zinc-800", dense ? "w-10" : "w-14")}>
        <div className="h-full rounded-full bg-[#FFB800]" style={{ width: `${pct}%` }} />
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

/**
 * Expanded scanner card — pixel-aligned to UAI scanner mockup (black canvas, Inter labels, mono figures).
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

  const { label: headlineEventLabel, Icon: HeadlineIcon } = scannerPrimaryEventLabel(
    flow?.primaryEventType ?? null,
    flow?.eventsToday ?? 0,
  );
  const netDir = flow?.netDirection ?? "neutral";
  const eventsToday = flow?.eventsToday ?? 0;

  const dirIcon =
    netDir === "bullish" ? (
      <ArrowUpRight className="h-4 w-4 shrink-0 text-[#4ade80]" aria-hidden />
    ) : netDir === "bearish" ? (
      <ArrowDownRight className="h-4 w-4 shrink-0 text-[#fb7185]" aria-hidden />
    ) : netDir === "mixed" ? (
      <span className="inline-block w-4 text-center text-lg leading-none text-[#FFB800]" aria-hidden>
        –
      </span>
    ) : (
      <Minus className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
    );

  const dirLabelCls =
    netDir === "bullish"
      ? "text-[#4ade80]"
      : netDir === "bearish"
        ? "text-[#fb7185]"
        : netDir === "mixed"
          ? "text-[#FFB800]"
          : "text-zinc-500";

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
  const earnChip =
    earn != null && Number.isFinite(earn.daysTo) ? `${Math.round(earn.daysTo)}d` : dashCell();
  const topStrikeChip = flow?.topStrikeLabel?.trim() ? flow.topStrikeLabel : dashCell();

  const todayLine = useMemo(() => {
    if (!summary) return null;
    const totalAll = summary.callNotional + summary.putNotional;
    const ratio = formatCpNotionalRatio(summary.callNotional, summary.putNotional);
    return `Today: ${summary.totalEvents} events · ${formatNotionalTickerUi(totalAll)} notional · C:P ${ratio}`;
  }, [summary]);

  const strikeLine = (
    s: { strike: number; callPut: "C" | "P"; expiration: string; notional: number },
    bull: boolean,
    i: number,
  ) => {
    const mm = s.expiration.length >= 10 ? mmDdYmd(s.expiration.slice(0, 10)) : mmDdYmd(s.expiration);
    const strikeStr = Number.isInteger(s.strike) ? String(s.strike) : s.strike.toFixed(2).replace(/\.?0+$/, "");
    const left = `$${strikeStr}${s.callPut} ${mm}`;
    const val = formatNotionalTickerUi(s.notional);
    return (
      <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold text-white" style={scannerNumericFontStyle}>
          {left}
        </span>
        <span className={cn("font-semibold", bull ? "text-[#4ade80]" : "text-[#fb7185]")} style={scannerNumericFontStyle}>
          {val}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-0 border-t border-zinc-900 bg-black px-2 pb-2 pt-2 text-white">
      {/* Headline strip */}
      <div
        className="flex flex-wrap items-center gap-2 border-b border-zinc-900 pb-2 text-[11px] font-semibold uppercase tracking-wide"
        style={scannerSansFontStyle}
      >
        <HeadlineIcon className="h-4 w-4 shrink-0 text-[#FFB800]" aria-hidden />
        <span className="text-white">{headlineEventLabel}</span>
        <span className="text-zinc-700">·</span>
        <span className="inline-flex items-center gap-1 normal-case">
          {dirIcon}
          <span className={cn("text-[12px] font-semibold tracking-tight", dirLabelCls)}>{dirText}</span>
        </span>
        <span className="ml-auto font-mono text-[11px] font-bold normal-case text-zinc-400" style={scannerNumericFontStyle}>
          {eventsToday} events
        </span>
      </div>

      {/* Event timeline */}
      <div className="border-b border-zinc-900 py-2">
        <h3
          className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500"
          style={scannerSansFontStyle}
        >
          Event timeline
        </h3>
        <ScannerCardEventTimeline eventsState={eventsState} />
      </div>

      {/* Directional bias */}
      <div className="border-b border-zinc-900 py-2">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500" style={scannerSansFontStyle}>
            Directional bias
          </h3>
          {summary?.netDeltaDollar != null && Number.isFinite(summary.netDeltaDollar) ? (
            <span
              className={cn(
                "text-xs font-semibold",
                summary.netDeltaDollar >= 0 ? "text-[#4ade80]" : "text-[#fb7185]",
              )}
              style={scannerNumericFontStyle}
            >
              Net {formatSignedMoney(summary.netDeltaDollar)}
            </span>
          ) : (
            <span className="text-xs text-zinc-600" style={scannerNumericFontStyle}>
              {dashCell()}
            </span>
          )}
        </div>
        {eventsState.error ? (
          <p className="text-[11px] text-[#fb7185]">{eventsState.error}</p>
        ) : eventsState.loading || !bias ? (
          <div className="h-20 animate-pulse rounded bg-zinc-950" />
        ) : (
          <>
            <div className="flex h-2.5 overflow-hidden rounded-sm bg-zinc-900">
              <div
                className="h-full bg-[#4ade80]"
                style={{ width: `${Math.min(100, Math.max(0, bias.bullPct))}%` }}
              />
              <div
                className="h-full bg-[#fb7185]"
                style={{ width: `${Math.min(100, Math.max(0, bias.bearPct))}%` }}
              />
            </div>
            <div
              className="mt-1.5 flex justify-between text-[10px] font-medium"
              style={scannerNumericFontStyle}
            >
              <span className="text-[#4ade80]">
                <span className="mr-0.5">●</span>
                {bias.bullPct}% bullish · {formatNotionalTickerUi(bias.bull)}
              </span>
              <span className="text-[#fb7185]">
                {formatNotionalTickerUi(bias.bear)} · {bias.bearPct}% bearish<span className="ml-0.5">●</span>
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500" style={scannerSansFontStyle}>
                  Top bullish
                </div>
                <div className="mt-1.5 space-y-1">
                  {(summary?.topBullishStrikes ?? []).length === 0 ? (
                    <div className="text-zinc-600" style={scannerNumericFontStyle}>
                      {dashCell()}
                    </div>
                  ) : (
                    (summary?.topBullishStrikes ?? []).map((s, i) => strikeLine(s, true, i))
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500" style={scannerSansFontStyle}>
                  Top bearish
                </div>
                <div className="mt-1.5 space-y-1">
                  {(summary?.topBearishStrikes ?? []).length === 0 ? (
                    <div className="text-zinc-600" style={scannerNumericFontStyle}>
                      {dashCell()}
                    </div>
                  ) : (
                    (summary?.topBearishStrikes ?? []).map((s, i) => strikeLine(s, false, i))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 4-up chips */}
      <div className="grid grid-cols-2 gap-2 border-b border-zinc-900 py-2 sm:grid-cols-4">
        {[
          { k: "IVR", v: ivrChip },
          { k: "Earnings", v: earnChip },
          { k: "Vol", v: volMult === dashCell() ? dashCell() : `${String(volMult).replace(/\u00d7/g, "x").replace(/×/g, "x")}` },
          { k: "Top", v: topStrikeChip },
        ].map((c) => (
          <div key={c.k} className="rounded-md border border-zinc-800 bg-black px-2 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-500" style={scannerSansFontStyle}>
              {c.k}
            </div>
            <div
              className="mt-1 truncate text-sm font-semibold text-white"
              style={scannerNumericFontStyle}
              title={String(c.v)}
            >
              {c.v}
            </div>
          </div>
        ))}
      </div>

      {todayLine ? (
        <div
          className="border-b border-zinc-900 py-2 font-mono text-[10px] text-zinc-500"
          style={scannerNumericFontStyle}
        >
          {todayLine}
        </div>
      ) : null}

      {/* Reference */}
      <div className="border-b border-zinc-900">
        <button
          type="button"
          onClick={() => setReferenceOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-2 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
          style={scannerSansFontStyle}
        >
          <span>Reference data</span>
          {referenceOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        {referenceOpen ? (
          <div className="grid gap-2 border-t border-zinc-900 pb-2 pt-2 sm:grid-cols-2">
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

      <div className="pt-2" style={scannerNumericFontStyle}>
        <ScannerCardActions symbol={data.symbol} onAction={onAction} />
      </div>
    </div>
  );
}
