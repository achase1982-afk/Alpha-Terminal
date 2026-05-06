import type { ConvictionDeskResult } from "./strategistDeskResult";

/** Memo plain text for copy, play audio, and screen readers (matches rendered conviction card). */
export function buildConvictionDeskMemoPlainText(args: {
  deskResult: ConvictionDeskResult;
  generatedAt?: string | number | null;
}): string {
  const { deskResult, generatedAt } = args;
  const { ticker, conviction } = deskResult;

  const when =
    generatedAt == null
      ? null
      : typeof generatedAt === "number"
        ? new Date(generatedAt).toLocaleString()
        : String(generatedAt);

  const lines: string[] = [];

  lines.push(`CONVICTION DESK  ${ticker}`);
  if (when) lines.push(`Generated: ${when}`);
  lines.push("");

  if (!conviction) {
    lines.push("ANALYSIS INCOMPLETE", "Memo JSON could not be validated.", "");
    return lines.join("\n").trim();
  }

  lines.push("REGIME", conviction.regime.summary, "");
  lines.push("VIEW", conviction.view.paragraph, "");

  const chosen = conviction.decision.chosen;
  const isNoTrade =
    chosen == null || conviction.size === "no-trade" || conviction.view.decision_intent === "pass";

  if (isNoTrade) {
    lines.push("NO TRADE", "");
    lines.push("FAILURE CASE", conviction.failure_scenario.steelman, "");
    if (conviction.failure_scenario.response) {
      lines.push("RESPONSE", conviction.failure_scenario.response, "");
    }
    lines.push(
      "SELF-GRADE",
      `Vol ${conviction.self_grade.vol}, Flow ${conviction.self_grade.flow}, Catalyst ${conviction.self_grade.catalyst}, Regime ${conviction.self_grade.regime}, Structure fit ${conviction.self_grade.structure_fit}, Failure scenario ${conviction.self_grade.failure_scenario_strength}, Conviction ${conviction.self_grade.conviction}`,
      "",
    );
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  lines.push(
    "DECISION",
    `Chosen: ${chosen.structure} exp ${chosen.expiry}, ${chosen.credit_or_debit < 0 ? "credit" : "debit"} $${Math.abs(chosen.credit_or_debit).toFixed(2)}`,
    `Entry Greeks: delta ${chosen.greeks_entry.delta}, gamma ${chosen.greeks_entry.gamma}, theta ${chosen.greeks_entry.theta}, vega ${chosen.greeks_entry.vega}`,
    "",
  );

  for (const r of conviction.decision.rejected_alternatives) {
    lines.push(`Rejected: ${r.structure}`, r.reason, "");
  }

  lines.push(
    "OUTCOME DISTRIBUTION (P5 to P95)",
    `${chosen.outcome_distribution.p5}, ${chosen.outcome_distribution.p25}, ${chosen.outcome_distribution.p50}, ${chosen.outcome_distribution.p75}, ${chosen.outcome_distribution.p95}`,
    "",
  );

  lines.push("FAILURE SCENARIO", conviction.failure_scenario.steelman, "");
  lines.push("RESPONSE", conviction.failure_scenario.response, "");

  if (conviction.scenarios) {
    lines.push(
      "SCENARIOS",
      `Designed: ${conviction.scenarios.designed.description} P/L ${conviction.scenarios.designed.pnl_per_spread}`,
      `Adverse: ${conviction.scenarios.adverse_bounded.description} P/L ${conviction.scenarios.adverse_bounded.pnl_per_spread} stop: ${conviction.scenarios.adverse_bounded.stop_trigger}`,
      `Tail: ${conviction.scenarios.tail.description} P/L ${conviction.scenarios.tail.pnl_per_spread}`,
      "",
    );
  }

  if (conviction.exit_plan) {
    const pt = conviction.exit_plan.profit_take.map((p) => `${p.level} (${p.scale_out_pct}%)`).join("; ");
    lines.push(
      "EXIT PLAN",
      pt || "(none)",
      conviction.exit_plan.vol_trigger ?? "",
      conviction.exit_plan.price_trigger ?? "",
      conviction.exit_plan.time_stop,
      "",
    );
  }

  lines.push(
    "SELF-GRADE",
    `Vol ${conviction.self_grade.vol}, Flow ${conviction.self_grade.flow}, Catalyst ${conviction.self_grade.catalyst}, Regime ${conviction.self_grade.regime}, Structure fit ${conviction.self_grade.structure_fit}, Failure scenario ${conviction.self_grade.failure_scenario_strength}, Conviction ${conviction.self_grade.conviction}`,
    `Sizing: ${conviction.size}`,
    "",
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
