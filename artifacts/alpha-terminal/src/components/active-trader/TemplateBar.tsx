import { memo } from "react";
import {
  BG_EXP_BAR, BORDER, DOWN, UP, GRAY, DIM, MONO, FW_NORMAL, TOOLBAR_H,
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
import { patchAutoSendArmed, patchAutoSendEnabled } from "@/lib/active-trader/atAutoSend";

interface TemplateBarProps {
  accentHex: string;
  instrumentLabel: string;
  prefs: ActiveTraderTemplatePrefs;
  onPrefsChange: (p: ActiveTraderTemplatePrefs) => void;
  onSell: () => void;
  onBuy: () => void;
  stickyTop?: number;
  accountLabel: string;
  isPaper: boolean;
  /** Inside collapsible settings panel (no sticky). */
  embedded?: boolean;
  /** Non-null when Arm is blocked (safeguard). */
  autoSendArmBlock?: string | null;
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
  embedded,
  autoSendArmBlock,
}: TemplateBarProps) {
  const typeBtn = prefs.orderType === "LIMIT" ? "LMT" : "MKT";
  return (
    <div
      className={embedded ? "px-3 py-1" : "sticky z-[39] px-3 py-1"}
      style={{
        ...(embedded ? {} : { top: stickyTop }),
        background: BG_EXP_BAR,
        borderBottom: embedded ? undefined : `1px solid ${BORDER}`,
        fontFamily: MONO,
      }}
    >
      <div
        className="flex items-center gap-2 flex-nowrap overflow-x-auto"
        style={{ height: embedded ? TOOLBAR_H : 32 }}
      >
        <Select
          value={prefs.template}
          onValueChange={(v) => onPrefsChange({ ...prefs, template: v as AtTemplateKind })}
        >
          <SelectTrigger
            className="h-6 min-w-[132px] px-1.5 border rounded text-white shrink-0"
            style={{ fontSize: 14, background: "#111", borderColor: "#2a2a2a", fontFamily: MONO }}
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
            style={{ fontSize: 14, background: "#111", borderColor: "#2a2a2a", fontFamily: MONO }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="LIMIT">LIMIT @ Mid</SelectItem>
            <SelectItem value="MKT">MKT</SelectItem>
          </SelectContent>
        </Select>
        {!embedded && (
          <>
        <div className="flex gap-2 shrink-0 ml-auto">
          <button
            type="button"
            onClick={onSell}
            className="px-3 rounded-lg border active:scale-95 whitespace-nowrap"
            style={{ height: 28, borderColor: BORDER, color: DOWN, fontSize: 12, fontWeight: FW_NORMAL, background: "transparent" }}
          >
            SELL {typeBtn}
          </button>
          <button
            type="button"
            onClick={onBuy}
            className="px-3 rounded-lg border active:scale-95 whitespace-nowrap"
            style={{ height: 28, borderColor: BORDER, color: UP, fontSize: 12, fontWeight: FW_NORMAL, background: "transparent" }}
          >
            BUY {typeBtn}
          </button>
        </div>
          </>
        )}
      </div>
      {embedded && (
      <div className="flex items-center gap-2 justify-between flex-nowrap pb-1" style={{ minHeight: TOOLBAR_H }}>
        <span
          className="shrink min-w-0 border rounded px-2 py-1"
          style={{ fontSize: 11, borderColor: BORDER, color: GRAY, wordBreak: "break-word" }}
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
        <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
          <label className="flex items-center gap-1" style={{ fontSize: 10, color: DIM }}>
            <Checkbox
              checked={prefs.autoSend.enabled}
              onCheckedChange={(v) => onPrefsChange(patchAutoSendEnabled(prefs, v === true))}
            />
            Auto send
          </label>
          {prefs.autoSend.enabled && (
            <button
              type="button"
              title={autoSendArmBlock ?? undefined}
              disabled={!prefs.autoSend.armed && !!autoSendArmBlock}
              className="h-6 px-1.5 rounded border"
              style={{
                fontSize: 9,
                borderColor: prefs.autoSend.armed ? UP : BORDER,
                color: prefs.autoSend.armed ? UP : GRAY,
                background: prefs.autoSend.armed ? `${UP}18` : "transparent",
                letterSpacing: "0.04em",
              }}
              onClick={() => onPrefsChange(patchAutoSendArmed(prefs, !prefs.autoSend.armed))}
            >
              {prefs.autoSend.armed ? "ARMED" : "Arm"}
            </button>
          )}
        </div>
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
      )}
    </div>
  );
});