import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import { ScannerCardIdentity } from "./ScannerCardIdentity";
import { ScannerCardScore } from "./ScannerCardScore";
import { ScannerCardPanel, ScannerCardPanelRow } from "./ScannerCardPanel";
import { ScannerCardActions } from "./ScannerCardActions";
import type { ScannerCardAction } from "./scannerCard.types";
import {
  dashCell,
  formatCompactInt,
  formatDollarRange,
  formatIvPct,
  formatRatio,
  formatSignedMoney,
  formatSignedPct,
  formatShortMonthDay,
  scannerNumericFontStyle,
} from "./scannerCard.utils";

function catalystEarningsCell(earn: NonNullable<ScannerCardData["nextEarnings"]>): string {
  const datePart = formatShortMonthDay(earn.date);
  const head = earn.timing ? `${datePart} ${earn.timing}` : datePart;
  if (earn.daysTo <= 30) {
    return `${head} · ${earn.daysTo}d`;
  }
  return head;
}

function catalystExDivCell(ex: NonNullable<ScannerCardData["nextExDiv"]>): string {
  const amt =
    ex.amount != null && Number.isFinite(ex.amount) ? `$${ex.amount.toFixed(2)}` : dashCell();
  return `${formatShortMonthDay(ex.date)} · ${amt}`;
}

function IvBar({ ivr, dense }: { ivr: number | null; dense?: boolean }) {
  if (ivr == null || !Number.isFinite(ivr)) {
    return <span className="font-mono tabular-nums text-zinc-600">{dashCell()}</span>;
  }
  const pct = Math.min(100, Math.max(0, ivr));
  return (
    <div className="flex items-center gap-1 min-w-0 justify-end">
      <div className={cn("h-1 shrink-0 overflow-hidden rounded-full bg-zinc-800", dense ? "w-10" : "w-14")}>
        <div className="h-full bg-amber-500/90 rounded-full" style={{ width: `${pct}%` }} />
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

/**
 * V3 expanded layout: identity line → score block (composite + 5-column row + preset) → 2×2 panel grid → actions.
 */
export function ScannerCardDetail({
  data,
  onAction,
}: {
  data: ScannerCardData;
  onAction: (action: ScannerCardAction) => void;
}) {
  const ts = data.termStructure;
  const earn = data.nextEarnings;
  const ex = data.nextExDiv;
  const flow = data.flow;
  const tech = data.technical;

  return (
    <div className="space-y-1 border-t border-zinc-800/80 bg-[#080808]/95 px-2 pb-1.5 pt-1">
      <ScannerCardIdentity data={data} />
      <ScannerCardScore data={data} />

      {/* V3: fixed 2×2 — Vol Context | Catalysts / Flow 4h | Technical */}
      <div className="grid min-h-0 auto-rows-fr grid-cols-2 grid-rows-2 gap-1">
        <ScannerCardPanel title="Vol Context" dense>
          <ScannerCardPanelRow dense label="IV30" value={formatIvPct(data.iv30)} />
          <ScannerCardPanelRow dense label="IVR" value={<IvBar ivr={data.ivr} dense />} />
          <ScannerCardPanelRow
            dense
            label="IV Percentile"
            value={data.ivPercentile != null && Number.isFinite(data.ivPercentile) ? `${Math.round(data.ivPercentile)}` : dashCell()}
          />
          <ScannerCardPanelRow dense label="HV30" value={formatIvPct(data.hv30)} />
          <ScannerCardPanelRow
            dense
            label="IV vs HV"
            value={
              data.ivVsHv != null && Number.isFinite(data.ivVsHv)
                ? formatRatio(data.ivVsHv)
                : data.iv30 != null && data.hv30 != null && Number.isFinite(data.iv30) && Number.isFinite(data.hv30) && data.hv30 !== 0
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

        <ScannerCardPanel title="Catalysts" dense>
          <ScannerCardPanelRow dense label="Earnings" value={earn ? catalystEarningsCell(earn) : dashCell()} />
          <ScannerCardPanelRow dense label="Ex-Dividend" value={ex ? catalystExDivCell(ex) : dashCell()} />
          <div className="pt-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Reactions Last 4Q
          </div>
          {data.earningsHistory && data.earningsHistory.length > 0 ? (
            <ul className="space-y-0">
              {data.earningsHistory.slice(0, 4).map((h, i) => (
                <li key={`${h.quarter}-${i}`} className="flex justify-between gap-1 font-mono tabular-nums">
                  <span className="truncate text-zinc-500">{h.quarter}</span>
                  <span
                    className={cn(
                      "shrink-0",
                      !Number.isFinite(h.absMovePct)
                        ? "text-zinc-600"
                        : h.absMovePct > 0
                          ? "text-terminal-success"
                          : h.absMovePct < 0
                            ? "text-terminal-danger"
                            : "text-zinc-200",
                    )}
                  >
                    {Number.isFinite(h.absMovePct) ? formatSignedPct(h.absMovePct) : dashCell()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-right font-mono tabular-nums text-zinc-600">{dashCell()}</div>
          )}
        </ScannerCardPanel>

        <ScannerCardPanel title="Flow 4h" dense>
          <ScannerCardPanelRow
            dense
            label="Blocks"
            value={flow?.blocks4h != null && Number.isFinite(flow.blocks4h) ? String(flow.blocks4h) : dashCell()}
          />
          <ScannerCardPanelRow
            dense
            label="Sweeps"
            value={flow?.sweeps4h != null && Number.isFinite(flow.sweeps4h) ? String(flow.sweeps4h) : dashCell()}
          />
          <ScannerCardPanelRow
            dense
            label="Net Delta $"
            value={
              flow?.netDeltaDollar != null && Number.isFinite(flow.netDeltaDollar)
                ? formatSignedMoney(flow.netDeltaDollar)
                : dashCell()
            }
          />
          <ScannerCardPanelRow
            dense
            label="Top Strike"
            value={
              flow?.topStrikeLabel
                ? flow.topStrikeLabel
                : flow?.topStrike
                  ? `$${flow.topStrike.strike}${flow.topStrike.optionType === "put" ? "P" : "C"}`
                  : dashCell()
            }
          />
          <ScannerCardPanelRow
            dense
            label="Volume"
            value={flow?.volume4h != null && Number.isFinite(flow.volume4h) ? formatCompactInt(flow.volume4h) : dashCell()}
          />
          <ScannerCardPanelRow
            dense
            label="Volume / OI"
            value={
              flow?.volumeOverOi != null && Number.isFinite(flow.volumeOverOi)
                ? formatRatio(flow.volumeOverOi)
                : dashCell()
            }
          />
        </ScannerCardPanel>

        <ScannerCardPanel title="Technical" dense>
          <ScannerCardPanelRow
            dense
            label="52w Range"
            value={
              tech != null ? formatDollarRange(tech.fiftyTwoWeekLow, tech.fiftyTwoWeekHigh) : dashCell()
            }
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

      <div style={scannerNumericFontStyle}>
        <ScannerCardActions symbol={data.symbol} onAction={onAction} />
      </div>
    </div>
  );
}
