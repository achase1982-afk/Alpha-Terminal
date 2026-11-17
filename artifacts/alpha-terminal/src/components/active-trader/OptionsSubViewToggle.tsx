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
  const pill = "flex-1 py-1.5 text-center rounded-full border text-[10px] font-medium tracking-widest uppercase transition-colors";
  return (
    <div
      className="flex gap-1 p-1 rounded-full border mx-3 mt-2 mb-1"
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
  );
});