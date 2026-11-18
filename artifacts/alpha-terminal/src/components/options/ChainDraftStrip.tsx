import { memo } from "react";
import { Minus, Plus, X } from "lucide-react";
import { MOBILE_BOTTOM_NAV_RESERVE_PX } from "@/hooks/useVisualViewportKeyboardInset";
import { BORDER, GOLD, GRAY, MONO, UP, DOWN, WHITE } from "@/components/options/optionsTheme";
import { CHAIN_LEG_LIMIT_MESSAGE } from "@/lib/orders/chainDraftLegLimits";

export const CHAIN_DRAFT_STRIP_HEIGHT_PX = 96;

export type ChainDraftStripLeg = {
  key: string;
  strike: number;
  type: "CALL" | "PUT";
  side: "bid" | "ask";
  quantity: number;
};

interface ChainDraftStripProps {
  legs: ChainDraftStripLeg[];
  limitRejected: boolean;
  onQtyChange: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onNext: () => void;
}

export const ChainDraftStrip = memo(function ChainDraftStrip({
  legs,
  limitRejected,
  onQtyChange,
  onRemove,
  onNext,
}: ChainDraftStripProps) {
  if (legs.length === 0) return null;
  return (
    <div
      data-chain-draft-strip
      className={`fixed left-0 right-0 z-[90] flex flex-col border-t ${limitRejected ? "animate-[shake_0.35s_ease-in-out]" : ""}`}
      style={{
        bottom: MOBILE_BOTTOM_NAV_RESERVE_PX,
        height: CHAIN_DRAFT_STRIP_HEIGHT_PX,
        background: "#000000",
        borderColor: limitRejected ? DOWN : BORDER,
        fontFamily: MONO,
        boxShadow: limitRejected ? `0 0 12px ${DOWN}55` : "0 -4px 24px rgba(0,0,0,0.85)",
      }}
    >
      {limitRejected ? (
        <p
          data-chain-leg-limit-msg
          className="shrink-0 px-3 pt-1.5 text-center"
          style={{ fontSize: 11, color: DOWN, fontWeight: 600 }}
        >
          {CHAIN_LEG_LIMIT_MESSAGE}
        </p>
      ) : null}
      <div className="flex items-stretch gap-2 px-2 py-1.5 min-h-0 flex-1">
        <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto items-center">
          {legs.map((leg) => {
            const buySell = leg.side === "ask" ? "Buy" : "Sell";
            const tint = leg.side === "ask" ? UP : DOWN;
            return (
              <div
                key={`${leg.key}|${leg.side}`}
                data-chain-draft-leg
                className="flex items-center gap-1 shrink-0 px-2 py-1 rounded-md border"
                style={{
                  borderColor: `${GOLD}66`,
                  background: "rgba(251,191,36,0.06)",
                }}
              >
                <span className="tabular-nums font-bold" style={{ fontSize: 14, color: GOLD }}>
                  {leg.strike}
                </span>
                <span style={{ fontSize: 11, color: WHITE, fontWeight: 600 }}>
                  {leg.type === "CALL" ? "C" : "P"}
                </span>
                <span style={{ fontSize: 10, color: tint, fontWeight: 600 }}>{buySell}</span>
                <span className="inline-flex items-center rounded border" style={{ borderColor: BORDER }}>
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    className="px-1 py-0.5"
                    onClick={() => onQtyChange(leg.key, Math.max(1, leg.quantity - 1))}
                  >
                    <Minus className="w-3 h-3" style={{ color: GRAY }} />
                  </button>
                  <span className="tabular-nums px-1" style={{ fontSize: 12, color: WHITE, minWidth: 16, textAlign: "center" }}>
                    {leg.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    className="px-1 py-0.5"
                    onClick={() => onQtyChange(leg.key, Math.min(999, leg.quantity + 1))}
                  >
                    <Plus className="w-3 h-3" style={{ color: GRAY }} />
                  </button>
                </span>
                <button
                  type="button"
                  aria-label="Remove leg"
                  className="p-0.5 rounded"
                  style={{ color: GRAY }}
                  onClick={() => onRemove(leg.key)}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          data-chain-draft-next
          data-testid="chain-draft-next"
          onClick={onNext}
          className="shrink-0 px-4 py-2 rounded-lg font-bold tracking-wide"
          style={{ fontSize: 13, background: GOLD, color: "#000" }}
        >
          Next
        </button>
      </div>
    </div>
  );
});