import { memo, useRef } from "react";
import { DOWN_TEXT, GOLD, PUT_WALL, UP, WHITE } from "@/components/options/optionsTheme";
import { AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import type { DeskNetPremiumGlance } from "@/lib/active-trader/deskFlowNetPremium";
import { formatStrikeLevel } from "@/lib/active-trader/atExpiryPill";
import { fmtGlanceFlowAmount } from "@/lib/active-trader/deskFlowMoneyFormat";

const TRACK_H = 15;
const SCALE_FLOOR = 50_000;
const SCALE_DECAY = 0.94;

function fmtSoldBought(usd: number): string {
  const core = fmtGlanceFlowAmount(usd);
  return core.startsWith("$") ? core : `$${core}`;
}

function grossBarFill(amount: number, scale: number): number {
  if (!(scale > 0)) return 0;
  return Math.min(1, amount / scale);
}

function GrossFlowTrack({
  side,
  soldUsd,
  boughtUsd,
  sharedScale,
  wallLabel,
  wallValue,
  wallColor,
}: {
  side: "calls" | "puts";
  soldUsd: number;
  boughtUsd: number;
  sharedScale: number;
  wallLabel: string;
  wallValue: number | null | undefined;
  wallColor: string;
}) {
  const sellFill = grossBarFill(soldUsd, sharedScale);
  const buyFill = grossBarFill(boughtUsd, sharedScale);
  const sideTag = side === "calls" ? "CALL" : "PUT";

  return (
    <div data-at-gross-flow-row={side} className="flex items-center gap-0.5 min-w-0" style={{ height: TRACK_H }}>
      <span
        className="shrink-0"
        style={{ width: 30, fontSize: 7, fontWeight: 600, color: AT_LABEL, letterSpacing: "0.04em" }}
      >
        {sideTag}
      </span>
      <span className="num shrink-0 whitespace-nowrap" style={{ fontSize: 7, fontWeight: 600, color: DOWN_TEXT, minWidth: 52 }}>
        Sold {fmtSoldBought(soldUsd)}
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
            width: `${sellFill * 50}%`,
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
            width: `${buyFill * 50}%`,
            background: UP,
            opacity: 0.85,
          }}
        />
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.28)" }} />
      </div>
      <span className="num shrink-0 whitespace-nowrap" style={{ fontSize: 7, fontWeight: 600, color: UP, minWidth: 58, textAlign: "right" }}>
        Bought {fmtSoldBought(boughtUsd)}
      </span>
      <div aria-hidden style={{ width: 1, alignSelf: "stretch", background: `${GOLD}88`, marginLeft: 2, marginRight: 2 }} />
      <div className="num shrink-0 flex flex-col items-end" data-at-flow-wall={side} style={{ width: 46, lineHeight: 1 }}>
        <span style={{ fontSize: 7, fontWeight: 500, color: AT_LABEL }}>{wallLabel}</span>
        <span style={{ fontSize: 8, fontWeight: 600, color: wallColor }}>
          {wallValue != null ? formatStrikeLevel(wallValue) : "\u2014"}
        </span>
      </div>
    </div>
  );
}

export type AtGlanceGrossFlowProps = {
  glance: DeskNetPremiumGlance;
  callWall?: number | null;
  putWall?: number | null;
  onOpenDetail?: () => void;
};

export const AtGlanceGrossFlow = memo(function AtGlanceGrossFlow({
  glance,
  callWall,
  putWall,
  onOpenDetail,
}: AtGlanceGrossFlowProps) {
  const scaleRef = useRef(SCALE_FLOOR);

  if (glance.unsupported) {
    return (
      <div data-at-gross-flow="unsupported" style={{ fontSize: 9, color: AT_SECONDARY, lineHeight: 1.15 }}>
        Flow not available
      </div>
    );
  }
  if (glance.closed) {
    return (
      <div data-at-gross-flow="closed" style={{ fontSize: 9, color: AT_SECONDARY }}>
        Closed
      </div>
    );
  }
  if (glance.noPrints) {
    return (
      <div data-at-gross-flow="no-prints" className="flex items-center gap-1" style={{ fontSize: 9, color: AT_SECONDARY }}>
        <span style={{ color: WHITE }}>{"\u2014"}</span>
        <span>no prints</span>
      </div>
    );
  }
  if (glance.stale) {
    return (
      <div data-at-gross-flow="stale" className="flex items-center gap-1" style={{ fontSize: 9, color: AT_SECONDARY }}>
        <span style={{ color: WHITE }}>{"\u2014"}</span>
        <span>stale</span>
      </div>
    );
  }

  const soldC = glance.grossCallsSell;
  const buyC = glance.grossCallsBuy;
  const soldP = glance.grossPutsSell;
  const buyP = glance.grossPutsBuy;
  const mag = Math.max(soldC, buyC, soldP, buyP, SCALE_FLOOR);
  scaleRef.current = Math.max(scaleRef.current * SCALE_DECAY, mag);
  const sharedScale = scaleRef.current;

  return (
    <button
      type="button"
      data-at-gross-flow="live"
      data-at-flow-window={glance.windowLabel}
      className="w-full text-left"
      onClick={onOpenDetail}
      style={{ padding: 0, background: "transparent", border: "none", cursor: onOpenDetail ? "pointer" : "default" }}
      aria-label="Option flow details"
    >
      <div className="flex flex-col gap-0.5" style={{ lineHeight: 1, overflow: "hidden" }}>
        <GrossFlowTrack
          side="calls"
          soldUsd={soldC}
          boughtUsd={buyC}
          sharedScale={sharedScale}
          wallLabel="Call wall"
          wallValue={callWall}
          wallColor={GOLD}
        />
        <GrossFlowTrack
          side="puts"
          soldUsd={soldP}
          boughtUsd={buyP}
          sharedScale={sharedScale}
          wallLabel="Put wall"
          wallValue={putWall}
          wallColor={PUT_WALL}
        />
      </div>
    </button>
  );
});