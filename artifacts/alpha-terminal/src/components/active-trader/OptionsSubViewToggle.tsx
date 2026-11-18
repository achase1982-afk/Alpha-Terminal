import { memo } from "react";
import { ChevronDown } from "lucide-react";
import { BG_EXP_BAR, GRAY, MONO, FW_NORMAL, BORDER } from "@/components/options/optionsTheme";
import { AT_HEADER_BG } from "@/lib/active-trader/atChromeContrast";

export type OptionsSubView = "chain" | "at";

interface OptionsSubViewToggleProps {
  view: OptionsSubView;
  onChange: (v: OptionsSubView) => void;
  /** Chain options toolbar (upper-right) vs AT glance header — same visual, shared position. */
  placement?: "chain-toolbar" | "at-header";
}

const MIN_TAP = 44;

export const OptionsSubViewToggle = memo(function OptionsSubViewToggle({
  view,
  onChange,
  placement = "chain-toolbar",
}: OptionsSubViewToggleProps) {
  const label = view === "chain" ? "Chain" : "Active Trader";
  const chromeBg = placement === "at-header" ? AT_HEADER_BG : BG_EXP_BAR;
  return (
    <div
      data-at-subview-chrome
      className="inline-flex items-center justify-center shrink-0"
      style={{ minWidth: MIN_TAP, minHeight: MIN_TAP }}
    >
      <label
        className="inline-flex items-center gap-1 rounded-md cursor-pointer"
        data-at-subview-toggle
        data-at-view-selector
        data-at-subview-placement={placement}
        style={{
          fontFamily: MONO,
          fontWeight: FW_NORMAL,
          background: chromeBg,
          border: `1px solid ${BORDER}`,
          fontSize: 11,
          color: GRAY,
          minHeight: MIN_TAP,
          minWidth: MIN_TAP,
          padding: "0 10px",
          boxSizing: "border-box",
        }}
      >
        <select
          aria-label="Options view"
          value={view}
          onChange={(e) => onChange(e.target.value as OptionsSubView)}
          className="bg-transparent border-0 outline-none cursor-pointer pr-0 flex-1 min-w-0"
          style={{
            fontFamily: MONO,
            fontSize: 11,
            fontWeight: 600,
            color: "inherit",
            appearance: "none",
            WebkitAppearance: "none",
            minWidth: 72,
            minHeight: MIN_TAP - 2,
          }}
        >
          <option value="chain">Chain</option>
          <option value="at">Active Trader</option>
        </select>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 pointer-events-none" style={{ color: GRAY }} aria-hidden />
        <span className="sr-only">{label}</span>
      </label>
    </div>
  );
});