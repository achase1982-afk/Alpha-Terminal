import { useCallback, useState, type CSSProperties } from "react";
import type { BlockReason, StrategistOutcome } from "@/components/StrategistV2Card";
import { ChevronDown, ChevronUp, AlertTriangle, Copy } from "lucide-react";
import { toast } from "sonner";

const PAL = {
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

const SYS_FONT = "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif";

interface DeskKeyStrike {
  strike: number;
  expiry: string;
  type: string;
  observation: string;
}

interface DeskLeg {
  type: string;
  strike: number;
  action: string;
  expiration: string;
  quantity?: number;
}

interface DeskStructure {
  type: string;
  legs: DeskLeg[];
  expiry: string;
  credit_or_debit: number;
}

interface DeskExitPlan {
  profit_target: number;
  stop_loss: number;
  time_stop: string;
}

interface VolAnalystOutput {
  iv_state: string;
  term_structure: string;
  skew: string;
  implied_vs_realized: string;
  read: string;
}

interface FlowAnalystOutput {
  dominant_flow: string;
  institutional_signal: string;
  retail_signal: string;
  key_strikes: DeskKeyStrike[];
  read: string;
}

interface CatalystAnalystOutput {
  primary_catalyst: string;
  bar_to_clear: string;
  asymmetry: string;
  historical_pattern: string;
  read: string;
}

interface PmOutput {
  decision: "trade" | "pass";
  structure: DeskStructure | null;
  thesis: string;
  size: "small" | "medium" | "large";
  whose_side: "institutional_alignment" | "retail_fade" | "neither";
  biggest_risk: string;
  exit_plan: DeskExitPlan;
  watch_for: string;
}

export interface DeskResult {
  mode: "desk";
  ticker: string;
  vol: VolAnalystOutput;
  flow: FlowAnalystOutput;
  catalyst: CatalystAnalystOutput;
  pm: PmOutput;
  models: {
    vol: string;
    flow: string;
    catalyst: string;
    pm: string;
  };
  errors?: string[];
  pmOutputIncomplete?: boolean;
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
      <span style={{ fontFamily: SYS_FONT, fontSize: 11, color: PAL.label, minWidth: 120, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: SYS_FONT, fontSize: 11, color: PAL.body, lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

function CollapsibleSection({ title, model, defaultOpen, children }: {
  title: string;
  model: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div style={{ border: `1px solid ${PAL.borderInner}`, borderRadius: 8, marginBottom: 8, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", background: PAL.bgInner, border: "none", cursor: "pointer",
        }}
      >
        <span style={{ fontFamily: SYS_FONT, fontSize: 12, fontWeight: 600, color: PAL.white, letterSpacing: 0.5 }}>{title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: SYS_FONT, fontSize: 9, color: PAL.label }}>{model}</span>
          {open ? <ChevronUp size={14} color={PAL.label} /> : <ChevronDown size={14} color={PAL.label} />}
        </div>
      </button>
      {open && <div style={{ padding: 12, background: PAL.bgCard }}>{children}</div>}
    </div>
  );
}

function StructureDisplay({ structure }: { structure: DeskStructure }) {
  return (
    <div style={{ background: PAL.bgInner, border: `1px solid ${PAL.borderInner}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
      <div style={{ fontFamily: SYS_FONT, fontSize: 12, fontWeight: 600, color: PAL.goldHeader, marginBottom: 6, textTransform: "uppercase" }}>
        {structure.type.replace(/_/g, " ")}
      </div>
      <div style={{ fontFamily: SYS_FONT, fontSize: 11, color: PAL.label, marginBottom: 4 }}>
        Expiry: {structure.expiry} &middot; {structure.credit_or_debit < 0 ? "Credit" : "Debit"}: ${Math.abs(structure.credit_or_debit).toFixed(2)}
      </div>
      {structure.legs.map((leg, i) => (
        <div key={i} style={{ fontFamily: SYS_FONT, fontSize: 11, color: PAL.body, padding: "2px 0" }}>
          {leg.action.toUpperCase()} {leg.type.toUpperCase()} {leg.strike} ({leg.expiration})
          {leg.quantity && leg.quantity > 1 ? ` x${leg.quantity}` : ""}
        </div>
      ))}
    </div>
  );
}

/** Plain text for the full Desk card (all sections including analyst reads, regardless of collapse). */
export function buildDeskCardPlainText(args: {
  deskResult: DeskResult;
  generatedAt?: string | number | null;
  strategistOutcome?: StrategistOutcome;
  blockReason?: BlockReason;
}): string {
  const { deskResult, generatedAt, strategistOutcome, blockReason } = args;
  const { pm, vol, flow, catalyst, models, errors } = deskResult;
  const isTrade = pm.decision === "trade";
  const banner = deskBanner(strategistOutcome, blockReason, !isTrade);

  const lines: string[] = [];
  if (banner) {
    lines.push(banner.title.toUpperCase(), banner.body, "");
  }

  const when =
    generatedAt == null
      ? null
      : typeof generatedAt === "number"
        ? new Date(generatedAt).toLocaleString()
        : String(generatedAt);

  lines.push(`${isTrade ? "TRADE" : "PASS"}  ${deskResult.ticker}  DESK MODE`);
  if (when) lines.push(`Generated: ${when}`);
  lines.push("");

  if (isTrade && pm.structure) {
    const s = pm.structure;
    lines.push(
      s.type.replace(/_/g, " ").toUpperCase(),
      `Expiry: ${s.expiry}  ·  ${s.credit_or_debit < 0 ? "Credit" : "Debit"}: $${Math.abs(s.credit_or_debit).toFixed(2)}`,
    );
    for (const leg of s.legs) {
      const q = leg.quantity && leg.quantity > 1 ? ` x${leg.quantity}` : "";
      lines.push(`${leg.action.toUpperCase()} ${leg.type.toUpperCase()} ${leg.strike} (${leg.expiration})${q}`);
    }
    lines.push("");
  }

  if (!isTrade && pm.watch_for) {
    lines.push("WATCH FOR", pm.watch_for, "");
  }

  lines.push("PM THESIS", pm.thesis, "");
  lines.push("SIZE", pm.size.toUpperCase());
  lines.push("ALIGNMENT", pm.whose_side.replace(/_/g, " "));

  if (isTrade) {
    lines.push("PROFIT TARGET", `$${pm.exit_plan.profit_target.toFixed(2)}`);
    lines.push("STOP LOSS", `$${pm.exit_plan.stop_loss.toFixed(2)}`);
    if (pm.exit_plan.time_stop) lines.push("TIME STOP", pm.exit_plan.time_stop);
  }
  lines.push("");

  lines.push("BIGGEST RISK", pm.biggest_risk, "");

  if (errors && errors.length > 0) {
    lines.push("NOTES / WARNINGS");
    for (const e of errors) lines.push(`- ${e}`);
    lines.push("");
  }

  lines.push("ANALYST READS", "");

  lines.push("— Vol Analyst —", `Model: ${models.vol}`);
  lines.push("IV State", vol.iv_state);
  lines.push("Term Structure", vol.term_structure);
  lines.push("Skew", vol.skew);
  lines.push("IV vs Realized", vol.implied_vs_realized);
  lines.push("Read", vol.read, "");

  lines.push("— Flow Analyst —", `Model: ${models.flow}`);
  lines.push("Dominant Flow", flow.dominant_flow);
  lines.push("Institutional", flow.institutional_signal);
  lines.push("Retail", flow.retail_signal);
  if (flow.key_strikes.length > 0) {
    lines.push("Key Strikes");
    for (const ks of flow.key_strikes) {
      lines.push(`  ${ks.type.toUpperCase()} ${ks.strike} (${ks.expiry}): ${ks.observation}`);
    }
  }
  lines.push("Read", flow.read, "");

  lines.push("— Catalyst Analyst —", `Model: ${models.catalyst}`);
  lines.push("Primary Catalyst", catalyst.primary_catalyst);
  lines.push("Bar to Clear", catalyst.bar_to_clear);
  lines.push("Asymmetry", catalyst.asymmetry);
  lines.push("Historical", catalyst.historical_pattern);
  lines.push("Read", catalyst.read, "");

  lines.push(`PM: ${models.pm}`);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function deskBanner(
  outcome: StrategistOutcome | undefined,
  blockReason: BlockReason | undefined,
  pmPass: boolean,
): { title: string; body: string; border: string; bg: string; accent: string } | null {
  if (outcome === "ANALYSIS_INCOMPLETE" || blockReason?.category === "ANALYSIS_INCOMPLETE") {
    return {
      title: "Analysis Incomplete",
      body: blockReason?.detail ?? "The PM output did not match the required format after retry. Try running the analysis again.",
      border: "rgba(245,158,11,0.35)",
      bg: "rgba(245,158,11,0.08)",
      accent: PAL.gold,
    };
  }
  if (outcome === "NO_TRADE" || pmPass) {
    return {
      title: "No Trade Recommended",
      body: "The PM is not putting on a structure for this name right now. Review the analyst reads below — especially “Watch for” — to see what would need to change.",
      border: "rgba(161,161,170,0.35)",
      bg: "rgba(161,161,170,0.06)",
      accent: "#a3a3a3",
    };
  }
  return null;
}

export function StrategistDeskCard({
  deskResult,
  generatedAt,
  strategistOutcome,
  blockReason,
  onRetry,
}: {
  deskResult: DeskResult;
  generatedAt?: string | number | null;
  strategistOutcome?: StrategistOutcome;
  blockReason?: BlockReason;
  onRetry?: (ticker: string) => void;
}) {
  const { pm, vol, flow, catalyst, models, errors } = deskResult;
  const isTrade = pm.decision === "trade";
  const banner = deskBanner(strategistOutcome, blockReason, !isTrade);
  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const copyPlain = useCallback(async () => {
    const text = buildDeskCardPlainText({ deskResult, generatedAt, strategistOutcome, blockReason });
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.message("Copied desk card to clipboard");
        setCopiedFull(true);
        window.setTimeout(() => setCopiedFull(false), 1500);
      } catch {
        /* noop */
      }
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.message("Copied desk card to clipboard");
        setCopiedFull(true);
        window.setTimeout(() => setCopiedFull(false), 1500);
      } else {
        fallback();
      }
    } catch {
      fallback();
    }
  }, [deskResult, generatedAt, strategistOutcome, blockReason]);

  const copyJson = useCallback(async () => {
    const text = JSON.stringify(deskResult, null, 2);
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.message("Copied desk JSON to clipboard");
        setCopiedJson(true);
        window.setTimeout(() => setCopiedJson(false), 1500);
      } catch {
        /* noop */
      }
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.message("Copied desk JSON to clipboard");
        setCopiedJson(true);
        window.setTimeout(() => setCopiedJson(false), 1500);
      } else {
        fallback();
      }
    } catch {
      fallback();
    }
  }, [deskResult]);

  const btnStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 6,
    border: `1px solid ${PAL.borderInner}`,
    background: PAL.bgInner,
    color: PAL.label,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: SYS_FONT,
  };

  return (
    <div style={{ background: PAL.bgCard, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16, fontFamily: SYS_FONT }}>
      {/* Outcome banner (non-error framing) */}
      {banner && (
        <div style={{ border: `1px solid ${banner.border}`, background: banner.bg, borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: banner.accent, letterSpacing: 0.8, marginBottom: 6 }}>{banner.title}</div>
          <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>{banner.body}</div>
          {(strategistOutcome === "ANALYSIS_INCOMPLETE" || blockReason?.category === "ANALYSIS_INCOMPLETE") && onRetry && (
            <button
              type="button"
              onClick={() => onRetry(deskResult.ticker)}
              style={{ marginTop: 10, padding: "8px 14px", borderRadius: 6, border: "none", background: "#fbbf24", color: "#0a0a0a", fontWeight: 700, fontSize: 11, cursor: "pointer" }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* PM Decision Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
            color: isTrade ? PAL.green : "#a3a3a3",
            background: isTrade ? "rgba(74,222,128,0.1)" : "rgba(161,161,170,0.12)",
            border: `1px solid ${isTrade ? "rgba(74,222,128,0.3)" : "rgba(161,161,170,0.35)"}`,
            padding: "3px 8px", borderRadius: 4,
          }}>
            {isTrade ? "TRADE" : "PASS"}
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: PAL.white }}>{deskResult.ticker}</span>
          <span style={{ fontSize: 10, color: PAL.label, letterSpacing: 0.5 }}>DESK MODE</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          <button type="button" onClick={() => void copyPlain()} style={btnStyle} aria-label="Copy full desk card as plain text">
            <Copy size={12} />
            {copiedFull ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={() => void copyJson()} style={btnStyle} aria-label="Copy desk result as JSON">
            <Copy size={12} />
            {copiedJson ? "Copied" : "Copy JSON"}
          </button>
          {generatedAt && (
            <span style={{ fontSize: 9, color: PAL.label }}>{typeof generatedAt === "number" ? new Date(generatedAt).toLocaleString() : generatedAt}</span>
          )}
        </div>
      </div>

      {/* Structure (if trade) */}
      {isTrade && pm.structure && <StructureDisplay structure={pm.structure} />}

      {/* Watch For (if pass) */}
      {!isTrade && pm.watch_for && (
        <div style={{ background: "rgba(251,191,36,0.08)", border: `1px solid rgba(251,191,36,0.3)`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: PAL.gold, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            WATCH FOR
          </div>
          <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>{pm.watch_for}</div>
        </div>
      )}

      {/* PM Thesis */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>PM THESIS</div>
        <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>{pm.thesis}</div>
      </div>

      {/* PM Details Row */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>SIZE</span>
          <div style={{ fontSize: 12, fontWeight: 600, color: PAL.white, textTransform: "uppercase" }}>{pm.size}</div>
        </div>
        <div>
          <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>ALIGNMENT</span>
          <div style={{ fontSize: 12, fontWeight: 600, color: PAL.white }}>{pm.whose_side.replace(/_/g, " ")}</div>
        </div>
        {isTrade && (
          <>
            <div>
              <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>PROFIT TARGET</span>
              <div style={{ fontSize: 12, fontWeight: 600, color: PAL.green }}>${pm.exit_plan.profit_target.toFixed(2)}</div>
            </div>
            <div>
              <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>STOP LOSS</span>
              <div style={{ fontSize: 12, fontWeight: 600, color: PAL.red }}>${pm.exit_plan.stop_loss.toFixed(2)}</div>
            </div>
            {pm.exit_plan.time_stop && (
              <div>
                <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>TIME STOP</span>
                <div style={{ fontSize: 12, fontWeight: 600, color: PAL.white }}>{pm.exit_plan.time_stop}</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Biggest Risk */}
      <div style={{ background: "rgba(220,38,38,0.06)", border: `1px solid rgba(220,38,38,0.2)`, borderRadius: 6, padding: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: PAL.red, letterSpacing: 1, textTransform: "uppercase" }}>BIGGEST RISK</span>
        <div style={{ fontSize: 11, color: PAL.body, marginTop: 4, lineHeight: 1.5 }}>{pm.biggest_risk}</div>
      </div>

      {/* Errors */}
      {errors && errors.length > 0 && (
        <div style={{ background: "rgba(245,158,11,0.08)", border: `1px solid rgba(245,158,11,0.3)`, borderRadius: 6, padding: 10, marginBottom: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <AlertTriangle size={14} color={PAL.gold} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            {errors.map((e, i) => <div key={i} style={{ fontSize: 10, color: PAL.body, lineHeight: 1.5 }}>{e}</div>)}
          </div>
        </div>
      )}

      {/* Analyst Reads (collapsible) */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>ANALYST READS</div>

        <CollapsibleSection title="Vol Analyst" model={models.vol} defaultOpen>
          <FieldRow label="IV State" value={vol.iv_state} />
          <FieldRow label="Term Structure" value={vol.term_structure} />
          <FieldRow label="Skew" value={vol.skew} />
          <FieldRow label="IV vs Realized" value={vol.implied_vs_realized} />
          <div style={{ marginTop: 8, fontSize: 12, color: PAL.body, lineHeight: 1.6, borderTop: `1px solid ${PAL.borderInner}`, paddingTop: 8 }}>
            {vol.read}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Flow Analyst" model={models.flow} defaultOpen>
          <FieldRow label="Dominant Flow" value={flow.dominant_flow} />
          <FieldRow label="Institutional" value={flow.institutional_signal} />
          <FieldRow label="Retail" value={flow.retail_signal} />
          {flow.key_strikes.length > 0 && (
            <div style={{ marginTop: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: PAL.label, letterSpacing: 0.5 }}>KEY STRIKES</span>
              {flow.key_strikes.map((ks, i) => (
                <div key={i} style={{ fontSize: 11, color: PAL.body, padding: "2px 0" }}>
                  {ks.type.toUpperCase()} {ks.strike} ({ks.expiry}): {ks.observation}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 12, color: PAL.body, lineHeight: 1.6, borderTop: `1px solid ${PAL.borderInner}`, paddingTop: 8 }}>
            {flow.read}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Catalyst Analyst" model={models.catalyst} defaultOpen>
          <FieldRow label="Primary Catalyst" value={catalyst.primary_catalyst} />
          <FieldRow label="Bar to Clear" value={catalyst.bar_to_clear} />
          <FieldRow label="Asymmetry" value={catalyst.asymmetry} />
          <FieldRow label="Historical" value={catalyst.historical_pattern} />
          <div style={{ marginTop: 8, fontSize: 12, color: PAL.body, lineHeight: 1.6, borderTop: `1px solid ${PAL.borderInner}`, paddingTop: 8 }}>
            {catalyst.read}
          </div>
        </CollapsibleSection>
      </div>

      {/* PM Model Attribution */}
      <div style={{ marginTop: 8, textAlign: "right" }}>
        <span style={{ fontSize: 9, color: PAL.label }}>PM: {models.pm}</span>
      </div>
    </div>
  );
}
