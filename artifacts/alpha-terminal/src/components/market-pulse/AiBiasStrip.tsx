import { Zap, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useMarketPulseStore } from "../../stores/marketPulseStore";

const BIAS_COLORS: Record<string, { label: string; accent: string }> = {
  STRONGLY_BULLISH: { label: "text-emerald-400", accent: "bg-emerald-400" },
  MODERATELY_BULLISH: { label: "text-emerald-400", accent: "bg-emerald-400" },
  SLIGHTLY_BULLISH: { label: "text-emerald-300", accent: "bg-emerald-300" },
  NEUTRAL: { label: "text-amber-400", accent: "bg-amber-400" },
  SLIGHTLY_BEARISH: { label: "text-red-300", accent: "bg-red-300" },
  MODERATELY_BEARISH: { label: "text-red-400", accent: "bg-red-400" },
  STRONGLY_BEARISH: { label: "text-red-400", accent: "bg-red-400" },
  NO_EDGE: { label: "text-zinc-500", accent: "bg-zinc-600" },
};

interface AiBiasStripProps {
  onNavigateToPulse?: () => void;
}

export function AiBiasStrip({ onNavigateToPulse }: AiBiasStripProps) {
  const { pulseData, isLoading, isStreaming, settings } = useMarketPulseStore();
  const isActive = isLoading || isStreaming;

  if (!settings.showBiasStrip) return null;

  if (isActive) {
    return (
      <button
        onClick={onNavigateToPulse}
        className="flex items-center justify-center gap-2 w-full px-4 border-b border-zinc-800 cursor-pointer hover:bg-zinc-800 transition-colors"
        style={{ height: 36, backgroundColor: '#1C1C1E' }}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FFB800] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FFB800]" />
        </span>
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-[#FFB800]">
          AI PULSE: GENERATING…
        </span>
      </button>
    );
  }

  if (!pulseData) {
    return (
      <button
        onClick={onNavigateToPulse}
        className="flex items-center justify-center gap-2 w-full px-4 border-b border-zinc-800 cursor-pointer hover:bg-zinc-800 transition-colors"
        style={{ height: 36, backgroundColor: '#1C1C1E' }}
      >
        <Zap className="w-3.5 h-3.5 text-zinc-500" />
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          AI PULSE: TAP TO GENERATE
        </span>
      </button>
    );
  }

  const colors = BIAS_COLORS[pulseData.bias] ?? BIAS_COLORS.NO_EDGE;
  const isBullish = pulseData.bias === "STRONGLY_BULLISH" || pulseData.bias === "MODERATELY_BULLISH" || pulseData.bias === "SLIGHTLY_BULLISH";
  const isBearish = pulseData.bias === "STRONGLY_BEARISH" || pulseData.bias === "MODERATELY_BEARISH" || pulseData.bias === "SLIGHTLY_BEARISH";
  const ageMs = Date.now() - pulseData.generatedAt;
  const ageMinutes = Math.floor(ageMs / 60_000);
  const isStale = ageMinutes > 15;

  const trendIcon = isBullish ? (
    <TrendingUp className="w-3.5 h-3.5" />
  ) : isBearish ? (
    <TrendingDown className="w-3.5 h-3.5" />
  ) : (
    <Minus className="w-3.5 h-3.5" />
  );

  const confidenceFilledDots = pulseData.confidenceScore >= 70 
    ? 3 
    : pulseData.confidenceScore >= 40 
    ? 2 
    : 1;

  return (
    <button
      onClick={onNavigateToPulse}
      className="flex items-center justify-between w-full px-4 border-b border-zinc-800 cursor-pointer transition-colors hover:bg-zinc-800"
      style={{ height: 36, backgroundColor: '#1C1C1E' }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <Zap className="w-4 h-4 text-amber-500" />
        <span className="font-mono text-[9px] font-medium uppercase tracking-wider text-zinc-500">
          AI BIAS
        </span>
        <div className={colors.label}>
          {trendIcon}
        </div>
        <span className={`text-sm font-semibold ${colors.label}`}>
          {pulseData.bias.replace(/_/g, " ")}
        </span>
      </div>

      <div className="flex items-center gap-1 mx-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${
              i < confidenceFilledDots
                ? colors.accent
                : "border border-zinc-600"
            }`}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 min-w-0 shrink-0 max-w-[200px]">
        {isStale && (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
          </span>
        )}
        <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-500 shrink-0">
          {pulseData.structuralRegime?.label?.replace(/_/g, "-") ?? "—"}
        </span>
        <span className="font-mono text-[9px] text-zinc-500 truncate">
          {pulseData.sessionBias?.summary || pulseData.structuralRegime?.summary || ""}
        </span>
      </div>
    </button>
  );
}
