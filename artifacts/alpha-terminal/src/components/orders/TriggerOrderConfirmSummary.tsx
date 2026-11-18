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
  /** Shown when bracket uses an OCO exit pair. */
  ocoPairNote?: string;
  exitDurationLabel?: string;
}

export const TriggerOrderConfirmSummary = memo(function TriggerOrderConfirmSummary({
  summary,
  className,
  ocoPairNote,
  exitDurationLabel,
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
      data-testid="at-trigger-confirm"
    >
      <p style={{ fontSize: S.label, color: DIM, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>
        Trigger order summary (est.)
      </p>
      <div className="space-y-3">
        {summary.orders.map((block) => (
          <div
            key={block.orderNumber}
            className="space-y-1"
            data-testid="at-trigger-confirm-row"
            data-position-effect={block.positionEffect.replace(/^\[|\]$/g, "")}
            data-order-kind={block.isTriggerParent ? "TRIGGER" : block.orderKind}
            data-order-parent={block.isTriggerParent ? "true" : "false"}
          >
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
      {ocoPairNote && (
        <p style={{ fontSize: S.body, color: GRAY, marginTop: 8, fontWeight: FW_LIGHT }}>{ocoPairNote}</p>
      )}
      {exitDurationLabel && (
        <p style={{ fontSize: S.label, color: DIM, marginTop: 4 }}>Exit duration {exitDurationLabel}</p>
      )}
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