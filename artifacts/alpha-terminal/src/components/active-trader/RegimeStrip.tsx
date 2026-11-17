import { memo, type CSSProperties } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  BG_EXP_BAR, BORDER, BORDER_ROW, DIM, WHITE, GRAY, UP, DOWN, GAMMA_SCENARIO,
  MONO, FW_LIGHT, FW_NORMAL,
} from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { formatGexUsd } from "@/lib/active-trader/zonesModel";
import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";
import { formatStrikeLevel } from "@/lib/active-trader/atExpiryPill";
import { useFlashOnChange } from "@/hooks/useFlashOnChange";

const AMBER = "#FFB800";

interface RegimeStripProps {
  accentHex: string;
  regimeLabel: string | null;
  regimeDegraded: boolean;
  zones: ZoneModel;
  stickyTop?: number;
  sessionLabel?: string;
  embedded?: boolean;
  headline?: string;
  headerCompact?: boolean;
  onExpandHeader?: () => void;
  onCompactHeader?: () => void;
}

export const RegimeStrip = memo(function RegimeStrip({
  regimeLabel,
  regimeDegraded,
  zones,
  stickyTop,
  sessionLabel,
  embedded,
  headline,
  headerCompact,
  onExpandHeader,
  onCompactHeader,
}: RegimeStripProps) {
  const session = sessionLabel ?? (isUsEquitiesMarketHoursEt() ? "Cash session" : "Extended");
  const envLabel =
    zones.env === "damping" ? "Damping" : zones.env === "amplifying" ? "Amplifying" : zones.env === "near_flip" ? "Near flip" : "\u2014";
  const dotColor = regimeDegraded ? GRAY : UP;

  const flashCw = useFlashOnChange(zones.callWall);
  const flashPw = useFlashOnChange(zones.putWall);
  const flashFlip = useFlashOnChange(zones.flip != null ? Math.round(zones.flip) : null);
  const flashGex = useFlashOnChange(
    zones.netGexUsdPer1Pct != null ? Math.round(zones.netGexUsdPer1Pct / 1e6) : null,
  );

  const levelStyle = (flash: boolean): CSSProperties => ({
    fontSize: 16,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    transition: "opacity 0.35s ease",
    opacity: flash ? 0.85 : 1,
  });

  return (
    <div
      data-at-key-levels
      className={embedded ? "px-3 pt-2 pb-1 space-y-1.5" : "sticky z-[38] px-3 pt-2 pb-1.5 space-y-1.5"}
      style={{
        ...(embedded ? {} : { top: stickyTop }),
        background: BG_EXP_BAR,
        borderBottom: embedded ? undefined : `1px solid ${BORDER}`,
        fontFamily: MONO,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span style={{ fontSize: 10, color: DIM, fontWeight: FW_LIGHT, letterSpacing: "0.08em" }}>SESSION REGIME</span>
          <span className="text-zinc-600" style={{ fontSize: 10 }}>•</span>
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
          <span
            className="truncate capitalize"
            style={{ fontSize: 12, color: regimeDegraded ? GRAY : WHITE, fontWeight: FW_NORMAL }}
          >
            {regimeLabel ?? "\u2014"}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span style={{ fontSize: 10, color: DIM, fontWeight: FW_LIGHT }}>{session}</span>
          <AtHeaderModeIcons
            headerCompact={headerCompact}
            onExpandHeader={onExpandHeader}
            onCompactHeader={onCompactHeader}
          />
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${BORDER_ROW}`, paddingTop: 6 }}>
        <div
          className="grid gap-x-3 gap-y-1"
          style={{ gridTemplateColumns: "1fr 1fr", fontSize: 10, fontWeight: FW_LIGHT, color: DIM, letterSpacing: "0.06em" }}
        >
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="shrink-0">CALL WALL</span>
            <span style={{ ...levelStyle(flashCw), color: UP, marginLeft: "auto" }}>{formatStrikeLevel(zones.callWall)}</span>
          </div>
          <div className="flex items-baseline gap-1 min-w-0" style={{ borderLeft: `1px solid ${BORDER_ROW}`, paddingLeft: 8 }}>
            <span className="shrink-0">PUT WALL</span>
            <span style={{ ...levelStyle(flashPw), color: DOWN, marginLeft: "auto" }}>{formatStrikeLevel(zones.putWall)}</span>
          </div>
        </div>
        <div
          className="grid gap-x-3 gap-y-1 mt-1.5"
          style={{
            gridTemplateColumns: "1fr 1fr",
            fontSize: 10,
            fontWeight: FW_LIGHT,
            color: DIM,
            borderTop: `1px solid ${BORDER_ROW}`,
            paddingTop: 6,
          }}
        >
          <div className="flex items-baseline gap-1 min-w-0">
            <span className="shrink-0">FLIP</span>
            <span style={{ ...levelStyle(flashFlip), color: GAMMA_SCENARIO, marginLeft: "auto" }}>
              {zones.flip != null ? formatStrikeLevel(Math.round(zones.flip)) : "\u2014"}
            </span>
          </div>
          <div
            className="flex items-baseline gap-1 min-w-0 flex-wrap justify-end"
            style={{ borderLeft: `1px solid ${BORDER_ROW}`, paddingLeft: 8 }}
          >
            <span className="shrink-0">GEX</span>
            <span style={{ ...levelStyle(flashGex), color: WHITE }}>{formatGexUsd(zones.netGexUsdPer1Pct)}</span>
            {envLabel !== "\u2014" && (
              <span style={{ color: GAMMA_SCENARIO, fontSize: 11, fontWeight: FW_NORMAL }}>· {envLabel}</span>
            )}
          </div>
        </div>
      </div>

      <div className="text-center pt-0.5" style={{ fontSize: 9, color: GRAY, letterSpacing: "0.04em" }}>
        Modeled · OI convention · 0DTE
      </div>

      {headline?.trim() ? (
        <div
          className="text-center py-0.5"
          data-at-pressure-line
          style={{ fontSize: 10, color: AMBER, fontWeight: FW_NORMAL, letterSpacing: "0.02em" }}
        >
          {headline.trim()}
        </div>
      ) : null}
    </div>
  );
});

function AtHeaderModeIcons({
  headerCompact,
  onExpandHeader,
  onCompactHeader,
}: {
  headerCompact?: boolean;
  onExpandHeader?: () => void;
  onCompactHeader?: () => void;
}) {
  if (headerCompact && onExpandHeader) {
    return (
      <button
        type="button"
        data-at-expand-header
        aria-label="Full header"
        className="p-0.5 rounded border ml-0.5"
        style={{ borderColor: BORDER, color: GRAY, background: "transparent" }}
        onClick={onExpandHeader}
      >
        <Maximize2 className="w-3 h-3" />
      </button>
    );
  }
  if (!headerCompact && onCompactHeader) {
    return (
      <button
        type="button"
        aria-label="Compact header"
        className="p-0.5 rounded border ml-0.5"
        style={{ borderColor: BORDER, color: GRAY, background: "transparent" }}
        onClick={onCompactHeader}
      >
        <Minimize2 className="w-3 h-3 opacity-70" />
      </button>
    );
  }
  return null;
}