import { useEffect, useRef, useState } from "react";
import { useOrderAlertStore, type OrderAlert } from "@/stores/orderAlertStore";

const GOLD = "#FFB800";
const GREEN = "#00d166";
const RED = "#dc2626";
const BG = "#111113";
const BORDER = "#1f1f23";
const WHITE = "#fafafa";
const MUTED = "#71717a";
const DISMISS_MS = 6000;
const MAX_VISIBLE = 4;

function alertColor(type: string): string {
  switch (type) {
    case "ExecutionCreated":
      return GREEN;
    case "OrderCreated":
    case "OrderAccepted":
      return GOLD;
    case "CancelAccepted":
    case "OrderUROutCompleted":
      return MUTED;
    case "OrderRejected":
    case "CancelRejected":
      return RED;
    default:
      return GOLD;
  }
}

function alertLabel(type: string): string {
  switch (type) {
    case "OrderCreated":
      return "ORDER CREATED";
    case "OrderAccepted":
      return "ORDER ACCEPTED";
    case "ExecutionCreated":
      return "FILL";
    case "CancelAccepted":
      return "CANCELED";
    case "OrderUROutCompleted":
      return "ORDER CLOSED";
    case "OrderRejected":
      return "REJECTED";
    case "CancelRejected":
      return "CANCEL REJECTED";
    case "OrderExpired":
      return "EXPIRED";
    case "OrderModified":
      return "MODIFIED";
    default:
      return type.toUpperCase();
  }
}

interface VisibleAlert extends OrderAlert {
  fadeOut: boolean;
}

export default function OrderAlertWatcher() {
  const [visible, setVisible] = useState<VisibleAlert[]>([]);
  const prevCountRef = useRef(0);

  useEffect(() => {
    const unsub = useOrderAlertStore.subscribe((state) => {
      const count = state.alerts.length;
      if (count > prevCountRef.current && count > 0) {
        const newest = state.alerts[0];
        setVisible((prev) => {
          const next = [{ ...newest, fadeOut: false }, ...prev].slice(0, MAX_VISIBLE);
          return next;
        });

        setTimeout(() => {
          setVisible((prev) =>
            prev.map((a) => (a.id === newest.id ? { ...a, fadeOut: true } : a))
          );
        }, DISMISS_MS - 400);

        setTimeout(() => {
          setVisible((prev) => prev.filter((a) => a.id !== newest.id));
        }, DISMISS_MS);
      }
      prevCountRef.current = count;
    });

    return unsub;
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        right: 12,
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {visible.map((alert) => {
        const color = alertColor(alert.type);
        const label = alertLabel(alert.type);
        const sym = alert.symbol ?? "";
        const side = alert.side ?? "";
        const qty = alert.quantity ?? "";
        const price = alert.price ?? "";

        let detail = "";
        if (side && qty && sym) detail = `${side} ${qty} ${sym}`;
        else if (sym) detail = sym;
        if (price && price !== "[object Object]") detail += ` @ $${price}`;

        return (
          <div
            key={alert.id}
            style={{
              background: BG,
              border: `1px solid ${color}44`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 6,
              padding: "10px 14px",
              minWidth: 260,
              maxWidth: 360,
              boxShadow: `0 4px 24px rgba(0,0,0,0.7), 0 0 0 1px ${BORDER}`,
              opacity: alert.fadeOut ? 0 : 1,
              transform: alert.fadeOut ? "translateX(20px)" : "translateX(0)",
              transition: "opacity 0.4s ease, transform 0.4s ease",
              pointerEvents: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: detail ? 4 : 0,
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.8px",
                  fontFamily: "monospace",
                }}
              >
                {label}
              </span>
              <span
                style={{
                  color: MUTED,
                  fontSize: 10,
                  marginLeft: "auto",
                  fontFamily: "monospace",
                }}
              >
                {new Date(alert.timestamp).toLocaleTimeString()}
              </span>
            </div>
            {detail && (
              <div
                style={{
                  color: WHITE,
                  fontSize: 12,
                  fontFamily: "monospace",
                  paddingLeft: 14,
                }}
              >
                {detail}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
