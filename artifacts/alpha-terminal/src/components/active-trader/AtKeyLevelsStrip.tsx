import { memo } from "react";
import {
  BG_EXP_BAR, BORDER, DIM, DOWN, GAMMA_SCENARIO, GRAY, MONO, UP, WHITE, FW_LIGHT, FW_NORMAL,
} from "@/components/options/optionsTheme";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { formatGexUsd } from "@/lib/active-trader/zonesModel";

interface AtKeyLevelsStripProps {
  accentHex: string;
  zones: ZoneModel;
  regimeLabel: string | null;
  regimeDegraded: boolean;
}

export const AtKeyLevelsStrip = memo(function AtKeyLevelsStrip({
  accentHex,
  zones,
  regimeLabel,
  regimeDegraded,
}: AtKeyLevelsStripProps) {
  const regimeWord = (regimeLabel ?? "—").split(/\s+/)[0] ?? "—";
  const env =
    zones.env === "damping" ? "Damp" : zones.env === "amplifying" ? "Amp" : zones.env === "near_flip" ? "Near flip" : "";
  return (
    <div
      data-at-key-levels
      className="sticky z-[38] px-2 py-1.5"
      style={{
        background: BG_EXP_BAR,
        borderBottom: `1px solid ${BORDER}`,
        fontFamily: MONO,
        fontSize: 10,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5" style={{ lineHeight: 1.3 }}>
        <span style={{ color: DIM, letterSpacing: "0.06em" }}>
          CW <span style={{ color: accentHex, fontWeight: FW_NORMAL }}>{zones.callWall ?? "—"}</span>
        </span>
        <span style={{ color: DIM, letterSpacing: "0.06em" }}>
          PW <span style={{ color: DOWN, fontWeight: FW_NORMAL }}>{zones.putWall ?? "—"}</span>
        </span>
        <span style={{ color: DIM, letterSpacing: "0.06em" }}>
          Flip <span style={{ color: GAMMA_SCENARIO, fontWeight: FW_NORMAL }}>{zones.flip != null ? zones.flip.toFixed(0) : "—"}</span>
        </span>
        <span style={{ color: DIM, letterSpacing: "0.06em" }}>
          GEX <span style={{ color: WHITE, fontWeight: FW_NORMAL }}>{formatGexUsd(zones.netGexUsdPer1Pct)}</span>
          {env && <span style={{ color: GAMMA_SCENARIO, marginLeft: 4 }}>· {env}</span>}
        </span>
        <span className="ml-auto flex items-center gap-1 shrink-0" style={{ fontSize: 10 }}>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: regimeDegraded ? GRAY : UP }}
          />
          <span style={{ color: regimeDegraded ? GRAY : WHITE, fontWeight: FW_LIGHT }}>{regimeWord}</span>
        </span>
      </div>
    </div>
  );
});