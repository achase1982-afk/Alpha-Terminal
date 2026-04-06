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
  if (score > 0) return "#00d166";
  if (score < 0) return "#f23645";
  return "#9CA3AF";
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
      className="shrink-0 overflow-hidden rounded-lg"
      style={{
        background: "#0c0c0c",
        border: "1px solid rgba(63,63,70,0.5)",
        width: 220,
        minWidth: 220,
      }}
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-zinc-800/50">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-bold text-zinc-200 tracking-wider">{label}</span>
          <span className="font-mono text-[11px] text-zinc-500">{weight}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-black tabular-nums" style={{ color: sc }}>
            {cluster.score > 0 ? "+" : ""}{cluster.score.toFixed(2)}
          </span>
          <span
            className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{
              color: cluster.dataQuality === "FRESH" ? "#00d166" : cluster.dataQuality === "STALE" ? "#FFB800" : "#f23645",
              border: `1px solid ${cluster.dataQuality === "FRESH" ? "rgba(0,209,102,0.3)" : cluster.dataQuality === "STALE" ? "rgba(255,184,0,0.3)" : "rgba(242,54,69,0.3)"}`,
            }}
          >{cluster.dataQuality}</span>
        </div>
      </div>

      <div className="px-3 py-1">
        <div className="h-[3px] w-full rounded-full" style={{ background: "rgba(63,63,70,0.3)" }}>
          <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: sc }} />
        </div>
      </div>

      <div className="px-3 py-2.5 space-y-2">
        <p className="font-mono text-[12px] text-zinc-300 leading-snug line-clamp-2">{cluster.headline}</p>
        {cluster.keyDataPoints.length > 0 && (
          <div className="space-y-0.5">
            {cluster.keyDataPoints.slice(0, 4).map((dp, i) => (
              <div key={i} className="font-mono text-[11px] text-zinc-500 tabular-nums truncate">{dp}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
