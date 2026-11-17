import { forwardRef, useEffect, useMemo, useState } from "react";
import {
  Dec,
  brokerQuantity,
  cashAmount,
  packageQuotes,
  percentageExitRaw,
  roundExit,
  strategyName,
  type PackageKind,
  type PackageLeg,
  type PriceGrid,
} from "@/lib/activeTraderOrder";
import {
  loadActiveTraderPrefs,
  saveActiveTraderPrefs,
  type ActiveTraderPrefs,
  type ExitTemplate,
} from "@/lib/activeTraderPrefs";

const GOLD = "#FFB800";
const BG = "#070707";
const BORDER = "#1a1a1a";
const UP = "#00d166";
const DOWN = "#f23645";
const MUTED = "#a1a1aa";
const MONO = "'SFMono-Regular', ui-monospace, monospace";

export interface ActiveTraderLegInput {
  key: string;
  right: "CALL" | "PUT";
  /** Chain bid tap is sell-to-open. Ask tap is buy-to-open. */
  side: "bid" | "ask";
  strike: number;
  expiration: string;
  bid?: number;
  ask?: number;
  schwabSymbol?: string;
}

export interface ActiveTraderHandoff {
  underlying: string;
  strategy: string;
  kind: PackageKind;
  limit: string;
  packageQty: number;
  multiplier: string;
  takeProfit: string | null;
  stopLoss: string | null;
  legs: Array<{
    schwabSymbol: string;
    instruction: "BUY_TO_OPEN" | "SELL_TO_OPEN";
    quantity: number;
    optionType: "CALL" | "PUT";
    strike: number;
    expiration: string;
    bid?: number;
    ask?: number;
  }>;
}

function q(n: number | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  return n.toFixed(2);
}

function gridFor(symbol: string, legCount: number): PriceGrid {
  const s = symbol.toUpperCase().replace(/^\$/, "");
  const spx = s === "SPX" || s === "SPXW" || s === "XSP";
  if (!spx) return "penny";
  return legCount > 1 ? "spx-complex" : "spx-single";
}

function toPackage(leg: ActiveTraderLegInput): PackageLeg | null {
  const bid = q(leg.bid);
  const ask = q(leg.ask);
  if (bid == null || ask == null) return null;
  return {
    ratio: 1,
    side: leg.side === "ask" ? 1 : -1,
    bid,
    ask,
    right: leg.right,
    strike: leg.strike.toFixed(2),
    expiration: leg.expiration,
  };
}

interface Props {
  symbol: string;
  legs: ActiveTraderLegInput[];
  limitMessage?: string | null;
  onClear: () => void;
  onRemove: (key: string) => void;
  onHandoff: (handoff: ActiveTraderHandoff) => void;
}

export const ActiveTraderDrawer = forwardRef<HTMLDivElement, Props>(function ActiveTraderDrawer(
  { symbol, legs, limitMessage, onClear, onRemove, onHandoff },
  ref,
) {
  const [prefs, setPrefs] = useState<ActiveTraderPrefs>(() => loadActiveTraderPrefs());
  const [qty, setQty] = useState(1);
  const [pricePick, setPricePick] = useState<"bid" | "mid" | "ask">("ask");
  const [manualLimit, setManualLimit] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    setQty(1);
    setPricePick("ask");
    setManualLimit(null);
  }, [symbol]);

  const updatePrefs = (next: ActiveTraderPrefs) => {
    setPrefs(next);
    saveActiveTraderPrefs(next);
  };

  const model = useMemo(() => {
    const packed = legs.map(toPackage);
    if (packed.some((p) => p == null)) return { error: "Waiting for a two-sided quote" as const };
    const quotes = packageQuotes(packed as PackageLeg[]);
    if ("error" in quotes) return { error: "Quote is missing or crossed" as const };
    const grid = gridFor(symbol, legs.length);
    const picked =
      pricePick === "bid" ? quotes.displayBid : pricePick === "mid" ? quotes.displayMid : quotes.displayAsk;
    const entry = manualLimit != null ? Dec.parse(manualLimit) : picked;
    if (!entry || !entry.isPos()) return { error: "Enter a limit" as const, quotes, grid };
    const kind: PackageKind = quotes.crossesZero ? quotes.kind : quotes.kind;
    const naturalKind = quotes.kind === "ZERO" ? "DEBIT" : quotes.kind;
    const exitKind = naturalKind === "CREDIT" ? "CREDIT" : "DEBIT";
    const tpRaw = prefs.tpEnabled ? percentageExitRaw(entry, exitKind, "tp", Dec.parse(prefs.tpPercent) ?? Dec.must("0")) : null;
    const slRaw = prefs.slEnabled ? percentageExitRaw(entry, exitKind, "sl", Dec.parse(prefs.slPercent) ?? Dec.must("0")) : null;
    const tp = tpRaw && !("error" in tpRaw) ? roundExit(tpRaw.premium, exitKind, "tp", entry, grid) : tpRaw;
    const sl = slRaw && !("error" in slRaw) ? roundExit(slRaw.premium, exitKind, "sl", entry, grid) : slRaw;
    return { quotes, grid, entry, kind, tp, sl, name: strategyName(packed as PackageLeg[]) };
  }, [legs, symbol, pricePick, manualLimit, prefs]);

  const blocked =
    "error" in model ||
    (prefs.tpEnabled && model.tp && "error" in model.tp) ||
    (prefs.slEnabled && model.sl && "error" in model.sl);

  const send = () => {
    if ("error" in model || blocked) return;
    const tp = prefs.tpEnabled && model.tp && !("error" in model.tp) ? model.tp.premium.toFixed(2) : null;
    const sl = prefs.slEnabled && model.sl && !("error" in model.sl) ? model.sl.premium.toFixed(2) : null;
    onHandoff({
      underlying: symbol,
      strategy: model.name,
      kind: model.quotes.kind,
      limit: model.entry.toFixed(2),
      packageQty: qty,
      multiplier: "100",
      takeProfit: tp,
      stopLoss: sl,
      legs: legs.map((leg) => ({
        schwabSymbol: leg.schwabSymbol || "",
        instruction: leg.side === "ask" ? "BUY_TO_OPEN" : "SELL_TO_OPEN",
        quantity: brokerQuantity(qty, 1),
        optionType: leg.right,
        strike: leg.strike,
        expiration: leg.expiration,
        bid: leg.bid,
        ask: leg.ask,
      })),
    });
  };

  const saveTemplate = () => {
    const name = templateName.trim();
    if (!name) return;
    const next: ExitTemplate = {
      name,
      tpEnabled: prefs.tpEnabled,
      slEnabled: prefs.slEnabled,
      tpPercent: prefs.tpPercent,
      slPercent: prefs.slPercent,
    };
    updatePrefs({ ...prefs, templates: [next, ...prefs.templates.filter((t) => t.name !== name)].slice(0, 12) });
    setTemplateName("");
  };

  const quoteLine = "error" in model
    ? null
    : {
        bid: model.quotes.displayBid.toFixed(2),
        mid: model.quotes.displayMid.toFixed(2),
        ask: model.quotes.displayAsk.toFixed(2),
        cash: model.quotes.kind === "ZERO" ? "0.00" : cashAmount(qty, "100", model.entry).toFixed(2),
        kind: model.quotes.kind,
        entry: model.entry.toFixed(2),
        name: model.name,
      };

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Active Trader"
      className="fixed left-0 right-0 z-[100] flex flex-col"
      style={{
        bottom: "var(--alpha-bottom-chrome, env(safe-area-inset-bottom, 0px))",
        maxHeight: "48dvh",
        background: BG,
        borderTop: `1px solid ${GOLD}55`,
        boxShadow: "0 -8px 28px rgba(0,0,0,0.85)",
        fontFamily: MONO,
        padding: "14px 14px 16px",
        gap: 12,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div style={{ color: GOLD, fontSize: 10, letterSpacing: "0.16em" }}>ACTIVE TRADER</div>
          <div style={{ color: "#f4f4f5", fontSize: 14, marginTop: 4 }}>
            {quoteLine ? quoteLine.name : "Select a leg"} · {legs.length} leg{legs.length === 1 ? "" : "s"}
          </div>
        </div>
        <div
          style={{
            color: quoteLine?.kind === "CREDIT" ? UP : GOLD,
            border: `1px solid ${quoteLine?.kind === "CREDIT" ? UP : GOLD}`,
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 11,
          }}
        >
          {quoteLine?.kind ?? "—"}
        </div>
      </div>

      <div className="overflow-y-auto" style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
        {legs.map((leg) => {
          const label = leg.side === "ask" ? "BTO" : "STO";
          const color = leg.side === "ask" ? UP : DOWN;
          return (
            <div key={leg.key} className="flex items-center justify-between gap-2" style={{ fontSize: 12, color: "#e4e4e7" }}>
              <span style={{ color, minWidth: 36 }}>{label}</span>
              <span className="tabular-nums">
                {leg.expiration.slice(0, 10)} {leg.right === "CALL" ? "C" : "P"} {leg.strike}
              </span>
              <button type="button" onClick={() => onRemove(leg.key)} aria-label={`Remove ${leg.strike}`} style={{ color: MUTED, minWidth: 44, minHeight: 44 }}>
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {limitMessage && <div style={{ color: DOWN, fontSize: 12 }}>{limitMessage}</div>}
      {"error" in model && <div style={{ color: DOWN, fontSize: 12 }}>{model.error}</div>}

      {quoteLine && (
        <>
          <div className="flex items-baseline justify-between">
            <span className="tabular-nums" style={{ color: "#fff", fontSize: 28 }}>{quoteLine.entry}</span>
            <span className="tabular-nums" style={{ color: MUTED, fontSize: 13 }}>
              {quoteLine.kind === "CREDIT" ? "credit" : "debit"} ${quoteLine.cash} · {qty} × 100
            </span>
          </div>
          <div className="flex gap-2">
            {(["bid", "mid", "ask"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPricePick(p);
                  setManualLimit(null);
                }}
                style={{
                  flex: 1,
                  minHeight: 44,
                  background: manualLimit == null && pricePick === p ? "#1c1404" : "transparent",
                  color: manualLimit == null && pricePick === p ? GOLD : MUTED,
                  border: `1px solid ${manualLimit == null && pricePick === p ? GOLD : BORDER}`,
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                {p.toUpperCase()} {p === "bid" ? quoteLine.bid : p === "mid" ? quoteLine.mid : quoteLine.ask}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <label style={{ color: MUTED, fontSize: 11 }}>
              LIMIT
              <input
                value={manualLimit ?? quoteLine.entry}
                onChange={(e) => setManualLimit(e.target.value)}
                inputMode="decimal"
                className="tabular-nums"
                style={{ display: "block", marginTop: 4, width: 96, minHeight: 44, background: "#000", color: "#fff", border: `1px solid ${BORDER}`, padding: "0 8px" }}
              />
            </label>
            <label style={{ color: MUTED, fontSize: 11 }}>
              QTY
              <input
                value={String(qty)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1 && n <= 99) setQty(n);
                }}
                inputMode="numeric"
                className="tabular-nums"
                style={{ display: "block", marginTop: 4, width: 64, minHeight: 44, background: "#000", color: "#fff", border: `1px solid ${BORDER}`, padding: "0 8px" }}
              />
            </label>
          </div>
        </>
      )}

      <div className="flex gap-4" style={{ fontSize: 12, color: "#e4e4e7" }}>
        <label className="flex items-center gap-2" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            checked={prefs.tpEnabled}
            onChange={(e) => updatePrefs({ ...prefs, tpEnabled: e.target.checked })}
          />
          TP %
          <input
            value={prefs.tpPercent}
            onChange={(e) => updatePrefs({ ...prefs, tpPercent: e.target.value })}
            className="tabular-nums"
            style={{ width: 52, minHeight: 36, background: "#000", color: "#fff", border: `1px solid ${BORDER}`, padding: "0 6px" }}
          />
        </label>
        <label className="flex items-center gap-2" style={{ minHeight: 44 }}>
          <input
            type="checkbox"
            checked={prefs.slEnabled}
            onChange={(e) => updatePrefs({ ...prefs, slEnabled: e.target.checked })}
          />
          SL %
          <input
            value={prefs.slPercent}
            onChange={(e) => updatePrefs({ ...prefs, slPercent: e.target.value })}
            className="tabular-nums"
            style={{ width: 52, minHeight: 36, background: "#000", color: "#fff", border: `1px solid ${BORDER}`, padding: "0 6px" }}
          />
        </label>
      </div>
      {"tp" in model && prefs.tpEnabled && (
        <div style={{ color: MUTED, fontSize: 11 }}>
          TP {model.tp && "premium" in model.tp ? model.tp.premium.toFixed(2) : "error" in (model.tp ?? {}) ? (model.tp as { error: string }).error : "—"}
          {" · "}
          SL {model.sl && "premium" in model.sl ? model.sl.premium.toFixed(2) : "error" in (model.sl ?? {}) ? (model.sl as { error: string }).error : "—"}
          {" · exits use the submitted limit, not the fill"}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="Template name"
          style={{ flex: 1, minHeight: 44, background: "#000", color: "#fff", border: `1px solid ${BORDER}`, padding: "0 8px", fontSize: 12 }}
        />
        <button type="button" onClick={saveTemplate} style={{ minHeight: 44, minWidth: 72, color: GOLD, border: `1px solid ${BORDER}`, background: "transparent" }}>
          Save
        </button>
        <select
          aria-label="Exit templates"
          defaultValue=""
          onChange={(e) => {
            const found = prefs.templates.find((t) => t.name === e.target.value);
            if (!found) return;
            updatePrefs({ ...prefs, tpEnabled: found.tpEnabled, slEnabled: found.slEnabled, tpPercent: found.tpPercent, slPercent: found.slPercent });
          }}
          style={{ minHeight: 44, background: "#000", color: MUTED, border: `1px solid ${BORDER}` }}
        >
          <option value="">Templates</option>
          {prefs.templates.map((t) => (
            <option key={t.name} value={t.name}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={onClear} style={{ minHeight: 48, minWidth: 88, color: MUTED, background: "transparent", border: `1px solid ${BORDER}` }}>
          CLEAR
        </button>
        <button
          type="button"
          onClick={send}
          disabled={!!blocked}
          style={{
            flex: 1,
            minHeight: 48,
            background: blocked ? "#3f3f46" : GOLD,
            color: "#000",
            fontWeight: 700,
            letterSpacing: "0.08em",
            border: "none",
          }}
        >
          SEND TO SCHWAB
        </button>
      </div>
    </div>
  );
});
