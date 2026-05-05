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

function IvBar({ ivr }: { ivr: number | null }) {
  if (ivr == null || !Number.isFinite(ivr)) {
    return <span className="text-zinc-600 tabular-nums">{dashCell()}</span>;
  }
  const pct = Math.min(100, Math.max(0, ivr));
  return (
    <div className="flex items-center gap-1.5 min-w-0 justify-end">
      <div className="w-14 h-1 rounded-full bg-zinc-800 overflow-hidden shrink-0">
        <div className="h-full bg-amber-500/90 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-zinc-200 w-8 text-right">{Math.round(ivr)}</span>
    </div>
  );
}

function termLabel(shape: NonNullable<ScannerCardData["termStructure"]>["shape"]): string {
  if (shape === "contango") return "Contango";
  if (shape === "backwardation") return "Backwardation";
  return "Flat";
}

function MaVs({ above }: { above: boolean | null }) {
  if (above == null) return dashCell();
  return above ? <span className="text-terminal-success">Above</span> : <span className="text-terminal-danger">Below</span>;
}

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
    <div className="px-3 pb-3 pt-2 space-y-3 border-t border-zinc-800/80 bg-[#080808]/95">
      <ScannerCardIdentity data={data} />
      <ScannerCardScore data={data} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ScannerCardPanel title="Vol Context">
          <ScannerCardPanelRow label="IV30" value={formatIvPct(data.iv30)} />
          <ScannerCardPanelRow
            label="IVR"
            value={<IvBar ivr={data.ivr} />}
          />
          <ScannerCardPanelRow label="IV Percentile" value={data.ivPercentile != null && Number.isFinite(data.ivPercentile) ? `${Math.round(data.ivPercentile)}` : dashCell()} />
          <ScannerCardPanelRow label="HV30" value={formatIvPct(data.hv30)} />
          <ScannerCardPanelRow
            label="IV vs HV"
            value={
              data.iv30 != null && data.hv30 != null && Number.isFinite(data.iv30) && Number.isFinite(data.hv30) && data.hv30 !== 0
                ? formatRatio(data.iv30 / data.hv30)
                : dashCell()
            }
          />
          <ScannerCardPanelRow
            label="Term Structure"
            value={
              ts
                ? `${termLabel(ts.shape)} (${formatRatio(ts.ratio)})`
                : dashCell()
            }
          />
        </ScannerCardPanel>

        <ScannerCardPanel title="Catalysts">
          <ScannerCardPanelRow
            label="Earnings"
            value={
              earn
                ? `${earn.date} · ${earn.daysTo}d${earn.timing ? ` · ${earn.timing}` : ""}`
                : dashCell()
            }
          />
          <ScannerCardPanelRow
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
          <div className="text-zinc-500 text-[10px] uppercase tracking-wide pt-0.5">Reactions last 4q</div>
          {data.earningsHistory && data.earningsHistory.length > 0 ? (
            <ul className="space-y-0.5">
              {data.earningsHistory.slice(0, 4).map((h, i) => (
                <li key={`${h.quarter}-${i}`} className="flex justify-between gap-2 tabular-nums">
                  <span className="text-zinc-500 truncate">{h.quarter}</span>
                  <span
                    className={cn(
                      "shrink-0",
                      h.absMovePct > 0 ? "text-terminal-success" : h.absMovePct < 0 ? "text-terminal-danger" : "text-zinc-400",
                    )}
                  >
                    {Number.isFinite(h.absMovePct) ? `${h.absMovePct >= 0 ? "+" : ""}${h.absMovePct.toFixed(1)}%` : dashCell()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-right text-zinc-600 tabular-nums">{dashCell()}</div>
          )}
        </ScannerCardPanel>

        <ScannerCardPanel title="Flow 4h">
          <ScannerCardPanelRow
            label="Blocks"
            value={flow?.blocks4h != null && Number.isFinite(flow.blocks4h) ? String(flow.blocks4h) : dashCell()}
          />
          <ScannerCardPanelRow
            label="Sweeps"
            value={flow?.sweeps4h != null && Number.isFinite(flow.sweeps4h) ? String(flow.sweeps4h) : dashCell()}
          />
          <ScannerCardPanelRow
            label="Net Delta $"
            value={
              flow?.netDeltaNotional != null && Number.isFinite(flow.netDeltaNotional)
                ? formatSignedMoney(flow.netDeltaNotional)
                : dashCell()
            }
          />
          <ScannerCardPanelRow
            label="Top Strike"
            value={
              flow?.topStrike
                ? `${flow.topStrike.strike} @ ${flow.topStrike.expiration}`
                : dashCell()
            }
          />
          <ScannerCardPanelRow
            label="Volume"
            value={flow?.topStrike?.volume != null ? formatCompactInt(flow.topStrike.volume) : dashCell()}
          />
          <ScannerCardPanelRow
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

        <ScannerCardPanel title="Technical">
          <ScannerCardPanelRow
            label="52w Range"
            value={
              tech && Number.isFinite(tech.week52Low) && Number.isFinite(tech.week52High)
                ? `${tech.week52Low.toFixed(2)} – ${tech.week52High.toFixed(2)}`
                : dashCell()
            }
          />
          <ScannerCardPanelRow
            label="Off 52w High"
            value={tech != null && Number.isFinite(tech.pctOffHigh) ? formatSignedPct(tech.pctOffHigh) : dashCell()}
          />
          <ScannerCardPanelRow label="vs 20MA" value={<MaVs above={tech?.aboveMa20 ?? null} />} />
          <ScannerCardPanelRow label="vs 50MA" value={<MaVs above={tech?.aboveMa50 ?? null} />} />
          <ScannerCardPanelRow label="vs 200MA" value={<MaVs above={tech?.aboveMa200 ?? null} />} />
          <ScannerCardPanelRow
            label="5d Return"
            value={tech != null && Number.isFinite(tech.return5d) ? formatSignedPct(tech.return5d) : dashCell()}
          />
          <ScannerCardPanelRow
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
