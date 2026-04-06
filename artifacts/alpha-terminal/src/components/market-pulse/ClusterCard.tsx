import type { ClusterData, ClusterKey } from "../../types/marketPulse";

const CLUSTER_LABELS: Record<ClusterKey, string> = {
  rates: "RATES",
  credit: "CREDIT",
  volLevel: "VOL LVL",
  volTerm: "VOL TERM",
  breadth: "BREADTH",
  riskAppetite: "RISK APP",
  macro: "MACRO",
};

const CLUSTER_WEIGHTS: Record<ClusterKey, number> = {
  rates: 18,
  credit: 12,
  volLevel: 15,
  volTerm: 12,
  breadth: 18,
  riskAppetite: 15,
  macro: 10,
};

function scoreColor(score: number): string {
  if (score > 0) return "#22c55e";
  if (score < 0) return "#ef4444";
  return "#71717a";
}

interface ClusterCardProps {
  clusterKey: ClusterKey;
  cluster: ClusterData;
}

export function ClusterCard({ clusterKey, cluster }: ClusterCardProps) {
  const label = CLUSTER_LABELS[clusterKey];
  const weight = CLUSTER_WEIGHTS[clusterKey];
  const sc = scoreColor(cluster.score);
  const pct = Math.min(Math.abs(cluster.score) / 2 * 100, 100);

  return (
    <div
      className="shrink-0 overflow-hidden"
      style={{
        background: "#000",
        border: "1px solid #1a1a1a",
        width: 200,
        minWidth: 200,
        opacity: cluster.dataQuality === "MISSING" ? 0.35 : 1,
      }}
    >
      <div className="px-3 py-1.5 flex items-center justify-between" style={{ borderBottom: "1px solid #1a1a1a" }}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-bold text-[#d4d4d8] tracking-wider">{label}</span>
          <span className="font-mono text-[8px] text-[#3f3f46]">{weight}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-black tabular-nums" style={{ color: sc }}>
            {cluster.score > 0 ? "+" : ""}{cluster.score.toFixed(2)}
          </span>
          <span
            className="font-mono text-[7px] font-bold px-1 py-px"
            style={{
              color: cluster.dataQuality === "FRESH" ? "#22c55e" : cluster.dataQuality === "STALE" ? "#fbbf24" : "#ef4444",
              border: `1px solid ${cluster.dataQuality === "FRESH" ? "#14532d" : cluster.dataQuality === "STALE" ? "#422006" : "#450a0a"}`,
            }}
          >{cluster.dataQuality}</span>
        </div>
      </div>

      <div className="px-3 py-0.5">
        <div className="h-[3px] w-full" style={{ background: "#1a1a1a" }}>
          <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: sc }} />
        </div>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        <p className="font-mono text-[10px] text-[#a1a1aa] leading-[1.5] line-clamp-2">{cluster.headline}</p>
        {cluster.keyDataPoints.length > 0 && (
          <div className="space-y-px">
            {cluster.keyDataPoints.slice(0, 4).map((dp, i) => (
              <div key={i} className="font-mono text-[9px] text-[#52525b] tabular-nums truncate">{dp}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
