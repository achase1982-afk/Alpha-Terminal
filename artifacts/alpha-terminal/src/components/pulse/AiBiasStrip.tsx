import { TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";
import { useMarketPulseStore } from "../../stores/marketPulseStore";

const BIAS_ICONS = {
  BULLISH: <TrendingUp className="w-3 h-3" />,
  BEARISH: <TrendingDown className="w-3 h-3" />,
  NEUTRAL: <Minus className="w-3 h-3" />,
};

const BIAS_COLORS = {
  BULLISH: "#00d166",
  BEARISH: "#f23645",
  NEUTRAL: "#FFB800",
};

const CONFIDENCE_LABEL = {
  HIGH: "●●●",
  MEDIUM: "●●○",
  LOW: "●○○",
};

export function AiBiasStrip() {
  const { pulseData, settings } = useMarketPulseStore();

  if (!settings.showBiasStrip) return null;

  if (!pulseData) {
    return (
      <div
        className="flex items-center gap-3 px-4 py-1.5 border-b border-[#2A2A2C]"
        style={{ background: "#111113" }}
      >
        <div className="flex items-center gap-1.5">
          <Zap className="w-3 h-3 text-[#71717a]" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#71717a]">
            AI BIAS
          </span>
        </div>
        <span className="font-mono text-[10px] text-[#52525b] tracking-wider">
          Generate Market Pulse from AI tab
        </span>
      </div>
    );
  }

  const { bias } = pulseData;
  const color = BIAS_COLORS[bias.direction];

  return (
    <div
      className="flex items-center gap-3 px-4 py-1.5 border-b border-[#2A2A2C]"
      style={{ background: "#111113" }}
    >
      <div className="flex items-center gap-1.5">
        <Zap className="w-3 h-3" style={{ color }} />
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
          AI BIAS
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <span style={{ color }}>{BIAS_ICONS[bias.direction]}</span>
        <span className="font-mono text-[10px] font-bold tracking-wider" style={{ color }}>
          {bias.direction}
        </span>
      </div>

      <span className="font-mono text-[10px] tracking-wider" style={{ color, opacity: 0.7 }}>
        {CONFIDENCE_LABEL[bias.confidence]}
      </span>

      <span className="text-[#2A2A2C]">|</span>

      <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider">
        {bias.regime}
      </span>

      <span className="text-[#2A2A2C]">|</span>

      <span className="font-sans text-[11px] text-[#a1a1aa] truncate flex-1">
        {bias.headline}
      </span>
    </div>
  );
}
