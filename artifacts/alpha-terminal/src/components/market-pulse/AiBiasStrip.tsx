import { Zap } from "lucide-react";
import { useMarketPulseStore } from "../../stores/marketPulseStore";

const STRIP_STYLES: Record<string, { bg: string; text: string }> = {
  STRONGLY_BULLISH: { bg: "rgba(5,150,105,0.9)", text: "#ffffff" },
  BULLISH: { bg: "rgba(6,95,70,0.8)", text: "#d1fae5" },
  NEUTRAL: { bg: "rgba(180,83,9,0.7)", text: "#fef3c7" },
  BEARISH: { bg: "rgba(153,27,27,0.8)", text: "#fee2e2" },
  STRONGLY_BEARISH: { bg: "rgba(220,38,38,0.9)", text: "#ffffff" },
  NO_EDGE: { bg: "rgba(63,63,70,0.8)", text: "#d4d4d8" },
};

interface AiBiasStripProps {
  onNavigateToPulse?: () => void;
}

export function AiBiasStrip({ onNavigateToPulse }: AiBiasStripProps) {
  const { pulseData, settings } = useMarketPulseStore();

  if (!settings.showBiasStrip) return null;

  if (!pulseData) {
    return (
      <button
        onClick={onNavigateToPulse}
        className="flex items-center justify-center gap-2 w-full px-4 border-b border-[#2A2A2C] cursor-pointer hover:bg-[#1a1a1a] transition-colors"
        style={{ background: "#111113", height: 36 }}
      >
        <Zap className="w-3 h-3 text-[#71717a]" />
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#71717a]">
          AI PULSE: TAP TO GENERATE
        </span>
      </button>
    );
  }

  const style = STRIP_STYLES[pulseData.bias] ?? STRIP_STYLES.NO_EDGE;
  const ageMs = Date.now() - pulseData.generatedAt;
  const ageMinutes = Math.floor(ageMs / 60_000);
  const isStale = ageMinutes > 15;

  const generatedDate = new Date(pulseData.generatedAt);
  const timeStr = generatedDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  return (
    <button
      onClick={onNavigateToPulse}
      className="flex items-center w-full px-4 border-b border-[#2A2A2C] cursor-pointer transition-colors"
      style={{ background: style.bg, height: 38 }}
    >
      <div className="flex items-center gap-1.5 shrink-0">
        <Zap className="w-3 h-3" style={{ color: style.text }} />
        <span
          className="font-mono text-[10px] font-bold uppercase tracking-wider"
          style={{ color: style.text }}
        >
          AI PULSE: {pulseData.bias.replace(/_/g, " ")}
        </span>
      </div>

      <div className="flex-1 flex justify-center">
        <span
          className="font-mono text-xs font-bold tabular-nums"
          style={{ color: style.text }}
        >
          {Math.round(pulseData.confidenceScore)}
          <span style={{ opacity: 0.6 }}> / {Math.round(pulseData.maxConfidence)}</span>
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isStale && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FFB800] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FFB800]" />
          </span>
        )}
        <span
          className="font-mono text-[10px] tracking-wider"
          style={{ color: style.text, opacity: 0.8 }}
        >
          Updated {timeStr}
        </span>
      </div>
    </button>
  );
}
