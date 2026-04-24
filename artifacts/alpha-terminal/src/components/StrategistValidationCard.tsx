import { useState, useMemo, useCallback } from "react";
import {
  ShieldCheck, AlertTriangle, ShieldX, Send,
  ChevronDown, ChevronUp, FileText, MessageSquare,
  Copy, Check,
} from "lucide-react";
import type { StrategistValidationMeta, StrategistTranscriptTurn } from "@/lib/store";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ValidationVerdict = "PROCEED" | "PROCEED_WITH_CAUTION" | "DO_NOT_PROCEED";

export interface ValidationVerdictPayload {
  verdict: ValidationVerdict;
  confidence: number;
  reasoningBullets: string[];
  risks: string[];
  improvements: string[];
  bullConfidence?: number;
  bearConfidence?: number;
}

// ─── Palette ─────────────────────────────────────────────────────────────────

const SYS_FONT = "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif";

const VERDICT_PALETTE: Record<ValidationVerdict, {
  fg: string; bg: string; border: string; label: string; dimBg: string;
  Icon: typeof ShieldCheck;
}> = {
  PROCEED: {
    fg: "#4ade80", bg: "rgba(74,222,128,0.10)", border: "rgba(74,222,128,0.35)",
    dimBg: "rgba(74,222,128,0.06)", label: "PROCEED", Icon: ShieldCheck,
  },
  PROCEED_WITH_CAUTION: {
    fg: "#fbbf24", bg: "rgba(251,191,36,0.10)", border: "rgba(251,191,36,0.35)",
    dimBg: "rgba(251,191,36,0.06)", label: "PROCEED WITH CAUTION", Icon: AlertTriangle,
  },
  DO_NOT_PROCEED: {
    fg: "#f87171", bg: "rgba(248,113,113,0.10)", border: "rgba(248,113,113,0.35)",
    dimBg: "rgba(248,113,113,0.06)", label: "DO NOT PROCEED", Icon: ShieldX,
  },
};

const BULL_COLOR = "#fbbf24";
const BEAR_COLOR = "#60a5fa";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParseTurnJson(text: string): Record<string, unknown> | null {
  try {
    const stripped = text.replace(/^```(json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return null;
  }
}

function asStr(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function asNum(v: unknown, fallback: number): number {
  return typeof v === "number" && isFinite(v) ? Math.round(v) : fallback;
}

function formatLeg(l: NonNullable<StrategistValidationMeta["ticket"]["legs"]>[number]): string {
  const action = l.instruction.replace(/_/g, " ").toLowerCase();
  const qty = l.quantity ?? 1;
  if (l.strike != null && l.optionType && l.expiration) {
    return `${action} ${qty}× ${l.expiration} $${l.strike} ${l.optionType.toLowerCase()}`;
  }
  return `${action} ${qty}`;
}

function describeUnderlyingShares(
  shares: NonNullable<StrategistValidationMeta["ticket"]["underlyingShares"]>,
  ticker: string,
): string {
  const sideLabel = shares.side === "long" ? "Long" : "Short";
  const avg = shares.averagePrice != null ? ` @ $${shares.averagePrice.toFixed(2)} avg` : "";
  return `${sideLabel} ${shares.quantity.toLocaleString()} sh ${ticker}${avg}`;
}

function detectCoverageLabel(meta: StrategistValidationMeta | null | undefined): string | null {
  const us = meta?.ticket?.underlyingShares;
  const legs = meta?.ticket?.legs;
  if (!us || us.quantity <= 0 || !legs || legs.length === 0) return null;
  for (const leg of legs) {
    if (!leg.optionType) continue;
    const isShort = (leg.instruction || "").toUpperCase().startsWith("SELL");
    const isLong = (leg.instruction || "").toUpperCase().startsWith("BUY");
    if (us.side === "long" && isShort && leg.optionType === "CALL") return "Covered Call";
    if (us.side === "long" && isLong && leg.optionType === "PUT") return "Married / Protective Put";
    if (us.side === "short" && isShort && leg.optionType === "PUT") return "Covered Put";
    if (us.side === "short" && isLong && leg.optionType === "CALL") return "Protective Call";
  }
  return null;
}

function describeTicket(meta: StrategistValidationMeta): string {
  const t = meta.ticket;
  const modeLabel = meta.mode === "closing" ? "Close" : "Open";
  const sl = t.stockLeg;
  const hasStockLeg = !!(sl && sl.quantity > 0);
  const optLegCount = t.legs?.length ?? 0;
  if (hasStockLeg && optLegCount > 0) {
    const optDesc = optLegCount === 1
      ? formatLeg(t.legs![0])
      : `${optLegCount}-leg options`;
    return `${modeLabel} · ${t.ticker}  ·  ${sl!.instruction} ${sl!.quantity} sh + ${optDesc}`;
  }
  if (!t.isOption) {
    return `${modeLabel} · ${t.side ?? ""} ${t.quantity} ${t.ticker}`.replace(/\s+/g, " ").trim();
  }
  if (t.isMultiLeg && t.legs && t.legs.length > 0) {
    const ng = t.netPrice != null
      ? `  ·  net ${t.isCredit ? "credit" : "debit"} $${Math.abs(t.netPrice).toFixed(2)}`
      : "";
    return `${modeLabel} · ${t.ticker}  ·  ${t.legs.length}-leg${ng}`;
  }
  if (t.legs && t.legs.length === 1) {
    return `${modeLabel} · ${t.ticker}  ·  ${formatLeg(t.legs[0])}`;
  }
  return `${modeLabel} · option on ${t.ticker}`;
}

function fmtTimestampForCopy(iso?: string | number | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const VERDICT_PLAIN_LABEL: Record<ValidationVerdict, string> = {
  PROCEED: "Proceed",
  PROCEED_WITH_CAUTION: "Proceed With Caution",
  DO_NOT_PROCEED: "Do Not Proceed",
};

export function validationCardToPlainText(
  payload: ValidationVerdictPayload,
  meta: StrategistValidationMeta | null | undefined,
  generatedAt?: string | number | null,
): string {
  const lines: string[] = [];
  const ts = fmtTimestampForCopy(generatedAt ?? Date.now());
  const ticker = meta?.ticket?.ticker ?? "";
  const verdictLabel = VERDICT_PLAIN_LABEL[payload.verdict];
  const conf = Math.max(0, Math.min(100, Math.round(payload.confidence)));

  lines.push(
    `${ticker ? ticker + " — " : ""}Strategist Validation: ${verdictLabel} (${conf}% conf)`,
  );
  if (ts) lines.push(`Generated: ${ts}`);

  if (meta) {
    const summary = describeTicket(meta);
    if (summary) lines.push("", "TICKET", summary);

    if (
      (meta.ticket?.stockLeg && meta.ticket.stockLeg.quantity > 0) ||
      (meta.ticket?.legs && meta.ticket.legs.length > 0)
    ) {
      lines.push("", "LEGS");
      const sl = meta.ticket.stockLeg;
      if (sl && sl.quantity > 0) {
        const px = sl.limitPrice != null ? ` @ $${sl.limitPrice.toFixed(2)}` : "";
        lines.push(`  Stock leg: ${sl.instruction} ${sl.quantity} sh ${meta.ticket.ticker}${px}`);
      }
      if (meta.ticket.legs) {
        for (const l of meta.ticket.legs) {
          lines.push("  " + formatLeg(l));
        }
      }
      if (meta.ticket.netPrice != null) {
        lines.push(
          `  Net ${meta.ticket.isCredit ? "credit" : "debit"}: $${Math.abs(meta.ticket.netPrice).toFixed(2)}`,
        );
      }
    }

    // Existing underlying-share position (covered/married/protective context)
    if (meta.ticket?.underlyingShares && meta.ticket.underlyingShares.quantity > 0) {
      const coverage = detectCoverageLabel(meta);
      lines.push("", "EXISTING UNDERLYING POSITION");
      lines.push("  " + describeUnderlyingShares(meta.ticket.underlyingShares, meta.ticket.ticker));
      if (coverage) lines.push(`  Detected structure: ${coverage}`);
    }
  }

  if (meta?.thesis) {
    lines.push("", "TRADER THESIS", meta.thesis);
  }
  if (meta?.rollingShort) {
    lines.push("", "ROLLING SHORT: yes (short leg expires before long leg)");
  }

  if (payload.bullConfidence != null || payload.bearConfidence != null) {
    const parts: string[] = [];
    if (payload.bullConfidence != null) parts.push(`Bull ${payload.bullConfidence}%`);
    if (payload.bearConfidence != null) parts.push(`Bear ${payload.bearConfidence}%`);
    lines.push("", "DEBATE SPLIT", parts.join("  ·  "));
  }

  if (payload.reasoningBullets.length > 0) {
    lines.push("", "REASONING");
    for (const b of payload.reasoningBullets) lines.push(`  • ${b}`);
  }
  if (payload.risks.length > 0) {
    lines.push("", "RISKS");
    for (const r of payload.risks) lines.push(`  • ${r}`);
  }
  if (payload.verdict !== "PROCEED" && payload.improvements.length > 0) {
    lines.push("", "IMPROVEMENTS");
    for (const s of payload.improvements) lines.push(`  • ${s}`);
  }

  return lines.join("\n");
}

// Generic copy-to-clipboard button used across the validation card sections.
// Accepts a function so we can defer text serialization until click time
// (which keeps re-render cost low and allows lazy heavy serializers).
function CopyTextButton({
  getText,
  ariaLabel,
}: {
  getText: () => string;
  ariaLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // give up silently
      }
    }
  }, [getText]);
  return (
    <button
      onClick={onCopy}
      aria-label={ariaLabel}
      className="flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider transition-all active:scale-95"
      style={{
        background: copied ? "rgba(46, 204, 113, 0.15)" : "rgba(255,255,255,0.06)",
        color: copied ? "#2ecc71" : "#a1a1aa",
        border: copied ? "1px solid rgba(46, 204, 113, 0.35)" : "1px solid rgba(255,255,255,0.10)",
      }}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function CopyValidationButton({
  payload,
  meta,
  generatedAt,
}: {
  payload: ValidationVerdictPayload;
  meta: StrategistValidationMeta | null | undefined;
  generatedAt?: string | number | null;
}) {
  return (
    <CopyTextButton
      ariaLabel="Copy validation card to clipboard"
      getText={() => validationCardToPlainText(payload, meta, generatedAt ?? undefined)}
    />
  );
}

function isValidationPayload(v: unknown): v is ValidationVerdictPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    (o.verdict === "PROCEED" || o.verdict === "PROCEED_WITH_CAUTION" || o.verdict === "DO_NOT_PROCEED") &&
    typeof o.confidence === "number" &&
    Array.isArray(o.reasoningBullets) &&
    Array.isArray(o.risks) &&
    Array.isArray(o.improvements)
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Bullet({ text, dotColor = "#a3a3a3" }: { text: string; dotColor?: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="rounded-full mt-[7px] shrink-0" style={{ width: 4, height: 4, background: dotColor }} />
      <span style={{ color: "#d4d4d4", fontSize: 12, lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "#525252", fontSize: 9, letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 6, fontFamily: SYS_FONT }}>
      {children}
    </div>
  );
}

function CollapsibleBlock({
  icon: Icon,
  title,
  children,
  defaultOpen = false,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: "1px solid #1f1f1f" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full px-4 py-3 transition-colors"
        style={{ background: "transparent" }}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5" style={{ color: "#525252" }} />
          <span style={{ color: "#737373", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: SYS_FONT }}>
            {title}
          </span>
        </div>
        {open
          ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "#525252" }} />
          : <ChevronDown className="w-3.5 h-3.5" style={{ color: "#525252" }} />}
      </button>
      {open && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Full Transcript collapsible ─────────────────────────────────────────────

function ProseTranscript({ transcript }: { transcript: StrategistTranscriptTurn[] }) {
  if (transcript.length === 0) {
    return (
      <div style={{ color: "#525252", fontSize: 11 }}>
        Transcript not available for this job.
      </div>
    );
  }

  const groups = useMemo(() => {
    const m = new Map<1 | 2 | 3 | "synthesis", StrategistTranscriptTurn[]>();
    for (const t of transcript) {
      const key = t.round;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    }
    return Array.from(m.entries());
  }, [transcript]);

  const roundLabel = (round: 1 | 2 | 3 | "synthesis"): string => {
    if (round === 1) return "Round 1 — Initial Cases";
    if (round === 2) return "Round 2 — Rebuttals";
    if (round === 3) return "Round 3 — Final Verdicts";
    return "Synthesis — Desk Verdict";
  };

  const sideStyle = (role: string): { fg: string; label: string; sideBorder: string } => {
    if (role === "A") return { fg: BULL_COLOR, label: "BULL", sideBorder: `${BULL_COLOR}50` };
    if (role === "B") return { fg: BEAR_COLOR, label: "BEAR", sideBorder: `${BEAR_COLOR}50` };
    if (role === "system") return { fg: "#a78bfa", label: "VERDICT", sideBorder: "rgba(167,139,250,0.4)" };
    return { fg: "#4ade80", label: "DESK", sideBorder: "rgba(74,222,128,0.4)" };
  };

  const extractProse = (turn: StrategistTranscriptTurn): React.ReactNode => {
    const parsed = safeParseTurnJson(turn.text);

    if (turn.phase === "propose") {
      const thesis = asStr(parsed?.thesis);
      if (thesis) {
        return (
          <p style={{ color: "#d4d4d4", fontSize: 12, lineHeight: 1.6, margin: 0 }}>{thesis}</p>
        );
      }
    }

    if (turn.phase === "critique") {
      const rebuttal = asStr(parsed?.rebuttal);
      if (rebuttal) {
        return (
          <p style={{ color: "#d4d4d4", fontSize: 12, lineHeight: 1.6, margin: 0 }}>{rebuttal}</p>
        );
      }
    }

    if (turn.phase === "final") {
      const verdict = asStr(parsed?.finalVerdict);
      const conf = asNum(parsed?.finalConfidence, 0);
      const bullets = asStrArr(parsed?.reasoningBullets);
      const risks = asStrArr(parsed?.risks);
      const pal = verdict === "PROCEED" ? VERDICT_PALETTE.PROCEED
        : verdict === "PROCEED_WITH_CAUTION" ? VERDICT_PALETTE.PROCEED_WITH_CAUTION
        : verdict === "DO_NOT_PROCEED" ? VERDICT_PALETTE.DO_NOT_PROCEED
        : null;
      return (
        <div className="space-y-2">
          {pal && (
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded-md font-bold"
                style={{ background: pal.bg, color: pal.fg, border: `1px solid ${pal.border}`, fontSize: 10, letterSpacing: "0.06em" }}
              >
                {pal.label}
              </span>
              {conf > 0 && (
                <span style={{ color: "#737373", fontSize: 11 }}>{conf}% confidence</span>
              )}
            </div>
          )}
          {bullets.length > 0 && (
            <div className="space-y-1">
              {bullets.map((b, i) => <Bullet key={i} text={b} />)}
            </div>
          )}
          {risks.length > 0 && (
            <div className="space-y-1 pt-1">
              {risks.map((r, i) => <Bullet key={i} text={r} dotColor="#f87171" />)}
            </div>
          )}
        </div>
      );
    }

    if (turn.phase === "info" && turn.role === "system") {
      const verdict = asStr(parsed?.verdict);
      const conf = asNum(parsed?.confidence, 0);
      const bullets = asStrArr(parsed?.reasoningBullets);
      const pal = verdict === "PROCEED" ? VERDICT_PALETTE.PROCEED
        : verdict === "PROCEED_WITH_CAUTION" ? VERDICT_PALETTE.PROCEED_WITH_CAUTION
        : verdict === "DO_NOT_PROCEED" ? VERDICT_PALETTE.DO_NOT_PROCEED
        : null;
      return (
        <div className="space-y-2">
          {pal && (
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 rounded-md font-bold"
                style={{ background: pal.bg, color: pal.fg, border: `1px solid ${pal.border}`, fontSize: 10, letterSpacing: "0.06em" }}
              >
                {pal.label}
              </span>
              {conf > 0 && (
                <span style={{ color: "#737373", fontSize: 11 }}>{conf}% confidence</span>
              )}
            </div>
          )}
          {bullets.length > 0 && (
            <div className="space-y-1">
              {bullets.map((b, i) => <Bullet key={i} text={b} />)}
            </div>
          )}
        </div>
      );
    }

    return (
      <p style={{ color: "#737373", fontSize: 12, lineHeight: 1.5, margin: 0, fontStyle: "italic" }}>
        {turn.text.slice(0, 300)}{turn.text.length > 300 ? "…" : ""}
      </p>
    );
  };

  return (
    <div className="space-y-5">
      {groups.map(([round, turns]) => (
        <div key={String(round)}>
          <div
            style={{
              color: "#525252",
              fontSize: 9,
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              marginBottom: 10,
              fontFamily: SYS_FONT,
            }}
          >
            {roundLabel(round)}
          </div>
          <div className="space-y-3">
            {turns.filter((t) => t.done).map((turn) => {
              const style = sideStyle(turn.role);
              return (
                <div
                  key={turn.id}
                  className="rounded-lg pl-3 pr-3 py-3"
                  style={{
                    background: "#0d0d0d",
                    borderLeft: `2px solid ${style.sideBorder}`,
                    border: "1px solid #1a1a1a",
                    borderLeftColor: style.sideBorder,
                    borderLeftWidth: 2,
                  }}
                >
                  <div
                    className="inline-flex items-center px-1.5 py-0.5 rounded mb-2"
                    style={{ background: `${style.fg}14`, border: `1px solid ${style.fg}40` }}
                  >
                    <span style={{ color: style.fg, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", fontFamily: SYS_FONT }}>
                      {style.label}
                    </span>
                  </div>
                  {extractProse(turn)}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Analyst Report collapsible ───────────────────────────────────────────────

function AnalystReport({
  payload,
  meta,
}: {
  payload: ValidationVerdictPayload;
  meta: StrategistValidationMeta | null | undefined;
}) {
  const pal = VERDICT_PALETTE[payload.verdict];
  const ticketSummary = meta ? describeTicket(meta) : "";
  const bullConf = payload.bullConfidence ?? null;
  const bearConf = payload.bearConfidence ?? null;

  return (
    <div className="space-y-4" style={{ fontFamily: SYS_FONT }}>
      {/* Header */}
      <div>
        {ticketSummary && (
          <div style={{ color: "#737373", fontSize: 11, marginBottom: 4 }}>{ticketSummary}</div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="px-2 py-0.5 rounded-md font-bold"
            style={{ background: pal.bg, color: pal.fg, border: `1px solid ${pal.border}`, fontSize: 10, letterSpacing: "0.06em" }}
          >
            {pal.label}
          </span>
          <span style={{ color: "#737373", fontSize: 11 }}>
            {Math.round(payload.confidence)}% desk confidence
          </span>
        </div>
      </div>

      {/* Bull / Bear confidence */}
      {(bullConf !== null || bearConf !== null) && (
        <div className="flex gap-3">
          {bullConf !== null && (
            <div
              className="flex-1 rounded-lg px-3 py-2"
              style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}
            >
              <div style={{ color: BULL_COLOR, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>Bull</div>
              <div style={{ color: "#e5e5e5", fontSize: 14, fontWeight: 600 }}>{bullConf}%</div>
              <div style={{ color: "#525252", fontSize: 9 }}>confidence</div>
            </div>
          )}
          {bearConf !== null && (
            <div
              className="flex-1 rounded-lg px-3 py-2"
              style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}
            >
              <div style={{ color: BEAR_COLOR, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>Bear</div>
              <div style={{ color: "#e5e5e5", fontSize: 14, fontWeight: 600 }}>{bearConf}%</div>
              <div style={{ color: "#525252", fontSize: 9 }}>confidence</div>
            </div>
          )}
        </div>
      )}

      {/* Trader context */}
      {meta?.thesis && (
        <div>
          <SectionLabel>Trader Thesis</SectionLabel>
          <div
            className="rounded-lg px-3 py-2.5"
            style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}
          >
            <p style={{ color: "#a3a3a3", fontSize: 12, lineHeight: 1.55, margin: 0, whiteSpace: "pre-wrap" }}>
              {meta.thesis}
            </p>
          </div>
        </div>
      )}

      {/* Key Considerations */}
      {payload.reasoningBullets.length > 0 && (
        <div>
          <SectionLabel>Key Considerations</SectionLabel>
          <div className="space-y-1.5">
            {payload.reasoningBullets.map((b, i) => <Bullet key={i} text={b} />)}
          </div>
        </div>
      )}

      {/* Risks */}
      {payload.risks.length > 0 && (
        <div>
          <SectionLabel>Key Risks</SectionLabel>
          <div className="space-y-1.5">
            {payload.risks.map((r, i) => <Bullet key={i} text={r} dotColor="#f87171" />)}
          </div>
        </div>
      )}

      {/* Improvements */}
      {payload.verdict !== "PROCEED" && payload.improvements.length > 0 && (
        <div>
          <SectionLabel>Suggested Improvements</SectionLabel>
          <div className="space-y-1.5">
            {payload.improvements.map((s, i) => <Bullet key={i} text={s} dotColor="#fbbf24" />)}
          </div>
        </div>
      )}

      {/* Rolling short note */}
      {meta?.rollingShort && (
        <div
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded"
          style={{ background: "rgba(147,197,253,0.08)", border: "1px solid rgba(147,197,253,0.25)" }}
        >
          <span style={{ color: "#93c5fd", fontSize: 10, letterSpacing: "0.04em" }}>
            Rolling short — short leg expires before long leg
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function StrategistValidationCard({
  result,
  meta,
  onReopenOrder,
  generatedAt,
  transcript = [],
}: {
  result: unknown;
  meta: StrategistValidationMeta | null | undefined;
  onReopenOrder?: (meta: StrategistValidationMeta) => void;
  generatedAt?: string | number | null;
  transcript?: StrategistTranscriptTurn[];
}) {
  const [confirmSend, setConfirmSend] = useState(false);

  const payload: ValidationVerdictPayload | null = useMemo(
    () => (isValidationPayload(result) ? result : null),
    [result],
  );

  const generatedLabel = useMemo(() => {
    if (generatedAt == null) return "";
    const d = typeof generatedAt === "number" ? new Date(generatedAt) : new Date(generatedAt as string);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [generatedAt]);

  if (!payload) {
    return (
      <div
        className="rounded-xl p-4"
        style={{
          background: "#141414",
          border: "1px solid #2a2a2a",
          fontFamily: SYS_FONT,
          color: "#525252",
          fontSize: 12,
        }}
      >
        Validation result unavailable.
      </div>
    );
  }

  const pal = VERDICT_PALETTE[payload.verdict];
  const Icon = pal.Icon;
  const confidence = Math.max(0, Math.min(100, Math.round(payload.confidence)));
  const ticketSummary = meta ? describeTicket(meta) : "";

  const ctaStyle: React.CSSProperties =
    payload.verdict === "PROCEED"
      ? {
          background: "linear-gradient(135deg, #0d9488, #14b8a6)",
          color: "#f0fdfa",
          border: "none",
        }
      : payload.verdict === "PROCEED_WITH_CAUTION"
      ? {
          background: "linear-gradient(135deg, #d97706, #fbbf24)",
          color: "#1c1008",
          border: "none",
        }
      : {
          background: "rgba(248,113,113,0.08)",
          color: "#f87171",
          border: "1px solid rgba(248,113,113,0.35)",
        };

  const ctaLabel =
    payload.verdict === "DO_NOT_PROCEED" ? "Send Back Order" : "Send Order";

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "#141414",
        border: `1px solid ${pal.border}`,
        fontFamily: SYS_FONT,
      }}
    >
      {/* ── Verdict banner ── */}
      <div
        className="px-4 py-3"
        style={{ background: pal.bg, borderBottom: `1px solid ${pal.border}` }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 shrink-0" style={{ color: pal.fg }} />
            <div>
              <div
                className="font-bold tracking-wider"
                style={{ color: pal.fg, fontSize: 13, letterSpacing: "0.06em" }}
              >
                {pal.label}
              </div>
              {ticketSummary && (
                <div style={{ color: "#737373", fontSize: 10, marginTop: 1 }}>{ticketSummary}</div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <CopyValidationButton payload={payload} meta={meta} generatedAt={generatedAt} />
            <span style={{ color: pal.fg, fontSize: 16, fontWeight: 700, lineHeight: 1 }}>
              {confidence}%
            </span>
            <span style={{ color: "#525252", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              confidence
            </span>
          </div>
        </div>

        {/* Confidence bar */}
        <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${confidence}%`, background: pal.fg, transition: "width 400ms ease-out" }}
          />
        </div>

        {/* Bull / Bear split tags */}
        {(payload.bullConfidence != null || payload.bearConfidence != null) && (
          <div className="flex gap-2 mt-2.5">
            {payload.bullConfidence != null && (
              <span
                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                style={{ background: `${BULL_COLOR}14`, color: BULL_COLOR, border: `1px solid ${BULL_COLOR}30` }}
              >
                Bull {payload.bullConfidence}%
              </span>
            )}
            {payload.bearConfidence != null && (
              <span
                className="px-2 py-0.5 rounded text-[10px] font-semibold"
                style={{ background: `${BEAR_COLOR}14`, color: BEAR_COLOR, border: `1px solid ${BEAR_COLOR}30` }}
              >
                Bear {payload.bearConfidence}%
              </span>
            )}
            {generatedLabel && (
              <span className="ml-auto" style={{ color: "#404040", fontSize: 9 }}>{generatedLabel}</span>
            )}
          </div>
        )}
      </div>

      {/* ── Stock leg attached to THIS order ticket (married put / covered call / collar) ── */}
      {meta?.ticket?.stockLeg && meta.ticket.stockLeg.quantity > 0 && (() => {
        const sl = meta.ticket.stockLeg;
        const accent = sl.instruction === "BUY" ? "#4ade80" : "#f87171";
        const px = sl.limitPrice != null ? ` @ $${sl.limitPrice.toFixed(2)}` : "";
        return (
          <div className="px-4 pt-3">
            <div
              className="rounded-lg px-3 py-2.5"
              style={{ background: "#0d0d0d", border: `1px solid ${accent}30`, borderLeft: `3px solid ${accent}` }}
            >
              <div style={{ color: "#404040", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
                Order ticket includes stock leg
              </div>
              <div style={{ color: "#e5e5e5", fontSize: 13, fontWeight: 600 }}>
                {sl.instruction} {sl.quantity.toLocaleString()} sh {meta.ticket.ticker}{px}
              </div>
              <div style={{ color: "#737373", fontSize: 10, marginTop: 4 }}>
                Strategist evaluated this combined order, not the option leg in isolation.
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Existing underlying-shares position (covered/married context) ── */}
      {meta?.ticket?.underlyingShares && meta.ticket.underlyingShares.quantity > 0 && (() => {
        const us = meta.ticket.underlyingShares;
        const coverage = detectCoverageLabel(meta);
        const accent = us.side === "long" ? "#4ade80" : "#f87171";
        return (
          <div className="px-4 pt-3">
            <div
              className="rounded-lg px-3 py-2.5"
              style={{ background: "#0d0d0d", border: `1px solid ${accent}30`, borderLeft: `3px solid ${accent}` }}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <div style={{ color: "#404040", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
                    Existing position in {meta.ticket.ticker}
                  </div>
                  <div style={{ color: "#e5e5e5", fontSize: 13, fontWeight: 600 }}>
                    {describeUnderlyingShares(us, meta.ticket.ticker)}
                  </div>
                </div>
                {coverage && (
                  <span
                    className="px-2 py-0.5 rounded font-semibold"
                    style={{ background: `${accent}14`, color: accent, border: `1px solid ${accent}40`, fontSize: 10, letterSpacing: "0.04em" }}
                  >
                    {coverage}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Trader context ── */}
      {(meta?.thesis || meta?.rollingShort) && (
        <div className="px-4 pt-3 space-y-1.5">
          {meta?.thesis && (
            <div className="rounded-lg px-3 py-2.5" style={{ background: "#0d0d0d", border: "1px solid #1a1a1a" }}>
              <div style={{ color: "#404040", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
                Trader thesis
              </div>
              <p style={{ color: "#a3a3a3", fontSize: 12, lineHeight: 1.5, margin: 0, whiteSpace: "pre-wrap" }}>
                {meta.thesis}
              </p>
            </div>
          )}
          {meta?.rollingShort && (
            <div
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded"
              style={{ background: "rgba(147,197,253,0.08)", border: "1px solid rgba(147,197,253,0.25)" }}
            >
              <span style={{ color: "#93c5fd", fontSize: 10, letterSpacing: "0.04em" }}>
                Rolling short — short leg expires before long leg
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Key reasoning bullets (synthesis) ── */}
      {payload.reasoningBullets.length > 0 && (
        <div className="px-4 pt-3 space-y-1.5">
          <SectionLabel>Reasoning</SectionLabel>
          {payload.reasoningBullets.map((b, i) => <Bullet key={i} text={b} />)}
        </div>
      )}

      {/* ── Risks ── */}
      {payload.risks.length > 0 && (
        <div className="px-4 pt-3 space-y-1.5">
          <SectionLabel>Risks</SectionLabel>
          {payload.risks.map((r, i) => <Bullet key={i} text={r} dotColor="#f87171" />)}
        </div>
      )}

      {/* ── Improvements (not shown for PROCEED) ── */}
      {payload.verdict !== "PROCEED" && payload.improvements.length > 0 && (
        <div className="px-4 pt-3 space-y-1.5">
          <SectionLabel>Improvements</SectionLabel>
          {payload.improvements.map((s, i) => <Bullet key={i} text={s} dotColor="#fbbf24" />)}
        </div>
      )}

      {/* ── CTA ── */}
      {meta && onReopenOrder && (
        <div className="px-4 pt-4 pb-1">
          {confirmSend ? (
            <div
              className="rounded-xl px-4 py-3 space-y-3"
              style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.30)" }}
            >
              <p style={{ color: "#f87171", fontSize: 12, margin: 0, textAlign: "center" }}>
                Strategist advises against this trade. Send anyway?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmSend(false)}
                  className="flex-1 py-2 rounded-lg transition-all active:scale-[0.98]"
                  style={{ background: "#1a1a1a", color: "#a3a3a3", fontSize: 12, border: "1px solid #2a2a2a" }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { setConfirmSend(false); onReopenOrder(meta); }}
                  className="flex-1 py-2 rounded-lg transition-all active:scale-[0.98] font-semibold"
                  style={{ background: "rgba(248,113,113,0.15)", color: "#f87171", fontSize: 12, border: "1px solid rgba(248,113,113,0.40)" }}
                >
                  Send Anyway
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                if (payload.verdict === "DO_NOT_PROCEED") {
                  setConfirmSend(true);
                } else {
                  onReopenOrder(meta);
                }
              }}
              className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl active:scale-[0.98] transition-all font-semibold"
              style={{
                ...ctaStyle,
                fontSize: 13,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              <Send className="w-3.5 h-3.5" />
              {ctaLabel}
            </button>
          )}
        </div>
      )}

      {/* ── Collapsibles ── */}
      <div className="mt-3">
        <CollapsibleBlock icon={MessageSquare} title="Full Transcript">
          <ProseTranscript transcript={transcript} />
        </CollapsibleBlock>

        <CollapsibleBlock icon={FileText} title="Analyst Report">
          <AnalystReport payload={payload} meta={meta} />
        </CollapsibleBlock>
      </div>
    </div>
  );
}
