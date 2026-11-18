import { memo } from "react";
import { BORDER, UP, DOWN } from "@/components/options/optionsTheme";
import { AT_LABEL, AT_SECONDARY } from "@/lib/active-trader/atChromeContrast";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import { atBracketLegPreviewPrice } from "@/lib/active-trader/atSchwabOrderBuilder";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";

type Props = {
  prefs: ActiveTraderTemplatePrefs;
  onPrefsChange: (p: ActiveTraderTemplatePrefs) => void;
  entryPrice: number | null;
  underlyingSymbol: string;
  primaryInstruction: SchwabInstruction;
  /** Multi-leg chain sheet — bracket in spread premium terms. */
  isSpread?: boolean;
  isCredit?: boolean;
};

export const AtActiveTraderSheetBrackets = memo(function AtActiveTraderSheetBrackets({
  prefs,
  onPrefsChange,
  entryPrice,
  underlyingSymbol,
  primaryInstruction,
  isSpread = false,
  isCredit = false,
}: Props) {
  const qty = prefs.qty;
  const bracketInstruction: SchwabInstruction =
    isSpread && isCredit ? "SELL_TO_OPEN" : isSpread ? "BUY_TO_OPEN" : primaryInstruction;
  const tp =
    entryPrice != null && prefs.takeProfit.enabled
      ? atBracketLegPreviewPrice(
          {
            template: prefs.template,
            assetType: "OPTION",
            symbol: "",
            underlyingSymbol,
            primaryInstruction: bracketInstruction,
            quantity: qty,
            limitPrice: entryPrice,
            takeProfit: prefs.takeProfit,
            stopLoss: { enabled: false, mode: "percent", offset: -10 },
          },
          "takeProfit",
        )
      : null;
  const sl =
    entryPrice != null && prefs.stopLoss.enabled
      ? atBracketLegPreviewPrice(
          {
            template: prefs.template,
            assetType: "OPTION",
            symbol: "",
            underlyingSymbol,
            primaryInstruction: bracketInstruction,
            quantity: qty,
            limitPrice: entryPrice,
            takeProfit: { enabled: false, mode: "percent", offset: 10 },
            stopLoss: prefs.stopLoss,
          },
          "stopLoss",
        )
      : null;

  return (
    <div className="mt-3 pt-2 space-y-2" style={{ borderTop: `1px solid ${BORDER}` }}>
      <label className="flex items-center justify-between gap-2" style={{ fontSize: 11, color: AT_SECONDARY }}>
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={prefs.takeProfit.enabled}
            onChange={(e) => onPrefsChange({ ...prefs, takeProfit: { ...prefs.takeProfit, enabled: e.target.checked } })}
          />
          Take profit (OCO)
        </span>
        <span className="tabular-nums" style={{ color: UP }}>{tp != null ? tp.toFixed(2) : "—"}</span>
      </label>
      <label className="flex items-center justify-between gap-2" style={{ fontSize: 11, color: AT_SECONDARY }}>
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={prefs.stopLoss.enabled}
            onChange={(e) => onPrefsChange({ ...prefs, stopLoss: { ...prefs.stopLoss, enabled: e.target.checked } })}
          />
          Stop loss (OCO)
        </span>
        <span className="tabular-nums" style={{ color: DOWN }}>{sl != null ? sl.toFixed(2) : "—"}</span>
      </label>
    </div>
  );
});