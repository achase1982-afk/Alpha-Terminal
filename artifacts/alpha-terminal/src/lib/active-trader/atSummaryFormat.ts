import type { ActiveTraderTemplatePrefs, AtTemplateKind } from "./activeTraderPrefs";
import { planAtOrderLegs, type SchwabInstruction } from "./atSchwabOrderBuilder";

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
  underlyingSymbol?: string,
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
    const { legs } = planAtOrderLegs({
      template: prefs.template,
      assetType: "OPTION",
      symbol: "",
      underlyingSymbol: underlyingSymbol?.replace(/^\$/, "") ?? "SPX",
      primaryInstruction,
      quantity: prefs.qty,
      limitPrice: entry,
      takeProfit: prefs.takeProfit,
      stopLoss: prefs.stopLoss,
      exitDuration: prefs.exitDuration,
      stopLossOrderType: prefs.stopLossOrderType,
      stopLimitOffset: prefs.stopLimitOffset,
    });
    const tpLeg = legs.find((l) => l.role !== "1st" && l.orderType === "LIMIT");
    const slLeg = legs.find((l) => l.orderType === "STOP" || l.orderType === "STOP_LIMIT");
    const bits: string[] = [];
    if (tpLeg?.price != null) bits.push(`TP ${tpLeg.price.toFixed(2)}`);
    if (slLeg?.stopPrice != null) bits.push(`SL ${slLeg.stopPrice.toFixed(2)}`);
    else if (slLeg?.price != null && slLeg.orderType === "STOP") bits.push(`SL ${slLeg.price.toFixed(2)}`);
    if (bits.length) line += ` · ${bits.join(" · ")}`;
  }
  return line;
}

export function formatAtExitDuration(duration: ActiveTraderTemplatePrefs["exitDuration"]): string {
  return duration === "GOOD_TILL_CANCEL" ? "GTC" : "Day";
}