import { useCallback, useMemo, type CSSProperties } from "react";
import type { BlockReason, StrategistOutcome, StrategistSendToOrderPayload } from "@/components/StrategistV2Card";
import { buildOccSymbol } from "@/components/StrategistV2Card";
import { Copy, Play } from "lucide-react";
import { toast } from "sonner";
import type {
  ConvictionDeskResult,
  DeskLeg,
  DeskStructure,
  PayoffScenario,
  PayoffScenariosSummary,
} from "@/lib/strategistDeskResult";
import { buildConvictionDeskMemoPlainText } from "@/lib/convictionDeskMemoPlain";

const SYS_FONT = "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif";
const TOUCH_MIN = 44;

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

function fmtCurrencyPlain(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedUsd(n: number): string {
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+$${abs}`;
  if (n < 0) return `-$${abs}`;
  return `$${abs}`;
}

function parseConvictionLegs(raw: unknown[]): DeskLeg[] | null {
  const out: DeskLeg[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
    const o = item as Record<string, unknown>;
    const type = o.type;
    const strike = o.strike;
    const action = o.action;
    const expiration = (o.expiration ?? o.expiry) as unknown;
    if (typeof type !== "string" || typeof action !== "string" || typeof expiration !== "string") return null;
    if (typeof strike !== "number" || !Number.isFinite(strike)) return null;
    const leg: DeskLeg = { type, strike, action, expiration };
    const qty = o.quantity;
    if (typeof qty === "number" && qty > 0) leg.quantity = qty;
    out.push(leg);
  }
  return out.length ? out : null;
}

function convictionChosenToDeskStructure(chosen: NonNullable<ConvictionDeskResult["conviction"]>["decision"]["chosen"]): DeskStructure | null {
  if (!chosen) return null;
  const legs = parseConvictionLegs(chosen.legs as unknown[]);
  if (!legs) return null;
  return {
    type: chosen.structure,
    legs,
    expiry: chosen.expiry,
    credit_or_debit: chosen.credit_or_debit,
  };
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

function GreeksPanel({ greeks }: { greeks: { delta: number; gamma: number; theta: number; vega: number; front_vega?: number; back_vega?: number } }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
      {[
        ["Delta", greeks.delta],
        ["Gamma", greeks.gamma],
        ["Theta", greeks.theta],
        ["Vega", greeks.vega],
      ].map(([k, v]) => (
        <div key={k as string}>
          <div style={{ fontSize: 9, color: PAL.label }}>{k}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: PAL.white }}>{typeof v === "number" ? v.toFixed(4) : String(v)}</div>
        </div>
      ))}
      {(greeks.front_vega != null || greeks.back_vega != null) && (
        <div style={{ fontSize: 11, color: PAL.body }}>
          {greeks.front_vega != null && <span style={{ marginRight: 12 }}>Front vega {greeks.front_vega.toFixed(4)}</span>}
          {greeks.back_vega != null && <span>Back vega {greeks.back_vega.toFixed(4)}</span>}
        </div>
      )}
    </div>
  );
}

function OutcomeDistributionBar({ dist }: { dist: { p5: number; p25: number; p50: number; p75: number; p95: number } }) {
  const min = dist.p5;
  const max = dist.p95;
  const span = max - min || 1;
  const pct = (x: number) => ((x - min) / span) * 100;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
        Outcome distribution (P5–P95)
      </div>
      <div style={{ position: "relative", height: 28, borderRadius: 6, background: PAL.bgInner, border: `1px solid ${PAL.borderInner}` }}>
        <div
          style={{
            position: "absolute",
            left: `${pct(dist.p25)}%`,
            width: `${Math.max(0, pct(dist.p75) - pct(dist.p25))}%`,
            top: 6,
            bottom: 6,
            background: "rgba(251,191,36,0.35)",
            borderRadius: 4,
          }}
        />
        {[dist.p5, dist.p25, dist.p50, dist.p75, dist.p95].map((x, i) => (
          <div
            key={i}
            title={fmtSignedUsd(x)}
            style={{
              position: "absolute",
              left: `${pct(x)}%`,
              top: 2,
              width: 2,
              marginLeft: -1,
              height: 24,
              background: i === 2 ? PAL.gold : PAL.label,
              borderRadius: 1,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: PAL.label, marginTop: 6 }}>
        <span>P5 {fmtSignedUsd(dist.p5)}</span>
        <span>P50 {fmtSignedUsd(dist.p50)}</span>
        <span>P95 {fmtSignedUsd(dist.p95)}</span>
      </div>
    </div>
  );
}

function PayoffAtExpirationSection({
  scenarios,
  summary,
}: {
  scenarios: PayoffScenario[];
  summary: PayoffScenariosSummary;
}) {
  const profitZone =
    summary.profitZoneLow != null && summary.profitZoneHigh != null
      ? `${fmtCurrencyPlain(summary.profitZoneLow)} — ${fmtCurrencyPlain(summary.profitZoneHigh)}`
      : null;

  let breakdownLine: string | null = null;
  const down = summary.downsideBreakdown;
  const up = summary.upsideBreakdown;
  if (down != null && up != null) {
    breakdownLine = `below ${fmtCurrencyPlain(down)} or above ${fmtCurrencyPlain(up)}`;
  } else if (down != null) {
    breakdownLine = `below ${fmtCurrencyPlain(down)}`;
  } else if (up != null) {
    breakdownLine = `above ${fmtCurrencyPlain(up)}`;
  }

  const pnlColor = (c: PayoffScenario["pnlColor"]) =>
    c === "green" ? PAL.green : c === "red" ? PAL.red : PAL.label;

  const midIdx = Math.floor(scenarios.length / 2);
  const spotRef = scenarios[midIdx]?.underlyingPrice ?? scenarios[0]?.underlyingPrice ?? 0;
  const pctVsSpot = (price: number) => (spotRef > 0 ? ((price / spotRef - 1) * 100) : 0);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
        Payoff at expiration
      </div>
      <div style={{ fontSize: 11, color: PAL.body, lineHeight: 1.6, marginBottom: 10 }}>
        <div>
          Peak: {fmtSignedUsd(summary.peakPnl)} at {fmtCurrencyPlain(summary.peakPnlPrice)}
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
        <table style={{ borderCollapse: "collapse", fontSize: 11, minWidth: "100%", fontFamily: SYS_FONT }}>
          <tbody>
            <tr>
              <td style={{ padding: "6px 10px 6px 4px", color: PAL.label, whiteSpace: "nowrap", verticalAlign: "bottom" }}>Stock move</td>
              {scenarios.map((s, i) => {
                const p = pctVsSpot(s.underlyingPrice);
                return (
                  <td key={i} style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
                    <div style={{ fontSize: 10, color: PAL.label }}>{p >= 0 ? "+" : ""}{p.toFixed(1)}%</div>
                    <div style={{ color: PAL.white, fontWeight: 600 }}>{fmtCurrencyPlain(s.underlyingPrice)}</div>
                  </td>
                );
              })}
            </tr>
            <tr style={{ borderTop: `1px solid ${PAL.borderInner}` }}>
              <td style={{ padding: "6px 10px 6px 4px", color: PAL.label, whiteSpace: "nowrap" }}>Spread Value</td>
              {scenarios.map((s, i) => (
                <td key={i} style={{ padding: "6px 8px", textAlign: "right", color: PAL.body, whiteSpace: "nowrap" }}>
                  {fmtCurrencyPlain(s.spreadValue)}
                </td>
              ))}
            </tr>
            <tr style={{ borderTop: `1px solid ${PAL.borderInner}` }}>
              <td style={{ padding: "6px 10px 6px 4px", color: PAL.label, whiteSpace: "nowrap" }}>P/L</td>
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
                  {fmtSignedUsd(s.pnl)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function convictionBanner(
  strategistOutcome: StrategistOutcome | undefined,
  blockReason: BlockReason | undefined,
  convictionDeskJsonDegraded: ConvictionDeskResult["convictionDeskJsonDegraded"],
): { title: string; body: string; border: string; bg: string; accent: string } | null {
  if (convictionDeskJsonDegraded === "schema_validation_failed_after_retry") {
    return {
      title: "Conviction Desk — Output Parse Failed",
      body: "The memo JSON did not match the required schema after retry. Retry the run or switch model or provider.",
      border: "rgba(239,68,68,0.45)",
      bg: "rgba(239,68,68,0.1)",
      accent: PAL.red,
    };
  }
  if (strategistOutcome === "ANALYSIS_INCOMPLETE" || blockReason?.category === "ANALYSIS_INCOMPLETE") {
    return {
      title: "Analysis Incomplete",
      body: blockReason?.detail ?? "The memo did not validate after retry.",
      border: "rgba(245,158,11,0.35)",
      bg: "rgba(245,158,11,0.08)",
      accent: PAL.gold,
    };
  }
  return null;
}

export type StrategistConvictionDeskCardProps = {
  deskResult: ConvictionDeskResult;
  generatedAt?: string | number | null;
  strategistOutcome?: StrategistOutcome;
  blockReason?: BlockReason;
  onRetry?: (ticker: string) => void;
  onSendToOrder?: (payload: StrategistSendToOrderPayload) => void;
};

export function StrategistConvictionDeskCard({
  deskResult,
  generatedAt,
  strategistOutcome,
  blockReason,
  onRetry,
  onSendToOrder,
}: StrategistConvictionDeskCardProps) {
  const conviction = deskResult.conviction;
  const incomplete = deskResult.convictionDeskJsonDegraded === "schema_validation_failed_after_retry" || conviction == null;

  const chosen = conviction?.decision.chosen ?? null;
  const isNoTrade =
    incomplete ||
    chosen == null ||
    conviction.size === "no-trade" ||
    conviction.view.decision_intent === "pass";

  const structure = chosen ? convictionChosenToDeskStructure(chosen) : null;

  const payoffScenarios = deskResult.payoffScenarios;
  const payoffSummary = deskResult.payoffSummary;
  const showPayoff =
    Array.isArray(payoffScenarios) && payoffScenarios.length > 0 && payoffSummary != null && !isNoTrade;

  const memoPlain = useMemo(
    () => buildConvictionDeskMemoPlainText({ deskResult, generatedAt }),
    [deskResult, generatedAt],
  );

  const copyPlain = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(memoPlain);
      toast.success("Copied memo text");
    } catch {
      toast.error("Copy failed");
    }
  }, [memoPlain]);

  const playMemo = useCallback(() => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(memoPlain);
      u.rate = 1;
      window.speechSynthesis.speak(u);
    } catch {
      toast.error("Playback unavailable");
    }
  }, [memoPlain]);

  const btnStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: TOUCH_MIN,
    padding: "8px 12px",
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
    outline: "none",
  };

  const banner = convictionBanner(strategistOutcome, blockReason, deskResult.convictionDeskJsonDegraded);

  const sendToOrder = useCallback(() => {
    if (!onSendToOrder || !structure) return;
    const isCredit = structure.credit_or_debit < 0;
    const netPrice = Math.abs(structure.credit_or_debit);
    const legs = structure.legs.map((leg) => {
      const action = leg.action.toLowerCase();
      const isBuy = action === "buy" || action.startsWith("buy");
      const typ = leg.type.toUpperCase();
      const optionType = typ.includes("CALL") ? "CALL" : "PUT";
      return {
        schwabSymbol: buildOccSymbol(deskResult.ticker, leg.expiration, leg.type, leg.strike),
        instruction: isBuy ? "BUY_TO_OPEN" : "SELL_TO_OPEN",
        quantity: leg.quantity != null && leg.quantity > 0 ? leg.quantity : 1,
        optionType,
        strike: leg.strike,
        expiration: leg.expiration,
        bid: 0,
        ask: 0,
        delta: 0,
      };
    });
    onSendToOrder({ ticker: deskResult.ticker, legs, netPrice, isCredit });
  }, [deskResult.ticker, onSendToOrder, structure]);

  if (!conviction) {
    return (
      <div style={{ background: PAL.bgCard, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16, fontFamily: SYS_FONT }}>
        {banner && (
          <div style={{ border: `1px solid ${banner.border}`, background: banner.bg, borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: banner.accent }}>{banner.title}</div>
            <div style={{ fontSize: 12, color: PAL.body, marginTop: 6 }}>{banner.body}</div>
            {onRetry && (
              <button type="button" onClick={() => onRetry(deskResult.ticker)} style={{ marginTop: 10, padding: "8px 14px", borderRadius: 6, border: "none", background: "#fbbf24", color: "#0a0a0a", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
                Retry
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  const g = conviction.self_grade;

  return (
    <div style={{ position: "relative", background: PAL.bgCard, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16, fontFamily: SYS_FONT }}>
      {banner && (
        <div style={{ border: `1px solid ${banner.border}`, background: banner.bg, borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: banner.accent, letterSpacing: 0.8, marginBottom: 6 }}>{banner.title}</div>
          <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>{banner.body}</div>
          {(strategistOutcome === "ANALYSIS_INCOMPLETE" || blockReason?.category === "ANALYSIS_INCOMPLETE") && onRetry && (
            <button type="button" onClick={() => onRetry(deskResult.ticker)} style={{ marginTop: 10, padding: "8px 14px", borderRadius: 6, border: "none", background: "#fbbf24", color: "#0a0a0a", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
              Retry
            </button>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: isNoTrade ? "#a3a3a3" : PAL.green,
              background: isNoTrade ? "rgba(161,161,170,0.12)" : "rgba(74,222,128,0.1)",
              border: `1px solid ${isNoTrade ? "rgba(161,161,170,0.35)" : "rgba(74,222,128,0.3)"}`,
              padding: "3px 8px",
              borderRadius: 4,
            }}
          >
            {isNoTrade ? "NO TRADE" : "TRADE"}
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: PAL.white }}>{deskResult.ticker}</span>
          <span style={{ fontSize: 10, color: PAL.label, letterSpacing: 0.5 }}>CONVICTION DESK</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          <button type="button" onClick={() => void copyPlain()} style={btnStyle} aria-label="Copy memo">
            <Copy size={14} /> Copy
          </button>
          <button type="button" onClick={() => playMemo()} style={btnStyle} aria-label="Play memo audio">
            <Play size={14} /> Play
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: PAL.label, marginBottom: 8 }}>{conviction.regime.summary}</div>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>View</div>
        <div style={{ fontSize: 13, color: PAL.body, lineHeight: 1.65 }}>{conviction.view.paragraph}</div>
      </div>

      {isNoTrade && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: PAL.white, letterSpacing: 1 }}>NO TRADE</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: PAL.red, marginTop: 12, marginBottom: 6 }}>FAILURE CASE</div>
          <blockquote style={{ margin: 0, padding: "10px 12px", borderLeft: `3px solid ${PAL.gold}`, background: PAL.bgInner, fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>
            {conviction.failure_scenario.steelman}
          </blockquote>
          {conviction.failure_scenario.response && (
            <div style={{ marginTop: 10, fontSize: 12, color: PAL.body }}>{conviction.failure_scenario.response}</div>
          )}
        </div>
      )}

      {!isNoTrade && chosen && structure && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Decision</div>
          <StructureDisplay structure={structure} />
          <GreeksPanel greeks={chosen.greeks_entry} />
          <OutcomeDistributionBar dist={chosen.outcome_distribution} />

          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: "pointer", fontSize: 11, color: PAL.gold }}>Rejected alternatives</summary>
            <div style={{ marginTop: 8 }}>
              {conviction.decision.rejected_alternatives.map((r, i) => (
                <div key={i} style={{ fontSize: 11, color: PAL.body, marginBottom: 6 }}>
                  <strong style={{ color: PAL.white }}>{r.structure}</strong>: {r.reason}
                </div>
              ))}
            </div>
          </details>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: PAL.red, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Failure scenario</div>
            <blockquote style={{ margin: 0, padding: "10px 12px", borderLeft: `3px solid ${PAL.red}`, background: "rgba(248,113,113,0.06)", fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>
              {conviction.failure_scenario.steelman}
            </blockquote>
            <div style={{ marginTop: 10, fontSize: 12, color: PAL.body }}>{conviction.failure_scenario.response}</div>
          </div>

          {conviction.scenarios && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Scenarios</div>
              <div style={{ fontSize: 11, color: PAL.body, lineHeight: 1.55, marginBottom: 8 }}>
                <strong>Designed:</strong> {conviction.scenarios.designed.description} P/L {fmtSignedUsd(conviction.scenarios.designed.pnl_per_spread)}
              </div>
              <div style={{ fontSize: 11, color: PAL.body, lineHeight: 1.55, marginBottom: 8 }}>
                <strong>Adverse:</strong> {conviction.scenarios.adverse_bounded.description} P/L {fmtSignedUsd(conviction.scenarios.adverse_bounded.pnl_per_spread)} stop: {conviction.scenarios.adverse_bounded.stop_trigger}
              </div>
              <div style={{ fontSize: 11, color: PAL.body, lineHeight: 1.55 }}>
                <strong>Tail:</strong> {conviction.scenarios.tail.description} P/L {fmtSignedUsd(conviction.scenarios.tail.pnl_per_spread)}
              </div>
            </div>
          )}

          {conviction.exit_plan && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>Exit plan</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>
                {conviction.exit_plan.profit_take.map((p, i) => (
                  <li key={i}>{p.level}: scale out {p.scale_out_pct}%</li>
                ))}
                {conviction.exit_plan.vol_trigger && <li>Vol: {conviction.exit_plan.vol_trigger}</li>}
                {conviction.exit_plan.price_trigger && <li>Price: {conviction.exit_plan.price_trigger}</li>}
                <li>Time stop (backstop): {conviction.exit_plan.time_stop}</li>
              </ul>
            </div>
          )}

          {showPayoff && payoffSummary && <PayoffAtExpirationSection scenarios={payoffScenarios!} summary={payoffSummary} />}

          {onSendToOrder && (
            <button
              type="button"
              onClick={sendToOrder}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 8,
                border: "none",
                background: PAL.goldHeader,
                color: "#0a0a0a",
                fontSize: 14,
                fontWeight: 800,
                cursor: "pointer",
                marginBottom: 12,
                minHeight: TOUCH_MIN,
              }}
            >
              Send to Order Ticket
            </button>
          )}
        </>
      )}

      <div style={{ borderTop: `1px solid ${PAL.borderInner}`, paddingTop: 10, fontSize: 10, color: PAL.label, lineHeight: 1.6 }}>
        Self-grade: Vol {g.vol}, Flow {g.flow}, Catalyst {g.catalyst}, Regime {g.regime}, Structure fit {g.structure_fit}, Failure {g.failure_scenario_strength}, Conviction {g.conviction}
        {conviction.size && (
          <span style={{ marginLeft: 8, color: PAL.white }}>Size {conviction.size}</span>
        )}
      </div>

    </div>
  );
}
