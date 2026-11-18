import { memo } from "react";
import { BG_EXP_BAR, BORDER, WHITE } from "@/components/options/optionsTheme";
import { AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import type { DeskFlowAggregate } from "@/lib/active-trader/deskFlowAggregator";
import type { DeskNetPremiumGlance } from "@/lib/active-trader/deskFlowNetPremium";
import { formatGlanceMoneyRow } from "@/lib/active-trader/deskFlowGlanceCopy";
import { fmtGlanceFlowAmount, fmtGlanceMoneyMagnitude } from "@/lib/active-trader/deskFlowMoneyFormat";
import { MONO } from "@/components/options/optionsTheme";

export type AtGlanceFlowDetailProps = {
  open: boolean;
  onClose: () => void;
  netGlance: DeskNetPremiumGlance;
  flowAgg: DeskFlowAggregate;
  gexLabel: string | null;
};

export const AtGlanceFlowDetail = memo(function AtGlanceFlowDetail({
  open,
  onClose,
  netGlance,
  flowAgg,
  gexLabel,
}: AtGlanceFlowDetailProps) {
  if (!open) return null;
  const gross = formatGlanceMoneyRow(flowAgg);

  return (
    <div
      data-at-glance-flow-detail
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[80] flex items-end justify-center"
      style={{ fontFamily: MONO }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-t-lg border"
        style={{ background: BG_EXP_BAR, borderColor: BORDER, maxHeight: "42vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: BORDER }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: WHITE }}>Flow & levels detail</span>
          <button type="button" onClick={onClose} style={{ fontSize: 10, color: AT_SECONDARY }}>
            Close
          </button>
        </div>
        <div className="px-3 py-2 space-y-2 overflow-y-auto" style={{ fontSize: 10, color: WHITE, lineHeight: 1.35 }}>
          {gexLabel ? (
            <div>
              <div style={{ fontSize: 9, color: AT_LABEL, marginBottom: 2 }}>Raw GEX (per 1% move)</div>
              <div data-at-detail-gex>{gexLabel}</div>
            </div>
          ) : null}
          <div>
            <div style={{ fontSize: 9, color: AT_LABEL, marginBottom: 2 }}>
              Gross flow · window {netGlance.windowLabel}
            </div>
            {netGlance.streamKind === "spx_options" ? (
              <ul className="list-none space-y-0.5" data-at-detail-gross>
                <li>
                  Calls bought {fmtGlanceMoneyMagnitude(netGlance.grossCallsBuy)} · sold{" "}
                  {fmtGlanceFlowAmount(netGlance.grossCallsSell)}
                </li>
                <li>
                  Puts bought {fmtGlanceMoneyMagnitude(netGlance.grossPutsBuy)} · sold{" "}
                  {fmtGlanceFlowAmount(netGlance.grossPutsSell)}
                </li>
              </ul>
            ) : (
              <ul className="list-none space-y-0.5" data-at-detail-gross>
                <li>
                  Lift {fmtGlanceMoneyMagnitude(netGlance.grossTapeBuy)} · Hit{" "}
                  {fmtGlanceFlowAmount(netGlance.grossTapeSell)}
                </li>
              </ul>
            )}
          </div>
          {!gross.unsupported && !gross.noPrints && gross.line1m ? (
            <div>
              <div style={{ fontSize: 9, color: AT_LABEL, marginBottom: 2 }}>Aggregated tape (1m / 5m / hr)</div>
              <pre
                data-at-detail-agg
                style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 10, color: AT_SECONDARY, fontFamily: MONO }}
              >
                {[gross.line1m, gross.line5m, gross.lineHr].filter(Boolean).join("\n\n")}
              </pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});