import { memo, useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import {
  applyOrderDefaults,
  type ActiveTraderTemplatePrefs,
  type AtAccountKind,
  type AtAdvancedRoute,
  type AtEntryDuration,
  type AtOrderSession,
  type AtRouting,
  type AtSchwabEntryType,
  type AtStopLossOrderType,
  type BracketOffsetMode,
} from "@/lib/active-trader/activeTraderPrefs";
import { isLongEntry } from "@/lib/active-trader/atBracketMath";
import {
  closingInstructionForOpen,
  humanInstruction,
  type SchwabInstruction,
} from "@/lib/active-trader/atSchwabOrderBuilder";

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const BG = "#1a1a1c";
const TEXT = "#f5f5f7";
const MUTED = "#8e8e93";
const LINE = "rgba(255,255,255,0.10)";
const GOLD = "#f5b400";
const FIELD = "#2c2c2e";

const ENTRY_OPTIONS: { value: AtSchwabEntryType; label: string }[] = [
  { value: "LIMIT", label: "Limit" },
  { value: "MARKET", label: "Market" },
  { value: "STOP", label: "Stop" },
  { value: "STOP_LIMIT", label: "Stop limit" },
  { value: "TRAILING_STOP", label: "Trailing stop" },
  { value: "TRAILING_STOP_LIMIT", label: "Trailing stop limit" },
];

const TIF_OPTIONS: { value: AtEntryDuration; label: string }[] = [
  { value: "DAY", label: "Day" },
  { value: "GOOD_TILL_CANCEL", label: "GTC" },
  { value: "FILL_OR_KILL", label: "FOK" },
];

const UNIT_OPTIONS: { value: BracketOffsetMode; label: string }[] = [
  { value: "percent", label: "Percent of entry" },
  { value: "dollars", label: "Dollars" },
  { value: "stdev", label: "Standard deviations" },
];

const ROUTE_OPTIONS: { value: AtAdvancedRoute; label: string }[] = [
  { value: "AUTO", label: "Automatic" },
  { value: "SINGLE", label: "Single" },
  { value: "TRIGGER", label: "1st triggers" },
  { value: "TRIGGER_OCO", label: "1st triggers OCO" },
  { value: "OCO", label: "OCO" },
];

const SESSION_OPTIONS: { value: AtOrderSession; label: string }[] = [
  { value: "NORMAL", label: "Normal" },
  { value: "AM", label: "AM" },
  { value: "PM", label: "PM" },
  { value: "SEAMLESS", label: "Seamless" },
];

const ROUTES: AtRouting[] = ["BEST", "NYSE", "NASDAQ", "ARCA", "BATS"];

export function describeOrderDefaults(
  prefs: ActiveTraderTemplatePrefs,
  instruction: SchwabInstruction,
): string {
  const close = humanInstruction(closingInstructionForOpen(instruction)).toLowerCase();
  const entry = ENTRY_OPTIONS.find((o) => o.value === (prefs.schwabEntryType ?? "LIMIT"))?.label ?? "Limit";
  const tif = TIF_OPTIONS.find((o) => o.value === (prefs.entryDuration ?? "DAY"))?.label ?? "Day";
  const parts = [`Each new order is a ${entry.toLowerCase()} ${tif.toLowerCase()} order.`];
  if (prefs.takeProfit.enabled) {
    parts.push(
      `Take profit sends a ${close} automatically after the entry fills. Open or close for the entry is chosen on the order confirmation, not on this screen.`,
    );
  } else {
    parts.push("Take profit is off, so no closing order is attached.");
  }
  if (prefs.stopLoss.enabled) {
    parts.push(`Stop loss uses the same ${close}.`);
  } else {
    parts.push("Stop loss is off.");
  }
  const route = prefs.advancedRoute ?? "AUTO";
  if (route === "OCO") {
    parts.push("OCO places the two closing orders now. They do not wait for an entry fill.");
  } else if (route === "TRIGGER_OCO" || (route === "AUTO" && prefs.takeProfit.enabled && prefs.stopLoss.enabled)) {
    parts.push("Schwab receives a 1st-triggers OCO: the entry fills, then the take profit and stop compete.");
  } else if (prefs.takeProfit.enabled || prefs.stopLoss.enabled) {
    parts.push("Schwab receives a 1st-triggers order: the exit is sent after the entry fills.");
  }
  parts.push(
    prefs.submission === "send"
      ? "Orders send without a review step."
      : "You review the order before it is sent.",
  );
  return parts.join(" ");
}

function unitLabel(mode: BracketOffsetMode, instruction: SchwabInstruction): string {
  if (mode === "percent") {
    return isLongEntry(instruction) ? "Percent of entry debit" : "Percent of entry credit";
  }
  if (mode === "dollars") return "Dollars";
  if (mode === "stdev") return "Standard deviations";
  return "Points";
}

function amountText(offset: number, mode: BracketOffsetMode): string {
  const n = Math.abs(offset);
  const shown = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  if (mode === "percent") return `${shown} %`;
  if (mode === "dollars") return `$${shown}`;
  if (mode === "stdev") return `${shown} σ`;
  return `${shown} pts`;
}

function Toggle({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        width: 51,
        height: 31,
        borderRadius: 16,
        border: 0,
        padding: 2,
        background: on ? GOLD : "#3a3a3c",
        display: "flex",
        justifyContent: on ? "flex-end" : "flex-start",
        flexShrink: 0,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: 27,
          height: 27,
          borderRadius: 14,
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.35)",
        }}
      />
    </button>
  );
}

export type AtOrderDefaultsSheetProps = {
  open: boolean;
  prefs: ActiveTraderTemplatePrefs;
  primaryInstruction: SchwabInstruction;
  windowSec: 30 | 60 | 300;
  onWindowSecChange: (v: 30 | 60 | 300) => void;
  onClose: () => void;
  onSave: (prefs: ActiveTraderTemplatePrefs) => void;
  /** Active order draft hook to validate the current ticket with AI Strategist. */
  onSendToStrategist?: (opts: { thesis?: string }) => Promise<void> | void;
  strategistBusy?: boolean;
  strategistError?: string | null;
  strategistSummary?: string | null;
};

export const AtOrderDefaultsSheet = memo(function AtOrderDefaultsSheet({
  open,
  prefs,
  primaryInstruction,
  windowSec,
  onWindowSecChange,
  onClose,
  onSave,
  onSendToStrategist,
  strategistBusy = false,
  strategistError = null,
  strategistSummary = null,
}: AtOrderDefaultsSheetProps) {
  const [draft, setDraft] = useState(() => applyOrderDefaults(prefs));
  const [menu, setMenu] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [strategistOpen, setStrategistOpen] = useState(false);
  const [strategistThesis, setStrategistThesis] = useState("");
  const [amountEditing, setAmountEditing] = useState<"takeProfit" | "stopLoss" | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(applyOrderDefaults(prefs));
    setMenu(null);
    setAdvancedOpen(false);
    setRiskOpen(false);
    setStrategistOpen(false);
    setStrategistThesis("");
    setAmountEditing(null);
  }, [open, prefs]);

  if (!open) return null;

  const patch = (partial: Partial<ActiveTraderTemplatePrefs>) => {
    setDraft((prev) => {
      const route =
        partial.advancedRoute ??
        (partial.takeProfit || partial.stopLoss ? "AUTO" : (prev.advancedRoute ?? "AUTO"));
      return applyOrderDefaults({ ...prev, ...partial, advancedRoute: route });
    });
  };

  const entry = draft.schwabEntryType ?? "LIMIT";
  const entryLabel = ENTRY_OPTIONS.find((o) => o.value === entry)?.label ?? "Limit";
  const tifLabel = TIF_OPTIONS.find((o) => o.value === (draft.entryDuration ?? "DAY"))?.label ?? "Day";
  const accountLabel = `${draft.accountKind === "CASH" ? "Cash" : "Margin"} · ${draft.routing ?? "BEST"}`;

  const setRoute = (advancedRoute: AtAdvancedRoute) => {
    const next: Partial<ActiveTraderTemplatePrefs> = { advancedRoute };
    if (advancedRoute === "SINGLE") {
      next.takeProfit = { ...draft.takeProfit, enabled: false };
      next.stopLoss = { ...draft.stopLoss, enabled: false };
    } else if (advancedRoute === "TRIGGER") {
      next.takeProfit = { ...draft.takeProfit, enabled: true };
      next.stopLoss = { ...draft.stopLoss, enabled: false };
    } else if (advancedRoute === "TRIGGER_OCO" || advancedRoute === "OCO") {
      next.takeProfit = { ...draft.takeProfit, enabled: true };
      next.stopLoss = { ...draft.stopLoss, enabled: true };
    }
    setDraft((prev) => applyOrderDefaults({ ...prev, ...next }));
    setMenu(null);
  };

  return createPortal(
    <div
      className="at-order-defaults"
      data-at-order-defaults
      data-at-settings-expanded
      role="dialog"
      aria-modal="true"
      aria-labelledby="at-order-defaults-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 400,
        background: BG,
        color: TEXT,
        fontFamily: FONT,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        .at-order-defaults { color-scheme: dark; }
        .at-order-defaults ::selection { background: rgba(245, 180, 0, 0.35); color: #fff; }
        .at-order-defaults input { caret-color: #f5b400; }
        .at-order-defaults button:focus-visible,
        .at-order-defaults input:focus-visible {
          outline: 2px solid #f5b400;
          outline-offset: 2px;
        }
        .at-od-scroll { scrollbar-color: #3a3a3c transparent; }
      `}</style>
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 8 }}>
        <span style={{ width: 36, height: 5, borderRadius: 3, background: "#3a3a3c" }} />
      </div>
      <div style={{ position: "relative", padding: "10px 16px 6px" }}>
        <button
          type="button"
          aria-label="Close order defaults"
          onClick={onClose}
          style={{
            position: "absolute",
            left: 16,
            top: 8,
            width: 32,
            height: 32,
            borderRadius: 16,
            border: 0,
            background: FIELD,
            color: TEXT,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <X size={16} strokeWidth={2.25} />
        </button>
        <h1
          id="at-order-defaults-title"
          style={{
            margin: 0,
            textAlign: "center",
            fontSize: 22,
            lineHeight: 1.15,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          Order defaults
        </h1>
        <p style={{ margin: "4px 0 0", textAlign: "center", color: MUTED, fontSize: 13, fontWeight: 400 }}>
          Used for each new Active Trader order
        </p>
      </div>

      <div className="at-od-scroll" style={{ flex: 1, overflowY: "auto", padding: "8px 0 12px" }}>
        <ChoiceRow
          label="Entry order"
          value={entryLabel}
          open={menu === "entry"}
          onToggle={() => setMenu(menu === "entry" ? null : "entry")}
        >
          {ENTRY_OPTIONS.map((opt) => (
            <MenuItem
              key={opt.value}
              label={opt.label}
              selected={entry === opt.value}
              onPick={() => {
                patch({ schwabEntryType: opt.value, orderType: opt.value === "MARKET" ? "MKT" : "LIMIT" });
                setMenu(null);
              }}
            />
          ))}
        </ChoiceRow>
        <ChoiceRow
          label="Time in force"
          value={tifLabel}
          open={menu === "tif"}
          onToggle={() => setMenu(menu === "tif" ? null : "tif")}
        >
          {TIF_OPTIONS.map((opt) => (
            <MenuItem
              key={opt.value}
              label={opt.label}
              selected={(draft.entryDuration ?? "DAY") === opt.value}
              onPick={() => {
                patch({ entryDuration: opt.value });
                setMenu(null);
              }}
            />
          ))}
        </ChoiceRow>

        <div style={rowStyle}>
          <span style={labelStyle}>Take profit</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 500 }}>{draft.takeProfit.enabled ? "On" : "Off"}</span>
            <Toggle
              label="Take profit"
              on={draft.takeProfit.enabled}
              onChange={(enabled) => patch({ takeProfit: { ...draft.takeProfit, enabled } })}
            />
          </span>
        </div>
        {draft.takeProfit.enabled ? (
          <TargetFields
            leg="takeProfit"
            mode={draft.takeProfit.mode}
            offset={draft.takeProfit.offset}
            instruction={primaryInstruction}
            editing={amountEditing === "takeProfit"}
            menu={menu}
            onMenu={setMenu}
            onEdit={setAmountEditing}
            onMode={(mode) => patch({ takeProfit: { ...draft.takeProfit, mode, offset: mode === "stdev" ? 1 : draft.takeProfit.offset } })}
            onOffset={(offset) => patch({ takeProfit: { ...draft.takeProfit, offset: Math.abs(offset) || 0 } })}
          />
        ) : null}

        <div style={rowStyle}>
          <span style={labelStyle}>Stop loss</span>
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 500 }}>{draft.stopLoss.enabled ? "On" : "Off"}</span>
            <Toggle
              label="Stop loss"
              on={draft.stopLoss.enabled}
              onChange={(enabled) =>
                patch({
                  stopLoss: {
                    ...draft.stopLoss,
                    enabled,
                    offset: draft.stopLoss.offset === 0 ? -10 : draft.stopLoss.offset,
                  },
                })
              }
            />
          </span>
        </div>
        {draft.stopLoss.enabled ? (
          <TargetFields
            leg="stopLoss"
            mode={draft.stopLoss.mode}
            offset={draft.stopLoss.offset}
            instruction={primaryInstruction}
            editing={amountEditing === "stopLoss"}
            menu={menu}
            onMenu={setMenu}
            onEdit={setAmountEditing}
            onMode={(mode) =>
              patch({
                stopLoss: {
                  ...draft.stopLoss,
                  mode,
                  offset: -Math.abs(mode === "stdev" ? 1 : draft.stopLoss.offset || 10),
                },
              })
            }
            onOffset={(offset) => patch({ stopLoss: { ...draft.stopLoss, offset: -Math.abs(offset) } })}
          />
        ) : null}

        <button type="button" onClick={() => setAdvancedOpen((v) => !v)} style={disclosureStyle} aria-expanded={advancedOpen}>
          <span style={labelStyle}>Advanced orders & conditions</span>
          <ChevronDown
            size={18}
            color={MUTED}
            style={{ transform: advancedOpen ? "rotate(180deg)" : undefined }}
          />
        </button>
        {advancedOpen ? (
          <div style={{ padding: "4px 0 8px" }}>
            <ChoiceRow
              label="Order route"
              value={ROUTE_OPTIONS.find((o) => o.value === (draft.advancedRoute ?? "AUTO"))?.label ?? "Automatic"}
              open={menu === "route"}
              onToggle={() => setMenu(menu === "route" ? null : "route")}
              nested
            >
              {ROUTE_OPTIONS.map((opt) => (
                <MenuItem
                  key={opt.value}
                  label={opt.label}
                  selected={(draft.advancedRoute ?? "AUTO") === opt.value}
                  onPick={() => setRoute(opt.value)}
                />
              ))}
            </ChoiceRow>
            <ChoiceRow
              label="Session"
              value={SESSION_OPTIONS.find((o) => o.value === (draft.session ?? "NORMAL"))?.label ?? "Normal"}
              open={menu === "session"}
              onToggle={() => setMenu(menu === "session" ? null : "session")}
              nested
            >
              {SESSION_OPTIONS.map((opt) => (
                <MenuItem
                  key={opt.value}
                  label={opt.label}
                  selected={(draft.session ?? "NORMAL") === opt.value}
                  onPick={() => {
                    patch({ session: opt.value });
                    setMenu(null);
                  }}
                />
              ))}
            </ChoiceRow>
            <ChoiceRow
              label="Exit time in force"
              value={draft.exitDuration === "GOOD_TILL_CANCEL" ? "GTC" : "Day"}
              open={menu === "exit"}
              onToggle={() => setMenu(menu === "exit" ? null : "exit")}
              nested
            >
              <MenuItem
                label="Day"
                selected={draft.exitDuration === "DAY"}
                onPick={() => {
                  patch({ exitDuration: "DAY" });
                  setMenu(null);
                }}
              />
              <MenuItem
                label="GTC"
                selected={draft.exitDuration === "GOOD_TILL_CANCEL"}
                onPick={() => {
                  patch({ exitDuration: "GOOD_TILL_CANCEL" });
                  setMenu(null);
                }}
              />
            </ChoiceRow>
            {draft.stopLoss.enabled ? (
              <ChoiceRow
                label="Stop type"
                value={draft.stopLossOrderType === "STOP_LIMIT" ? "Stop limit" : "Stop"}
                open={menu === "stopType"}
                onToggle={() => setMenu(menu === "stopType" ? null : "stopType")}
                nested
              >
                {(["STOP", "STOP_LIMIT"] as AtStopLossOrderType[]).map((value) => (
                  <MenuItem
                    key={value}
                    label={value === "STOP" ? "Stop" : "Stop limit"}
                    selected={draft.stopLossOrderType === value}
                    onPick={() => {
                      patch({ stopLossOrderType: value });
                      setMenu(null);
                    }}
                  />
                ))}
              </ChoiceRow>
            ) : null}
            {entry === "TRAILING_STOP" || entry === "TRAILING_STOP_LIMIT" ? (
              <div style={{ ...rowStyle, paddingLeft: 32 }}>
                <span style={{ ...labelStyle, fontSize: 15 }}>Trail amount</span>
                <input
                  aria-label="Trail amount"
                  inputMode="decimal"
                  value={String(draft.trailOffset ?? 0.1)}
                  onChange={(e) => patch({ trailOffset: Math.abs(parseFloat(e.target.value) || 0) })}
                  style={amountInputStyle}
                />
              </div>
            ) : null}
            <ChoiceRow
              label="Classified window"
              value={windowSec === 300 ? "5m" : windowSec === 60 ? "1m" : "30s"}
              open={menu === "window"}
              onToggle={() => setMenu(menu === "window" ? null : "window")}
              nested
            >
              {([30, 60, 300] as const).map((sec) => (
                <MenuItem
                  key={sec}
                  label={sec === 300 ? "5m" : sec === 60 ? "1m" : "30s"}
                  selected={windowSec === sec}
                  onPick={() => {
                    onWindowSecChange(sec);
                    setMenu(null);
                  }}
                />
              ))}
            </ChoiceRow>
            <ChoiceRow
              label="Ladder mode"
              value={draft.ladderMode === "vertical" ? "Vertical" : "Single"}
              open={menu === "ladder"}
              onToggle={() => setMenu(menu === "ladder" ? null : "ladder")}
              nested
            >
              <MenuItem
                label="Single"
                selected={draft.ladderMode === "single"}
                onPick={() => {
                  patch({ ladderMode: "single" });
                  setMenu(null);
                }}
              />
              <MenuItem
                label="Vertical"
                selected={draft.ladderMode === "vertical"}
                onPick={() => {
                  patch({ ladderMode: "vertical" });
                  setMenu(null);
                }}
              />
            </ChoiceRow>
            <p style={{ margin: "8px 20px 0 32px", color: MUTED, fontSize: 13, lineHeight: 1.4 }}>
              Take profit is always the closing side. A buy to open is closed with a sell to close. A sell to open is closed with a buy to close.
            </p>
          </div>
        ) : null}

        <ChoiceRow
          label="Account & routing"
          value={accountLabel}
          open={menu === "account"}
          onToggle={() => setMenu(menu === "account" ? null : "account")}
        >
          {(["MARGIN", "CASH"] as AtAccountKind[]).flatMap((kind) =>
            ROUTES.map((routing) => {
              const label = `${kind === "CASH" ? "Cash" : "Margin"} · ${routing}`;
              return (
                <MenuItem
                  key={label}
                  label={label}
                  selected={draft.accountKind === kind && (draft.routing ?? "BEST") === routing}
                  onPick={() => {
                    patch({ accountKind: kind, routing });
                    setMenu(null);
                  }}
                />
              );
            }),
          )}
        </ChoiceRow>

        <button type="button" onClick={() => setRiskOpen((v) => !v)} style={disclosureStyle} aria-expanded={riskOpen}>
          <span style={labelStyle}>Order description & risk</span>
          <ChevronDown size={18} color={MUTED} style={{ transform: riskOpen ? "rotate(180deg)" : undefined }} />
        </button>
        {riskOpen ? (
          <p style={{ margin: "4px 20px 12px", color: MUTED, fontSize: 14, lineHeight: 1.45 }}>
            {describeOrderDefaults(draft, primaryInstruction)} Risk is priced on the confirmation from the live limit.
          </p>
        ) : null}

        <button
          type="button"
          data-at-strategist-toggle
          onClick={() => setStrategistOpen((v) => !v)}
          style={disclosureStyle}
          aria-expanded={strategistOpen}
        >
          <span style={labelStyle}>AI Strategist review</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: onSendToStrategist ? "#5ad1c0" : MUTED }}>
              {onSendToStrategist ? "Ready" : "Draft slot"}
            </span>
            <ChevronDown size={18} color={MUTED} style={{ transform: strategistOpen ? "rotate(180deg)" : undefined }} />
          </span>
        </button>
        {strategistOpen ? (
          <div data-at-strategist-panel style={{ padding: "10px 20px 14px", borderBottom: `1px solid ${LINE}` }}>
            {onSendToStrategist ? (
              <>
                {strategistSummary ? (
                  <p style={{ margin: "0 0 8px", color: TEXT, fontSize: 13, fontWeight: 500 }}>
                    {strategistSummary}
                  </p>
                ) : null}
                <p style={{ margin: "0 0 8px", color: MUTED, fontSize: 13, lineHeight: 1.4 }}>
                  Have AI Strategist evaluate this order draft (legs, risk, and live quote) instead of sending straight to your broker.
                </p>
                <textarea
                  aria-label="Strategist trade thesis"
                  value={strategistThesis}
                  onChange={(e) => setStrategistThesis(e.target.value)}
                  placeholder="Optional thesis or notes for AI Strategist…"
                  rows={2}
                  style={{
                    width: "100%",
                    borderRadius: 10,
                    border: "1px solid #3a3a3c",
                    background: FIELD,
                    color: TEXT,
                    fontFamily: FONT,
                    fontSize: 14,
                    padding: "8px 10px",
                    resize: "none",
                    boxSizing: "border-box",
                  }}
                />
                {strategistError ? (
                  <p style={{ margin: "6px 0 0", color: "#ff4d4d", fontSize: 13, lineHeight: 1.35 }}>
                    {strategistError}
                  </p>
                ) : null}
                <button
                  type="button"
                  data-at-send-to-strategist
                  disabled={strategistBusy}
                  onClick={() => void onSendToStrategist({ thesis: strategistThesis })}
                  style={{
                    marginTop: 10,
                    width: "100%",
                    height: 44,
                    borderRadius: 12,
                    border: "1px solid rgba(90, 209, 192, 0.45)",
                    background: "rgba(90, 209, 192, 0.14)",
                    color: "#5ad1c0",
                    fontFamily: FONT,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: strategistBusy ? "default" : "pointer",
                    opacity: strategistBusy ? 0.6 : 1,
                  }}
                >
                  {strategistBusy ? "Sending to Strategist…" : "Send draft to AI Strategist"}
                </button>
              </>
            ) : (
              <p
                data-at-strategist-placeholder
                style={{ margin: 0, color: MUTED, fontSize: 13, lineHeight: 1.45 }}
              >
                Open an equity or options order draft on the bottom ticket to validate the trade with AI Strategist before sending to your broker.
              </p>
            )}
          </div>
        ) : null}

        <div style={{ padding: "18px 20px 8px" }}>
          <div style={{ ...labelStyle, marginBottom: 10 }}>Order submission</div>
          <SubmitChoice
            label="Review before sending"
            selected={(draft.submission ?? "review") !== "send"}
            onPick={() => patch({ submission: "review" })}
          />
          <div style={{ height: 8 }} />
          <SubmitChoice
            label="Send without review"
            selected={draft.submission === "send"}
            onPick={() => patch({ submission: "send" })}
          />
        </div>
      </div>

      <div style={{ padding: "8px 16px max(16px, env(safe-area-inset-bottom, 0px))" }}>
        <button
          type="button"
          onClick={() => onSave(applyOrderDefaults(draft))}
          style={{
            width: "100%",
            height: 54,
            border: 0,
            borderRadius: 14,
            background: GOLD,
            color: "#14120a",
            fontFamily: FONT,
            fontSize: 17,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Save defaults
        </button>
      </div>
    </div>,
    document.body,
  );
});

const rowStyle: CSSProperties = {
  minHeight: 54,
  padding: "0 20px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  borderBottom: `1px solid ${LINE}`,
};

const labelStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: "-0.011em",
  color: TEXT,
};

const disclosureStyle: CSSProperties = {
  ...rowStyle,
  width: "100%",
  background: "transparent",
  borderLeft: 0,
  borderRight: 0,
  borderTop: 0,
  color: TEXT,
  fontFamily: FONT,
  cursor: "pointer",
  textAlign: "left",
};

const amountInputStyle: CSSProperties = {
  width: 84,
  height: 36,
  borderRadius: 10,
  border: "1px solid #3a3a3c",
  background: "transparent",
  color: TEXT,
  fontFamily: FONT,
  fontSize: 16,
  fontWeight: 500,
  textAlign: "center",
};

function ChoiceRow({
  label,
  value,
  open,
  onToggle,
  nested,
  children,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  nested?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: `1px solid ${LINE}` }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          minHeight: 54,
          padding: nested ? "0 20px 0 32px" : "0 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: "transparent",
          border: 0,
          color: TEXT,
          fontFamily: FONT,
          cursor: "pointer",
        }}
      >
        <span style={{ ...labelStyle, fontSize: nested ? 15 : 16 }}>{label}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 16, fontWeight: 500 }}>
          {value}
          <ChevronDown size={16} color={MUTED} />
        </span>
      </button>
      {open ? (
        <div style={{ margin: "0 16px 10px", background: FIELD, borderRadius: 12, overflow: "hidden" }}>{children}</div>
      ) : null}
    </div>
  );
}

function MenuItem({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      style={{
        width: "100%",
        minHeight: 44,
        padding: "0 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "transparent",
        border: 0,
        borderBottom: `1px solid ${LINE}`,
        color: TEXT,
        fontFamily: FONT,
        fontSize: 15,
        cursor: "pointer",
      }}
    >
      {label}
      {selected ? <Check size={16} color={GOLD} /> : null}
    </button>
  );
}

function TargetFields({
  leg,
  mode,
  offset,
  instruction,
  editing,
  menu,
  onMenu,
  onEdit,
  onMode,
  onOffset,
}: {
  leg: "takeProfit" | "stopLoss";
  mode: BracketOffsetMode;
  offset: number;
  instruction: SchwabInstruction;
  editing: boolean;
  menu: string | null;
  onMenu: (id: string | null) => void;
  onEdit: (leg: "takeProfit" | "stopLoss" | null) => void;
  onMode: (mode: BracketOffsetMode) => void;
  onOffset: (offset: number) => void;
}) {
  const menuId = `${leg}-unit`;
  const choices = mode === "points" ? [{ value: "points" as const, label: "Points" }, ...UNIT_OPTIONS] : UNIT_OPTIONS;
  return (
    <>
      <div style={{ borderBottom: `1px solid ${LINE}` }}>
        <button
          type="button"
          onClick={() => onMenu(menu === menuId ? null : menuId)}
          aria-expanded={menu === menuId}
          style={{
            width: "100%",
            minHeight: 48,
            padding: "0 20px 0 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "transparent",
            border: 0,
            color: TEXT,
            fontFamily: FONT,
            cursor: "pointer",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 500, color: "#d2d2d6" }}>Target unit</span>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, fontWeight: 500 }}>
            {unitLabel(mode, instruction)}
            <ChevronDown size={16} color={MUTED} />
          </span>
        </button>
        {menu === menuId ? (
          <div style={{ margin: "0 16px 10px", background: FIELD, borderRadius: 12, overflow: "hidden" }}>
            {choices.map((opt) => (
              <MenuItem
                key={opt.value}
                label={opt.value === "percent" ? unitLabel("percent", instruction) : opt.label}
                selected={mode === opt.value}
                onPick={() => {
                  onMode(opt.value);
                  onMenu(null);
                }}
              />
            ))}
          </div>
        ) : null}
      </div>
      <div style={{ ...rowStyle, paddingLeft: 32, borderBottom: "none" }}>
        <span style={{ fontSize: 15, fontWeight: 500, color: "#d2d2d6" }}>Target amount</span>
        {editing ? (
          <input
            aria-label="Target amount"
            autoFocus
            inputMode="decimal"
            defaultValue={String(Math.abs(offset))}
            onBlur={(e) => {
              onOffset(parseFloat(e.target.value) || 0);
              onEdit(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            style={amountInputStyle}
          />
        ) : (
          <button
            type="button"
            onClick={() => onEdit(leg)}
            style={{
              ...amountInputStyle,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            {amountText(offset, mode)}
          </button>
        )}
      </div>
      <p style={{ margin: "0 20px 12px 32px", color: MUTED, fontSize: 12, lineHeight: 1.35 }}>
        Available units: percent, dollars, standard deviations.
      </p>
    </>
  );
}

function SubmitChoice({
  label,
  selected,
  onPick,
}: {
  label: string;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      style={{
        width: "100%",
        height: 52,
        borderRadius: 12,
        border: `1px solid ${selected ? "#4a4a4e" : "#3a3a3c"}`,
        background: selected ? "#242426" : "transparent",
        color: TEXT,
        fontFamily: FONT,
        fontSize: 16,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        cursor: "pointer",
      }}
    >
      {label}
      {selected ? (
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            background: GOLD,
            color: "#14120a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={14} strokeWidth={3} />
        </span>
      ) : (
        <span style={{ width: 22, height: 22, borderRadius: 11, border: "1.5px solid #6e6e73" }} />
      )}
    </button>
  );
}
