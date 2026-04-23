import { useMemo } from "react";
import { ShieldCheck, AlertTriangle, ShieldX, Send } from "lucide-react";
import type { StrategistValidationMeta } from "@/lib/store";

export type ValidationVerdict = "PROCEED" | "PROCEED_WITH_CAUTION" | "DO_NOT_PROCEED";

export interface ValidationVerdictPayload {
  verdict: ValidationVerdict;
  confidence: number;
  reasoningBullets: string[];
  risks: string[];
  improvements: string[];
}

const SYS_FONT = "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif";

const COLORS: Record<ValidationVerdict, { fg: string; bg: string; border: string; label: string; Icon: typeof ShieldCheck }> = {
  PROCEED: {
    fg: "#4ade80",
    bg: "rgba(74, 222, 128, 0.10)",
    border: "rgba(74, 222, 128, 0.45)",
    label: "PROCEED",
    Icon: ShieldCheck,
  },
  PROCEED_WITH_CAUTION: {
    fg: "#fbbf24",
    bg: "rgba(251, 191, 36, 0.10)",
    border: "rgba(251, 191, 36, 0.45)",
    label: "PROCEED WITH CAUTION",
    Icon: AlertTriangle,
  },
  DO_NOT_PROCEED: {
    fg: "#f87171",
    bg: "rgba(248, 113, 113, 0.10)",
    border: "rgba(248, 113, 113, 0.45)",
    label: "DO NOT PROCEED",
    Icon: ShieldX,
  },
};

function formatLeg(l: NonNullable<StrategistValidationMeta["ticket"]["legs"]>[number]): string {
  const action = l.instruction.replace(/_/g, " ").toLowerCase();
  const qty = l.quantity ?? 1;
  if (l.strike != null && l.optionType && l.expiration) {
    return `${action} ${qty} ${l.expiration} ${l.strike} ${l.optionType.toLowerCase()}`;
  }
  return `${action} ${qty}`;
}

function describeTicket(meta: StrategistValidationMeta): string {
  const t = meta.ticket;
  if (!t.isOption) {
    return `${meta.mode === "closing" ? "Close" : "Open"} ${t.side ?? ""} ${t.quantity} ${t.ticker}`.trim();
  }
  if (t.isMultiLeg && t.legs && t.legs.length > 0) {
    const ng = t.netPrice != null
      ? `, net ${t.isCredit ? "credit" : "debit"} $${Math.abs(t.netPrice).toFixed(2)}`
      : "";
    return `${meta.mode === "closing" ? "Close" : "Open"} ${t.legs.length}-leg on ${t.ticker}${ng}`;
  }
  if (t.legs && t.legs.length === 1) {
    return `${meta.mode === "closing" ? "Close" : "Open"} ${formatLeg(t.legs[0])} on ${t.ticker}`;
  }
  return `${meta.mode === "closing" ? "Close" : "Open"} option on ${t.ticker}`;
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

export function StrategistValidationCard({
  result,
  meta,
  onReopenOrder,
  generatedAt,
}: {
  result: unknown;
  meta: StrategistValidationMeta | null | undefined;
  onReopenOrder?: (meta: StrategistValidationMeta) => void;
  generatedAt?: string | number | null;
}) {
  const payload: ValidationVerdictPayload | null = useMemo(
    () => (isValidationPayload(result) ? result : null),
    [result],
  );
  const palette = payload ? COLORS[payload.verdict] : COLORS.PROCEED_WITH_CAUTION;
  const Icon = palette.Icon;
  const confidence = payload ? Math.max(0, Math.min(100, Math.round(payload.confidence))) : 0;
  const ticketSummary = meta ? describeTicket(meta) : "";
  const generatedLabel = useMemo(() => {
    if (generatedAt == null) return "";
    const d = typeof generatedAt === "number" ? new Date(generatedAt) : new Date(generatedAt);
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
          color: "#a3a3a3",
          fontSize: 12,
        }}
      >
        Validation result unavailable.
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "#141414",
        border: `1px solid ${palette.border}`,
        fontFamily: SYS_FONT,
      }}
    >
      {/* Header — verdict badge */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: palette.bg, borderBottom: `1px solid ${palette.border}` }}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5" style={{ color: palette.fg }} />
          <div className="flex flex-col">
            <span
              className="font-bold tracking-wider"
              style={{ color: palette.fg, fontSize: 14, letterSpacing: "0.05em" }}
            >
              {palette.label}
            </span>
            {ticketSummary && (
              <span style={{ color: "#a3a3a3", fontSize: 11 }}>{ticketSummary}</span>
            )}
          </div>
        </div>
        {generatedLabel && (
          <span style={{ color: "#737373", fontSize: 10 }}>{generatedLabel}</span>
        )}
      </div>

      {/* Confidence bar */}
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between mb-1">
          <span style={{ color: "#a3a3a3", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Confidence
          </span>
          <span style={{ color: palette.fg, fontSize: 12, fontWeight: 600 }}>{confidence}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#1f1f1f" }}>
          <div
            className="h-full"
            style={{
              width: `${confidence}%`,
              background: palette.fg,
              transition: "width 300ms ease-out",
            }}
          />
        </div>
      </div>

      {/* Trader-supplied context */}
      {(meta?.thesis || meta?.rollingShort) && (
        <div className="px-4 pt-3 space-y-1.5">
          {meta?.thesis && (
            <div
              className="rounded-lg p-2.5"
              style={{ background: "#0a0a0a", border: "1px solid #1f1f1f" }}
            >
              <div
                style={{ color: "#737373", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}
              >
                Trader thesis
              </div>
              <div style={{ color: "#e5e5e5", fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                {meta.thesis}
              </div>
            </div>
          )}
          {meta?.rollingShort && (
            <div
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded"
              style={{ background: "rgba(147, 197, 253, 0.10)", border: "1px solid rgba(147, 197, 253, 0.30)" }}
            >
              <span style={{ color: "#93c5fd", fontSize: 10, letterSpacing: "0.04em" }}>
                Rolling short — short leg expires before long leg
              </span>
            </div>
          )}
        </div>
      )}

      {/* Reasoning bullets */}
      {payload.reasoningBullets.length > 0 && (
        <Section title="Reasoning">
          {payload.reasoningBullets.map((b, i) => (
            <Bullet key={i} text={b} />
          ))}
        </Section>
      )}

      {/* Risks */}
      {payload.risks.length > 0 && (
        <Section title="Risks">
          {payload.risks.map((b, i) => (
            <Bullet key={i} text={b} dotColor="#f87171" />
          ))}
        </Section>
      )}

      {/* Improvements (only when not PROCEED) */}
      {payload.verdict !== "PROCEED" && payload.improvements.length > 0 && (
        <Section title="Improvements">
          {payload.improvements.map((b, i) => (
            <Bullet key={i} text={b} dotColor="#fbbf24" />
          ))}
        </Section>
      )}

      {/* Reopen-order CTA */}
      {meta && onReopenOrder && (
        <div className="px-4 pt-2 pb-4">
          <button
            onClick={() => onReopenOrder(meta)}
            className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl active:scale-[0.98] transition-all"
            style={{
              background: payload.verdict === "DO_NOT_PROCEED"
                ? "rgba(255,255,255,0.06)"
                : "linear-gradient(135deg, #f5a623, #ffce73)",
              color: payload.verdict === "DO_NOT_PROCEED" ? "#e5e5e5" : "#050607",
              border: payload.verdict === "DO_NOT_PROCEED" ? "1px solid #2a2a2a" : "none",
              fontWeight: 600,
              fontSize: 13,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontFamily: SYS_FONT,
            }}
          >
            <Send className="w-3.5 h-3.5" />
            {payload.verdict === "DO_NOT_PROCEED" ? "Send Order Anyway" : "Send Order"}
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3">
      <div
        style={{ color: "#737373", fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}
      >
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Bullet({ text, dotColor = "#a3a3a3" }: { text: string; dotColor?: string }) {
  return (
    <div className="flex items-start gap-2">
      <div
        className="rounded-full mt-1.5 shrink-0"
        style={{ width: 5, height: 5, background: dotColor }}
      />
      <div style={{ color: "#e5e5e5", fontSize: 12, lineHeight: 1.45 }}>{text}</div>
    </div>
  );
}
