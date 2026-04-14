import { Zap, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { useMarketPulseStore } from "../../stores/marketPulseStore";
import { useUICustomizationStore } from "../../lib/ui-customization-store";

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

const SCROLL_DURATIONS = {
  off: 0,
  slow: 10,
  normal: 6,
  fast: 3,
} as const;

interface AiBiasStripProps {
  onNavigateToPulse?: () => void;
}

export function AiBiasStrip({ onNavigateToPulse }: AiBiasStripProps) {
  const { pulseData, isLoading, isStreaming, settings } = useMarketPulseStore();
  const biasScrollSpeed = useUICustomizationStore((s) => s.biasScrollSpeed);
  const isActive = isLoading || isStreaming;

  if (!settings.showBiasStrip) return null;

  if (isActive) {
    return (
      <button
        onClick={onNavigateToPulse}
        className="flex items-center justify-center gap-2 w-full px-4 border-b border-zinc-800 cursor-pointer hover:bg-zinc-800 transition-colors"
        style={{ height: 28, backgroundColor: '#1C1C1E' }}
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
        style={{ height: 28, backgroundColor: '#1C1C1E' }}
      >
        <Zap className="w-3.5 h-3.5 text-zinc-500" />
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          AI PULSE: TAP TO GENERATE
        </span>
      </button>
    );
  }

  const shockState = pulseData.shockState ?? "NORMAL";
  const isShockWarning = shockState === "WARNING";
  const isShockActive = shockState === "ACTIVE";

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

  const summaryText = pulseData.sessionBias?.summary || pulseData.structuralRegime?.summary || "";
  const scrollDuration = SCROLL_DURATIONS[biasScrollSpeed] || SCROLL_DURATIONS.slow;
  const scrollEnabled = biasScrollSpeed !== "off";

  return (
    <button
      onClick={onNavigateToPulse}
      className="flex items-center justify-between w-full px-4 border-b border-zinc-800 cursor-pointer transition-colors hover:bg-zinc-800"
      style={{ height: 28, backgroundColor: '#1C1C1E' }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <div className={colors.label}>
          {trendIcon}
        </div>
        <span className={`text-sm font-semibold ${colors.label}`}>
          {pulseData.bias.replace(/_/g, " ")}
        </span>
        {(isShockWarning || isShockActive) && (
          <span className={`ml-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
            isShockActive
              ? "bg-red-500/20 text-red-400 border border-red-500/40"
              : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
          }`}>
            <AlertTriangle className="w-3 h-3" />
            {isShockActive ? "SHOCK" : "WARN"}
          </span>
        )}
        {pulseData.deltaHealth && pulseData.deltaHealth.state !== "HEALTHY" && pulseData.deltaHealth.state !== "AWAITING_BASELINE" && (
          <span className={`ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
            pulseData.deltaHealth.state === "REVERSING"
              ? "bg-red-500/20 text-red-400 border border-red-500/40"
              : pulseData.deltaHealth.state === "FADING"
              ? "bg-orange-500/20 text-orange-400 border border-orange-500/40"
              : pulseData.deltaHealth.state === "DEGRADED"
              ? "bg-zinc-500/20 text-zinc-400 border border-zinc-500/40"
              : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40"
          }`}>
            {pulseData.deltaHealth.state}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 mx-2">
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
        <span className="font-mono text-sm font-semibold uppercase tracking-wider text-amber-500 shrink-0">
          {pulseData.structuralRegime?.label?.replace(/_/g, "-") ?? "—"}
        </span>
        {summaryText && (
          <div className="overflow-hidden min-w-0" style={{ maskImage: "linear-gradient(to right, transparent 0%, black 4%, black 90%, transparent 100%)" }}>
            {scrollEnabled ? (
              <div
                className="flex whitespace-nowrap"
                style={{ animation: `biasScroll ${scrollDuration}s linear infinite` }}
              >
                <span className="font-mono text-[13px] text-white shrink-0 pr-16">{summaryText}</span>
                <span className="font-mono text-[13px] text-white shrink-0 pr-16">{summaryText}</span>
              </div>
            ) : (
              <span
                className="font-mono text-[13px] text-white whitespace-nowrap inline-block"
                style={{ overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {summaryText}
              </span>
            )}
          </div>
        )}
      </div>

      {scrollEnabled && (
        <style>{`
          @keyframes biasScroll {
            0% { transform: translateX(0); }
            100% { transform: translateX(-50%); }
          }
        `}</style>
      )}
    </button>
  );
}
