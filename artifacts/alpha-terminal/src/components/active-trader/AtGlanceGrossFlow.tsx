import { memo, useRef } from "react";
import { DOWN_TEXT, GOLD, PUT_WALL, UP } from "@/components/options/optionsTheme";
import { AT_LABEL } from "@/lib/active-trader/atChromeContrast";
import type { DeskNetPremiumGlance } from "@/lib/active-trader/deskFlowNetPremium";
import { fmtGlanceFlowAmount } from "@/lib/active-trader/deskFlowMoneyFormat";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { resolveCallWallDisplay, resolvePutWallDisplay } from "@/lib/active-trader/atGlanceWallDisplay";

const TRACK_H = 18;
const TEXT_PX = 13;
const FLOW_GRID = "36px minmax(0, max-content) minmax(8px, 1fr) minmax(0, max-content) 6px 104px";
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
  wallColor,
  dashAmounts,
}: {
  side: "calls" | "puts";
  soldUsd: number;
  boughtUsd: number;
  sharedScale: number;
  wallLabel: string;
  wallText: string;
  wallColor: string;
  dashAmounts: boolean;
}) {
  const sellFill = grossBarFill(soldUsd, sharedScale);
  const buyFill = grossBarFill(boughtUsd, sharedScale);

  const sideTag = side === "calls" ? "CALL" : "PUT";

  return (
    <div
      data-at-gross-flow-row={side}
      data-at-flow-gross-sold-usd={dashAmounts ? "" : String(soldUsd)}
      data-at-flow-gross-bought-usd={dashAmounts ? "" : String(boughtUsd)}
      className="grid items-center min-w-0 w-full"
      style={{ height: TRACK_H, gridTemplateColumns: FLOW_GRID }}
    >
      <span
        className="shrink-0 inline-block text-left"
        style={{ fontSize: TEXT_PX, fontWeight: 600, color: AT_LABEL, letterSpacing: 0 }}
      >
        {sideTag}
      </span>
      <span
        className="num whitespace-nowrap"
        style={{
          fontFeatureSettings: '"tnum" 1',
          fontSize: TEXT_PX,
          fontWeight: 600,
          color: DOWN_TEXT,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        Sold {fmtSoldBought(soldUsd, dashAmounts)}
      </span>
      <div
        className="relative flex-1 min-w-0 rounded-sm overflow-hidden"
        style={{ height: 8, background: "rgba(255,255,255,0.06)" }}
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
          </>
        ) : null}
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.28)" }} />
      </div>
      <span
        className="num whitespace-nowrap"
        style={{
          fontFeatureSettings: '"tnum" 1',
          fontSize: TEXT_PX,
          fontWeight: 600,
          color: UP,
          textAlign: "left",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        Bought {fmtSoldBought(boughtUsd, dashAmounts)}
      </span>
      <div aria-hidden style={{ width: 1, height: 14, justifySelf: "center", background: `${GOLD}88` }} />
      <div
        data-at-flow-wall={side}
        className="num whitespace-nowrap"
        style={{
          lineHeight: 1,
          fontSize: TEXT_PX,
          textAlign: "left",
          justifySelf: "start",
        }}
        title={`${wallLabel} ${wallText}`}
      >
        <span style={{ fontWeight: 600, color: AT_LABEL }}>{wallLabel} </span>
        <span style={{ fontWeight: 600, color: wallColor }}>{wallText}</span>
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
      <div className="flex flex-col gap-0.5" style={{ lineHeight: 1 }}>
        <GrossFlowTrack
          side="calls"
          soldUsd={soldC}
          boughtUsd={buyC}
          sharedScale={sharedScale}
          wallLabel={callWallCol.label}
          wallText={callWallCol.value}
          wallColor={GOLD}
          dashAmounts={shell}
        />
        <GrossFlowTrack
          side="puts"
          soldUsd={soldP}
          boughtUsd={buyP}
          sharedScale={sharedScale}
          wallLabel={putWallCol.label}
          wallText={putWallCol.value}
          wallColor={PUT_WALL}
          dashAmounts={shell}
        />
      </div>
    </button>
  );
});