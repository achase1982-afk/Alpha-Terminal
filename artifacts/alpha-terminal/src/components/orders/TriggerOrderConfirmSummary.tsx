import { memo } from "react";
import { BORDER, DIM, MONO, WHITE, GRAY, UP, DOWN, FW_LIGHT, FW_NORMAL } from "@/components/options/optionsTheme";
import type { TriggerConfirmSummary } from "@/lib/orders/triggerOrderConfirmSummary";

const S = {
  label: 10,
  body: 11,
  heading: 12,
} as const;

interface TriggerOrderConfirmSummaryProps {
  summary: TriggerConfirmSummary;
  className?: string;
}

export const TriggerOrderConfirmSummary = memo(function TriggerOrderConfirmSummary({
  summary,
  className,
}: TriggerOrderConfirmSummaryProps) {
  return (
    <div
      className={className}
      style={{
        fontFamily: MONO,
        borderTop: `1px dashed ${BORDER}`,
        paddingTop: 8,
        marginTop: 8,
      }}
      data-at-trigger-confirm
    >
      <p style={{ fontSize: S.label, color: DIM, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
        Trigger order summary (est.)
      </p>
      <div className="space-y-3">
        {summary.orders.map((block) => (
          <div key={block.orderNumber} className="space-y-1">
            <p style={{ fontSize: S.heading, color: WHITE, fontWeight: FW_NORMAL }}>{block.header}</p>
            <p style={{ fontSize: S.body, color: GRAY, fontWeight: FW_LIGHT, lineHeight: 1.4 }}>
              {block.instructionLine}
            </p>
            <p style={{ fontSize: S.label, color: DIM, lineHeight: 1.45 }}>
              {block.costLine}
            </p>
          </div>
        ))}
      </div>
      {summary.netIfAllFillLine && (
        <p style={{ fontSize: S.body, color: UP, marginTop: 10, fontWeight: FW_NORMAL }}>{summary.netIfAllFillLine}</p>
      )}
      {summary.ocoOutcomeLines?.map((row) => (
        <p key={row.label} style={{ fontSize: S.body, color: row.label.includes("SL") ? DOWN : UP, marginTop: 6 }}>
          {row.line}
        </p>
      ))}
      {summary.breakevenLines.map((line) => (
        <p key={line} style={{ fontSize: S.label, color: DIM, marginTop: 6 }}>
          {line}
        </p>
      ))}
    </div>
  );
});