import { memo, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  BG_EXP_BAR, BORDER, DIM, GRAY, WHITE, MONO, FW_LIGHT, FW_NORMAL, TOOLBAR_H,
} from "@/components/options/optionsTheme";
import type { ActiveTraderTemplatePrefs } from "@/lib/active-trader/activeTraderPrefs";
import { buildAtSettingsSummary } from "@/lib/active-trader/atSummaryFormat";
import { AtBracketControls } from "./AtBracketControls";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import { TemplateBar } from "./TemplateBar";
import { RegimeStrip } from "./RegimeStrip";
import { FilterStrip, type LaneFilterKey } from "./FilterStrip";
import { AtTemplateLegPlan } from "./AtTemplateLegPlan";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  sessionLabel?: string;
  laneFilters: Record<LaneFilterKey, boolean>;
  onToggleLane: (key: LaneFilterKey) => void;
  classifiedPct: number | null;
  windowLabel: string;
  primaryInstruction: SchwabInstruction;
  limitMid: number | null;
  autoSendArmBlock?: string | null;
  expiryLabel: string;
  dteLabel: string;
  windowSec: 30 | 60 | 300;
  onWindowSecChange: (v: 30 | 60 | 300) => void;
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
  sessionLabel,
  laneFilters,
  onToggleLane,
  classifiedPct,
  windowLabel,
  primaryInstruction,
  limitMid,
  autoSendArmBlock,
  expiryLabel,
  dteLabel,
  windowSec,
  onWindowSecChange,
}: AtSettingsPanelProps) {
  const summary = buildAtSettingsSummary(prefs, limitMid, primaryInstruction, expiryLabel);

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
        <div className="flex items-start gap-1.5 min-w-0 flex-1">
          {open ? (
            <ChevronDown className="w-3 h-3 shrink-0 mt-0.5" style={{ color: DIM }} />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0 mt-0.5" style={{ color: DIM }} />
          )}
          <span
            className="tracking-wide text-left"
            style={{
              fontSize: 11,
              color: WHITE,
              fontWeight: FW_NORMAL,
              lineHeight: 1.35,
              wordBreak: "break-word",
            }}
          >
            {summary}
            <span style={{ color: GRAY, fontSize: 10 }}> · {dteLabel}</span>
          </span>
        </div>
        <span style={{ fontSize: 10, color: GRAY, fontWeight: FW_LIGHT, flexShrink: 0 }}>
          {open ? "Collapse" : "Expand"}
        </span>
      </button>

      {open && (
        <div data-at-settings-expanded className="border-t" style={{ borderColor: BORDER }}>
          <div
            className="flex items-center justify-between px-3 gap-2"
            style={{ height: TOOLBAR_H, borderBottom: `1px solid ${BORDER}` }}
          >
            <span style={{ fontSize: 13, color: WHITE, fontWeight: FW_NORMAL }}>
              {expiryLabel}
              <span style={{ color: GRAY, fontSize: 12, marginLeft: 6 }}>{dteLabel}</span>
            </span>
            <Select
              value={String(windowSec)}
              onValueChange={(v) => onWindowSecChange(Number(v) as 30 | 60 | 300)}
            >
              <SelectTrigger
                className="h-6 w-[52px] px-1.5 border rounded text-white"
                style={{ fontSize: 14, background: "#111", borderColor: "#2a2a2a", fontFamily: MONO }}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30s</SelectItem>
                <SelectItem value="60">1m</SelectItem>
                <SelectItem value="300">5m</SelectItem>
              </SelectContent>
            </Select>
          </div>
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