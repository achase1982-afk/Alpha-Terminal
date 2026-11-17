import { memo } from "react";
import { BG_EXP_BAR, GRAY, MONO, FW_NORMAL } from "@/components/options/optionsTheme";

const GOLD = "#FFB800";

export type OptionsSubView = "chain" | "at";

interface OptionsSubViewToggleProps {
  view: OptionsSubView;
  onChange: (v: OptionsSubView) => void;
  accentHex: string;
}

export const OptionsSubViewToggle = memo(function OptionsSubViewToggle({
  view,
  onChange,
}: OptionsSubViewToggleProps) {
  const seg =
    "px-4 py-1 text-center rounded-full border text-[11px] tracking-wide transition-colors whitespace-nowrap font-normal";
  return (
    <div className="flex justify-center px-3 mt-1.5 mb-0.5">
      <div
        className="inline-flex gap-1 p-0.5 rounded-full"
        data-at-subview-toggle
        style={{
          background: "#0c0c0c",
          border: `1px solid ${BG_EXP_BAR}`,
          fontFamily: MONO,
          fontWeight: FW_NORMAL,
        }}
      >
        <button
          type="button"
          className={seg}
          style={{
            borderColor: "transparent",
            color: view === "chain" ? GRAY : "#52525b",
            background: "transparent",
          }}
          onClick={() => onChange("chain")}
        >
          Chain
        </button>
        <button
          type="button"
          className={seg}
          style={{
            borderColor: view === "at" ? GOLD : "transparent",
            color: view === "at" ? GOLD : GRAY,
            background: "transparent",
          }}
          onClick={() => onChange("at")}
        >
          Active Trader
        </button>
      </div>
    </div>
  );
});