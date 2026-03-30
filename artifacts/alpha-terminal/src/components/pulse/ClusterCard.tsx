import { TrendingUp, TrendingDown, Minus, BarChart2, Activity, Globe, Layers, Flame, Coins } from "lucide-react";
import type { PulseCluster } from "../../types/marketPulse";

const CATEGORY_ICONS: Record<PulseCluster["category"], React.ReactNode> = {
  equity: <BarChart2 className="w-3.5 h-3.5" />,
  volatility: <Activity className="w-3.5 h-3.5" />,
  breadth: <Layers className="w-3.5 h-3.5" />,
  macro: <Globe className="w-3.5 h-3.5" />,
  futures: <Flame className="w-3.5 h-3.5" />,
  commodities: <Coins className="w-3.5 h-3.5" />,
};

const BIAS_CONFIG = {
  BULLISH: { color: "#00d166", bg: "rgba(0,209,102,0.10)", label: "BULL" },
  BEARISH: { color: "#f23645", bg: "rgba(242,54,69,0.10)", label: "BEAR" },
  NEUTRAL: { color: "#FFB800", bg: "rgba(255,184,0,0.10)", label: "NEUT" },
};

const CONFIDENCE_DOT = {
  HIGH: "#00d166",
  MEDIUM: "#FFB800",
  LOW: "#f23645",
};

function DirectionIcon({ dir }: { dir?: "up" | "down" | "flat" }) {
  if (dir === "up") return <TrendingUp className="w-3 h-3 text-[#00d166]" />;
  if (dir === "down") return <TrendingDown className="w-3 h-3 text-[#f23645]" />;
  return <Minus className="w-3 h-3 text-[#71717a]" />;
}

interface ClusterCardProps {
  cluster: PulseCluster;
}

export function ClusterCard({ cluster }: ClusterCardProps) {
  const biasStyle = BIAS_CONFIG[cluster.bias];

  return (
    <div className="rounded-xl border border-[#2A2A2C] overflow-hidden" style={{ background: "#111113" }}>
      <div className="px-4 py-2.5 border-b border-[#2A2A2C] flex items-center gap-2" style={{ background: "#151517" }}>
        <span style={{ color: biasStyle.color }}>{CATEGORY_ICONS[cluster.category]}</span>
        <span className="font-mono text-xs font-bold text-[#e4e4e7] flex-1">{cluster.title}</span>
        <span
          className="px-2 py-0.5 rounded-full font-mono text-[9px] font-bold tracking-wider"
          style={{ background: biasStyle.bg, color: biasStyle.color }}
        >
          {biasStyle.label}
        </span>
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: CONFIDENCE_DOT[cluster.confidence] }}
          title={`Confidence: ${cluster.confidence}`}
        />
      </div>

      <div className="p-4 space-y-3">
        {cluster.keyData.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {cluster.keyData.map((d, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#2A2A2C]"
                style={{ background: "#0c0c0c" }}
              >
                <DirectionIcon dir={d.direction} />
                <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider">{d.label}</span>
                <span className="font-mono text-xs text-[#e4e4e7] font-bold tabular-nums">{d.value}</span>
              </div>
            ))}
          </div>
        )}

        <p className="font-sans text-xs text-[#a1a1aa] leading-relaxed">{cluster.summary}</p>
      </div>
    </div>
  );
}
