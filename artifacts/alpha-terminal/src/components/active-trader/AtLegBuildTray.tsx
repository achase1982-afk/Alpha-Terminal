import { memo } from "react";
import { X } from "lucide-react";
import type { AtLadderLegPick } from "@/lib/active-trader/atLadderLegKeys";
import { atSignedLegQty } from "@/lib/active-trader/atLadderLegKeys";
import { BORDER, GRAY, MONO, UP, DOWN, WHITE } from "@/components/options/optionsTheme";

interface AtLegBuildTrayProps {
  legs: AtLadderLegPick[];
  qtyByKey: Map<string, number>;
  onRemove: (key: string) => void;
}

export const AtLegBuildTray = memo(function AtLegBuildTray({ legs, qtyByKey, onRemove }: AtLegBuildTrayProps) {
  if (legs.length === 0) return null;
  return (
    <div
      data-at-leg-tray
      className="shrink-0 grid gap-1.5 px-2 py-1.5"
      style={{
        gridTemplateColumns: legs.length > 2 ? "1fr 1fr" : "1fr",
        background: "#0a0a0a",
        borderBottom: `1px solid ${BORDER}`,
        fontFamily: MONO,
      }}
    >
      {legs.map((leg) => {
        const key = `${leg.contract.expiration}|${leg.contract.strike}|${leg.type}`;
        const qty = qtyByKey.get(key) ?? 1;
        const signed = atSignedLegQty(leg.side, qty);
        const tint = leg.side === "ask" ? UP : DOWN;
        return (
          <div
            key={`${key}|${leg.side}`}
            className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-md border"
            style={{ borderColor: `${tint}55`, background: "rgba(255,255,255,0.04)" }}
          >
            <span className="tabular-nums font-semibold" style={{ fontSize: 13, color: WHITE }}>
              {leg.contract.strike}
            </span>
            <span style={{ fontSize: 11, color: GRAY }}>{leg.type === "CALL" ? "C" : "P"}</span>
            <span className="tabular-nums font-bold" style={{ fontSize: 13, color: tint }}>
              {signed}
            </span>
            <button
              type="button"
              aria-label="Remove leg"
              className="p-0.5 rounded"
              style={{ color: GRAY }}
              onClick={() => onRemove(key)}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
});