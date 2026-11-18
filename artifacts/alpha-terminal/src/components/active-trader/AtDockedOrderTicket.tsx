import { memo } from "react";
import { Lock, LockOpen, Minus, Plus, SquareArrowOutUpRight, X } from "lucide-react";
import type { StrategyLeg } from "@/components/StrategyBuilder";
import { BORDER, DIM, DOWN, GOLD, GRAY, MUTED, UP, WHITE } from "@/components/options/optionsTheme";

const SYS_FONT =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export type AtDockedOrderType = "LIMIT" | "MARKET";

export interface AtDockedOrderTicketProps {
  legs: StrategyLeg[];
  isCredit: boolean;
  spreadMid: number | null;
  entryGross: number | null;
  targetExit: number | null;
  estNet: number | null;
  estNetUnavailable?: boolean;
  maxLossLabel: string;
  limitPrice: string;
  limitLocked: boolean;
  orderType: AtDockedOrderType;
  onOrderTypeChange: (t: AtDockedOrderType) => void;
  onLimitChange: (raw: string) => void;
  onLimitLockToggle: () => void;
  onNudgeLimit: (dir: "up" | "down") => void;
  onRemoveLeg: (legId: string) => void;
  onReview: () => void;
  onExpandSheet: () => void;
  onAdvancedOrders: () => void;
  reviewDisabled?: boolean;
  sendPreviewOnly?: boolean;
}

export const AT_DOCKED_TICKET_BOTTOM = "calc(76px + max(env(safe-area-inset-bottom, 0px), 12px))";

export const AtDockedOrderTicket = memo(function AtDockedOrderTicket({
  legs,
  isCredit,
  spreadMid,
  entryGross,
  targetExit,
  estNet,
  estNetUnavailable,
  maxLossLabel,
  limitPrice,
  limitLocked,
  orderType,
  onOrderTypeChange,
  onLimitChange,
  onLimitLockToggle,
  onNudgeLimit,
  onRemoveLeg,
  onReview,
  onExpandSheet,
  onAdvancedOrders,
  reviewDisabled,
  sendPreviewOnly,
}: AtDockedOrderTicketProps) {
  const entryLabel = isCredit ? "Entry credit" : "Entry debit";
  const entryColor = isCredit ? UP : DOWN;
  const netPositive = estNet != null && estNet >= 0;
  const twoLegRows = legs.length > 2;
  const canReview = !reviewDisabled && (orderType === "MARKET" || limitLocked);

  return (
    <div
      data-testid="at-docked-order-ticket"
      className="fixed left-0 right-0 z-[109] flex flex-col"
      style={{
        bottom: AT_DOCKED_TICKET_BOTTOM,
        background: "linear-gradient(180deg, #12151a 0%, #0a0a0a 100%)",
        borderTop: `1px solid ${GOLD}55`,
        boxShadow: "0 -8px 28px rgba(0,0,0,0.85)",
        fontFamily: SYS_FONT,
      }}
    >
      <div className="px-3 pt-2 pb-1 flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 min-w-0 flex-1">
          <div>
            <div style={{ fontSize: 10, color: GRAY, letterSpacing: "0.04em" }}>{entryLabel}</div>
            <div className="tabular-nums font-semibold" style={{ fontSize: 15, color: entryColor }}>
              {fmtMoney(entryGross)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: GRAY }}>Target exit</div>
            <div className="tabular-nums font-semibold" style={{ fontSize: 15, color: DOWN }}>
              {targetExit != null ? fmtMoney(targetExit) : "—"}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: GRAY }}>Est. net profit</div>
            <div
              className="tabular-nums font-semibold"
              style={{
                fontSize: 15,
                color: estNetUnavailable ? MUTED : netPositive ? UP : DOWN,
              }}
            >
              {estNetUnavailable ? "Unavailable" : fmtMoney(estNet)}
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label="Advanced orders"
          title="Advanced orders"
          className="shrink-0 p-2 rounded-lg"
          style={{ border: `1px solid ${BORDER}`, color: GOLD, background: "#111" }}
          onClick={() => {
            onAdvancedOrders();
            onExpandSheet();
          }}
          data-testid="at-docked-advanced-orders"
        >
          <SquareArrowOutUpRight className="w-4 h-4" />
        </button>
      </div>

      <div
        className={`px-3 pb-1 flex flex-wrap gap-1.5 ${twoLegRows ? "max-h-[72px]" : "max-h-[40px]"}`}
        style={{ overflowY: twoLegRows ? "auto" : "hidden" }}
      >
        {legs.map((leg) => (
          <DockedLegPill key={leg.id} leg={leg} onRemove={onRemoveLeg} />
        ))}
      </div>

      <div
        className="px-3 py-1.5 flex items-center justify-between gap-2 border-t"
        style={{ borderColor: BORDER, fontSize: 11, color: DIM }}
      >
        <span data-testid="at-docked-max-loss">Max loss: {maxLossLabel}</span>
        <span className="tabular-nums" style={{ color: WHITE }}>
          Mid {fmtPx(spreadMid)}
        </span>
      </div>

      <div className="px-3 pb-2 flex items-center gap-2">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            className="px-2 py-1 rounded-md text-left"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: WHITE,
              background: "#161616",
              border: `1px solid ${BORDER}`,
            }}
            onClick={() => onOrderTypeChange(orderType === "LIMIT" ? "MARKET" : "LIMIT")}
            data-testid="at-docked-order-type"
          >
            {orderType}
          </button>
        </div>

        {orderType === "LIMIT" ? (
          <div
            className="flex-1 flex items-center gap-1 px-2 py-1 rounded-lg"
            style={{ border: `1px solid ${BORDER}`, background: "#111" }}
          >
            <button type="button" onClick={() => onNudgeLimit("down")} aria-label="Decrease limit">
              <Minus className="w-3.5 h-3.5" style={{ color: GRAY }} />
            </button>
            <input
              type="text"
              inputMode="decimal"
              value={limitPrice}
              onChange={(e) => onLimitChange(e.target.value)}
              className="flex-1 text-center bg-transparent outline-none tabular-nums"
              style={{ fontSize: 14, color: WHITE, fontWeight: 600 }}
              data-testid="at-docked-limit"
            />
            <button type="button" onClick={() => onNudgeLimit("up")} aria-label="Increase limit">
              <Plus className="w-3.5 h-3.5" style={{ color: GRAY }} />
            </button>
            <button
              type="button"
              aria-label={limitLocked ? "Unlock limit" : "Lock limit"}
              onClick={onLimitLockToggle}
              className="p-1 rounded"
              style={{ color: limitLocked ? GOLD : MUTED }}
              data-testid="at-docked-limit-lock"
            >
              {limitLocked ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
            </button>
          </div>
        ) : (
          <div className="flex-1 text-center py-1.5" style={{ fontSize: 12, color: MUTED }}>
            Market — no locked limit
          </div>
        )}

        <button
          type="button"
          disabled={orderType === "LIMIT" && !limitLocked ? !limitPrice.trim() : !canReview}
          onClick={() => {
            if (orderType === "LIMIT" && !limitLocked) {
              onLimitLockToggle();
              return;
            }
            onExpandSheet();
            onReview();
          }}
          className="shrink-0 px-4 py-2 rounded-full font-bold disabled:opacity-45"
          style={{
            fontSize: 12,
            background:
              orderType === "LIMIT" && !limitLocked
                ? "#2a2a2a"
                : canReview
                  ? GOLD
                  : "#2a2a2a",
            color:
              orderType === "LIMIT" && !limitLocked
                ? WHITE
                : canReview
                  ? "#0a0a0a"
                  : MUTED,
            whiteSpace: "nowrap",
          }}
          data-testid="at-docked-review"
        >
          {orderType === "LIMIT" && !limitLocked
            ? "Lock limit to send"
            : sendPreviewOnly
              ? "Review"
              : "Send to Schwab"}
        </button>
      </div>
    </div>
  );
});

function DockedLegPill({ leg, onRemove }: { leg: StrategyLeg; onRemove: (id: string) => void }) {
  const isSell = leg.direction.startsWith("SELL");
  const tint = isSell ? DOWN : UP;
  const cp = leg.optionType === "CALL" ? "C" : "P";
  return (
    <div
      className="flex items-center gap-1.5 shrink-0 px-2 py-1 rounded-full border"
      style={{
        borderColor: `${tint}66`,
        background: `${tint}14`,
        maxWidth: "48%",
      }}
      data-testid="at-docked-leg-pill"
    >
      <span className="tabular-nums font-bold" style={{ fontSize: 13, color: tint }}>
        {isSell ? "SELL" : "BUY"} {leg.strike} {cp}
      </span>
      <span className="tabular-nums" style={{ fontSize: 12, color: WHITE }}>
        · ×{leg.quantity}
      </span>
      <button
        type="button"
        aria-label={`Remove ${leg.strike} ${cp}`}
        onClick={() => onRemove(leg.id)}
        className="p-0.5 rounded"
        style={{ color: MUTED }}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}