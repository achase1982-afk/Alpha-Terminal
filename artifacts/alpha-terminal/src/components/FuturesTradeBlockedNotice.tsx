import { memo } from "react";
import { X } from "lucide-react";
import { FUTURES_ORDER_BLOCK_MESSAGE } from "@/lib/futuresSchwabUi";
import { BG, BORDER, DIM, GOLD, MONO, WHITE } from "@/components/options/optionsTheme";

interface FuturesTradeBlockedNoticeProps {
  isOpen: boolean;
  onClose: () => void;
  symbol?: string;
}

export const FuturesTradeBlockedNotice = memo(function FuturesTradeBlockedNotice({
  isOpen,
  onClose,
  symbol,
}: FuturesTradeBlockedNoticeProps) {
  if (!isOpen) return null;

  const label = symbol?.trim() ? symbol.toUpperCase() : "Futures";

  return (
    <div
      className="fixed inset-0 z-[230] flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog"
      aria-label="Futures trading unavailable"
      data-testid="futures-trade-blocked-notice"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md p-4 animate-in slide-in-from-bottom duration-200"
        style={{
          background: BG,
          borderRadius: "20px 20px 0 0",
          border: `1px solid ${BORDER}`,
          borderBottom: "none",
          fontFamily: MONO,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-[10px] tracking-widest uppercase" style={{ color: DIM }}>
              {label}
            </p>
            <h3 className="text-sm mt-1" style={{ color: WHITE }}>
              Trading not available
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center shrink-0"
            style={{ borderRadius: "50%", border: `1px solid ${BORDER}`, background: "transparent", color: DIM }}
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: GOLD }}>
          {FUTURES_ORDER_BLOCK_MESSAGE}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-4"
          style={{
            height: 40,
            borderRadius: 999,
            border: `1px solid ${BORDER}`,
            background: "transparent",
            color: WHITE,
            fontSize: 13,
          }}
        >
          OK
        </button>
      </div>
    </div>
  );
});