import { memo } from "react";
import { BG_EXP_BAR, BORDER, WHITE } from "@/components/options/optionsTheme";
import { AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import type { DeskFlowAggregate } from "@/lib/active-trader/deskFlowAggregator";
import { formatGlanceMoneyRow } from "@/lib/active-trader/deskFlowGlanceCopy";
import { buildDeskGrossFlowGlance } from "@/lib/active-trader/deskFlowGlanceGross";
import { fmtGlanceMoneyUsd } from "@/lib/active-trader/deskFlowMoneyFormat";

export type AtGlanceFlowDetailProps = {
  open: boolean;
  onClose: () => void;
  agg: DeskFlowAggregate;
  gexLabel?: string | null;
  sessionClosed?: boolean;
};

export const AtGlanceFlowDetail = memo(function AtGlanceFlowDetail({
  open,
  onClose,
  agg,
  gexLabel,
  sessionClosed,
}: AtGlanceFlowDetailProps) {
  if (!open) return null;

  const copy = formatGlanceMoneyRow(agg);
  const gross1m = buildDeskGrossFlowGlance(agg, "1m", { sessionClosed });

  return (
    <div
      data-at-flow-detail
      className="fixed inset-0 z-[120] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md px-3 py-3"
        style={{ background: BG_EXP_BAR, borderTop: `1px solid ${BORDER}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <FlowDetailHeader onClose={onClose} />
        {gexLabel ? (
          <p className="num" style={{ fontSize: 11, color: WHITE, marginBottom: 8 }}>
            GEX {gexLabel}
          </p>
        ) : null}
        <p style={{ fontSize: 10, color: AT_LABEL, marginBottom: 6 }}>Net premium (header shows gross)</p>
        <p className="num whitespace-pre-line" style={{ fontSize: 10, color: AT_SECONDARY, lineHeight: 1.35 }}>
          {copy.line1m ?? "—"}
        </p>
        {gross1m.calls && gross1m.puts ? (
          <p className="num" style={{ fontSize: 10, color: WHITE, marginTop: 10 }}>
            Calls net {fmtGlanceMoneyUsd(gross1m.netCalls)} · Puts net {fmtGlanceMoneyUsd(gross1m.netPuts)}
          </p>
        ) : null}
      </div>
    </div>
  );
});

function FlowDetailHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span style={{ fontSize: 11, fontWeight: 600, color: WHITE }}>Flow detail</span>
      <button type="button" onClick={onClose} style={{ fontSize: 10, color: AT_SECONDARY, background: "transparent", border: "none" }}>
        Close
      </button>
    </div>
  );
}