import type { ActiveTraderTemplatePrefs, AtTemplateKind } from "./activeTraderPrefs";
import { atBracketPreviewPrices, type SchwabInstruction } from "./atSchwabOrderBuilder";

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
    const und = underlyingSymbol?.replace(/^\$/, "") ?? "SPX";
    const preview = atBracketPreviewPrices({
      template: prefs.template,
      assetType: "OPTION",
      symbol: "",
      underlyingSymbol: und,
      primaryInstruction,
      quantity: prefs.qty,
      limitPrice: entry,
      takeProfit: prefs.takeProfit,
      stopLoss: prefs.stopLoss,
      exitDuration: prefs.exitDuration,
      stopLossOrderType: prefs.stopLossOrderType,
      stopLimitOffset: prefs.stopLimitOffset,
    });
    const bits: string[] = [];
    if (preview.takeProfit != null) {
      const tpLabel = `TP ${preview.takeProfit.toFixed(2)}`;
      bits.push(
        preview.takeProfit <= entry
          ? `${tpLabel} (min tick bump)`
          : tpLabel,
      );
    }
    if (preview.stopLoss != null) bits.push(`SL ${preview.stopLoss.toFixed(2)}`);
    if (bits.length) line += ` · ${bits.join(" · ")}`;
  }
  return line;
}

export function formatAtExitDuration(duration: ActiveTraderTemplatePrefs["exitDuration"]): string {
  return duration === "GOOD_TILL_CANCEL" ? "GTC" : "Day";
}