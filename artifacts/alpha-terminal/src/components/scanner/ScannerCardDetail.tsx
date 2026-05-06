import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { ScannerCardIdentity } from "./ScannerCardIdentity";
import { ScannerCardScore } from "./ScannerCardScore";
import { ScannerCardPanel, ScannerCardPanelRow } from "./ScannerCardPanel";
import { ScannerCardActions } from "./ScannerCardActions";
import type { ScannerCardAction } from "./scannerCard.types";
import {
  dashCell,
  formatCompactInt,
  formatIvPct,
  formatRatio,
  formatSignedMoney,
  formatSignedPct,
  scannerNumericFontStyle,
} from "./scannerCard.utils";
import { cn } from "@/lib/utils";

function IvBar({ ivr, dense }: { ivr: number | null; dense?: boolean }) {
  if (ivr == null || !Number.isFinite(ivr)) {
    return <span className="font-mono tabular-nums text-zinc-600">{dashCell()}</span>;
  }
  const pct = Math.min(100, Math.max(0, ivr));
  return (
    <div className="flex items-center gap-1 min-w-0 justify-end">
      <div className={cn("h-1 rounded-full bg-zinc-800 overflow-hidden shrink-0", dense ? "w-10" : "w-14")}>
        <div className="h-full bg-amber-500/90 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono tabular-nums text-zinc-200 w-7 text-right">{Math.round(ivr)}</span>
    </div>
  );
}

function termLabel(shape: NonNullable<ScannerCardData["termStructure"]>["shape"]): string {
  if (shape === "contango") return "Contango";
  if (shape === "backwardation") return "Backwardation";
  return "Flat";
}

function MaVs({ above }: { above: boolean | null }) {
  if (above == null) return <span className="font-mono tabular-nums text-zinc-600">{dashCell()}</span>;
  return above ? (
    <span className="font-mono text-terminal-success">Above</span>
  ) : (
    <span className="font-mono text-terminal-danger">Below</span>
  );
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
    <div className="border-t border-zinc-800/80 bg-[#080808]/95 px-2 pb-1.5 pt-1 space-y-1">
      <ScannerCardIdentity data={data} />
      <ScannerCardScore data={data} />

      {/* V3: fixed 2×2 — Vol Context | Catalysts / Flow 4h | Technical */}
      <div className="grid grid-cols-2 grid-rows-2 gap-1 min-h-0 auto-rows-fr">
        <ScannerCardPanel title="Vol Context" dense>
          <ScannerCardPanelRow dense label="IV30" value={formatIvPct(data.iv30)} />
          <ScannerCardPanelRow
            dense
            label="IVR"
            value={<IvBar ivr={data.ivr} dense />}
          />
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
            value={
              ts
                ? `${termLabel(ts.shape)} (${formatRatio(ts.ratio)})`
                : dashCell()
            }
          />
        </ScannerCardPanel>

        <ScannerCardPanel title="Catalysts" dense>
          <ScannerCardPanelRow
            dense
            label="Earnings"
            value={
              earn
                ? `${earn.date} · ${earn.daysTo}d${earn.timing ? ` · ${earn.timing}` : ""}`
                : dashCell()
            }
          />
          <ScannerCardPanelRow
            dense
            label="Ex-Dividend"
            value={
              ex
                ? `${ex.date} · ${ex.daysTo}d${
                    ex.amount != null && Number.isFinite(ex.amount)
                      ? ` · $${ex.amount.toFixed(2)}`
                      : ""
                  }`
                : dashCell()
            }
          />
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
                    {Number.isFinite(h.absMovePct) ? `${h.absMovePct >= 0 ? "+" : ""}${h.absMovePct.toFixed(1)}%` : dashCell()}
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
              flow?.netDeltaNotional != null && Number.isFinite(flow.netDeltaNotional)
                ? formatSignedMoney(flow.netDeltaNotional)
                : dashCell()
            }
          />
          <ScannerCardPanelRow
            dense
            label="Top Strike"
            value={
              flow?.topStrike
                ? `${flow.topStrike.strike} @ ${flow.topStrike.expiration}`
                : dashCell()
            }
          />
          <ScannerCardPanelRow
            dense
            label="Volume"
            value={flow?.topStrike?.volume != null ? formatCompactInt(flow.topStrike.volume) : dashCell()}
          />
          <ScannerCardPanelRow
            dense
            label="Volume / OI"
            value={
              flow?.topStrike &&
              flow.topStrike.oi > 0 &&
              Number.isFinite(flow.topStrike.volume)
                ? formatRatio(flow.topStrike.volume / flow.topStrike.oi)
                : dashCell()
            }
          />
        </ScannerCardPanel>

        <ScannerCardPanel title="Technical" dense>
          <ScannerCardPanelRow
            dense
            label="52w Range"
            value={
              tech && Number.isFinite(tech.week52Low) && Number.isFinite(tech.week52High)
                ? `${tech.week52Low.toFixed(1)}–${tech.week52High.toFixed(1)}`
                : dashCell()
            }
          />
          <ScannerCardPanelRow
            dense
            label="Off 52w High"
            value={tech != null && Number.isFinite(tech.pctOffHigh) ? formatSignedPct(tech.pctOffHigh) : dashCell()}
          />
          <ScannerCardPanelRow dense label="vs 20MA" value={<MaVs above={tech?.aboveMa20 ?? null} />} />
          <ScannerCardPanelRow dense label="vs 50MA" value={<MaVs above={tech?.aboveMa50 ?? null} />} />
          <ScannerCardPanelRow dense label="vs 200MA" value={<MaVs above={tech?.aboveMa200 ?? null} />} />
          <ScannerCardPanelRow
            dense
            label="5d Return"
            value={tech != null && Number.isFinite(tech.return5d) ? formatSignedPct(tech.return5d) : dashCell()}
          />
          <ScannerCardPanelRow
            dense
            label="30d Return"
            value={tech != null && Number.isFinite(tech.return30d) ? formatSignedPct(tech.return30d) : dashCell()}
          />
        </ScannerCardPanel>
      </div>

      <div style={scannerNumericFontStyle}>
        <ScannerCardActions symbol={data.symbol} onAction={onAction} />
      </div>
    </div>
  );
}
