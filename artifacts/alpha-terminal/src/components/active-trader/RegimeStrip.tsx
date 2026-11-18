import { memo, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
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
import {
  loadAtKeyLevelsExpanded,
  saveAtKeyLevelsExpanded,
} from "@/lib/active-trader/atKeyLevelsPanelState";

const LABEL_PX = 9;
const VALUE_PX = 15;
const K_PX = 13;
const SPOT_ROW_VALUE_PX = 14;

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

function BoldSpotCell({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="min-w-0">
      <div style={{ fontSize: 9, color: GRAY, fontWeight: 600, letterSpacing: "0.08em" }}>{label}</div>
      <div
        className="tabular-nums leading-tight"
        style={{ fontSize: SPOT_ROW_VALUE_PX, color, fontWeight: 700 }}
      >
        {value}
      </div>
      {sub ? (
        <div className="tabular-nums" style={{ fontSize: K_PX, color: WHITE, fontWeight: 600, marginTop: 1 }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}

export const RegimeStrip = memo(function RegimeStrip({
  regimeLabel: _regimeLabel,
  regimeDegraded: _regimeDegraded,
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
  const [expanded, setExpanded] = useState(() => loadAtKeyLevelsExpanded());
  const [infoOpen, setInfoOpen] = useState(false);
  const session = sessionLabel ?? (isUsEquitiesMarketHoursEt() ? "Cash session" : "Extended");

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

  const spotFmt =
    underlyingPrice != null && Number.isFinite(underlyingPrice)
      ? formatStrikeLevel(underlyingPrice)
      : "\u2014";

  const showKeepaway =
    keepawayStats != null && keepawayPutLine != null && keepawayCallLine != null;

  const toggleExpanded = () => {
    setExpanded((v) => {
      const next = !v;
      saveAtKeyLevelsExpanded(next);
      return next;
    });
  };

  return (
    <div
      data-at-key-levels
      className={embedded ? "px-3 pt-1.5 pb-1" : "sticky z-[38] px-3 pt-1.5 pb-1"}
      style={{
        ...(embedded ? {} : { top: stickyTop }),
        background: BG_EXP_BAR,
        borderBottom: embedded ? undefined : `1px solid ${BORDER_ROW}`,
        fontFamily: MONO,
        overflow: "hidden",
      }}
    >
      <div className="w-full flex items-center justify-between gap-1.5">
        <div
          role="button"
          tabIndex={0}
          className="flex items-center gap-1 min-w-0"
          onClick={toggleExpanded}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleExpanded();
            }
          }}
          aria-expanded={expanded}
        >
          <ChevronDown
            className="w-3.5 h-3.5 shrink-0 transition-transform"
            style={{ color: DIM, transform: expanded ? "rotate(180deg)" : undefined }}
          />
          <span className="truncate" style={{ fontSize: 10, color: GRAY, fontWeight: 500, letterSpacing: "0.06em" }}>
            KEY LEVELS
          </span>
        </div>
        {showKeepaway && onToggleKeepawayMean ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleKeepawayMean();
            }}
            className="shrink-0 rounded-full px-1.5 py-px"
            style={{
              fontSize: 10,
              color: WHITE,
              border: `1px solid ${BORDER_ROW}`,
              background: keepawayUseMean ? "rgba(255,255,255,0.08)" : "transparent",
              fontWeight: 600,
            }}
          >
            {keepawayUseMean ? "K: avg" : "K: med"}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Key level conventions"
          onClick={() => setInfoOpen((v) => !v)}
          className="shrink-0 p-0.5 rounded"
          style={{ color: infoOpen ? WHITE : DIM }}
        >
          <Info className="w-3.5 h-3.5" />
        </button>
        <span className="shrink-0 ml-auto" style={{ fontSize: 10, color: WHITE, fontWeight: 500 }}>
          {session}
        </span>
      </div>

      {infoOpen ? (
        <div className="mt-1 space-y-1 leading-snug" style={{ fontSize: 10, color: GRAY, fontWeight: FW_LIGHT }}>
          <p>Modeled · OI convention · 0DTE. Walls and flip refresh with chain OI/gamma and live ticks.</p>
          {showKeepaway && keepawayStats ? (
            <p className="tabular-nums" style={{ color: WHITE }}>
              Keep-away K: Schwab $SPX daily candles, YTD {keepawayStats.startYmd}–{keepawayStats.endYmd}, n=
              {keepawayStats.n}. K_low med {keepawayStats.lowSide.median.toFixed(1)} · avg{" "}
              {keepawayStats.lowSide.mean.toFixed(1)} · K_high med {keepawayStats.highSide.median.toFixed(1)} · avg{" "}
              {keepawayStats.highSide.mean.toFixed(1)}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div
        className="grid grid-cols-3 gap-x-2 py-1.5 mt-0.5"
        style={{ borderTop: `1px solid ${BORDER_ROW}` }}
      >
        <BoldSpotCell label="SPOT" value={spotFmt} color={WHITE} />
        {showKeepaway ? (
          <>
            <BoldSpotCell
              label="PUT LINE"
              value={formatStrikeLevel(keepawayPutLine!)}
              sub={kLow != null ? `K ${kLow.toFixed(1)}` : undefined}
              color={DOWN}
            />
            <BoldSpotCell
              label="CALL LINE"
              value={formatStrikeLevel(keepawayCallLine!)}
              sub={kHigh != null ? `K ${kHigh.toFixed(1)}` : undefined}
              color={GOLD}
            />
          </>
        ) : (
          <>
            <BoldSpotCell label="PUT WALL" value={pw} color={DOWN} />
            <BoldSpotCell label="CALL WALL" value={cw} color={GOLD} />
          </>
        )}
      </div>

      {expanded ? (
        <div
          className="grid grid-cols-2 gap-x-3 gap-y-2 py-1.5"
          style={{ borderTop: `1px solid ${BORDER_ROW}` }}
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
            color={DOWN}
            flash={flashPw}
          />
          <LevelCell
            label="Flip"
            value={flip}
            dist={null}
            color={GAMMA_SCENARIO}
            flash={flashFlip}
          />
          <button
            type="button"
            className="min-w-0 py-1 text-left"
            style={{ opacity: flashGex ? 0.9 : 1 }}
            onClick={toggleExpanded}
          >
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
          </button>
        </div>
      ) : null}

      {expanded && headline?.trim() ? (
        <div
          className="text-center leading-tight"
          data-at-pressure-line
          style={{
            fontSize: 11,
            color: GOLD,
            fontWeight: 600,
            borderTop: `1px solid ${BORDER_ROW}`,
            paddingTop: 6,
            paddingBottom: 4,
          }}
        >
          {headline.trim()}
        </div>
      ) : null}
    </div>
  );
});