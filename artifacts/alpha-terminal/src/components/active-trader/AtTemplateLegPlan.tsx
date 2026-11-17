import { memo, useMemo } from "react";
import { DOWN, DIM, MONO, FW_LIGHT, FW_NORMAL } from "@/components/options/optionsTheme";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import {
  closingInstructionForOpen,
  humanInstruction,
  planAtOrderLegs,
  usesBracketExit,
  type SchwabInstruction,
} from "@/lib/active-trader/atSchwabOrderBuilder";

interface AtTemplateLegPlanProps {
  prefs: ActiveTraderTemplatePrefs;
  primaryInstruction: SchwabInstruction;
  limitPrice: number | null;
  underlyingSymbol?: string;
}

export const AtTemplateLegPlan = memo(function AtTemplateLegPlan({
  prefs,
  primaryInstruction,
  limitPrice,
  underlyingSymbol = "SPX",
}: AtTemplateLegPlanProps) {
  const { legs, validationError } = useMemo(() => {
    if (limitPrice == null || limitPrice <= 0) {
      return { legs: [], validationError: null as string | null };
    }
    return planAtOrderLegs({
      template: prefs.template,
      assetType: "OPTION",
      symbol: "",
      underlyingSymbol: underlyingSymbol.replace(/^\$/, ""),
      primaryInstruction,
      quantity: prefs.qty,
      limitPrice,
      takeProfit: prefs.takeProfit,
      stopLoss: prefs.stopLoss,
      exitDuration: prefs.exitDuration,
      stopLossOrderType: prefs.stopLossOrderType,
      stopLimitOffset: prefs.stopLimitOffset,
    });
  }, [prefs, primaryInstruction, limitPrice]);

  const showBracket =
    usesBracketExit({
      template: prefs.template,
      assetType: "OPTION",
      symbol: "",
      primaryInstruction,
      quantity: prefs.qty,
      limitPrice: limitPrice ?? 0,
      takeProfit: prefs.takeProfit,
      stopLoss: prefs.stopLoss,
    }) || prefs.template !== "Single";

  if (!showBracket || legs.length <= 1) return null;

  return (
    <div className="px-3 pb-2 space-y-1" style={{ fontFamily: MONO, fontSize: 11 }}>
      {legs.map((leg) => (
        <div key={leg.role} className="flex justify-between gap-2" style={{ color: DIM, fontWeight: FW_LIGHT }}>
          <span>
            {leg.role}: {leg.label}
          </span>
          {leg.price != null && (
            <span style={{ fontWeight: FW_NORMAL, fontVariantNumeric: "tabular-nums" }}>
              {leg.orderType === "STOP_LIMIT" ? "STP LMT " : leg.orderType === "STOP" ? "Stop " : "LMT "}
              {leg.price.toFixed(2)}
            </span>
          )}
        </div>
      ))}
      {validationError && (
        <p style={{ fontSize: 10, color: DOWN, fontWeight: FW_NORMAL, lineHeight: 1.35 }}>{validationError}</p>
      )}
      <p style={{ fontSize: 9, color: DIM }}>
        2nd leg defaults to {humanInstruction(closingInstructionForOpen(primaryInstruction))}.
      </p>
    </div>
  );
});