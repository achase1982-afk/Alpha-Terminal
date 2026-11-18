import { memo, useState } from "react";
import { Info } from "lucide-react";
import {
  BG_EXP_BAR, BORDER_ROW, DIM, WHITE, GRAY, UP, DOWN, GAMMA_SCENARIO,
  MONO, FW_LIGHT, GOLD,
} from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { formatGexUsd } from "@/lib/active-trader/zonesModel";
import { isUsEquitiesMarketHoursEt } from "@/lib/usMarketHours";
import { formatStrikeLevel } from "@/lib/active-trader/atExpiryPill";
import { useFlashOnChange } from "@/hooks/useFlashOnChange";
import type { SpxKeepawayStats } from "@workspace/order-ticket-math";

const AMBER = "#FFB800";
const PUT_TEAL = "#14b8a6";
const LABEL_PX = 9;
const VALUE_PX = 15;

interface RegimeStripProps {
  accentHex: string;
  regimeLabel: string | null;
  regimeDegraded: boolean;
  zones: ZoneModel;
  underlyingPrice?: number | null;
  keepawayStats?: SpxKeepawayStats | null;
  keepawayPutLine?: number | null;
  keepawayCallLine?: number | null;
  keepawayUseMean?: boolean;
  onToggleKeepawayMean?: () => void;
  stickyTop?: number;
  sessionLabel?: string;
  embedded?: boolean;
  headline?: string;
}

function distToWall(
  wall: number | null,
  spot: number | null,
  kind: "call" | "put",
): string | null {
  if (wall == null || spot == null || !Number.isFinite(spot)) return null;
  const raw = kind === "call" ? wall - spot : spot - wall;
  if (Math.abs(raw) < 0.05) return "at spot";
  const away = Math.abs(raw);
  return kind === "call"
    ? `${away.toFixed(1)} above`
    : `${away.toFixed(1)} below`;
}

function KeepawayValue({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: LABEL_PX, color: GRAY, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: VALUE_PX, color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function LevelCell({
  label,
  value,
  dist,
  color,
  flash,
}: {
  label: string;
  value: string;
  dist: string | null;
  color: string;
  flash: boolean;
}) {
  return (
    <div
      className="min-w-0 py-1"
      style={{
        fontFamily: MONO,
        opacity: flash ? 0.9 : 1,
        transition: "opacity 0.35s ease",
      }}
    >
      <div
        className="uppercase tracking-wider"
        style={{ fontSize: LABEL_PX, color: GRAY, fontWeight: 600, letterSpacing: "0.1em" }}
      >
        {label}
      </div>
      <div
        className="tabular-nums leading-tight"
        style={{ fontSize: VALUE_PX, color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
      {dist ? (
        <div className="tabular-nums" style={{ fontSize: 10, color: WHITE, fontWeight: 500, marginTop: 1 }}>
          {dist}
        </div>
      ) : null}
    </div>
  );
}

export const RegimeStrip = memo(function RegimeStrip({
  regimeLabel,
  regimeDegraded,
  zones,
  underlyingPrice,
  keepawayStats,
  keepawayPutLine,
  keepawayCallLine,
  keepawayUseMean = false,
  onToggleKeepawayMean,
  stickyTop,
  sessionLabel,
  embedded,
  headline,
}: RegimeStripProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const session = sessionLabel ?? (isUsEquitiesMarketHoursEt() ? "Cash session" : "Extended");
  const envLabel =
    zones.env === "damping" ? "Damping" : zones.env === "amplifying" ? "Amplifying" : zones.env === "near_flip" ? "Near flip" : "";

  const regimeText = regimeLabel ?? "\u2014";
  const regimeTone = regimeDegraded
    ? { bg: "#27272a", color: GRAY, border: "#3f3f46" }
    : /bear|down|put/i.test(regimeText)
      ? { bg: "rgba(242,54,69,0.18)", color: DOWN, border: "rgba(242,54,69,0.45)" }
      : /bull|up|call/i.test(regimeText)
        ? { bg: "rgba(0,209,102,0.15)", color: UP, border: "rgba(0,209,102,0.4)" }
        : { bg: "rgba(251,191,36,0.12)", color: GOLD, border: "rgba(251,191,36,0.35)" };

  const flashCw = useFlashOnChange(zones.callWall);
  const flashPw = useFlashOnChange(zones.putWall);
  const flashFlip = useFlashOnChange(zones.flip != null ? Math.round(zones.flip) : null);
  const flashGex = useFlashOnChange(
    zones.netGexUsdPer1Pct != null ? Math.round(zones.netGexUsdPer1Pct / 1e6) : null,
  );

  const cw = zones.callWall != null ? formatStrikeLevel(zones.callWall) : "\u2014";
  const pw = zones.putWall != null ? formatStrikeLevel(zones.putWall) : "\u2014";
  const flip =
    zones.flip != null ? formatStrikeLevel(Math.round(zones.flip)) : "none in range";
  const gexVal = formatGexUsd(zones.netGexUsdPer1Pct);

  const kLow = keepawayStats
    ? keepawayUseMean
      ? keepawayStats.lowSide.mean
      : keepawayStats.lowSide.median
    : null;
  const kHigh = keepawayStats
    ? keepawayUseMean
      ? keepawayStats.highSide.mean
      : keepawayStats.highSide.median
    : null;

  return (
    <div
      data-at-key-levels
      className={embedded ? "px-3 pt-2 pb-1.5 space-y-1.5" : "sticky z-[38] px-3 pt-2 pb-1.5 space-y-1.5"}
      style={{
        ...(embedded ? {} : { top: stickyTop }),
        background: BG_EXP_BAR,
        borderBottom: embedded ? undefined : `1px solid ${BORDER_ROW}`,
        fontFamily: MONO,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span
            className="shrink-0 rounded-full px-2 py-0.5 capitalize truncate max-w-[200px]"
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: regimeTone.color,
              background: regimeTone.bg,
              border: `1px solid ${regimeTone.border}`,
            }}
          >
            {regimeText}
          </span>
          <button
            type="button"
            aria-label="Key level conventions"
            onClick={() => setInfoOpen((v) => !v)}
            className="shrink-0 p-0.5 rounded"
            style={{ color: infoOpen ? WHITE : DIM }}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>
        <span className="shrink-0" style={{ fontSize: 10, color: WHITE, fontWeight: 500 }}>
          {session}
        </span>
      </div>

      {infoOpen ? (
        <p className="leading-snug" style={{ fontSize: 10, color: GRAY, fontWeight: FW_LIGHT }}>
          Modeled · OI convention · 0DTE. Walls and flip refresh with chain OI/gamma and live ticks.
        </p>
      ) : null}

      <div
        className="grid grid-cols-2 gap-x-3 gap-y-2 py-1.5"
        style={{ borderTop: `1px solid ${BORDER_ROW}`, borderBottom: `1px solid ${BORDER_ROW}` }}
      >
        <LevelCell
          label="Call wall"
          value={cw}
          dist={distToWall(zones.callWall, underlyingPrice ?? null, "call")}
          color={GOLD}
          flash={flashCw}
        />
        <LevelCell
          label="Put wall"
          value={pw}
          dist={distToWall(zones.putWall, underlyingPrice ?? null, "put")}
          color={PUT_TEAL}
          flash={flashPw}
        />
        <LevelCell
          label="Flip"
          value={flip}
          dist={null}
          color={GAMMA_SCENARIO}
          flash={flashFlip}
        />
        <div className="min-w-0 py-1" style={{ opacity: flashGex ? 0.9 : 1 }}>
          <div
            className="uppercase tracking-wider"
            style={{ fontSize: LABEL_PX, color: GRAY, fontWeight: 600, letterSpacing: "0.1em" }}
          >
            GEX
          </div>
          <div
            className="tabular-nums leading-tight"
            style={{ fontSize: VALUE_PX, color: WHITE, fontWeight: 700 }}
          >
            {gexVal}
          </div>
          {envLabel ? (
            <div style={{ fontSize: 10, color: GRAY, fontWeight: 500, marginTop: 1 }}>{envLabel}</div>
          ) : null}
        </div>
      </div>

      {keepawayStats && keepawayPutLine != null && keepawayCallLine != null ? (
        <div
          data-at-keepaway-strip
          className="space-y-1 py-1"
          style={{ borderBottom: `1px solid ${BORDER_ROW}` }}
        >
          <div className="flex items-center justify-between gap-2">
            <span style={{ fontSize: 10, color: WHITE, fontWeight: 600, letterSpacing: "0.06em" }}>
              KEEP-AWAY (SPX)
            </span>
            {onToggleKeepawayMean ? (
              <button
                type="button"
                onClick={onToggleKeepawayMean}
                className="rounded-full px-2 py-0.5"
                style={{
                  fontSize: 9,
                  color: GRAY,
                  border: `1px solid ${BORDER_ROW}`,
                  background: keepawayUseMean ? "rgba(255,255,255,0.06)" : "transparent",
                }}
              >
                {keepawayUseMean ? "Avg K" : "Med K"}
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-x-2">
            <div>
              <KeepawayValue label="Put floor" value={formatStrikeLevel(keepawayPutLine)} color={PUT_TEAL} />
            </div>
            <div>
              <KeepawayValue label="Call ceiling" value={formatStrikeLevel(keepawayCallLine)} color={GOLD} />
            </div>
          </div>
          <p className="tabular-nums" style={{ fontSize: 9, color: GRAY, lineHeight: 1.35 }}>
            K_low med {keepawayStats.lowSide.median.toFixed(1)} · avg {keepawayStats.lowSide.mean.toFixed(1)} · K_high
            med {keepawayStats.highSide.median.toFixed(1)} · avg {keepawayStats.highSide.mean.toFixed(1)} · n=
            {keepawayStats.n}
            {kLow != null && kHigh != null
              ? ` · using ${keepawayUseMean ? "avg" : "med"} ${kLow.toFixed(1)}/${kHigh.toFixed(1)}`
              : ""}
          </p>
        </div>
      ) : null}

      {headline?.trim() ? (
        <div
          className="text-center leading-tight"
          data-at-pressure-line
          style={{
            fontSize: 11,
            color: AMBER,
            fontWeight: 600,
            borderTop: `1px solid ${BORDER_ROW}`,
            paddingTop: 6,
          }}
        >
          {headline.trim()}
        </div>
      ) : null}
    </div>
  );
});