import { memo, type CSSProperties } from "react";
import { Lock, Unlock, Minus, Plus, SquareArrowOutUpRight, X } from "lucide-react";
import type { StrategyLeg } from "@/components/StrategyBuilder";
import { AT_SHEET_PEEK_VH } from "@/lib/active-trader/atSheetLayout";
import type { LimitTickContext } from "@workspace/order-ticket-math";

const SYS_FONT =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const GOLD = "#fbbf24";
const UP = "#00d166";
const DOWN = "#f23645";
const WHITE = "#f0f0f0";
const GRAY = "#a1a1aa";
const MUTED = "#71717a";
const BORDER = "#2a2a2a";
const SHEET_BOTTOM_OFFSET = "calc(76px + max(env(safe-area-inset-bottom, 0px), 12px))";

const PEER_VALUE: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  fontVariantNumeric: "tabular-nums",
  color: WHITE,
};
const PEER_LABEL: CSSProperties = { fontSize: 11, fontWeight: 500, color: GRAY };
const META_VALUE: CSSProperties = { fontSize: 12, fontWeight: 500, fontVariantNumeric: "tabular-nums", color: WHITE };

function fmtMoney(n: number | null | undefined, cents = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

export type AtApprovedMobileOrderSheetProps = {
  legs: StrategyLeg[];
  collapsed: boolean;
  sheetPeek: boolean;
  onCollapsedChange: (v: boolean) => void;
  onClearAll: () => void;
  onRemoveLeg: (legId: string) => void;
  entryLabel: string;
  entryAmount: number | null;
  targetExitAmount: number | null;
  estNetAmount: number | null;
  estNetUnavailable?: boolean;
  maxLossLabel: string;
  midDisplay: string | null;
  limitPrice: string;
  onLimitPriceChange: (v: string) => void;
  limitLocked: boolean;
  onLimitLockedChange: (locked: boolean) => void;
  onNudgeLimit: (dir: "up" | "down") => void;
  orderType: "LIMIT" | "MARKET";
  onOrderTypeChange: (t: "LIMIT" | "MARKET") => void;
  limitTickCtx: LimitTickContext;
  sendLabel: string;
  sendDisabled: boolean;
  onSend: () => void;
  onAdvancedOrders?: () => void;
  primaryActionTestId?: string;
};

export const AtApprovedMobileOrderSheet = memo(function AtApprovedMobileOrderSheet({
  legs,
  collapsed,
  sheetPeek,
  onCollapsedChange,
  onClearAll,
  onRemoveLeg,
  entryLabel,
  entryAmount,
  targetExitAmount,
  estNetAmount,
  estNetUnavailable,
  maxLossLabel,
  midDisplay,
  limitPrice,
  onLimitPriceChange,
  limitLocked,
  onLimitLockedChange,
  onNudgeLimit,
  orderType,
  onOrderTypeChange,
  limitTickCtx,
  sendLabel,
  sendDisabled,
  onSend,
  onAdvancedOrders,
  primaryActionTestId,
}: AtApprovedMobileOrderSheetProps) {
  if (legs.length === 0) return null;

  const entryColor = entryLabel.toLowerCase().includes("credit") ? UP : DOWN;
  const netColor =
    estNetUnavailable || estNetAmount == null ? MUTED : estNetAmount >= 0 ? UP : DOWN;
  const height = collapsed ? 52 : sheetPeek ? AT_SHEET_PEEK_VH : AT_SHEET_PEEK_VH;
  const gridCols = legs.length > 2 ? 2 : 1;

  return (
    <div
      className="fixed left-0 right-0 z-[110] flex flex-col"
      style={{
        bottom: SHEET_BOTTOM_OFFSET,
        height,
        background: "#0a0a0a",
        borderTop: `1px solid ${BORDER}`,
        fontFamily: SYS_FONT,
        boxShadow: "0 -8px 28px rgba(0,0,0,0.65)",
      }}
      data-testid="options-chain-order-sheet"
      data-at-approved-ticket
    >
      <div className="px-3 pt-2 pb-1 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="grid grid-cols-3 gap-x-2 flex-1 min-w-0" data-at-ticket-summary>
            <MotionStat label={entryLabel} value={fmtMoney(entryAmount)} color={entryColor} />
            <MotionStat label="Target exit" value={fmtMoney(targetExitAmount)} color={DOWN} />
            <MotionStat
              label="Est. net P/L"
              value={estNetUnavailable ? "—" : fmtMoney(estNetAmount)}
              color={netColor}
            />
          </div>
          {onAdvancedOrders ? (
            <button
              type="button"
              data-at-advanced-order-trigger
              aria-label="Advanced orders"
              className="shrink-0 p-1.5 rounded-md"
              style={{ border: `1px solid ${BORDER}`, color: GOLD }}
              onClick={onAdvancedOrders}
            >
              <SquareArrowOutUpRight className="w-4 h-4" />
            </button>
          ) : null}
        </div>

        <div
          className="mt-2 gap-1.5"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          }}
          data-at-ticket-legs
        >
          {legs.map((leg) => {
            const isBuy = leg.direction.startsWith("BUY");
            const tone = isBuy ? UP : DOWN;
            const type = leg.optionType === "CALL" ? "C" : "P";
            return (
              <div
                key={leg.id}
                className="flex items-center gap-1 px-2 py-1 rounded-md min-w-0"
                style={{ border: `1px solid ${tone}55`, background: "rgba(255,255,255,0.04)" }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: tone }}>
                  {isBuy ? "BUY" : "SELL"} {leg.strike} {type}
                </span>
                <span style={{ fontSize: 11, color: MUTED }}>×{leg.quantity}</span>
                <button
                  type="button"
                  className="ml-auto p-0.5"
                  aria-label="Remove leg"
                  onClick={() => onRemoveLeg(leg.id)}
                >
                  <X className="w-3 h-3" style={{ color: MUTED }} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-2 gap-2">
          <div>
            <span style={PEER_LABEL}>Max loss</span>
            <span className="ml-1" style={META_VALUE}>
              {maxLossLabel}
            </span>
          </div>
          <div className="text-right">
            <span style={PEER_LABEL}>Mid</span>
            <span className="ml-1" style={META_VALUE} data-at-ticket-mid>
              {midDisplay ?? "—"}
            </span>
          </div>
        </div>
      </div>

      <div
        className="shrink-0 px-3 py-2 mt-auto"
        style={{ borderTop: `1px solid ${BORDER}`, paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              className="text-left"
              style={{
                fontSize: 11,
                color: orderType === "LIMIT" ? GOLD : GRAY,
                fontWeight: 600,
              }}
              onClick={() => onOrderTypeChange("LIMIT")}
            >
              Limit
            </button>
            {orderType === "LIMIT" ? (
              <button
                type="button"
                style={{ fontSize: 10, color: MUTED }}
                onClick={() => onOrderTypeChange("MARKET")}
              >
                Market
              </button>
            ) : null}
          </div>
          {orderType === "MARKET" ? (
            <div className="flex-1 text-[11px]" style={{ color: MUTED }}>
              Market · no lock · fill not guaranteed
            </div>
          ) : (
            <div
              className="flex-1 flex items-center gap-1 rounded-lg px-2"
              style={{
                border: `1px solid ${limitLocked ? `${GOLD}66` : BORDER}`,
                background: "rgba(0,0,0,0.35)",
                minHeight: 36,
              }}
            >
              <button type="button" aria-label="Decrease limit" onClick={() => !limitLocked && onNudgeLimit("down")}>
                <Minus className="w-4 h-4" style={{ color: limitLocked ? MUTED : GRAY }} />
              </button>
              <input
                type="text"
                inputMode="decimal"
                value={limitPrice}
                readOnly={limitLocked}
                data-testid="chain-sheet-limit"
                data-at-limit-locked={limitLocked ? "true" : "false"}
                onChange={(e) => !limitLocked && onLimitPriceChange(e.target.value)}
                className="flex-1 text-center bg-transparent outline-none tabular-nums"
                style={{ fontSize: 14, color: limitLocked ? GOLD : WHITE, fontWeight: 500 }}
              />
              <button type="button" aria-label="Increase limit" onClick={() => !limitLocked && onNudgeLimit("up")}>
                <Plus className="w-4 h-4" style={{ color: limitLocked ? MUTED : GRAY }} />
              </button>
              <button
                type="button"
                aria-label={limitLocked ? "Unlock limit" : "Lock limit"}
                onClick={() => onLimitLockedChange(!limitLocked)}
              >
                {limitLocked ? (
                  <Lock className="w-4 h-4" style={{ color: GOLD }} />
                ) : (
                  <Unlock className="w-4 h-4" style={{ color: MUTED }} />
                )}
              </button>
            </div>
          )}
        </div>

        {orderType === "MARKET" ? (
          <button
            type="button"
            style={{ fontSize: 10, color: GRAY, marginBottom: 6 }}
            onClick={() => onOrderTypeChange("LIMIT")}
          >
            Limit
          </button>
        ) : null}

        <button
          type="button"
          disabled={sendDisabled}
          onClick={onSend}
          data-testid={primaryActionTestId}
          className="w-full py-2.5 rounded-lg font-semibold disabled:opacity-45"
          style={{
            fontSize: 13,
            background: sendDisabled ? "#3f3f46" : GOLD,
            color: sendDisabled ? GRAY : "#0a0a0a",
          }}
        >
          {sendLabel}
        </button>
        <button type="button" className="w-full mt-1 text-[10px]" style={{ color: MUTED }} onClick={onClearAll}>
          Clear legs
        </button>
      </div>
    </div>
  );
});

function MotionStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="min-w-0">
      <div style={PEER_LABEL}>{label}</div>
      <div className="truncate" style={{ ...PEER_VALUE, color }}>
        {value}
      </div>
    </div>
  );
}