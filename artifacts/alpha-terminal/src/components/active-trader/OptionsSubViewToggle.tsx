import { memo } from "react";
import { ChevronDown } from "lucide-react";
import { BG_EXP_BAR, GRAY, MONO, FW_NORMAL, BORDER } from "@/components/options/optionsTheme";

const GOLD = "#FFB800";

export type OptionsSubView = "chain" | "at";

interface OptionsSubViewToggleProps {
  view: OptionsSubView;
  onChange: (v: OptionsSubView) => void;
  /** Renders in shared toolbar (chain + AT) with outlined control. */
  toolbar?: boolean;
}

export const OptionsSubViewToggle = memo(function OptionsSubViewToggle({
  view,
  onChange,
  toolbar,
}: OptionsSubViewToggleProps) {
  const label = view === "chain" ? "Chain" : "Active Trader";
  const wrapClass = toolbar
    ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-md"
    : "inline-flex items-center gap-1 px-2 py-0.5 rounded-md";
  return (
    <label
      className={wrapClass}
      data-at-subview-toggle
      data-at-view-selector
      style={{
        fontFamily: MONO,
        fontWeight: FW_NORMAL,
        background: "#0c0c0c",
        border: `1px solid ${toolbar ? BORDER : BG_EXP_BAR}`,
        fontSize: 11,
        color: toolbar ? GRAY : GOLD,
      }}
    >
      <select
        aria-label="Options view"
        value={view}
        onChange={(e) => onChange(e.target.value as OptionsSubView)}
        className="bg-transparent border-0 outline-none cursor-pointer pr-0"
        style={{
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 600,
          color: "inherit",
          appearance: "none",
          WebkitAppearance: "none",
          minWidth: 88,
        }}
      >
        <option value="chain">Chain</option>
        <option value="at">Active Trader</option>
      </select>
      <ChevronDown className="w-3 h-3 shrink-0 pointer-events-none" style={{ color: GRAY }} aria-hidden />
      <span className="sr-only">{label}</span>
    </label>
  );
});