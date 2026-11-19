import { memo, useRef } from "react";
import { WHITE } from "@/components/options/optionsTheme";
import { AT_LABEL } from "@/lib/active-trader/atChromeContrast";
import type { DeskNetPremiumGlance } from "@/lib/active-trader/deskFlowNetPremium";
import { fmtGlanceFlowAmount } from "@/lib/active-trader/deskFlowMoneyFormat";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { resolveCallWallDisplay, resolvePutWallDisplay } from "@/lib/active-trader/atGlanceWallDisplay";
import {
  AT_LADDER_SELECT_BUY,
  AT_LADDER_SELECT_SELL,
} from "@/lib/active-trader/atLadderLayout";

const TRACK_H = 22;
const FLOW_VALUE_PX = 14;
const WALL_LABEL_PX = 13;
const WALL_VALUE_PX = 14;
const SCALE_FLOOR = 50_000;
const SCALE_DECAY = 0.94;

function fmtSoldBought(usd: number, dash: boolean): string {
  if (dash) return "\u2014";
  const core = fmtGlanceFlowAmount(usd);
  return core.startsWith("$") ? core : `$${core}`;
}

function grossBarFill(amount: number, scale: number): number {
  if (!(scale > 0) || amount <= 0) return 0;
  return Math.min(1, amount / scale);
}

function GrossFlowTrack({
  side,
  soldUsd,
  boughtUsd,
  sharedScale,
  wallLabel,
  wallText,
  dashAmounts,
}: {
  side: "calls" | "puts";
  soldUsd: number;
  boughtUsd: number;
  sharedScale: number;
  wallLabel: string;
  wallText: string;
  dashAmounts: boolean;
}) {
  const sellFill = grossBarFill(soldUsd, sharedScale);
  const buyFill = grossBarFill(boughtUsd, sharedScale);

  return (
    <div
      data-at-gross-flow-row={side}
      data-at-flow-gross-sold-usd={dashAmounts ? "" : String(soldUsd)}
      data-at-flow-gross-bought-usd={dashAmounts ? "" : String(boughtUsd)}
      className="items-center min-w-0"
      style={{
        height: TRACK_H,
        display: "grid",
        gridTemplateColumns: "46px 88px 108px 34px 1px minmax(0, 1fr)",
        columnGap: 6,
      }}
    >
      <span style={{ fontSize: FLOW_VALUE_PX, fontWeight: 500, color: WHITE }}>
        {side === "calls" ? "Calls" : "Puts"}
      </span>
      <span
        className="num whitespace-nowrap"
        style={{
          fontFeatureSettings: '"tnum" 1',
          fontSize: FLOW_VALUE_PX,
          fontWeight: 500,
          color: AT_LADDER_SELECT_SELL,
        }}
      >
        Sold {fmtSoldBought(soldUsd, dashAmounts)}
      </span>
      <span
        className="num whitespace-nowrap"
        style={{
          fontFeatureSettings: '"tnum" 1',
          fontSize: FLOW_VALUE_PX,
          fontWeight: 500,
          color: AT_LADDER_SELECT_BUY,
        }}
      >
        Bought {fmtSoldBought(boughtUsd, dashAmounts)}
      </span>
      <div
        className="relative min-w-0 overflow-hidden"
        style={{ height: 4, background: "rgba(255,255,255,0.08)" }}
        aria-hidden
      >
        {!dashAmounts ? (
          <>
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                right: "50%",
                width: `${sellFill * 50}%`,
                background: AT_LADDER_SELECT_SELL,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: "50%",
                width: `${buyFill * 50}%`,
                background: AT_LADDER_SELECT_BUY,
              }}
            />
          </>
        ) : null}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 1,
            background: "rgba(255,255,255,0.2)",
          }}
        />
      </div>
      <div aria-hidden style={{ width: 1, height: 16, background: "rgba(255,255,255,0.24)" }} />
      <div
        data-at-flow-wall={side}
        className="num min-w-0 text-right whitespace-nowrap"
        style={{
          lineHeight: 1,
          fontSize: WALL_LABEL_PX,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={`${wallLabel} ${wallText}`}
      >
        <span style={{ fontWeight: 400, color: AT_LABEL }}>{wallLabel} </span>
        <span style={{ fontSize: WALL_VALUE_PX, fontWeight: 500, color: WHITE }}>{wallText}</span>
      </div>
    </div>
  );
}

export type AtGlanceGrossFlowProps = {
  glance: DeskNetPremiumGlance;
  zones: ZoneModel;
  /** When market is closed, keep rows but dash sold/bought amounts. */
  forceDashAmounts?: boolean;
  onOpenDetail?: () => void;
};

export const AtGlanceGrossFlow = memo(function AtGlanceGrossFlow({
  glance,
  zones,
  forceDashAmounts,
  onOpenDetail,
}: AtGlanceGrossFlowProps) {
  const callWallCol = resolveCallWallDisplay(zones);
  const putWallCol = resolvePutWallDisplay(zones);
  const scaleRef = useRef(SCALE_FLOOR);

  const shell =
    forceDashAmounts ||
    glance.unsupported ||
    glance.closed ||
    glance.noPrints ||
    glance.stale ||
    !glance.calls ||
    !glance.puts;

  const soldC = shell ? 0 : glance.grossCallsSell;
  const buyC = shell ? 0 : glance.grossCallsBuy;
  const soldP = shell ? 0 : glance.grossPutsSell;
  const buyP = shell ? 0 : glance.grossPutsBuy;

  const mag = Math.max(soldC, buyC, soldP, buyP, SCALE_FLOOR);
  if (!shell) {
    scaleRef.current = Math.max(scaleRef.current * SCALE_DECAY, mag);
  }
  const sharedScale = scaleRef.current;

  const state = glance.unsupported
    ? "unsupported"
    : glance.closed
      ? "closed"
      : glance.noPrints
        ? "no-prints"
        : glance.stale
          ? "stale"
          : "live";

  return (
    <button
      type="button"
      data-at-gross-flow={state}
      data-at-flow-window={glance.windowLabel}
      data-at-gross-flow-shell={shell ? "1" : "0"}
      className="w-full text-left"
      onClick={onOpenDetail}
      style={{ padding: 0, background: "transparent", border: "none", cursor: onOpenDetail ? "pointer" : "default" }}
      aria-label="Option flow details"
    >
      <div className="flex flex-col" style={{ lineHeight: 1, gap: 1 }}>
        <GrossFlowTrack
          side="calls"
          soldUsd={soldC}
          boughtUsd={buyC}
          sharedScale={sharedScale}
          wallLabel={callWallCol.label}
          wallText={callWallCol.value}
          dashAmounts={shell}
        />
        <GrossFlowTrack
          side="puts"
          soldUsd={soldP}
          boughtUsd={buyP}
          sharedScale={sharedScale}
          wallLabel={putWallCol.label}
          wallText={putWallCol.value}
          dashAmounts={shell}
        />
      </div>
    </button>
  );
});