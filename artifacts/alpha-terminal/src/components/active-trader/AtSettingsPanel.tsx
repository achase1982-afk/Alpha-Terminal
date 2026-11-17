import { memo, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  BG_EXP_BAR, BORDER, DIM, GRAY, WHITE, MONO, FW_LIGHT, FW_NORMAL, TOOLBAR_H,
} from "@/components/options/optionsTheme";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import { computeBracketPrices } from "@/lib/active-trader/atBracketMath";
import { AtBracketControls } from "./AtBracketControls";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { TemplateBar } from "./TemplateBar";
import { RegimeStrip } from "./RegimeStrip";
import { FilterStrip, type LaneFilterKey } from "./FilterStrip";
import { AtTemplateLegPlan } from "./AtTemplateLegPlan";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";

function buildSummary(
  prefs: ActiveTraderTemplatePrefs,
  entry: number | null,
  primaryInstruction: SchwabInstruction,
): string {
  const order =
    prefs.orderType === "LIMIT"
      ? prefs.limitAnchor === "Mid"
        ? "LMT mid"
        : `LMT ${prefs.limitAnchor.toLowerCase()}`
      : "MKT";
  let line = `${prefs.template} · ${prefs.qty} · ${order}`;
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

interface AtSettingsPanelProps {
  open: boolean;
  onToggle: () => void;
  accentHex: string;
  prefs: ActiveTraderTemplatePrefs;
  onPrefsChange: (p: ActiveTraderTemplatePrefs) => void;
  instrumentLabel: string;
  onSell: () => void;
  onBuy: () => void;
  accountLabel: string;
  isPaper: boolean;
  regimeLabel: string | null;
  regimeDegraded: boolean;
  zones: ZoneModel;
  headline: string;
  sessionLabel?: string;
  laneFilters: Record<LaneFilterKey, boolean>;
  onToggleLane: (key: LaneFilterKey) => void;
  classifiedPct: number | null;
  windowLabel: string;
  primaryInstruction: SchwabInstruction;
  limitMid: number | null;
  autoSendArmBlock?: string | null;
}

export const AtSettingsPanel = memo(function AtSettingsPanel({
  open,
  onToggle,
  accentHex,
  prefs,
  onPrefsChange,
  instrumentLabel,
  onSell,
  onBuy,
  accountLabel,
  isPaper,
  regimeLabel,
  regimeDegraded,
  zones,
  headline,
  sessionLabel,
  laneFilters,
  onToggleLane,
  classifiedPct,
  windowLabel,
  primaryInstruction,
  limitMid,
  autoSendArmBlock,
}: AtSettingsPanelProps) {
  const summary = buildSummary(prefs, limitMid, primaryInstruction);

  const handleSummaryKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onToggle();
      }
    },
    [onToggle],
  );

  return (
    <div style={{ background: BG_EXP_BAR, borderBottom: `1px solid ${BORDER}`, fontFamily: MONO }}>
      <button
        type="button"
        onClick={onToggle}
        onKeyDown={handleSummaryKey}
        className="w-full flex items-center justify-between px-3 gap-2"
        style={{ height: TOOLBAR_H, background: BG_EXP_BAR }}
        aria-expanded={open}
        data-at-settings-summary
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {open ? (
            <ChevronDown className="w-3 h-3 shrink-0" style={{ color: DIM }} />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0" style={{ color: DIM }} />
          )}
          <span
            className="truncate tracking-wide"
            style={{ fontSize: 13, color: WHITE, fontWeight: FW_NORMAL }}
          >
            {summary}
          </span>
        </div>
        <span style={{ fontSize: 12, color: GRAY, fontWeight: FW_LIGHT, flexShrink: 0 }}>
          {open ? "Tap to collapse" : "Tap to expand"}
        </span>
      </button>

      {open && (
        <div data-at-settings-expanded className="border-t" style={{ borderColor: BORDER }}>
          <TemplateBar
            embedded
            accentHex={accentHex}
            instrumentLabel={instrumentLabel}
            prefs={prefs}
            onPrefsChange={onPrefsChange}
            onSell={onSell}
            onBuy={onBuy}
            accountLabel={accountLabel}
            isPaper={isPaper}
            autoSendArmBlock={autoSendArmBlock}
          />
          <AtBracketControls
            prefs={prefs}
            onPrefsChange={onPrefsChange}
            primaryInstruction={primaryInstruction}
            entryPrice={limitMid}
          />
          <RegimeStrip
            embedded
            accentHex={accentHex}
            regimeLabel={regimeLabel}
            regimeDegraded={regimeDegraded}
            zones={zones}
            headline={headline}
            sessionLabel={sessionLabel}
          />
          <FilterStrip
            embedded
            accentHex={accentHex}
            filters={laneFilters}
            onToggle={onToggleLane}
            classifiedPct={classifiedPct}
            windowLabel={windowLabel}
          />
          <AtTemplateLegPlan
            prefs={prefs}
            primaryInstruction={primaryInstruction}
            limitPrice={limitMid}
          />
        </div>
      )}
    </div>
  );
});