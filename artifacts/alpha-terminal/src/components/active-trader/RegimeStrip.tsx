import { memo, type CSSProperties } from "react";
import {
  BG_EXP_BAR, BORDER_ROW, DIM, WHITE, GRAY, UP, GAMMA_SCENARIO,
  MONO, FW_LIGHT, GOLD,
} from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { formatGexUsd } from "@/lib/active-trader/zonesModel";
import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";
import { formatStrikeLevel } from "@/lib/active-trader/atExpiryPill";
import { useFlashOnChange } from "@/hooks/useFlashOnChange";

const AMBER = "#FFB800";
const PUT_TEAL = "#14b8a6";
const ROW_PX = 11;

interface RegimeStripProps {
  accentHex: string;
  regimeLabel: string | null;
  regimeDegraded: boolean;
  zones: ZoneModel;
  stickyTop?: number;
  sessionLabel?: string;
  embedded?: boolean;
  headline?: string;
}

function InlineLevel({
  label,
  value,
  color,
  flash,
  align = "left",
}: {
  label: string;
  value: string;
  color: string;
  flash: boolean;
  align?: "left" | "right";
}) {
  const base: CSSProperties = {
    fontSize: ROW_PX,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.25,
    opacity: flash ? 0.88 : 1,
    transition: "opacity 0.35s ease",
    textAlign: align,
  };
  return (
    <span className="block truncate" style={base}>
      <span style={{ color: DIM, fontWeight: FW_LIGHT, letterSpacing: "0.04em" }}>{label} </span>
      <span style={{ color }}>{value}</span>
    </span>
  );
}

export const RegimeStrip = memo(function RegimeStrip({
  regimeLabel,
  regimeDegraded,
  zones,
  stickyTop,
  sessionLabel,
  embedded,
  headline,
}: RegimeStripProps) {
  const session = sessionLabel ?? (isUsEquitiesMarketHoursEt() ? "Cash session" : "Extended");
  const envLabel =
    zones.env === "damping" ? "Damping" : zones.env === "amplifying" ? "Amplifying" : zones.env === "near_flip" ? "Near flip" : "";
  const dotColor = regimeDegraded ? GRAY : UP;

  const flashCw = useFlashOnChange(zones.callWall);
  const flashPw = useFlashOnChange(zones.putWall);
  const flashFlip = useFlashOnChange(zones.flip != null ? Math.round(zones.flip) : null);
  const flashGex = useFlashOnChange(
    zones.netGexUsdPer1Pct != null ? Math.round(zones.netGexUsdPer1Pct / 1e6) : null,
  );

  const cw = zones.callWall != null ? formatStrikeLevel(zones.callWall) : "\u2014";
  const pw = zones.putWall != null ? formatStrikeLevel(zones.putWall) : "\u2014";
  const flip = zones.flip != null ? formatStrikeLevel(Math.round(zones.flip)) : "\u2014";
  const gexVal = formatGexUsd(zones.netGexUsdPer1Pct);

  return (
    <div
      data-at-key-levels
      className={embedded ? "px-3 pt-1.5 pb-1 space-y-1" : "sticky z-[38] px-3 pt-1.5 pb-1 space-y-1"}
      style={{
        ...(embedded ? {} : { top: stickyTop }),
        background: BG_EXP_BAR,
        borderBottom: embedded ? undefined : `1px solid ${BORDER_ROW}`,
        fontFamily: MONO,
      }}
    >
      <div className="flex items-center justify-between gap-2 min-h-[18px]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="uppercase shrink-0"
            style={{ fontSize: 10, color: DIM, fontWeight: FW_LIGHT, letterSpacing: "0.08em" }}
          >
            SESSION REGIME
          </span>
          <span className="w-1 h-1 rounded-full shrink-0" style={{ background: dotColor }} />
          <span
            className="truncate capitalize"
            style={{ fontSize: 11, color: regimeDegraded ? GRAY : WHITE, fontWeight: 500 }}
          >
            {regimeLabel ?? "\u2014"}
          </span>
        </div>
        <span className="shrink-0" style={{ fontSize: 10, color: DIM, fontWeight: FW_LIGHT }}>
          {session}
        </span>
      </div>

      <div
        className="grid grid-cols-2 gap-x-2 gap-y-1 py-1"
        style={{ borderTop: `1px solid ${BORDER_ROW}`, borderBottom: `1px solid ${BORDER_ROW}` }}
      >
        <div className="pr-1" style={{ borderRight: `1px solid ${BORDER_ROW}` }}>
          <InlineLevel label="CALL WALL" value={cw} color={GOLD} flash={flashCw} />
        </div>
        <div className="pl-1.5">
          <InlineLevel label="PUT WALL" value={pw} color={PUT_TEAL} flash={flashPw} />
        </div>
        <div className="pr-1 pt-0.5" style={{ borderRight: `1px solid ${BORDER_ROW}` }}>
          <InlineLevel label="FLIP" value={flip} color={GAMMA_SCENARIO} flash={flashFlip} />
        </div>
        <p className="pl-1.5 pt-0.5 truncate" style={{ fontSize: ROW_PX, fontVariantNumeric: "tabular-nums", lineHeight: 1.25 }}>
          <span style={{ color: DIM, fontWeight: FW_LIGHT, letterSpacing: "0.04em" }}>GEX </span>
          <span style={{ color: WHITE, fontWeight: 500, opacity: flashGex ? 0.88 : 1 }}>{gexVal}</span>
          {envLabel ? (
            <span style={{ color: GRAY, fontWeight: FW_LIGHT, fontSize: 10 }}> · {envLabel}</span>
          ) : null}
        </p>
      </div>

      <div className="text-center leading-tight" style={{ fontSize: 10, color: GRAY, letterSpacing: "0.03em" }}>
        Modeled · OI convention · 0DTE
      </div>

      {headline?.trim() ? (
        <div
          className="text-center leading-tight pt-0.5"
          data-at-pressure-line
          style={{
            fontSize: 11,
            color: AMBER,
            fontWeight: 500,
            borderTop: `1px solid ${BORDER_ROW}`,
            paddingTop: 4,
          }}
        >
          {headline.trim()}
        </div>
      ) : null}
    </div>
  );
});