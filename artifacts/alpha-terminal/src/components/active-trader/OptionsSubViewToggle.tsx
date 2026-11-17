import { memo } from "react";
import { BG_EXP_BAR, BORDER, GRAY, MONO, FW_NORMAL } from "@/components/options/optionsTheme";

export type OptionsSubView = "chain" | "at";

interface OptionsSubViewToggleProps {
  view: OptionsSubView;
  onChange: (v: OptionsSubView) => void;
  accentHex: string;
}

export const OptionsSubViewToggle = memo(function OptionsSubViewToggle({
  view,
  onChange,
  accentHex,
}: OptionsSubViewToggleProps) {
  const pill = "px-4 py-1 text-center rounded-full border text-[10px] font-medium tracking-widest uppercase transition-colors whitespace-nowrap";
  return (
    <div className="flex justify-center px-3 mt-2 mb-1">
      <div
        className="inline-flex gap-0.5 p-0.5 rounded-full border"
        data-at-subview-toggle
        style={{ background: BG_EXP_BAR, borderColor: BORDER, fontFamily: MONO, fontWeight: FW_NORMAL }}
      >
      <button
        type="button"
        className={pill}
        style={{
          borderColor: view === "chain" ? accentHex : "transparent",
          color: view === "chain" ? accentHex : GRAY,
          background: view === "chain" ? "rgba(255,255,255,0.04)" : "transparent",
        }}
        onClick={() => onChange("chain")}
      >
        Chain
      </button>
      <button
        type="button"
        className={pill}
        style={{
          borderColor: view === "at" ? accentHex : "transparent",
          color: view === "at" ? accentHex : GRAY,
          background: view === "at" ? "rgba(255,255,255,0.04)" : "transparent",
        }}
        onClick={() => onChange("at")}
      >
        Active Trader
      </button>
      </div>
    </div>
  );
});