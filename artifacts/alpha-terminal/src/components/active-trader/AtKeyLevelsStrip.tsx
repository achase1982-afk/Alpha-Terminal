import { memo, useMemo } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  BG_EXP_BAR, BORDER, DOWN, GAMMA_SCENARIO, GRAY, MONO, UP, WHITE, FW_LIGHT, FW_NORMAL,
} from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { formatGexUsd } from "@/lib/active-trader/zonesModel";
import { resolveGammaFlipDisplay } from "@/lib/active-trader/atGlanceWallDisplay";
import { useFlashOnChange } from "@/hooks/useFlashOnChange";

interface AtKeyLevelsStripProps {
  accentHex: string;
  zones: ZoneModel;
  regimeLabel: string | null;
  regimeDegraded: boolean;
  spot: number | null;
  headerCompact?: boolean;
  onExpandHeader?: () => void;
  onCompactHeader?: () => void;
}

function ptsFromSpot(level: number | null, spot: number | null): string {
  if (level == null || spot == null) return "\u2014";
  const d = Math.round(level - spot);
  if (d === 0) return "ATM";
  return d > 0 ? `+${d} pts` : `${d} pts`;
}

function LevelTile({
  label,
  value,
  sub,
  valueColor,
  tintBg,
  borderColor,
  flash,
}: {
  label: string;
  value: string;
  sub: string;
  valueColor: string;
  tintBg: string;
  borderColor: string;
  flash: boolean;
}) {
  return (
    <div
      className="flex flex-col justify-center min-w-0 flex-1 px-1.5 py-1 rounded"
      style={{
        border: `1px solid ${borderColor}`,
        background: tintBg,
        boxShadow: flash ? `0 0 0 1px ${borderColor}` : undefined,
        transition: "box-shadow 0.35s ease",
      }}
    >
      <span
        className="uppercase tracking-wider truncate"
        style={{ fontSize: 8, color: GRAY, fontWeight: FW_LIGHT, letterSpacing: "0.08em" }}
      >
        {label}
      </span>
      <span
        className="tabular-nums leading-tight truncate"
        style={{ fontSize: 18, fontWeight: 600, color: valueColor }}
      >
        {value}
      </span>
      <span className="tabular-nums truncate" style={{ fontSize: 9, color: GRAY, fontWeight: FW_LIGHT }}>
        {sub}
      </span>
    </div>
  );
}

export const AtKeyLevelsStrip = memo(function AtKeyLevelsStrip({
  accentHex,
  zones,
  regimeLabel,
  regimeDegraded,
  spot,
  headerCompact,
  onExpandHeader,
  onCompactHeader,
}: AtKeyLevelsStripProps) {
  const regimeWord = (regimeLabel ?? "—").split(/\s+/)[0] ?? "—";
  const cw = zones.callWall;
  const pw = zones.putWall;
  const flip = zones.flip;
  const gex = zones.netGexUsdPer1Pct;

  const flashCw = useFlashOnChange(cw);
  const flashPw = useFlashOnChange(pw);
  const flashFlip = useFlashOnChange(flip != null ? Math.round(flip) : null);
  const flashGex = useFlashOnChange(gex != null ? Math.round(gex / 1e6) : null);

  const gexColor = gex == null ? WHITE : gex >= 0 ? UP : DOWN;

  const tiles = useMemo(
    () => [
      {
        key: "cw",
        label: "Call wall",
        value: cw != null ? String(cw) : "—",
        sub: ptsFromSpot(cw, spot),
        valueColor: UP,
        tintBg: `${UP}18`,
        borderColor: `${UP}55`,
        flash: flashCw,
      },
      {
        key: "pw",
        label: "Put wall",
        value: pw != null ? String(pw) : "—",
        sub: ptsFromSpot(pw, spot),
        valueColor: DOWN,
        tintBg: `${DOWN}18`,
        borderColor: `${DOWN}55`,
        flash: flashPw,
      },
      {
        key: "flip",
        label: "Flip",
        value: resolveGammaFlipDisplay(zones),
        sub: ptsFromSpot(flip, spot),
        valueColor: GAMMA_SCENARIO,
        tintBg: `${GAMMA_SCENARIO}16`,
        borderColor: `${GAMMA_SCENARIO}66`,
        flash: flashFlip,
      },
      {
        key: "gex",
        label: "Net GEX",
        value: formatGexUsd(gex),
        sub: zones.env === "damping" ? "Damping" : zones.env === "amplifying" ? "Amplifying" : zones.env === "near_flip" ? "Near flip" : "—",
        valueColor: gexColor,
        tintBg: gex != null && gex >= 0 ? `${UP}12` : `${DOWN}12`,
        borderColor: gex != null && gex >= 0 ? `${accentHex}66` : `${DOWN}44`,
        flash: flashGex,
      },
    ],
    [cw, pw, flip, gex, spot, flashCw, flashPw, flashFlip, flashGex, gexColor, accentHex, zones],
  );

  return (
    <div
      data-at-key-levels
      className="sticky z-[38] px-1.5 py-1.5"
      style={{
        background: `linear-gradient(180deg, ${BG_EXP_BAR}, #080808)`,
        borderBottom: `2px solid ${BORDER}`,
        fontFamily: MONO,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div className="flex gap-1 min-w-0 items-stretch">
        {tiles.map((t) => (
          <LevelTile key={t.key} label={t.label} value={t.value} sub={t.sub} valueColor={t.valueColor} tintBg={t.tintBg} borderColor={t.borderColor} flash={t.flash} />
        ))}
        <div
          className="flex flex-col justify-center items-center shrink-0 px-1.5 py-1 rounded min-w-[52px]"
          style={{ border: `1px solid ${BORDER}`, background: regimeDegraded ? "#111" : `${UP}10` }}
        >
          <span style={{ fontSize: 8, color: GRAY, letterSpacing: "0.08em" }} className="uppercase">
            Regime
          </span>
          <span
            className="w-2 h-2 rounded-full my-0.5"
            style={{ background: regimeDegraded ? GRAY : UP, boxShadow: regimeDegraded ? undefined : `0 0 8px ${UP}` }}
          />
          <span style={{ fontSize: 11, color: WHITE, fontWeight: FW_NORMAL }}>{regimeWord}</span>
          <AtHeaderModeIcons
            headerCompact={headerCompact}
            onExpandHeader={onExpandHeader}
            onCompactHeader={onCompactHeader}
          />
        </div>
      </div>
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
        className="mt-1 p-0.5 rounded border"
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
        className="mt-1 p-0.5 rounded border"
        style={{ borderColor: BORDER, color: GRAY, background: "transparent" }}
        onClick={onCompactHeader}
      >
        <Minimize2 className="w-3 h-3 opacity-70" />
      </button>
    );
  }
  return null;
}