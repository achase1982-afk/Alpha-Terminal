import { useState } from "react";
import { ChevronDown, ChevronRight, XCircle } from "lucide-react";
import type { PortfolioOrder } from "./orderTypes";
import {
  ordersChrome as C,
  ordersFont as f,
  fmtCurrency,
  formatOptionSymbol,
  statusColor,
  timeAgo,
} from "./ordersTheme";

export function OrderRow({
  order,
  onCancel,
}: {
  order: PortfolioOrder;
  onCancel?: (orderId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const primaryLeg = order.legs[0];
  const isMultiLeg = order.legs.length > 1;
  const displaySymbol = primaryLeg
    ? primaryLeg.assetType === "OPTION" ||
      primaryLeg.assetType === "INDEX_OPTION" ||
      primaryLeg.assetType === "FUTURE_OPTION"
      ? formatOptionSymbol(primaryLeg.symbol)
      : primaryLeg.symbol
    : "—";
  const isBuy = primaryLeg?.instruction?.includes("BUY");
  const isOpen = order.status === "WORKING" || order.status === "PENDING_ACTIVATION";

  return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: f,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#ffffff04";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, flex: 1, gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: isBuy ? C.green : C.red,
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
            >
              {primaryLeg?.instruction?.replace(/_/g, " ") ?? "—"}
            </span>
            {isMultiLeg && (
              <span style={{ fontSize: 16, color: C.textDim }}>
                +{order.legs.length - 1} leg{order.legs.length > 2 ? "s" : ""}
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: 16,
              color: C.textMuted,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 200,
            }}
          >
            {displaySymbol}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: statusColor(order.status),
              textTransform: "uppercase",
              letterSpacing: 0.3,
            }}
          >
            {order.status}
          </span>
          <span style={{ fontSize: 16, color: C.dim }}>{timeAgo(order.enteredTime)}</span>
        </div>
        {isOpen && onCancel && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCancel(order.orderId);
            }}
            style={{ marginLeft: 2, padding: 2, background: "transparent", border: "none", cursor: "pointer", color: C.red }}
          >
            <XCircle style={{ width: 13, height: 13 }} />
          </button>
        )}
        {expanded ? (
          <ChevronDown style={{ color: C.dim, width: 11, height: 11, flexShrink: 0 }} />
        ) : (
          <ChevronRight style={{ color: C.dim, width: 11, height: 11, flexShrink: 0 }} />
        )}
      </button>

      {expanded && (
        <div style={{ padding: "6px 10px 8px 20px", borderTop: `1px solid ${C.border}`, background: C.bg }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 12px" }}>
            {[
              ["Type", order.orderType.replace(/_/g, " ")],
              ["Price", order.price != null ? fmtCurrency(order.price) : "MKT"],
              ["Filled", `${order.filledQuantity} / ${order.filledQuantity + order.remainingQuantity}`],
              ["Duration", order.duration],
              ["Session", order.session],
              ...(order.complexStrategy !== "NONE" ? [["Strategy", order.complexStrategy.replace(/_/g, " ")]] : []),
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 16, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
                <div style={{ fontSize: 16, color: C.text }}>{value}</div>
              </div>
            ))}
          </div>
          {order.legs.length > 1 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 16, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Legs</div>
              {order.legs.map((leg, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 6, marginBottom: 1 }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: leg.instruction?.includes("BUY") ? C.green : C.red }}>
                    {leg.instruction?.replace(/_/g, " ")}
                  </span>
                  <span style={{ fontSize: 16, color: C.textDim }}>
                    {leg.quantity}×{" "}
                    {leg.assetType === "OPTION" || leg.assetType === "INDEX_OPTION" || leg.assetType === "FUTURE_OPTION"
                      ? formatOptionSymbol(leg.symbol)
                      : leg.symbol}
                  </span>
                </div>
              ))}
            </div>
          )}
          {order.fills.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 16, color: C.dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Fills</div>
              {order.fills.map((fill, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 6, marginBottom: 1 }}>
                  <span style={{ fontSize: 16, color: C.textDim, fontVariantNumeric: "tabular-nums" }}>
                    {fill.quantity}× @ {fmtCurrency(fill.price)}
                  </span>
                  <span style={{ fontSize: 16, color: C.dim }}>{timeAgo(fill.time)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}