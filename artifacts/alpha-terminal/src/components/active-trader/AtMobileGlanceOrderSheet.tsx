import { memo } from "react";
import { Minus, Plus } from "lucide-react";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import { BG, BORDER, DIM, GOLD, MUTED, UP, DOWN, WHITE } from "@/components/options/optionsTheme";

export const AT_MOBILE_PEEK_MAX_PX = 430;

type Props = {
  displaySymbol: string;
  side: "BUY" | "SELL";
  onSideChange: (side: "BUY" | "SELL") => void;
  quantity: number;
  onQuantityChange: (qty: number) => void;
  limitDisplay: string;
  onLimitChange: (raw: string) => void;
  takeProfitEnabled: boolean;
  onTakeProfitEnabled: (on: boolean) => void;
  takeProfitPrice: string | null;
  onReview: () => void;
  reviewDisabled?: boolean;
};

export const AtMobileGlanceOrderSheet = memo(function AtMobileGlanceOrderSheet({
  displaySymbol,
  side,
  onSideChange,
  quantity,
  onQuantityChange,
  limitDisplay,
  onLimitChange,
  takeProfitEnabled,
  onTakeProfitEnabled,
  takeProfitPrice,
  onReview,
  reviewDisabled,
}: Props) {
  const sideColor = side === "BUY" ? UP : DOWN;

  return (
    <div className="flex flex-col gap-2 px-3 pt-1 pb-2" data-at-mobile-peek>
      <div className="flex items-center justify-between gap-2">
        <span style={{ fontSize: 13, color: WHITE, fontWeight: 500 }} className="truncate">
          {displaySymbol}
        </span>
        <div
          className="inline-flex p-0.5 shrink-0"
          style={{ borderRadius: 999, border: `1px solid ${BORDER}`, background: "rgba(0,0,0,0.2)" }}
        >
          {(["BUY", "SELL"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSideChange(s)}
              className="px-3 py-1 transition-colors"
              style={{
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 999,
                color: side === s ? (s === "BUY" ? UP : DOWN) : MUTED,
                background: side === s ? `${sideColor}18` : "transparent",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span style={{ fontSize: 12, color: DIM, width: 56 }}>Qty</span>
        <button
          type="button"
          aria-label="Decrease quantity"
          onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
          className="w-8 h-8 flex items-center justify-center"
          style={{ borderRadius: 8, border: `1px solid ${BORDER}`, color: WHITE }}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span style={{ fontSize: 16, color: WHITE, fontWeight: 600, minWidth: 24, textAlign: "center" }}>
          {quantity}
        </span>
        <button
          type="button"
          aria-label="Increase quantity"
          onClick={() => onQuantityChange(Math.min(999, quantity + 1))}
          className="w-8 h-8 flex items-center justify-center"
          style={{ borderRadius: 8, border: `1px solid ${BORDER}`, color: WHITE }}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span style={{ fontSize: 12, color: DIM, width: 56 }}>Limit</span>
        <input
          inputMode="decimal"
          value={limitDisplay}
          onChange={(e) => onLimitChange(e.target.value)}
          className="flex-1 h-9 px-2 rounded-lg text-white"
          style={{ fontSize: 15, background: "#0c0c0c", border: `1px solid ${BORDER}` }}
        />
      </div>

      <label className="flex items-center justify-between gap-2 py-0.5" style={{ fontSize: 12 }}>
        <span className="flex items-center gap-2" style={{ color: WHITE }}>
          <input
            type="checkbox"
            checked={takeProfitEnabled}
            onChange={(e) => onTakeProfitEnabled(e.target.checked)}
            className="accent-emerald-500"
          />
          Take profit
        </span>
        <span style={{ color: takeProfitEnabled ? UP : MUTED, fontWeight: 500 }}>
          {takeProfitEnabled && takeProfitPrice ? `$${takeProfitPrice}` : "—"}
        </span>
      </label>

      <button
        type="button"
        data-testid="at-mobile-review"
        disabled={reviewDisabled}
        onClick={onReview}
        className="w-full mt-1 tracking-wide disabled:opacity-50 transition-transform active:scale-[0.98]"
        style={{
          height: 44,
          borderRadius: 999,
          border: "none",
          background: `linear-gradient(135deg, ${GOLD}, #c9a227)`,
          color: BG,
          fontSize: 16,
          fontWeight: 600,
        }}
      >
        Review
      </button>
    </div>
  );
});

export type { ActiveTraderTemplatePrefs };