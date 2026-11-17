import { memo } from "react";
import {
  BG_EXP_BAR, BORDER, DIM, WHITE, GRAY, UP, DOWN, GAMMA_SCENARIO,
  MONO, FW_LIGHT, FW_NORMAL, FW_PREMIUM,
} from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { formatGexUsd } from "@/lib/active-trader/zonesModel";
import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";

interface RegimeStripProps {
  accentHex: string;
  regimeLabel: string | null;
  regimeDegraded: boolean;
  zones: ZoneModel;
  stickyTop?: number;
  sessionLabel?: string;
  embedded?: boolean;
}

export const RegimeStrip = memo(function RegimeStrip({
  accentHex,
  regimeLabel,
  regimeDegraded,
  zones,
  stickyTop,
  sessionLabel,
  embedded,
}: RegimeStripProps) {
  const session = sessionLabel ?? (isUsEquitiesMarketHoursEt() ? "Cash session" : "Extended");
  const envLabel =
    zones.env === "damping" ? "Damping" : zones.env === "amplifying" ? "Amplifying" : zones.env === "near_flip" ? "Near flip" : "\u2014";
  const dotColor = regimeDegraded ? GRAY : UP;

  return (
    <div
      className={embedded ? "px-3 py-2 space-y-2" : "sticky z-[38] px-3 py-2 space-y-2"}
      style={{
        ...(embedded ? {} : { top: stickyTop }),
        background: BG_EXP_BAR,
        borderBottom: embedded ? undefined : `1px solid ${BORDER}`,
        fontFamily: MONO,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ fontSize: 10, color: DIM, fontWeight: FW_LIGHT, letterSpacing: "0.08em" }}>SESSION REGIME</span>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
          <span style={{ fontSize: 12, color: regimeDegraded ? GRAY : WHITE, fontWeight: FW_NORMAL }}>
            {regimeLabel ?? "\u2014"}
          </span>
        </div>
        <span style={{ fontSize: 10, color: DIM, fontWeight: FW_LIGHT }}>{session}</span>
      </div>

      <div
        className="grid gap-x-4 gap-y-1"
        style={{ gridTemplateColumns: "1fr 1fr", fontSize: 12, fontWeight: FW_NORMAL, fontVariantNumeric: "tabular-nums" }}
      >
        <div>
          <span style={{ fontSize: 10, color: DIM, letterSpacing: "0.06em" }}>CALL WALL </span>
          <span style={{ color: accentHex }}>{zones.callWall ?? "\u2014"}</span>
        </div>
        <div>
          <span style={{ fontSize: 10, color: DIM, letterSpacing: "0.06em" }}>PUT WALL </span>
          <span style={{ color: DOWN }}>{zones.putWall ?? "\u2014"}</span>
        </div>
        <div>
          <span style={{ fontSize: 10, color: DIM, letterSpacing: "0.06em" }}>FLIP </span>
          <span style={{ color: GAMMA_SCENARIO }}>{zones.flip != null ? zones.flip.toFixed(0) : "\u2014"}</span>
        </div>
        <div>
          <span style={{ fontSize: 10, color: DIM, letterSpacing: "0.06em" }}>GEX </span>
          <span style={{ color: WHITE }}>{formatGexUsd(zones.netGexUsdPer1Pct)}</span>
          {envLabel !== "\u2014" && (
            <span style={{ color: GAMMA_SCENARIO, fontSize: 11, marginLeft: 4 }}>· {envLabel}</span>
          )}
        </div>
      </div>

      <div className="text-center" style={{ fontSize: 9, color: GRAY, letterSpacing: "0.04em" }}>
        Modeled · OI convention · 0DTE
      </div>

    </div>
  );
});