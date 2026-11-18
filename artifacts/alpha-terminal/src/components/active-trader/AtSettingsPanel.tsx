import { memo, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  BG_EXP_BAR, BORDER, DIM, GRAY, WHITE, MONO, FW_LIGHT, FW_NORMAL,
} from "@/components/options/optionsTheme";
import type { ActiveTraderTemplatePrefs, AtLadderMode, AtVerticalWidth } from "@/lib/active-trader/activeTraderPrefs";
import { buildAtSettingsSummary } from "@/lib/active-trader/atSummaryFormat";
import { AtBracketControls } from "./AtBracketControls";
import { TemplateBar } from "./TemplateBar";
import { AtTemplateLegPlan } from "./AtTemplateLegPlan";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import { AT_VERTICAL_LADDER_ENABLED } from "@/lib/active-trader/atOrderSend";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AtSettingsSummaryProps {
  open: boolean;
  onToggle: () => void;
  prefs: ActiveTraderTemplatePrefs;
  primaryInstruction: SchwabInstruction;
  limitMid: number | null;
  expiryLabel: string;
  underlyingSymbol: string;
  slim?: boolean;
  glanceSlim?: boolean;
}

export const AtSettingsSummary = memo(function AtSettingsSummary({
  open,
  onToggle,
  prefs,
  primaryInstruction,
  limitMid,
  expiryLabel,
  underlyingSymbol,
  slim = false,
  glanceSlim = false,
}: AtSettingsSummaryProps) {
  const summary = buildAtSettingsSummary(
    prefs,
    limitMid,
    primaryInstruction,
    expiryLabel,
    underlyingSymbol,
  );

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
    <button
      type="button"
      onClick={onToggle}
      onKeyDown={handleSummaryKey}
      className="w-full flex items-center justify-between px-3 gap-2"
      style={{
        height: glanceSlim ? (open ? 28 : 22) : slim ? 28 : 40,
        background: BG_EXP_BAR,
        borderBottom: `1px solid ${BORDER}`,
        fontFamily: MONO,
      }}
      aria-expanded={open}
      data-at-settings-summary
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {open ? (
          <ChevronDown className="w-3 h-3 shrink-0" style={{ color: DIM }} />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" style={{ color: DIM }} />
        )}
        <span
          className="tracking-wide text-left truncate"
          style={{
            fontSize: slim ? 10 : 11,
            color: GRAY,
            fontWeight: FW_LIGHT,
            lineHeight: 1.35,
          }}
        >
          {summary}
        </span>
      </div>
      <span style={{ fontSize: 9, color: DIM, fontWeight: FW_LIGHT, flexShrink: 0 }}>
        {open ? "Less" : "More"}
      </span>
    </button>
  );
});

interface AtSettingsExpandedProps {
  open: boolean;
  accentHex: string;
  prefs: ActiveTraderTemplatePrefs;
  onPrefsChange: (p: ActiveTraderTemplatePrefs) => void;
  instrumentLabel: string;
  onSell: () => void;
  onBuy: () => void;
  accountLabel: string;
  isPaper: boolean;
  primaryInstruction: SchwabInstruction;
  limitMid: number | null;
  autoSendArmBlock?: string | null;
  underlyingSymbol: string;
  windowSec: 30 | 60 | 300;
  onWindowSecChange: (v: 30 | 60 | 300) => void;
}

export const AtSettingsExpanded = memo(function AtSettingsExpanded({
  open,
  accentHex,
  prefs,
  onPrefsChange,
  instrumentLabel,
  onSell,
  onBuy,
  accountLabel,
  isPaper,
  primaryInstruction,
  limitMid,
  autoSendArmBlock,
  underlyingSymbol,
  windowSec,
  onWindowSecChange,
}: AtSettingsExpandedProps) {
  if (!open) return null;

  return (
    <div
      data-at-settings-expanded
      className="border-t border-b"
      style={{ borderColor: BORDER, background: BG_EXP_BAR, fontFamily: MONO }}
    >
      <div className="flex items-center justify-between px-3 gap-2" style={{ height: 36, borderBottom: `1px solid ${BORDER}` }}>
        <span style={{ fontSize: 9, color: DIM, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Classified window
        </span>
        <Select value={String(windowSec)} onValueChange={(v) => onWindowSecChange(Number(v) as 30 | 60 | 300)}>
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
        underlyingSymbol={underlyingSymbol}
      />
      <div
        className="px-3 py-2 grid grid-cols-2 gap-2 items-end"
        style={{ borderBottom: `1px solid ${BORDER}` }}
        data-at-ladder-mode
      >
        <div>
          <span style={{ fontSize: 9, color: DIM, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Ladder mode
          </span>
          <div className="flex gap-1 mt-1">
            {(["single", "vertical"] as AtLadderMode[]).map((mode) => {
              const verticalDisabled = mode === "vertical" && !AT_VERTICAL_LADDER_ENABLED;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={verticalDisabled}
                  onClick={() => {
                    if (verticalDisabled) return;
                    onPrefsChange({ ...prefs, ladderMode: mode });
                  }}
                  className="flex-1 py-1 rounded border disabled:opacity-40"
                  style={{
                    fontSize: 11,
                    fontFamily: MONO,
                    borderColor: prefs.ladderMode === mode ? accentHex : BORDER,
                    background: prefs.ladderMode === mode ? `${accentHex}18` : "#111",
                    color: prefs.ladderMode === mode ? WHITE : GRAY,
                  }}
                >
                  {mode === "single" ? "Single" : "Vertical (soon)"}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <span style={{ fontSize: 9, color: DIM, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Spread width
          </span>
          <Select
            disabled={prefs.ladderMode !== "vertical"}
            value={String(prefs.verticalWidth)}
            onValueChange={(v) => onPrefsChange({ ...prefs, verticalWidth: Number(v) as AtVerticalWidth })}
          >
            <SelectTrigger
              className="h-7 mt-1 border rounded text-white"
              style={{ fontSize: 12, background: "#111", borderColor: BORDER, fontFamily: MONO }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 pts</SelectItem>
              <SelectItem value="10">10 pts</SelectItem>
              <SelectItem value="25">25 pts</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <AtTemplateLegPlan
        prefs={prefs}
        primaryInstruction={primaryInstruction}
        limitPrice={limitMid}
        underlyingSymbol={underlyingSymbol}
      />
    </div>
  );
});

/** @deprecated Use AtSettingsSummary + AtSettingsExpanded */
export const AtSettingsPanel = AtSettingsSummary;