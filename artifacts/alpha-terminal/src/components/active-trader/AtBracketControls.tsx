import { memo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { BORDER, DIM, GRAY, MONO, FW_LIGHT, WHITE, UP, DOWN } from "@/components/options/optionsTheme";
import type {
  ActiveTraderTemplatePrefs,
  AtExitDuration,
  AtStopLossOrderType,
  BracketLegPrefs,
} from "@/lib/active-trader/activeTraderPrefs";
import {
  computeBracketPrices,
  formatSignedOffset,
  type BracketOffsetMode,
} from "@/lib/active-trader/atBracketMath";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";

const POINT_PRESETS = [0.5, 1, 2] as const;

interface AtBracketControlsProps {
  prefs: ActiveTraderTemplatePrefs;
  onPrefsChange: (p: ActiveTraderTemplatePrefs) => void;
  primaryInstruction: SchwabInstruction;
  entryPrice: number | null;
}

function LegEditor({
  title,
  legKey,
  leg,
  accentColor,
  onChange,
  entryPrice,
  quantity,
  primaryInstruction,
}: {
  title: string;
  legKey: "takeProfit" | "stopLoss";
  leg: BracketLegPrefs;
  accentColor: string;
  onChange: (leg: BracketLegPrefs) => void;
  entryPrice: number | null;
  quantity: number;
  primaryInstruction: SchwabInstruction;
}) {
  const computed =
    entryPrice != null && leg.enabled
      ? computeBracketPrices({
          entryPrice,
          quantity,
          primaryInstruction,
          tp: legKey === "takeProfit" ? leg : { enabled: false, mode: "percent", offset: 10 },
          sl: legKey === "stopLoss" ? leg : { enabled: false, mode: "percent", offset: -10 },
        })
      : null;
  const legPrice = legKey === "takeProfit" ? computed?.takeProfit : computed?.stopLoss;

  return (
    <div className="space-y-1.5 py-2 border-t" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2" style={{ fontSize: 11, color: GRAY }}>
          <Checkbox
            checked={leg.enabled}
            onCheckedChange={(v) => onChange({ ...leg, enabled: v === true })}
          />
          <span style={{ color: accentColor, fontWeight: FW_LIGHT }}>{title}</span>
        </label>
        {legPrice != null && (
          <span style={{ fontSize: 11, color: WHITE, fontVariantNumeric: "tabular-nums" }}>
            @ {legPrice.toFixed(2)}
          </span>
        )}
      </div>
      {leg.enabled && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={leg.mode}
            onValueChange={(v) => onChange({ ...leg, mode: v as BracketOffsetMode })}
          >
            <SelectTrigger
              className="h-6 w-[88px] px-1.5 border rounded text-white"
              style={{ fontSize: 12, background: "#111", borderColor: "#2a2a2a", fontFamily: MONO }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">%</SelectItem>
              <SelectItem value="points">Pts</SelectItem>
              <SelectItem value="dollars">$ P/L</SelectItem>
            </SelectContent>
          </Select>
          <Input
            type="number"
            step={leg.mode === "percent" ? 1 : 0.05}
            value={leg.offset}
            onChange={(e) => onChange({ ...leg, offset: parseFloat(e.target.value) || 0 })}
            className="h-6 w-20 px-1.5 font-mono"
            style={{ fontSize: 12, background: "#111", borderColor: BORDER, color: WHITE }}
          />
          <span style={{ fontSize: 10, color: DIM, marginLeft: 4, minWidth: 44 }}>{formatSignedOffset(leg.offset, leg.mode)}</span>
          {leg.mode === "points" && (
            <div className="flex gap-1">
              {POINT_PRESETS.map((p) => {
                const sign = legKey === "takeProfit" ? 1 : -1;
                const val = sign * p;
                return (
                  <button
                    key={p}
                    type="button"
                    className="h-6 px-1.5 rounded border"
                    style={{ fontSize: 10, borderColor: BORDER, color: GRAY, background: "transparent" }}
                    onClick={() => onChange({ ...leg, mode: "points", offset: val })}
                  >
                    {val > 0 ? `+${p}` : `−${p}`}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const AtBracketControls = memo(function AtBracketControls({
  prefs,
  onPrefsChange,
  primaryInstruction,
  entryPrice,
}: AtBracketControlsProps) {
  const patch = (partial: Partial<ActiveTraderTemplatePrefs>) =>
    onPrefsChange({ ...prefs, ...partial });

  return (
    <div className="px-3 pb-2" style={{ fontFamily: MONO }}>
      <p style={{ fontSize: 10, color: DIM, fontWeight: FW_LIGHT, letterSpacing: "0.06em" }}>
        BRACKET (1st triggers OCO)
      </p>
      <LegEditor
        title="Take profit"
        legKey="takeProfit"
        leg={prefs.takeProfit}
        accentColor={UP}
        entryPrice={entryPrice}
        quantity={prefs.qty}
        primaryInstruction={primaryInstruction}
        onChange={(takeProfit) => patch({ takeProfit })}
      />
      <LegEditor
        title="Stop loss"
        legKey="stopLoss"
        leg={prefs.stopLoss}
        accentColor={DOWN}
        entryPrice={entryPrice}
        quantity={prefs.qty}
        primaryInstruction={primaryInstruction}
        onChange={(stopLoss) => patch({ stopLoss })}
      />
      <div className="flex flex-wrap items-end gap-3 py-2 border-t" style={{ borderColor: BORDER }}>
        <div>
          <span style={{ fontSize: 9, color: DIM, display: "block", marginBottom: 4 }}>Exit TIF</span>
          <Select
            value={prefs.exitDuration}
            onValueChange={(v) => patch({ exitDuration: v as AtExitDuration })}
          >
            <SelectTrigger
              className="h-6 w-[72px] px-1.5 border rounded text-white"
              style={{ fontSize: 12, background: "#111", borderColor: "#2a2a2a", fontFamily: MONO }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DAY">Day</SelectItem>
              <SelectItem value="GOOD_TILL_CANCEL">GTC</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <span style={{ fontSize: 9, color: DIM, display: "block", marginBottom: 4 }}>Stop type</span>
          <Select
            value={prefs.stopLossOrderType}
            onValueChange={(v) => patch({ stopLossOrderType: v as AtStopLossOrderType })}
          >
            <SelectTrigger
              className="h-6 w-[92px] px-1.5 border rounded text-white"
              style={{ fontSize: 12, background: "#111", borderColor: "#2a2a2a", fontFamily: MONO }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="STOP">Stop</SelectItem>
              <SelectItem value="STOP_LIMIT">Stop limit</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {prefs.stopLossOrderType === "STOP_LIMIT" && (
          <div>
            <span style={{ fontSize: 9, color: DIM, display: "block", marginBottom: 4 }}>Lmt offset</span>
            <Input
              type="number"
              step={0.01}
              min={0.01}
              value={prefs.stopLimitOffset}
              onChange={(e) => patch({ stopLimitOffset: parseFloat(e.target.value) || 0.05 })}
              className="h-6 w-16 px-1.5 font-mono"
              style={{ fontSize: 12, background: "#111", borderColor: BORDER, color: WHITE }}
            />
          </div>
        )}
      </div>
    </div>
  );
});