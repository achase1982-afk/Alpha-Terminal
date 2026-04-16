import type { StrategistV2Result } from "@/components/StrategistV2Card";

const STRAT_LABELS: Record<string, string> = {
  bull_put_spread: "Bull Put Spread",
  bear_call_spread: "Bear Call Spread",
  call_debit_spread: "Call Debit Spread",
  put_debit_spread: "Put Debit Spread",
  bull_call_spread: "Bull Call Spread",
  bear_put_spread: "Bear Put Spread",
  iron_condor: "Iron Condor",
  butterfly: "Butterfly",
  calendar: "Calendar Spread",
  calendar_spread: "Calendar Spread",
  diagonal: "Diagonal Spread",
  diagonal_spread: "Diagonal Spread",
  ratio_spread: "Ratio Spread",
  straddle: "Straddle",
  strangle: "Strangle",
  naked_put: "Naked Put",
  naked_call: "Naked Call",
};

function fmtTimestamp(iso?: string | number | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtNum(n: number | undefined | null, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toFixed(digits);
}

function fmtInt(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString();
}

/**
 * Serialize a Strategist V2 card to plain text suitable for pasting into
 * iMessage, Slack, Notes, Gmail, etc. Empty/missing fields are omitted.
 */
export function strategistCardToPlainText(
  result: StrategistV2Result,
  generatedAt?: string | number | null,
): string {
  const lines: string[] = [];
  const ts = fmtTimestamp(generatedAt ?? Date.now());

  // Header
  if (result.status === "recommendation" && result.recommendation) {
    const rec = result.recommendation;
    const stratLabel = STRAT_LABELS[rec.strategyType] ?? rec.strategyType.replace(/_/g, " ");
    const conf = rec.confidence != null ? ` - ${rec.confidence}% conf` : "";
    lines.push(`${result.ticker} - ${stratLabel}${conf}`);
    if (ts) lines.push(`Generated: ${ts}`);

    if (rec.companyContext) {
      lines.push("", "COMPANY", rec.companyContext);
    }
    if (rec.thesis || rec.rationale) {
      lines.push("", "THESIS", rec.thesis || rec.rationale || "");
    }

    if (rec.legs && rec.legs.length) {
      lines.push("", "LEGS");
      for (const leg of rec.legs) {
        const side = (leg.side || "").toUpperCase();
        const type = (leg.type || "").toUpperCase();
        const parts = [
          `${side} ${type}`,
          `$${fmtNum(leg.strike, 2)}`,
          leg.expiration || "",
          leg.delta != null ? `delta ${fmtNum(leg.delta, 2)}` : "",
          leg.openInterest != null ? `OI ${fmtInt(leg.openInterest)}` : "",
          leg.mid != null ? `$${fmtNum(leg.mid, 2)}` : "",
        ].filter(Boolean);
        lines.push("  " + parts.join("  "));
      }
    }

    // Economics
    const econLines: string[] = [];
    const isCredit = rec.credit != null && rec.credit > 0;
    const entry = isCredit ? rec.credit : rec.debit;
    if (entry != null && entry > 0) {
      econLines.push(`${isCredit ? "Credit" : "Debit"}: $${fmtNum(entry, 2)} per contract ($${fmtInt(entry * 100)} on 1 lot)`);
    }
    if (rec.entryRangeMin != null && rec.entryRangeMax != null) {
      econLines.push(`Fill Range: $${fmtNum(Math.abs(rec.entryRangeMin), 2)} - $${fmtNum(Math.abs(rec.entryRangeMax), 2)}`);
    }
    if (rec.riskReward != null && rec.riskReward > 0) {
      econLines.push(`Risk/Reward: ${fmtNum(rec.riskReward, 2)}:1`);
    }
    if (rec.maxProfit != null) econLines.push(`Max Profit: $${fmtInt(rec.maxProfit)}`);
    if (rec.maxLoss != null) econLines.push(`Max Loss: $${fmtInt(rec.maxLoss)}`);
    if (rec.breakeven != null) econLines.push(`Breakeven: $${fmtNum(rec.breakeven, 2)}`);
    if (rec.dte != null) econLines.push(`DTE: ${rec.dte}d`);
    if (econLines.length) {
      lines.push("", "ECONOMICS", ...econLines);
    }

    // Exit targets
    const et = rec.exitTargets;
    if (et && (et.profitTarget > 0 || et.stopLoss > 0 || et.timeStop)) {
      const etLines: string[] = [];
      if (et.profitTarget > 0) {
        const under = et.profitTargetUnderlying > 0 ? `, underlying $${fmtNum(et.profitTargetUnderlying, 2)}` : "";
        etLines.push(`Profit Target: $${fmtNum(et.profitTarget, 2)} per contract ($${fmtInt(et.profitTarget * 100)} on 1 lot${under})`);
      }
      if (et.stopLoss > 0) {
        const under = et.stopLossUnderlying > 0 ? `, underlying $${fmtNum(et.stopLossUnderlying, 2)}` : "";
        etLines.push(`Stop Loss: $${fmtNum(et.stopLoss, 2)} per contract ($${fmtInt(et.stopLoss * 100)} on 1 lot${under})`);
      }
      if (et.timeStop) etLines.push(`Time Stop: ${et.timeStop}`);
      lines.push("", "EXIT TARGETS", ...etLines);
    }

    // Invalidation
    if (rec.bullInvalidation || rec.bearInvalidation) {
      lines.push("", "INVALIDATION");
      if (rec.bullInvalidation) lines.push(`Bull: ${rec.bullInvalidation}`);
      if (rec.bearInvalidation) lines.push(`Bear: ${rec.bearInvalidation}`);
    }

    if (rec.riskOfRuin) {
      lines.push("", "RISK OF RUIN", rec.riskOfRuin);
    }

    if (rec.warnings) {
      lines.push("", "CAUTION", rec.warnings);
    }
  } else {
    // Block or no_viable_setup — still provide a useful paste
    lines.push(`${result.ticker} - ${result.status === "toxic_block" ? "TOXIC BLOCK" : "NO VIABLE SETUP"}`);
    if (ts) lines.push(`Generated: ${ts}`);
    if (result.blockReason) lines.push("", "REASON", result.blockReason);
  }

  // IOScore block (shared on both recommendation + block)
  if (result.ioScore) {
    const io = result.ioScore;
    const ioLines: string[] = [];
    const pct = Math.round((io.final ?? 0) * 100);
    const classLabel = (io.classification || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    ioLines.push(`Overall: ${pct}%  Classification: ${classLabel}`);
    if (result.recommendation) {
      const rec = result.recommendation;
      if (rec.idioStrengthPct != null && rec.macroPct != null) {
        ioLines.push(`Edge: Idiosyncratic ${rec.idioStrengthPct}% / Macro ${rec.macroPct}%`);
      }
    }
    const reg = result.regime;
    if (reg) {
      const conv = (reg.directionalConviction || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const risk = (reg.systemicRiskLevel || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const corr = (reg.correlationRegime || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      ioLines.push(`Conviction: ${conv}  Risk: ${risk}`);
      if (reg.compositeScore != null) {
        ioLines.push(`Correlation: ${corr}  Composite: ${fmtNum(reg.compositeScore, 1)}`);
      } else {
        ioLines.push(`Correlation: ${corr}`);
      }
      if (reg.idioOpportunityFlag != null) {
        ioLines.push(`Idio Opportunity: ${reg.idioOpportunityFlag ? "Yes" : "No"}`);
      }
    }
    lines.push("", "IOSCORE", ...ioLines);
  }

  // Collapse accidental triple blank lines
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
