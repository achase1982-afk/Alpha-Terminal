import { memo } from "react";
import {
  BG_EXP_BAR, BORDER, DOWN, UP, GRAY, DIM, MONO, FW_NORMAL,
} from "@/components/options/optionsTheme";
import { Checkbox } from "@/components/ui/checkbox";
import type { ActiveTraderTemplatePrefs, AtTemplateKind, AtOrderType } from "@/lib/active-trader/activeTraderPrefs";

interface TemplateBarProps {
  accentHex: string;
  instrumentLabel: string;
  prefs: ActiveTraderTemplatePrefs;
  onPrefsChange: (p: ActiveTraderTemplatePrefs) => void;
  onSell: () => void;
  onBuy: () => void;
  stickyTop: number;
  accountLabel: string;
  isPaper: boolean;
}

export const TemplateBar = memo(function TemplateBar({
  accentHex,
  instrumentLabel,
  prefs,
  onPrefsChange,
  onSell,
  onBuy,
  stickyTop,
  accountLabel,
  isPaper,
}: TemplateBarProps) {
  const typeBtn = prefs.orderType === "LIMIT" ? "LMT" : "MKT";
  return (
    <div
      className="sticky z-[39] px-3 py-1 space-y-1"
      style={{ top: stickyTop, background: BG_EXP_BAR, borderBottom: `1px solid ${BORDER}`, fontFamily: MONO }}
    >
      <div className="flex flex-wrap items-center gap-2" style={{ height: 32 }}>
        <select
          className="h-6 px-1.5 rounded border text-white"
          style={{ fontSize: 12, background: "transparent", borderColor: BORDER }}
          value={prefs.template}
          onChange={(e) => onPrefsChange({ ...prefs, template: e.target.value as AtTemplateKind })}
        >
          <option value="Single">Single</option>
          <option value="OCO">OCO</option>
          <option value="TRG w/ bracket">TRG w/ bracket</option>
        </select>
        <div className="flex items-center gap-1">
          {[1, 2, 5, 10].map((q) => (
            <button
              key={q}
              type="button"
              className="h-6 min-w-6 px-1 rounded border"
              style={{
                fontSize: 11,
                borderColor: prefs.qty === q ? accentHex : BORDER,
                color: prefs.qty === q ? accentHex : GRAY,
                background: "transparent",
              }}
              onClick={() => onPrefsChange({ ...prefs, qty: q })}
            >
              {q}
            </button>
          ))}
        </div>
        <select
          className="h-6 px-1.5 rounded border text-white"
          style={{ fontSize: 12, background: "transparent", borderColor: BORDER }}
          value={prefs.orderType}
          onChange={(e) => onPrefsChange({ ...prefs, orderType: e.target.value as AtOrderType })}
        >
          <option value="LIMIT">LIMIT @ Mid</option>
          <option value="MKT">MKT</option>
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 justify-between" style={{ height: 32 }}>
        <span className="truncate max-w-[40%] border rounded px-2 py-1" style={{ fontSize: 11, borderColor: BORDER, color: GRAY }}>
          {instrumentLabel}
        </span>
        <div className="flex gap-2 flex-1 justify-end">
          <button
            type="button"
            onClick={onSell}
            className="px-3 rounded-lg border active:scale-95"
            style={{ height: 32, borderColor: BORDER, color: DOWN, fontSize: 12, fontWeight: FW_NORMAL, background: "transparent" }}
          >
            SELL {typeBtn}
          </button>
          <button
            type="button"
            onClick={onBuy}
            className="px-3 rounded-lg border active:scale-95"
            style={{ height: 32, borderColor: BORDER, color: UP, fontSize: 12, fontWeight: FW_NORMAL, background: "transparent" }}
          >
            BUY {typeBtn}
          </button>
        </div>
        <label className="flex items-center gap-1" style={{ fontSize: 10, color: DIM }}>
          <Checkbox disabled checked={false} />
          Auto send
          <span style={{ fontSize: 9 }}>(soon)</span>
        </label>
        <span style={{ fontSize: 10, color: isPaper ? GRAY : DOWN }}>{accountLabel}</span>
      </div>
    </div>
  );
});