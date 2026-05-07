/**
 * Shared desk card primitives (Solo / Conviction) to avoid circular imports between
 * StrategistDeskCard and StrategistConvictionDeskCard.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { DeskStructure, PayoffScenario, PayoffScenariosSummary } from "@/lib/strategistDeskResult";

export const DESK_PAL = {
  bgCard: "#141414",
  bgInner: "#0a0a0a",
  border: "#2a2a2a",
  borderInner: "#1f1f1f",
  label: "#a3a3a3",
  body: "#e5e5e5",
  white: "#ffffff",
  green: "#4ade80",
  red: "#f87171",
  gold: "#fbbf24",
  goldHeader: "#f59e0b",
};

export const DESK_SYS_FONT = "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif";

export const DESK_FOCUS_RING = "2px solid rgba(255,255,255,0.85)";
export const DESK_TOUCH_MIN = 44;

export function fmtDeskCurrencyPlain(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDeskSignedUsd(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+$${abs}`;
  if (n < 0) return `-$${abs}`;
  return `$${abs}`;
}

export function DeskCardFieldRow({ label, value, valueSizePx = 11 }: { label: string; value: string; valueSizePx?: number }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
      <span style={{ fontFamily: DESK_SYS_FONT, fontSize: 11, color: DESK_PAL.label, minWidth: 120, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: DESK_SYS_FONT, fontSize: valueSizePx, color: DESK_PAL.body, lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

export function DeskCardCollapsibleSection({
  title,
  defaultOpen,
  headerAddon,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  headerAddon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div
      style={{
        border: `1px solid ${DESK_PAL.borderInner}`,
        borderRadius: 8,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          background: DESK_PAL.bgInner,
          border: "none",
          cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", textAlign: "left" }}>
          <span style={{ fontFamily: DESK_SYS_FONT, fontSize: 12, fontWeight: 600, color: DESK_PAL.white, letterSpacing: 0.5 }}>{title}</span>
          {headerAddon}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {open ? <ChevronUp size={14} color={DESK_PAL.label} /> : <ChevronDown size={14} color={DESK_PAL.label} />}
        </div>
      </button>
      {open && <div style={{ padding: 12, background: DESK_PAL.bgCard }}>{children}</div>}
    </div>
  );
}

export function DeskCardStructureDisplay({ structure }: { structure: DeskStructure }) {
  return (
    <div style={{ background: DESK_PAL.bgInner, border: `1px solid ${DESK_PAL.borderInner}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
      <div style={{ fontFamily: DESK_SYS_FONT, fontSize: 12, fontWeight: 600, color: DESK_PAL.goldHeader, marginBottom: 6, textTransform: "uppercase" }}>
        {structure.type.replace(/_/g, " ")}
      </div>
      <div style={{ fontFamily: DESK_SYS_FONT, fontSize: 11, color: DESK_PAL.label, marginBottom: 4 }}>
        Expiry: {structure.expiry} &middot; {structure.credit_or_debit < 0 ? "Credit" : "Debit"}: ${Math.abs(structure.credit_or_debit).toFixed(2)}
      </div>
      {structure.legs.map((leg, i) => (
        <div key={i} style={{ fontFamily: DESK_SYS_FONT, fontSize: 11, color: DESK_PAL.body, padding: "2px 0" }}>
          {leg.action.toUpperCase()} {leg.type.toUpperCase()} {leg.strike} ({leg.expiration})
          {leg.quantity && leg.quantity > 1 ? ` x${leg.quantity}` : ""}
        </div>
      ))}
    </div>
  );
}

export function DeskCardPayoffAtExpirationSection({
  scenarios,
  summary,
}: {
  scenarios: PayoffScenario[];
  summary: PayoffScenariosSummary;
}) {
  const profitZone =
    summary.profitZoneLow != null && summary.profitZoneHigh != null
      ? `${fmtDeskCurrencyPlain(summary.profitZoneLow)} — ${fmtDeskCurrencyPlain(summary.profitZoneHigh)}`
      : null;

  let breakdownLine: string | null = null;
  const down = summary.downsideBreakdown;
  const up = summary.upsideBreakdown;
  if (down != null && up != null) {
    breakdownLine = `below ${fmtDeskCurrencyPlain(down)} or above ${fmtDeskCurrencyPlain(up)}`;
  } else if (down != null) {
    breakdownLine = `below ${fmtDeskCurrencyPlain(down)}`;
  } else if (up != null) {
    breakdownLine = `above ${fmtDeskCurrencyPlain(up)}`;
  }

  const pnlColor = (c: PayoffScenario["pnlColor"]) =>
    c === "green" ? DESK_PAL.green : c === "red" ? DESK_PAL.red : DESK_PAL.label;

  const midIdx = Math.floor(scenarios.length / 2);
  const spotRef = scenarios[midIdx]?.underlyingPrice ?? scenarios[0]?.underlyingPrice ?? 0;
  const pctVsSpot = (price: number) => (spotRef > 0 ? (price / spotRef - 1) * 100 : 0);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: DESK_PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
        Payoff at expiration
      </div>
      <div style={{ fontSize: 11, color: DESK_PAL.body, lineHeight: 1.6, marginBottom: 10 }}>
        <div>
          Peak: {fmtDeskSignedUsd(summary.peakPnl)} at {fmtDeskCurrencyPlain(summary.peakPnlPrice)}
        </div>
        {profitZone && (
          <div style={{ marginTop: 4 }}>
            Profit zone: {profitZone}
          </div>
        )}
        {breakdownLine && (
          <div style={{ marginTop: 4 }}>
            Breakdown: {breakdownLine}
          </div>
        )}
      </div>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", marginLeft: -2, marginRight: -2 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: "100%", fontFamily: DESK_SYS_FONT }}>
          <tbody>
            <tr>
              <td style={{ padding: "6px 10px 6px 4px", color: DESK_PAL.label, whiteSpace: "nowrap", verticalAlign: "bottom" }}>Stock move</td>
              {scenarios.map((s, i) => {
                const p = pctVsSpot(s.underlyingPrice);
                return (
                  <td key={i} style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
                    <div style={{ fontSize: 10, color: DESK_PAL.label }}>{p >= 0 ? "+" : ""}{p.toFixed(1)}%</div>
                    <div style={{ color: DESK_PAL.white, fontWeight: 600 }}>{fmtDeskCurrencyPlain(s.underlyingPrice)}</div>
                  </td>
                );
              })}
            </tr>
            <tr style={{ borderTop: `1px solid ${DESK_PAL.borderInner}` }}>
              <td style={{ padding: "6px 10px 6px 4px", color: DESK_PAL.label, whiteSpace: "nowrap" }}>Spread Value</td>
              {scenarios.map((s, i) => (
                <td key={i} style={{ padding: "6px 8px", textAlign: "right", color: DESK_PAL.body, whiteSpace: "nowrap" }}>
                  {fmtDeskCurrencyPlain(s.spreadValue)}
                </td>
              ))}
            </tr>
            <tr style={{ borderTop: `1px solid ${DESK_PAL.borderInner}` }}>
              <td style={{ padding: "6px 10px 6px 4px", color: DESK_PAL.label, whiteSpace: "nowrap" }}>P/L</td>
              {scenarios.map((s, i) => (
                <td
                  key={i}
                  style={{
                    padding: "6px 8px",
                    textAlign: "right",
                    fontWeight: 700,
                    color: pnlColor(s.pnlColor),
                    whiteSpace: "nowrap",
                  }}
                >
                  {fmtDeskSignedUsd(s.pnl)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
