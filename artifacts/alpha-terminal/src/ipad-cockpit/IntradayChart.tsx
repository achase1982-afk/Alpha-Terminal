import { useEffect, useState } from "react";
import type { ChartGeometry } from "./chartModel";

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return reduce;
}

export function IntradayChart({
  geometry,
  status,
  statusTone,
}: {
  geometry: ChartGeometry;
  status: string;
  statusTone: "apart" | "aligned";
}) {
  const reduce = useReduceMotion();
  const gradId = "ipad-spot-fill";
  return (
    <section id="modChart" className="mod" aria-label="Intraday spot versus dealer walls">
      <div className="chart-h">
        <span className="chart-title">SPX INTRADAY · WALLS + 5m NET FLOW</span>
        <span className={`div-pill ${statusTone}`}>{status}</span>
      </div>
      <svg className="chart-svg" viewBox="0 0 440 146" preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={geometry.line} stopOpacity="0.28" />
            <stop offset="100%" stopColor={geometry.line} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {geometry.gridX.map((x) => (
          <line key={x} x1={x} y1={8} x2={x} y2={92} stroke="#1C2330" strokeDasharray="2 3" strokeWidth={1} />
        ))}
        {geometry.walls.map((wall) => (
          <line
            key={wall.key}
            x1={6}
            y1={wall.y}
            x2={376}
            y2={wall.y}
            stroke={wall.color}
            strokeDasharray="4 3"
            strokeWidth={1.2}
          />
        ))}
        <path d={geometry.areaPath} fill={`url(#${gradId})`} />
        <polyline
          points={geometry.pricePoints}
          fill="none"
          stroke={geometry.line}
          strokeWidth={2.4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx={geometry.endpoint.x} cy={geometry.endpoint.y} r={5} fill={geometry.line} opacity={0.55}>
          {reduce ? null : (
            <>
              <animate attributeName="r" values="5;8.25;5" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.55;0;0.55" dur="2s" repeatCount="indefinite" />
            </>
          )}
        </circle>
        <circle
          cx={geometry.endpoint.x}
          cy={geometry.endpoint.y}
          r={3.2}
          fill="#FFFFFF"
          stroke={geometry.line}
          strokeWidth={1.4}
        />
        {geometry.walls.map((wall) => (
          <g key={`${wall.key}-tag`}>
            <rect x={380} y={wall.y - 7} width={58} height={14} rx={3} fill={wall.tagFill} />
            <text
              x={409}
              y={wall.y + 3}
              textAnchor="middle"
              fill={wall.color}
              fontSize={8}
              fontWeight={800}
            >
              {wall.tag}
            </text>
          </g>
        ))}
        <line x1={6} y1={98} x2={434} y2={98} stroke="#232B38" strokeWidth={1} />
        <line x1={6} y1={121} x2={376} y2={121} stroke="#1C2330" strokeWidth={1} />
        {geometry.bars.map((bar, index) => (
          <rect key={index} x={bar.x} y={bar.y} width={bar.w} height={bar.h} rx={1.5} fill={bar.color} />
        ))}
        <text x={380} y={114} fill="#94A3B8" fontSize={8} fontWeight={700}>
          5m FLOW
        </text>
        <text x={380} y={126} fill={geometry.flowColor} fontSize={9} fontWeight={800}>
          {geometry.flowValue}
        </text>
        {geometry.times.map((tick) => (
          <text
            key={tick.label}
            x={tick.x}
            y={144}
            textAnchor={tick.anchor}
            fill="#64748B"
            fontSize={8.5}
            fontWeight={600}
          >
            {tick.label}
          </text>
        ))}
      </svg>
    </section>
  );
}
