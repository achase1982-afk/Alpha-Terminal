import { memo } from "react";
import {
  BG_EXP_BAR, BORDER, DOWN, UP, GRAY, DIM, MONO, FW_NORMAL,
} from "@/components/options/optionsTheme";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      <div className="flex items-center gap-2 flex-nowrap overflow-x-auto" style={{ height: 32 }}>
        <Select
          value={prefs.template}
          onValueChange={(v) => onPrefsChange({ ...prefs, template: v as AtTemplateKind })}
        >
          <SelectTrigger
            className="h-6 w-[108px] px-1.5 border rounded text-white shrink-0"
            style={{ fontSize: 12, background: "transparent", borderColor: BORDER, fontFamily: MONO }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Single">Single</SelectItem>
            <SelectItem value="OCO">OCO</SelectItem>
            <SelectItem value="TRG w/ bracket">TRG w/ bracket</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 shrink-0">
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
        <Select
          value={prefs.orderType}
          onValueChange={(v) => onPrefsChange({ ...prefs, orderType: v as AtOrderType })}
        >
          <SelectTrigger
            className="h-6 w-[112px] px-1.5 border rounded text-white shrink-0"
            style={{ fontSize: 12, background: "transparent", borderColor: BORDER, fontFamily: MONO }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="LIMIT">LIMIT @ Mid</SelectItem>
            <SelectItem value="MKT">MKT</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2 justify-between flex-nowrap" style={{ height: 32 }}>
        <span
          className="truncate shrink min-w-0 max-w-[38%] border rounded px-2 py-1 whitespace-nowrap"
          style={{ fontSize: 11, borderColor: BORDER, color: GRAY }}
        >
          {instrumentLabel}
        </span>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onSell}
            className="px-3 rounded-lg border active:scale-95 whitespace-nowrap"
            style={{ height: 32, borderColor: BORDER, color: DOWN, fontSize: 12, fontWeight: FW_NORMAL, background: "transparent" }}
          >
            SELL {typeBtn}
          </button>
          <button
            type="button"
            onClick={onBuy}
            className="px-3 rounded-lg border active:scale-95 whitespace-nowrap"
            style={{ height: 32, borderColor: BORDER, color: UP, fontSize: 12, fontWeight: FW_NORMAL, background: "transparent" }}
          >
            BUY {typeBtn}
          </button>
        </div>
        <label className="flex items-center gap-1 shrink-0 whitespace-nowrap" style={{ fontSize: 10, color: DIM }}>
          <Checkbox disabled checked={false} />
          Auto send
          <span style={{ fontSize: 9, opacity: 0.65 }}>(soon)</span>
        </label>
        <span
          className="shrink-0 px-2 py-0.5 rounded border whitespace-nowrap"
          style={{
            fontSize: 10,
            color: isPaper ? GRAY : GRAY,
            borderColor: BORDER,
            letterSpacing: "0.04em",
          }}
        >
          {accountLabel}
        </span>
      </div>
    </div>
  );
});