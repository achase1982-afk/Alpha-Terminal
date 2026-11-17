import type { ActiveTraderTemplatePrefs, AtTemplateKind } from "./activeTraderPrefs";
import { computeBracketPrices } from "./atBracketMath";
import type { SchwabInstruction } from "./atSchwabOrderBuilder";

/** Short labels for collapsed summary (avoid truncation in 440px). */
export function abbrevAtTemplate(template: AtTemplateKind): string {
  switch (template) {
    case "Single":
      return "Single";
    case "OCO":
      return "OCO";
    case "TRG w/ bracket":
      return "Bracket";
    default:
      return template;
  }
}

export function buildAtSettingsSummary(
  prefs: ActiveTraderTemplatePrefs,
  entry: number | null,
  primaryInstruction: SchwabInstruction,
  expiryLabel?: string,
): string {
  const order =
    prefs.orderType === "LIMIT"
      ? prefs.limitAnchor === "Mid"
        ? "LMT mid"
        : `LMT ${prefs.limitAnchor.toLowerCase()}`
      : "MKT";
  const head = expiryLabel ? `${expiryLabel} · ` : "";
  let line = `${head}${abbrevAtTemplate(prefs.template)} · ${prefs.qty} · ${order}`;
  if (entry != null && entry > 0) {
    const { takeProfit, stopLoss } = computeBracketPrices({
      entryPrice: entry,
      quantity: prefs.qty,
      primaryInstruction,
      tp: prefs.takeProfit,
      sl: prefs.stopLoss,
    });
    const bits: string[] = [];
    if (takeProfit != null) bits.push(`TP ${takeProfit.toFixed(2)}`);
    if (stopLoss != null) bits.push(`SL ${stopLoss.toFixed(2)}`);
    if (bits.length) line += ` · ${bits.join(" · ")}`;
  }
  return line;
}