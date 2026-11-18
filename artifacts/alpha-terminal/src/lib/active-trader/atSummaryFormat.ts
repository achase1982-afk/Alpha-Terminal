import type { ActiveTraderTemplatePrefs, AtTemplateKind } from "./activeTraderPrefs";
import { atBracketPreviewPrices, type SchwabInstruction } from "./atSchwabOrderBuilder";
import { parseSchwabOptionSymbol } from "@workspace/order-ticket-math";

function optionRootFromOcc(sym: string): string {
  const root = sym.trim().slice(0, 6).trim();
  return root || sym;
}

/** Human leg label for glance mobile sheet (no raw OCC). */
export function formatAtMobileContractLabel(optionSymbol: string | undefined, fallbackUnderlying: string): string {
  if (!optionSymbol) return fallbackUnderlying.replace(/^\$/, "");
  const parsed = parseSchwabOptionSymbol(optionSymbol);
  const root = optionRootFromOcc(optionSymbol);
  if (!parsed) return root;
  const strikeStr = parsed.strike % 1 === 0 ? String(parsed.strike) : parsed.strike.toFixed(1);
  const type = parsed.optionType === "CALL" ? "Call" : "Put";
  let exp = "";
  if (parsed.expiration) {
    const d = new Date(`${parsed.expiration}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      exp = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
  }
  return `${root} ${strikeStr} ${type}${exp ? ` · ${exp}` : ""}`;
}

function formatAtMobileLegShort(optionSymbol: string | undefined, fallbackUnderlying: string): string {
  const full = formatAtMobileContractLabel(optionSymbol, fallbackUnderlying);
  return full.replace(/ · [A-Za-z]{3} \d{1,2}$/, "");
}

export function formatAtMobilePinnedSummary(input: {
  optionSymbol: string | undefined;
  underlying: string;
  side: "BUY" | "SELL";
  quantity: number;
  limit: string | null | undefined;
  takeProfit: number | null | undefined;
}): string {
  const leg = formatAtMobileLegShort(input.optionSymbol, input.underlying);
  const sideWord = input.side === "BUY" ? "Buy" : "Sell";
  const lim = input.limit?.trim();
  const tp =
    input.takeProfit != null && Number.isFinite(input.takeProfit)
      ? input.takeProfit.toFixed(2)
      : null;
  return `${leg} · ${sideWord} ${input.quantity}${lim ? ` @ ${lim}` : ""}${tp ? ` · TP ${tp}` : ""}`;
}

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
      bits.push(`TP ${preview.takeProfit.toFixed(2)}`);
    }
    if (preview.stopLoss != null) bits.push(`SL ${preview.stopLoss.toFixed(2)}`);
    if (bits.length) line += ` · ${bits.join(" · ")}`;
  }
  return line;
}

export function formatAtExitDuration(duration: ActiveTraderTemplatePrefs["exitDuration"]): string {
  return duration === "GOOD_TILL_CANCEL" ? "GTC" : "Day";
}

/** Collapsed glance footer — “Order settings · Bracket · 1 contract · Limit at mid”. */
export function formatGlanceOrderSettingsLine(
  prefs: ActiveTraderTemplatePrefs,
  entry: number | null,
  primaryInstruction: SchwabInstruction,
): string {
  void entry;
  void primaryInstruction;
  const template = abbrevAtTemplate(prefs.template);
  const qtyLabel = prefs.qty === 1 ? "1 contract" : `${prefs.qty} contracts`;
  const order =
    prefs.orderType === "LIMIT"
      ? prefs.limitAnchor === "Mid"
        ? "Limit at mid"
        : `Limit at ${prefs.limitAnchor.toLowerCase()}`
      : "Market";
  return `Order settings · ${template} · ${qtyLabel} · ${order}`;
}