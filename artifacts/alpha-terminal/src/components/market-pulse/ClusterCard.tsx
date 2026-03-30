import { TrendingUp, TrendingDown, Minus, BarChart2, Activity, Layers, GitBranch, Users } from "lucide-react";
import type { ClusterData, ClusterKey } from "../../types/marketPulse";

const CLUSTER_CONFIG: Record<ClusterKey, { label: string; icon: React.ReactNode }> = {
  rates: { label: "RATES", icon: <BarChart2 className="w-3.5 h-3.5" /> },
  credit: { label: "CREDIT", icon: <Activity className="w-3.5 h-3.5" /> },
  volLevel: { label: "VOL LEVEL", icon: <Layers className="w-3.5 h-3.5" /> },
  volTermStructure: { label: "TERM STRUCT", icon: <GitBranch className="w-3.5 h-3.5" /> },
  breadth: { label: "BREADTH", icon: <Users className="w-3.5 h-3.5" /> },
};

function scoreColor(score: number): string {
  if (score >= 1) return "#00d166";
  if (score > 0) return "#00d166";
  if (score <= -1) return "#f23645";
  if (score < 0) return "#f23645";
  return "#71717a";
}

function DirectionArrow({ direction }: { direction: string }) {
  if (direction === "UP" || direction === "POSITIVE" || direction === "COMPRESSING" || direction === "CONTANGO") {
    return <TrendingUp className="w-3 h-3 text-[#00d166]" />;
  }
  if (direction === "DOWN" || direction === "NEGATIVE" || direction === "EXPANDING" || direction === "INVERTED") {
    return <TrendingDown className="w-3 h-3 text-[#f23645]" />;
  }
  return <Minus className="w-3 h-3 text-[#71717a]" />;
}

function qualityDot(quality: string): string {
  if (quality === "FRESH") return "#00d166";
  if (quality === "STALE") return "#FFB800";
  return "#f23645";
}

interface ClusterCardProps {
  clusterKey: ClusterKey;
  cluster: ClusterData;
}

export function ClusterCard({ clusterKey, cluster }: ClusterCardProps) {
  const config = CLUSTER_CONFIG[clusterKey];
  const isDimmed = cluster.dataQuality !== "FRESH";
  const sColor = scoreColor(cluster.score);

  return (
    <div
      className="rounded-xl border border-[#2A2A2C] overflow-hidden shrink-0"
      style={{
        background: "#111113",
        opacity: isDimmed ? 0.5 : 1,
        width: 220,
        minWidth: 220,
      }}
    >
      <div className="px-3 py-2 border-b border-[#2A2A2C] flex items-center gap-2" style={{ background: "#151517" }}>
        <span style={{ color: sColor }}>{config.icon}</span>
        <span className="font-mono text-[10px] font-bold text-[#e4e4e7] flex-1 tracking-wider">{config.label}</span>
        <span
          className="font-mono text-sm font-black tabular-nums"
          style={{ color: sColor }}
        >
          {cluster.score > 0 ? "+" : ""}{cluster.score.toFixed(1)}
        </span>
        <DirectionArrow direction={cluster.direction} />
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: qualityDot(cluster.dataQuality) }}
          title={`Data: ${cluster.dataQuality}`}
        />
      </div>

      <div className="p-3 space-y-2">
        <p className="font-sans text-[11px] text-[#a1a1aa] leading-snug line-clamp-2">{cluster.headline}</p>
        {cluster.keyDataPoints.length > 0 && (
          <div className="space-y-0.5">
            {cluster.keyDataPoints.map((dp, i) => (
              <span key={i} className="block font-mono text-[10px] text-[#71717a] tabular-nums">{dp}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
