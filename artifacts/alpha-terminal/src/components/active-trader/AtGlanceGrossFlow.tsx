import { memo, useMemo, useState } from "react";
import { DOWN_TEXT, UP, WHITE, BORDER, GOLD, PUT_WALL } from "@/components/options/optionsTheme";
import { AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import type { DeskFlowAggregate } from "@/lib/active-trader/deskFlowAggregator";
import {
  buildDeskGrossFlowGlance,
  grossBarFill,
  type FlowWindow,
} from "@/lib/active-trader/deskFlowGlanceGross";
import { formatStrikeLevel } from "@/lib/active-trader/atExpiryPill";

const FLOW_WINDOWS: FlowWindow[] = ["1m", "5m", "hr"];
const TRACK_H = 13;

function GrossFlowTrack({
  label,
  side,
  buyLabel,
  sellLabel,
  buyUsd,
  sellUsd,
  sharedScale,
  wallLabel,
  wallValue,
  wallColor,
}: {
  label: string;
  side: "calls" | "puts";
  buyLabel: string;
  sellLabel: string;
  buyUsd: number;
  sellUsd: number;
  sharedScale: number;
  wallLabel: string;
  wallValue: number | null | undefined;
  wallColor: string;
}) {
  const sellFill = grossBarFill(sellUsd, sharedScale);
  const buyFill = grossBarFill(buyUsd, sharedScale);

  return (
    <div data-at-gross-flow-row={side} className="flex items-center gap-0.5 min-w-0" style={{ height: TRACK_H }}>
      <span
        className="num shrink-0 truncate"
        style={{ width: 28, fontSize: 8, fontWeight: 600, color: AT_LABEL, letterSpacing: "0.04em" }}
      >
        {label}
      </span>
      <span className="num shrink-0 truncate" style={{ fontSize: 7, fontWeight: 600, color: DOWN_TEXT, width: 54 }}>
        {sellLabel}
      </span>
      <div
        className="relative flex-1 min-w-0 rounded-sm overflow-hidden"
        style={{ height: 8, background: "rgba(255,255,255,0.06)" }}
        aria-hidden
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: "50%",
            width: `${sellFill * 100}%`,
            background: DOWN_TEXT,
            opacity: 0.85,
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "50%",
            width: `${buyFill * 100}%`,
            background: UP,
            opacity: 0.85,
          }}
        />
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.28)" }} />
      </div>
      <span className="num shrink-0 truncate" style={{ fontSize: 7, fontWeight: 600, color: UP, width: 58, textAlign: "right" }}>
        {buyLabel}
      </span>
      <div
        aria-hidden
        style={{ width: 1, alignSelf: "stretch", background: BORDER, marginLeft: 2, marginRight: 2, opacity: 0.9 }}
      />
      <div className="num shrink-0 flex flex-col items-end" data-at-flow-wall={side} style={{ width: 44, lineHeight: 1 }}>
        <span style={{ fontSize: 7, fontWeight: 500, color: AT_LABEL }}>{wallLabel}</span>
        <span style={{ fontSize: 8, fontWeight: 600, color: wallColor }}>
          {wallValue != null ? formatStrikeLevel(wallValue) : "—"}
        </span>
      </div>
    </div>
  );
}

export type AtGlanceGrossFlowProps = {
  agg: DeskFlowAggregate;
  sessionClosed?: boolean;
  callWall?: number | null;
  putWall?: number | null;
  onOpenDetail?: () => void;
};

export const AtGlanceGrossFlow = memo(function AtGlanceGrossFlow({
  agg,
  sessionClosed,
  callWall,
  putWall,
  onOpenDetail,
}: AtGlanceGrossFlowProps) {
  const [flowWindow, setFlowWindow] = useState<FlowWindow>("1m");
  const glance = useMemo(
    () => buildDeskGrossFlowGlance(agg, flowWindow, { sessionClosed }),
    [agg, flowWindow, sessionClosed],
  );

  if (glance.unsupported) {
    return (
      <div data-at-glance-flow="unsupported" style={{ fontSize: 10, color: AT_SECONDARY, lineHeight: 1.15 }}>
        Flow not available
      </div>
    );
  }
  if (glance.closed) {
    return (
      <div data-at-glance-flow="closed" className="flex items-center gap-1" style={{ fontSize: 10, color: AT_SECONDARY }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: AT_LABEL }}>Closed</span>
      </div>
    );
  }
  if (glance.noPrints) {
    return (
      <div data-at-glance-flow="no-prints" className="flex items-center gap-1" style={{ fontSize: 10, color: AT_SECONDARY }}>
        <span style={{ color: WHITE }}>—</span>
        <span style={{ fontSize: 10, color: AT_LABEL }}>no prints</span>
      </div>
    );
  }
  if (glance.stale) {
    return (
      <div data-at-glance-flow="stale" className="flex items-center gap-1" style={{ fontSize: 10, color: AT_SECONDARY }}>
        <span style={{ color: WHITE }}>—</span>
        <span>stale</span>
      </div>
    );
  }

  if (!glance.calls || !glance.puts) return null;

  return (
    <div
      data-at-glance-flow="live"
      data-at-glance-flow-window={flowWindow}
      className="flex flex-col gap-0.5 min-w-0"
      style={{ lineHeight: 1, overflow: "hidden", maxHeight: TRACK_H * 2 + 10 }}
    >
      <div className="flex items-start gap-1">
        <div className="flex flex-1 flex-col gap-0.5 min-w-0">
          <GrossFlowTrack
            label="CALL"
            side="calls"
            {...glance.calls}
            sharedScale={glance.sharedScale}
            wallLabel="Call wall"
            wallValue={callWall}
            wallColor={GOLD}
          />
          <GrossFlowTrack
            label="PUT"
            side="puts"
            {...glance.puts}
            sharedScale={glance.sharedScale}
            wallLabel="Put wall"
            wallValue={putWall}
            wallColor={PUT_WALL}
          />
        </div>
        <div className="num flex shrink-0 flex-col items-end gap-0.5" data-at-glance-flow-seg style={{ fontSize: 9 }}>
          {FLOW_WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              data-at-glance-flow-seg={w}
              onClick={() => setFlowWindow(w)}
              style={{
                fontSize: 9,
                fontWeight: flowWindow === w ? 600 : 500,
                color: flowWindow === w ? WHITE : AT_SECONDARY,
                padding: "1px 3px",
                minWidth: 24,
                background: "transparent",
                border: "none",
              }}
            >
              {w}
            </button>
          ))}
          {onOpenDetail ? (
            <button
              type="button"
              data-at-glance-flow-detail
              onClick={onOpenDetail}
              style={{ fontSize: 8, color: AT_LABEL, background: "transparent", border: "none", padding: 0 }}
            >
              Details
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
});