import { useState } from "react";
import { ChevronDown, Database } from "lucide-react";
import type { MarketPulseData, RawIndicators, ClusterKey } from "../../types/marketPulse";

type AuditCluster = "volLevel" | "volTerm" | "rates" | "credit" | "breadth" | "riskAppetite" | "macro";

interface IndicatorRow {
  symbol: string;
  label: string;
  value: number | null;
  change: number | null;
  cluster: AuditCluster;
}

const CLUSTER_LABELS: Record<AuditCluster, string> = {
  rates: "Rates",
  credit: "Credit",
  volLevel: "Vol Level",
  volTerm: "Vol Term",
  breadth: "Breadth",
  riskAppetite: "Risk App",
  macro: "Macro",
};

function buildIndicatorRows(raw: RawIndicators): IndicatorRow[] {
  return [
    { symbol: "$TNX", label: "TNX (10Y Yield)", value: raw.tnx, change: raw.tnxChange, cluster: "rates" },
    { symbol: "$TYX", label: "TYX (30Y Yield)", value: raw.tyx, change: raw.tyxChange, cluster: "rates" },
    { symbol: "/ZB", label: "30Y Bond Futures", value: raw.zb, change: raw.zbChange, cluster: "rates" },
    { symbol: "/ZT", label: "2Y Note Futures", value: raw.zt, change: raw.ztChange, cluster: "rates" },
    { symbol: "HYG", label: "HYG (High Yield)", value: raw.hyg, change: raw.hygChange, cluster: "credit" },
    { symbol: "LQD", label: "LQD (Inv Grade)", value: raw.lqd, change: raw.lqdChange, cluster: "credit" },
    { symbol: "IEF", label: "IEF (7-10Y Tsy)", value: raw.ief, change: raw.iefChange, cluster: "credit" },
    { symbol: "$VIX", label: "VIX (30-Day IV)", value: raw.vix, change: raw.vixChange, cluster: "volLevel" },
    { symbol: "$VVIX", label: "VVIX (Vol of Vol)", value: raw.vvix, change: raw.vvixChange, cluster: "volLevel" },
    { symbol: "$VIX9D", label: "VIX9D (9-Day)", value: raw.vix9d, change: raw.vix9dChange, cluster: "volTerm" },
    { symbol: "$VIX3M", label: "VIX3M (3-Month)", value: raw.vix3m, change: raw.vix3mChange, cluster: "volTerm" },
    { symbol: "$SKEW", label: "SKEW (Tail Risk)", value: raw.skew, change: null, cluster: "volTerm" },
    { symbol: "$ADVN", label: "Advancers", value: raw.advn, change: null, cluster: "breadth" },
    { symbol: "$DECN", label: "Decliners", value: raw.decn, change: null, cluster: "breadth" },
    { symbol: "$ADD", label: "A/D Line", value: raw.add, change: null, cluster: "breadth" },
    { symbol: "$TICK", label: "NYSE Tick", value: raw.tick, change: null, cluster: "breadth" },
    { symbol: "$TRIN", label: "Arms Index", value: raw.trin, change: null, cluster: "breadth" },
    { symbol: "/ES", label: "E-mini S&P 500", value: raw.es, change: raw.esChange, cluster: "riskAppetite" },
    { symbol: "/NQ", label: "E-mini Nasdaq", value: raw.nq, change: raw.nqChange, cluster: "riskAppetite" },
    { symbol: "/YM", label: "Mini Dow", value: raw.ym, change: raw.ymChange, cluster: "riskAppetite" },
    { symbol: "/RTY", label: "E-mini Russell", value: raw.rty, change: raw.rtyChange, cluster: "riskAppetite" },
    { symbol: "/GC", label: "Gold Futures", value: raw.gc, change: raw.gcChange, cluster: "macro" },
    { symbol: "/CL", label: "WTI Crude", value: raw.cl, change: raw.clChange, cluster: "macro" },
    { symbol: "/BZ", label: "Brent Crude", value: raw.bz, change: raw.bzChange, cluster: "macro" },
    { symbol: "/ZQ", label: "Fed Funds", value: raw.zq, change: raw.zqChange, cluster: "macro" },
  ];
}

function fmtVal(v: number | null): string {
  if (v === null || v === undefined) return "—";
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 10_000) return (v / 1_000).toFixed(1) + "K";
  return v.toFixed(2);
}

function fmtChg(v: number | null): string {
  if (v === null || v === undefined) return "";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function chgColor(v: number | null): string {
  if (v === null || v === undefined) return "#52525b";
  if (v > 0) return "#00d166";
  if (v < 0) return "#f23645";
  return "#71717a";
}

const CLUSTER_ORDER: ClusterKey[] = ["rates", "credit", "volLevel", "volTerm", "breadth", "riskAppetite", "macro"];

export function EngineAuditPanel({ data }: { data: MarketPulseData }) {
  const [open, setOpen] = useState(false);

  const raw = data.rawIndicators;
  const rows = raw ? buildIndicatorRows(raw) : [];

  return (
    <div className="rounded-xl border border-[#2A2A2C] overflow-hidden" style={{ background: "#111113" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#1C1C1E] transition-colors"
      >
        <span className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-[#FFB800]" />
          <span className="font-mono text-[10px] font-light text-[#a1a1aa] uppercase tracking-widest">Engine Audit</span>
          <span className="font-mono text-[9px] text-[#52525b]">{data.engineVersion}</span>
        </span>
        <ChevronDown
          className="w-3.5 h-3.5 text-[#52525b] transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && (
        <div className="border-t border-[#2A2A2C] animate-in fade-in slide-in-from-top-1 duration-200">
          {raw && rows.length > 0 && (
            <div className="px-3 py-3">
              <div className="font-mono text-[9px] text-[#52525b] uppercase tracking-widest mb-2 px-1">Raw Indicator Values</div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[340px]">
                  <thead>
                    <tr className="border-b border-[#2A2A2C]">
                      <th className="font-mono text-[9px] text-[#52525b] uppercase tracking-wider text-left py-1.5 px-1.5">Indicator</th>
                      <th className="font-mono text-[9px] text-[#52525b] uppercase tracking-wider text-right py-1.5 px-1.5">Value</th>
                      <th className="font-mono text-[9px] text-[#52525b] uppercase tracking-wider text-right py-1.5 px-1.5">Change</th>
                      <th className="font-mono text-[9px] text-[#52525b] uppercase tracking-wider text-left py-1.5 px-1.5">Cluster</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.symbol} className="border-b border-[#2A2A2C]/50 hover:bg-[#1C1C1E]/50">
                        <td className="py-1 px-1.5">
                          <span className="font-mono text-[10px] font-light text-[#e4e4e7]">{r.symbol.replace(/^\$/, '')}</span>
                          <span className="font-mono text-[9px] text-[#52525b] ml-1.5 hidden sm:inline">{r.label}</span>
                        </td>
                        <td className="py-1 px-1.5 text-right">
                          <span
                            className="font-mono text-[10px] tabular-nums font-light"
                            style={{ color: r.value !== null ? "#e4e4e7" : "#52525b" }}
                          >
                            {fmtVal(r.value)}
                          </span>
                        </td>
                        <td className="py-1 px-1.5 text-right">
                          <span
                            className="font-mono text-[10px] tabular-nums"
                            style={{ color: chgColor(r.change) }}
                          >
                            {fmtChg(r.change)}
                          </span>
                        </td>
                        <td className="py-1 px-1.5">
                          <span className="font-mono text-[9px] text-[#71717a]">{CLUSTER_LABELS[r.cluster] ?? r.cluster}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="px-3 py-3 border-t border-[#2A2A2C]">
            <div className="font-mono text-[9px] text-[#52525b] uppercase tracking-widest mb-2 px-1">Cluster Scoring Rules</div>
            <div className="space-y-3">
              {CLUSTER_ORDER.map((key) => {
                const cluster = data.clusters[key];
                if (!cluster) return null;
                const rules = cluster.rulesApplied ?? [];
                const points = cluster.keyDataPoints ?? [];
                return (
                  <div key={key} className="rounded-lg border border-[#2A2A2C]/70 p-2.5" style={{ background: "#0c0c0c" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono text-[10px] font-light text-[#e4e4e7] uppercase tracking-wider">
                        {CLUSTER_LABELS[key]}
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className="font-mono text-[10px] tabular-nums font-light"
                          style={{ color: cluster.score > 0 ? "#00d166" : cluster.score < 0 ? "#f23645" : "#71717a" }}
                        >
                          {cluster.score > 0 ? "+" : ""}{cluster.score.toFixed(2)}
                        </span>
                        <span
                          className="font-mono text-[8px] px-1.5 py-0.5 rounded"
                          style={{
                            background: "transparent",
                            border: `1px solid ${cluster.dataQuality === "FRESH" ? "rgba(0,209,102,0.3)" :
                                       cluster.dataQuality === "STALE" ? "rgba(255,184,0,0.3)" : "rgba(113,113,122,0.3)"}`,
                            color: cluster.dataQuality === "FRESH" ? "#00d166" :
                                  cluster.dataQuality === "STALE" ? "#FFB800" : "#71717a",
                          }}
                        >
                          {cluster.dataQuality}
                        </span>
                      </div>
                    </div>
                    {points.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {points.map((pt, i) => (
                          <span key={i} className="font-mono text-[9px] text-[#a1a1aa] bg-[#1C1C1E] rounded px-1.5 py-0.5">{pt}</span>
                        ))}
                      </div>
                    )}
                    {rules.length > 0 && (
                      <div className="space-y-0.5">
                        {rules.map((rule, i) => (
                          <div key={i} className="font-mono text-[9px] text-[#71717a] leading-relaxed flex items-start gap-1">
                            <span className="text-[#FFB800] mt-px shrink-0">›</span>
                            <span>{rule}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="px-3 py-2 border-t border-[#2A2A2C] flex items-center gap-3 flex-wrap">
            <span className="font-mono text-[9px] text-[#52525b]">
              Composite: <span className="text-[#e4e4e7] font-light">{data.compositeScore > 0 ? "+" : ""}{data.compositeScore.toFixed(2)}</span>
            </span>
            <span className="font-mono text-[9px] text-[#52525b]">
              Confidence: <span className="text-[#e4e4e7] font-light">{data.confidenceScore}/{data.maxConfidence}</span>
            </span>
            <span className="font-mono text-[9px] text-[#52525b]">
              Weights: R20 C15 VL15 VT10 B15 RA15 M10
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
