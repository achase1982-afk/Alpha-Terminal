import { memo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Lock, Unlock, Minus, Plus, SquareArrowOutUpRight, X } from "lucide-react";
import type { StrategyLeg } from "@/components/StrategyBuilder";
import { AT_SHEET_PEEK_VH } from "@/lib/active-trader/atSheetLayout";
import type { LimitTickContext } from "@workspace/order-ticket-math";
import {
  DOWN,
  DOWN_TEXT,
  GOLD,
  GRAY,
  MUTED,
  UP,
  WHITE,
} from "@/components/options/optionsTheme";
import {
  AT_ORDER_BTN_DISABLED,
  AT_ORDER_BTN_TEXT_DARK,
  AT_ORDER_PANEL_BG,
  AT_ORDER_PANEL_BORDER,
} from "@/lib/active-trader/atChromeContrast";

const SYS_FONT =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const SHEET_BOTTOM_OFFSET = "calc(94px + max(env(safe-area-inset-bottom, 0px), 12px))";

const PEER_VALUE: CSSProperties = {
  fontSize: 17,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: WHITE,
  lineHeight: 1,
};
const PEER_LABEL: CSSProperties = { fontSize: 11, fontWeight: 500, color: GRAY, lineHeight: 1.15 };
const META_VALUE: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: WHITE,
  lineHeight: 1.15,
};

function fmtMoney(n: number | null | undefined, cents = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

export type EquitySheetDisplayLeg = {
  symbol: string;
  badgeLabel: string;
  isBuy: boolean;
  quantity: number;
  isClosing: boolean;
  quoteSummary?: string | null;
};

export type AtApprovedMobileOrderSheetProps = {
  legs: StrategyLeg[];
  equityLegDisplay?: EquitySheetDisplayLeg | null;
  collapsed: boolean;
  sheetPeek: boolean;
  docked?: boolean;
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
  /** Why Send cannot be used. Shown on the ticket; it does not enable a live route. */
  sendDetail?: string | null;
  /** Strategy-wide spread count or share count. Each leg keeps its own ratio. */
  spreadQuantity?: number;
  onSpreadQuantityChange?: (next: number) => void;
  quantityLabel?: string;
  editableQuantity?: boolean;
  /** In-flight and broker result for the docked ticket. Success that closes the dock uses a toast. */
  sendPhase?: "idle" | "submitting" | "error" | "sent";
  sendError?: string | null;
  orderReceipt?: string | null;
  onDismissSendError?: () => void;
  /** Net credit when true. Debit is a green Buy; credit is a red Sell. */
  isCredit?: boolean;
  /** Reverse every draft leg. The parent keeps strikes, expirations, and quantities. */
  onFlipSides?: () => void;
  onSend: () => void;
  onAdvancedOrders?: () => void;
  primaryActionTestId?: string;
};

/** Cancel and Send share one box so the outlined control matches the filled one. */
const DOCK_ACTION_W = 72;
const DOCK_ACTION_H = 44;
const DOCK_ACTION_BOX: CSSProperties = {
  height: DOCK_ACTION_H,
  width: DOCK_ACTION_W,
  minWidth: DOCK_ACTION_W,
  maxWidth: DOCK_ACTION_W,
  padding: 0,
  boxSizing: "border-box",
  flex: `0 0 ${DOCK_ACTION_W}px`,
};

/** Vertical travel that counts as a swipe on the sheet handle; less than the tap slop is a tap. */
const SHEET_SWIPE_PX = 24;
const SHEET_TAP_SLOP_PX = 8;

/**
 * Grab handle for the Active Trader sheet. The collapsed bar expands on a tap
 * or a swipe up. The expanded full-width overlay only collapses on a deliberate
 * swipe down — a tap on that strip, or anywhere else inside the ticket, leaves
 * it open. A swipe up still expands a collapsed bar.
 */
function SpreadQuantityStepper({
  quantity,
  onChange,
  label = "Spreads",
  editable = false,
}: {
  quantity: number;
  onChange: (next: number) => void;
  label?: string;
  editable?: boolean;
}) {
  const count = Math.max(1, Math.floor(quantity) || 1);
  return (
    <div
      className="flex items-center justify-between"
      style={{ marginTop: 6, height: 28 }}
      data-at-spread-qty
    >
      <span style={PEER_LABEL}>{label}</span>
      <div
        className="inline-flex items-center"
        style={{ border: `1px solid ${AT_ORDER_PANEL_BORDER}`, borderRadius: 6, height: 28 }}
      >
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={count <= 1}
          onClick={() => onChange(count - 1)}
          className="inline-flex items-center justify-center disabled:opacity-40"
          style={{ width: 28, height: 28, background: "transparent", border: "none", padding: 0, color: WHITE }}
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        {editable ? (
          <input
            type="text"
            inputMode="numeric"
            aria-label={label}
            data-at-spread-qty-value
            value={String(count)}
            onChange={(e) => {
              const digits = e.target.value.replace(/[^\d]/g, "");
              if (!digits) {
                onChange(1);
                return;
              }
              onChange(Math.max(1, Math.floor(Number(digits) || 1)));
            }}
            className="tabular-nums bg-transparent outline-none"
            style={{ width: 46, textAlign: "center", fontSize: 13, fontWeight: 650, color: WHITE }}
          />
        ) : (
          <span
            data-at-spread-qty-value
            className="tabular-nums"
            style={{ minWidth: 22, textAlign: "center", fontSize: 13, fontWeight: 650, color: WHITE }}
          >
            {count}
          </span>
        )}
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onChange(count + 1)}
          className="inline-flex items-center justify-center"
          style={{ width: 28, height: 28, background: "transparent", border: "none", padding: 0, color: WHITE }}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function DockSendStatus({
  sendPhase,
  sendError,
  orderReceipt,
  onDismissSendError,
}: {
  sendPhase: "idle" | "submitting" | "error" | "sent";
  sendError?: string | null;
  orderReceipt?: string | null;
  onDismissSendError?: () => void;
}) {
  if (sendPhase === "idle") return null;
  if (sendPhase === "submitting") {
    return (
      <p
        data-at-send-phase="submitting"
        style={{ marginTop: 6, marginBottom: 0, fontSize: 13, lineHeight: 1.35, fontWeight: 650, color: GOLD }}
      >
        Sending…
      </p>
    );
  }
  if (sendPhase === "error") {
    return (
      <div data-at-send-phase="error" style={{ marginTop: 6 }}>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.35,
            fontWeight: 650,
            color: "#ff4d4d",
            maxHeight: 72,
            overflow: "auto",
          }}
        >
          {sendError?.trim() || "Order was not confirmed."}
        </p>
        {onDismissSendError ? (
          <button
            type="button"
            data-at-send-dismiss
            onClick={onDismissSendError}
            className="mt-1 text-[12px] font-semibold"
            style={{ color: WHITE, background: "transparent", border: "none", padding: 0 }}
          >
            Edit order
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <p
      data-at-send-phase="sent"
      style={{ marginTop: 6, marginBottom: 0, fontSize: 13, lineHeight: 1.35, fontWeight: 650, color: UP }}
    >
      {orderReceipt ? `Order sent · #${orderReceipt}` : "Order sent"}
    </p>
  );
}

function SheetHandle({
  collapsed,
  onCollapsedChange,
  children,
  overlay = false,
}: {
  collapsed: boolean;
  onCollapsedChange: (v: boolean) => void;
  children?: ReactNode;
  overlay?: boolean;
}) {
  const startRef = useRef<{ id: number; y: number } | null>(null);
  const expandedOverlay = overlay && !collapsed;
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    startRef.current = { id: e.pointerId, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (!start || start.id !== e.pointerId) return;
    const dy = e.clientY - start.y;
    if (dy > SHEET_SWIPE_PX) onCollapsedChange(true);
    else if (dy < -SHEET_SWIPE_PX) onCollapsedChange(false);
    else if (!expandedOverlay && Math.abs(dy) <= SHEET_TAP_SLOP_PX) onCollapsedChange(!collapsed);
  };
  return (
    <button
      type="button"
      data-at-order-sheet-handle
      aria-label={
        expandedOverlay
          ? "Swipe down to collapse the order ticket"
          : collapsed
            ? "Expand order ticket"
            : "Collapse order ticket"
      }
      aria-expanded={!collapsed}
      className={overlay ? "absolute inset-x-0 top-0 z-[3]" : "w-full flex flex-col items-stretch"}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        height: overlay ? 12 : undefined,
        touchAction: "none",
        WebkitTapHighlightColor: "transparent",
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        startRef.current = null;
      }}
      onClick={(e) => {
        // Keyboard / assistive-tech activation. The expanded overlay is swipe-only.
        if (e.detail === 0 && !expandedOverlay) onCollapsedChange(!collapsed);
      }}
    >
      {!overlay ? (
        <span className="flex items-center justify-center" style={{ height: 14 }} aria-hidden>
          <span style={{ width: 36, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.22)" }} />
        </span>
      ) : null}
      {children}
    </button>
  );
}

export const AtApprovedMobileOrderSheet = memo(function AtApprovedMobileOrderSheet({
  legs,
  equityLegDisplay,
  collapsed,
  sheetPeek,
  docked = false,
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
  sendLabel,
  sendDisabled,
  sendDetail,
  spreadQuantity = 1,
  onSpreadQuantityChange,
  quantityLabel = "Spreads",
  editableQuantity = false,
  sendPhase = "idle",
  sendError,
  orderReceipt,
  onDismissSendError,
  isCredit,
  onFlipSides,
  onSend,
  onAdvancedOrders,
  primaryActionTestId,
}: AtApprovedMobileOrderSheetProps) {
  if (legs.length === 0 && !equityLegDisplay) return null;

  const sendHeld = sendDisabled || sendPhase === "submitting";
  const lowerEntryLabel = entryLabel.toLowerCase();
  const creditOrder = isCredit ?? (lowerEntryLabel.includes("credit") || lowerEntryLabel.includes("proceeds"));
  const entryColor = lowerEntryLabel.includes("credit") || lowerEntryLabel.includes("proceeds") ? UP : DOWN_TEXT;
  const sideTone = creditOrder ? DOWN : UP;
  const sideLabel = creditOrder ? "Sell" : "Buy";
  const netColor =
    estNetUnavailable || estNetAmount == null ? MUTED : estNetAmount >= 0 ? UP : DOWN_TEXT;
  const gridCols = legs.length >= 2 ? 2 : 1;
  const collapsedSummaryLabel = equityLegDisplay
    ? `${equityLegDisplay.symbol} · ${equityLegDisplay.quantity} sh${equityLegDisplay.isClosing ? " (Close)" : ""}`
    : `${legs.length} leg${legs.length === 1 ? "" : "s"}`;

  if (docked) {
    const sheetStyle: CSSProperties = {
      background: AT_ORDER_PANEL_BG,
      borderTop: `1px solid ${AT_ORDER_PANEL_BORDER}`,
      borderRadius: 0,
      boxShadow: "none",
      fontFamily: SYS_FONT,
      boxSizing: "border-box",
    };
    if (collapsed) {
      return (
        <div
          className="w-full flex flex-col"
          style={sheetStyle}
          data-testid="options-chain-order-sheet"
          data-at-approved-ticket
          data-at-docked-order-panel
          data-at-order-sheet-collapsed
          data-at-send-phase={sendPhase}
        >
          <SheetHandle collapsed onCollapsedChange={onCollapsedChange}>
            <span
              className="flex items-center justify-between gap-2"
              style={{ padding: "0 12px 9px", minHeight: 28 }}
              data-at-order-sheet-bar
            >
              <span className="flex items-baseline gap-2 min-w-0">
                <span style={{ ...META_VALUE, fontWeight: 600 }}>
                  {collapsedSummaryLabel}
                </span>
                <span className="truncate" style={PEER_LABEL}>
                  {entryLabel}
                </span>
                <span style={{ ...META_VALUE, color: entryColor }}>{fmtMoney(entryAmount)}</span>
              </span>
              <span
                className="flex items-center gap-1 shrink-0"
                style={{
                  ...PEER_LABEL,
                  color: sendPhase === "error" ? "#ff4d4d" : sendPhase === "sent" ? UP : GRAY,
                }}
              >
                {sendPhase === "submitting"
                  ? "Sending…"
                  : sendPhase === "error"
                    ? sendError?.trim() === "Order was not confirmed." || !sendError?.trim()
                      ? "Order was not confirmed."
                      : "Not sent"
                    : sendPhase === "sent"
                      ? "Order sent"
                      : "Ticket"}
                <ChevronUp className="w-4 h-4" style={{ color: GRAY }} aria-hidden />
              </span>
            </span>
          </SheetHandle>
        </div>
      );
    }
    return (
      <div
        className="w-full flex flex-col"
        style={sheetStyle}
        data-testid="options-chain-order-sheet"
        data-at-approved-ticket
        data-at-docked-order-panel
        data-at-send-phase={sendPhase}
      >
        <SheetHandle collapsed={false} onCollapsedChange={onCollapsedChange} overlay />
        <div className="flex flex-col" style={{ padding: "5px 12px 4px" }}>
        <div className="flex items-start justify-between gap-2">
          <div
            className="grid grid-cols-3 gap-x-2 min-w-0"
            style={{ width: "min(340px, calc(100% - 40px))" }}
            data-at-ticket-summary
          >
            <MotionStat label={entryLabel} value={fmtMoney(entryAmount)} color={entryColor} />
            <MotionStat label="Target exit" value={fmtMoney(targetExitAmount)} color={DOWN_TEXT} />
            <MotionStat
              label="Est. net profit"
              value={estNetUnavailable ? "—" : fmtMoney(estNetAmount)}
              color={netColor}
            />
          </div>
          {onAdvancedOrders ? (
            <button
              type="button"
              data-at-advanced-order-trigger
              aria-label="Advanced orders"
              className="flex h-[33px] w-[33px] shrink-0 items-center justify-center rounded-md p-0"
              style={{ border: `1px solid ${AT_ORDER_PANEL_BORDER}`, color: GRAY, marginRight: 1 }}
              onClick={onAdvancedOrders}
            >
              <SquareArrowOutUpRight className="w-4 h-4" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center" style={{ marginTop: 4, gap: 4 }}>
          {onFlipSides ? (
            <button
              type="button"
              data-at-side-flip
              aria-label={`Reverse ${sideLabel}`}
              onClick={onFlipSides}
              className="shrink-0 rounded-md font-semibold inline-flex items-center justify-center"
              style={{
                height: 30,
                minWidth: 58,
                padding: "0 8px",
                gap: 4,
                fontSize: 12,
                lineHeight: 1,
                background: "transparent",
                color: sideTone,
                border: `1px solid ${sideTone}`,
              }}
            >
              {sideLabel}
              <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>⇄</span>
            </button>
          ) : null}
          <div
            className="gap-1 min-w-0 flex-1"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
            }}
            data-at-ticket-legs
          >
          {equityLegDisplay ? (
            <div
              data-at-equity-leg
              className="flex h-[30px] w-full items-center gap-1.5 rounded-md py-0 pl-2 pr-0.5 min-w-0"
              style={{
                border: `1px solid ${AT_ORDER_PANEL_BORDER}`,
                background: "rgba(255,255,255,0.025)",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: equityLegDisplay.isBuy ? UP : DOWN_TEXT,
                  letterSpacing: "0.02em",
                  flexShrink: 0,
                }}
              >
                {equityLegDisplay.badgeLabel}
              </span>
              <span
                className="tabular-nums truncate"
                style={{ fontSize: 13, fontWeight: 500, color: WHITE }}
              >
                {equityLegDisplay.symbol} · ×{equityLegDisplay.quantity}
                {equityLegDisplay.isClosing ? " · Close" : ""}
              </span>
              {equityLegDisplay.quoteSummary ? (
                <span
                  className="tabular-nums truncate"
                  style={{ fontSize: 11, color: GRAY }}
                >
                  {equityLegDisplay.quoteSummary}
                </span>
              ) : null}
              <button
                type="button"
                className="ml-auto p-0.5 shrink-0"
                aria-label="Clear equity order"
                onClick={onClearAll}
              >
                <X className="w-3 h-3" style={{ color: GRAY }} />
              </button>
            </div>
          ) : null}
          {legs.map((leg) => {
            const isBuy = leg.direction.startsWith("BUY");
            const tone = isBuy ? UP : DOWN_TEXT;
            const type = leg.optionType === "CALL" ? "C" : "P";
            return (
              <div
                key={leg.id}
                className="flex h-[30px] w-full items-center gap-1.5 rounded-md py-0 pl-2 pr-0.5 min-w-0"
                style={{
                  border: `1px solid ${AT_ORDER_PANEL_BORDER}`,
                  background: "rgba(255,255,255,0.025)",
                }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, color: tone, letterSpacing: "0.02em", flexShrink: 0 }}>
                  {isBuy ? "BUY" : "SELL"}
                </span>
                <span
                  className="tabular-nums"
                  style={{ fontSize: 13, fontWeight: 500, color: WHITE, whiteSpace: "nowrap" }}
                >
                  {leg.strike} {type} · ×{leg.quantity}
                </span>
                <button
                  type="button"
                  className="ml-auto p-0.5 shrink-0"
                  aria-label="Remove leg"
                  onClick={() => onRemoveLeg(leg.id)}
                >
                  <X className="w-3 h-3" style={{ color: GRAY }} />
                </button>
              </div>
            );
          })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2" style={{ marginTop: 4, height: 17, lineHeight: 1 }}>
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

        {onSpreadQuantityChange ? (
          <SpreadQuantityStepper
            quantity={spreadQuantity}
            onChange={onSpreadQuantityChange}
            label={quantityLabel}
            editable={editableQuantity}
          />
        ) : null}

        {sendDetail ? (
          <p
            data-at-send-reason
            style={{ marginTop: 6, fontSize: 13, lineHeight: 1.35, fontWeight: 650, color: "#ff4d4d" }}
          >
            {sendDetail}
          </p>
        ) : null}
        <DockSendStatus
          sendPhase={sendPhase}
          sendError={sendError}
          orderReceipt={orderReceipt}
          onDismissSendError={onDismissSendError}
        />

        <div className="flex items-center" style={{ marginTop: 4, gap: 6 }}>
          <button
            type="button"
            data-at-ticket-cancel
            aria-label="Cancel draft"
            onClick={onClearAll}
            className="shrink-0 rounded-md font-medium inline-flex items-center justify-center"
            style={{
              ...DOCK_ACTION_BOX,
              fontSize: 14,
              color: WHITE,
              background: "transparent",
              border: "1px solid #5c6368",
            }}
          >
            Cancel
          </button>

          <div className="flex min-w-0 flex-1 items-center justify-center" style={{ gap: 4 }}>
            <div
              className="relative inline-flex w-[72px] shrink-0 items-center rounded-md px-2"
              style={{
                height: 44,
                border: `1px solid ${AT_ORDER_PANEL_BORDER}`,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <select
                aria-label="Order type"
                value={orderType}
                onChange={(e) => onOrderTypeChange(e.target.value as "LIMIT" | "MARKET")}
                className="w-full appearance-none bg-transparent outline-none pr-3 cursor-pointer"
                style={{ fontSize: 14, fontWeight: 500, color: WHITE }}
              >
                <option value="LIMIT">Limit</option>
                <option value="MARKET">Market</option>
              </select>
              <ChevronDown
                className="w-3.5 h-3.5 pointer-events-none absolute right-1.5"
                style={{ color: GRAY }}
                aria-hidden
              />
            </div>

            {orderType === "MARKET" ? (
              <div
                className="flex shrink-0 items-center justify-center rounded-md px-2"
                style={{
                  height: 44,
                  minWidth: 148,
                  fontSize: 14,
                  border: `1px solid ${AT_ORDER_PANEL_BORDER}`,
                  color: GRAY,
                }}
              >
                Market
              </div>
            ) : (
              <div
                className="flex shrink-0 items-center rounded-md px-1"
                data-at-limit-locked={limitLocked ? "true" : "false"}
                style={{
                  height: 44,
                  minWidth: 148,
                  gap: 2,
                  border: `1px solid ${limitLocked ? `${GOLD}66` : AT_ORDER_PANEL_BORDER}`,
                  background: "rgba(0,0,0,0.35)",
                }}
              >
                <button
                  type="button"
                  aria-label="Decrease limit"
                  className="p-1 shrink-0"
                  onClick={() => !limitLocked && onNudgeLimit("down")}
                >
                  <Minus className="w-3.5 h-3.5" style={{ color: limitLocked ? MUTED : GRAY }} />
                </button>
                <input
                  type="text"
                  inputMode="decimal"
                  value={limitPrice}
                  readOnly={limitLocked}
                  data-testid="chain-sheet-limit"
                  onChange={(e) => !limitLocked && onLimitPriceChange(e.target.value)}
                  className="bg-transparent text-center outline-none tabular-nums"
                  style={{
                    fontSize: 14,
                    flex: "0 0 7ch",
                    width: "7ch",
                    minWidth: "7ch",
                    color: limitLocked ? GOLD : WHITE,
                    fontWeight: 600,
                  }}
                />
                <button
                  type="button"
                  aria-label="Increase limit"
                  className="p-1 shrink-0"
                  onClick={() => !limitLocked && onNudgeLimit("up")}
                >
                  <Plus className="w-3.5 h-3.5" style={{ color: limitLocked ? MUTED : GRAY }} />
                </button>
                <button
                  type="button"
                  aria-label={limitLocked ? "Unlock limit" : "Lock limit"}
                  className="p-1 shrink-0"
                  onClick={() => onLimitLockedChange(!limitLocked)}
                >
                  {limitLocked ? (
                    <Lock className="w-3.5 h-3.5" style={{ color: GOLD }} />
                  ) : (
                    <Unlock className="w-3.5 h-3.5" style={{ color: GOLD }} />
                  )}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={sendHeld}
            title={sendDetail || undefined}
            onClick={onSend}
            data-testid={primaryActionTestId}
            className="shrink-0 rounded-md font-medium disabled:opacity-45 inline-flex items-center justify-center text-center"
            style={{
              ...DOCK_ACTION_BOX,
              fontSize: sendLabel.length > 6 ? 11 : 14,
              lineHeight: 1.1,
              whiteSpace: "normal",
              background: sendHeld ? AT_ORDER_BTN_DISABLED : sideTone,
              color: sendHeld ? GRAY : creditOrder ? WHITE : AT_ORDER_BTN_TEXT_DARK,
            }}
          >
            {sendLabel}
          </button>
        </div>
        </div>
      </div>
    );
  }

  const height = collapsed ? 52 : sheetPeek ? AT_SHEET_PEEK_VH : AT_SHEET_PEEK_VH;
  const legacyGridCols = legs.length > 2 ? 2 : 1;

  return (
    <div
      className="fixed left-0 right-0 z-[110] flex flex-col"
      style={{
        bottom: SHEET_BOTTOM_OFFSET,
        height,
        background: AT_ORDER_PANEL_BG,
        borderTop: `1px solid ${AT_ORDER_PANEL_BORDER}`,
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
              label="Est. net profit"
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
              style={{ border: `1px solid ${AT_ORDER_PANEL_BORDER}`, color: GOLD }}
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
            gridTemplateColumns: `repeat(${legacyGridCols}, minmax(0, 1fr))`,
          }}
          data-at-ticket-legs
        >
          {equityLegDisplay ? (
            <div
              className="flex items-center gap-1 px-2 py-1 rounded-md min-w-0"
              style={{
                border: `1px solid ${(equityLegDisplay.isBuy ? UP : DOWN)}55`,
                background: "rgba(255,255,255,0.04)",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600, color: equityLegDisplay.isBuy ? UP : DOWN }}>
                {equityLegDisplay.badgeLabel} {equityLegDisplay.symbol}
              </span>
              <span style={{ fontSize: 11, color: MUTED }}>
                ×{equityLegDisplay.quantity}
                {equityLegDisplay.isClosing ? " (Close)" : ""}
              </span>
              <button
                type="button"
                className="ml-auto p-0.5"
                aria-label="Clear equity order"
                onClick={onClearAll}
              >
                <X className="w-3 h-3" style={{ color: MUTED }} />
              </button>
            </div>
          ) : null}
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
        style={{
          borderTop: `1px solid ${AT_ORDER_PANEL_BORDER}`,
          paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))",
        }}
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
                border: `1px solid ${limitLocked ? `${GOLD}66` : AT_ORDER_PANEL_BORDER}`,
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
          disabled={sendHeld}
          onClick={onSend}
          data-testid={primaryActionTestId}
          className="w-full py-2.5 rounded-lg font-semibold disabled:opacity-45"
          style={{
            fontSize: 13,
            background: sendHeld ? AT_ORDER_BTN_DISABLED : GOLD,
            color: sendHeld ? GRAY : AT_ORDER_BTN_TEXT_DARK,
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
