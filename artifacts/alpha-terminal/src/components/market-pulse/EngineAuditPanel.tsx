import { useState } from "react";
import { ChevronDown, Database } from "lucide-react";
import type { MarketPulseData, RawIndicators, ClusterKey } from "../../types/marketPulse";

type AuditCluster = "volLevel" | "volTerm" | "rates" | "credit" | "breadth" | "riskAppetite" | "macro" | "options" | "currency";

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
  options: "Options",
  currency: "Currency",
};

const CLUSTER_COLORS: Record<AuditCluster, string> = {
  rates: "#60a5fa",
  credit: "#a78bfa",
  volLevel: "#f87171",
  volTerm: "#fb923c",
  breadth: "#34d399",
  riskAppetite: "#fbbf24",
  macro: "#38bdf8",
  options: "#e879f9",
  currency: "#2dd4bf",
};

function buildIndicatorRows(raw: RawIndicators): IndicatorRow[] {
  return [
    { symbol: "$TNX", label: "10Y Yield", value: raw.tnx, change: raw.tnxChange, cluster: "rates" },
    { symbol: "$TYX", label: "30Y Yield", value: raw.tyx, change: raw.tyxChange, cluster: "rates" },
    { symbol: "$IRX", label: "13-Wk T-Bill", value: raw.irx, change: raw.irxChange, cluster: "rates" },
    { symbol: "/ZB", label: "30Y Bond Fut", value: raw.zb, change: raw.zbChange, cluster: "rates" },
    { symbol: "/ZT", label: "2Y Note Fut", value: raw.zt, change: raw.ztChange, cluster: "rates" },
    { symbol: "/ZF", label: "5Y Note Fut", value: raw.zf, change: raw.zfChange, cluster: "rates" },
    { symbol: "/ZN", label: "10Y Note Fut", value: raw.zn, change: raw.znChange, cluster: "rates" },
    { symbol: "/ZQ", label: "Fed Funds", value: raw.zq, change: raw.zqChange, cluster: "rates" },
    { symbol: "TLT", label: "20+ Tsy ETF", value: raw.tlt, change: raw.tltChange, cluster: "rates" },

    { symbol: "HYG", label: "High Yield", value: raw.hyg, change: raw.hygChange, cluster: "credit" },
    { symbol: "LQD", label: "Inv Grade", value: raw.lqd, change: raw.lqdChange, cluster: "credit" },
    { symbol: "IEF", label: "7-10Y Tsy", value: raw.ief, change: raw.iefChange, cluster: "credit" },

    { symbol: "$VIX", label: "30-Day IV", value: raw.vix, change: raw.vixChange, cluster: "volLevel" },
    { symbol: "$VVIX", label: "Vol of Vol", value: raw.vvix, change: raw.vvixChange, cluster: "volLevel" },
    { symbol: "$VIX1D", label: "1-Day IV", value: raw.vix1d, change: raw.vix1dChange, cluster: "volLevel" },
    { symbol: "$VXN", label: "NDX Vol", value: raw.vxn, change: raw.vxnChange, cluster: "volLevel" },
    { symbol: "$RVX", label: "Russell Vol", value: raw.rvx, change: raw.rvxChange, cluster: "volLevel" },
    { symbol: "$OVX", label: "Oil Vol", value: raw.ovx, change: raw.ovxChange, cluster: "volLevel" },
    { symbol: "$GVZ", label: "Gold Vol", value: raw.gvz, change: raw.gvzChange, cluster: "volLevel" },
    { symbol: "$TYVIX", label: "Tsy Vol", value: raw.tyvix, change: raw.tyvixChange, cluster: "volLevel" },

    { symbol: "$VIX9D", label: "9-Day IV", value: raw.vix9d, change: raw.vix9dChange, cluster: "volTerm" },
    { symbol: "$VIX3M", label: "3-Month IV", value: raw.vix3m, change: raw.vix3mChange, cluster: "volTerm" },
    { symbol: "$SKEW", label: "Tail Risk", value: raw.skew, change: null, cluster: "volTerm" },
    { symbol: "MOVE", label: "MOVE Index", value: raw.move, change: null, cluster: "volTerm" },
    { symbol: "/VX", label: "VIX Futures", value: raw.vixFut, change: raw.vixFutChange, cluster: "volTerm" },

    { symbol: "$ADVN", label: "NYSE Adv", value: raw.advn, change: null, cluster: "breadth" },
    { symbol: "$DECN", label: "NYSE Dec", value: raw.decn, change: null, cluster: "breadth" },
    { symbol: "$ADD", label: "NYSE A/D", value: raw.add, change: null, cluster: "breadth" },
    { symbol: "$UVOL", label: "NYSE Up Vol", value: raw.uvol, change: null, cluster: "breadth" },
    { symbol: "$DVOL", label: "NYSE Dn Vol", value: raw.dvol, change: null, cluster: "breadth" },
    { symbol: "$TICK", label: "NYSE Tick", value: raw.tick, change: null, cluster: "breadth" },
    { symbol: "$TRIN", label: "Arms Index", value: raw.trin, change: null, cluster: "breadth" },
    { symbol: "$ADVN/Q", label: "NASD Adv", value: raw.advnq, change: null, cluster: "breadth" },
    { symbol: "$DECN/Q", label: "NASD Dec", value: raw.decnq, change: null, cluster: "breadth" },
    { symbol: "$ADD/Q", label: "NASD A/D", value: raw.addq, change: null, cluster: "breadth" },
    { symbol: "$UVOL/Q", label: "NASD Up Vol", value: raw.uvolq, change: null, cluster: "breadth" },
    { symbol: "$DVOL/Q", label: "NASD Dn Vol", value: raw.dvolq, change: null, cluster: "breadth" },
    { symbol: "$TICK/Q", label: "NASD Tick", value: raw.ticki, change: null, cluster: "breadth" },
    { symbol: "$TRIN/Q", label: "NASD TRIN", value: raw.trinq, change: null, cluster: "breadth" },

    { symbol: "/ES", label: "S&P 500 Fut", value: raw.es, change: raw.esChange, cluster: "riskAppetite" },
    { symbol: "/NQ", label: "Nasdaq Fut", value: raw.nq, change: raw.nqChange, cluster: "riskAppetite" },
    { symbol: "/YM", label: "Dow Fut", value: raw.ym, change: raw.ymChange, cluster: "riskAppetite" },
    { symbol: "/RTY", label: "Russell Fut", value: raw.rty, change: raw.rtyChange, cluster: "riskAppetite" },
    { symbol: "SPY", label: "S&P 500 ETF", value: raw.spy, change: raw.spyChange, cluster: "riskAppetite" },
    { symbol: "QQQ", label: "Nasdaq ETF", value: raw.qqq, change: raw.qqqChange, cluster: "riskAppetite" },
    { symbol: "IWM", label: "Russell ETF", value: raw.iwm, change: raw.iwmChange, cluster: "riskAppetite" },

    { symbol: "/GC", label: "Gold Fut", value: raw.gc, change: raw.gcChange, cluster: "macro" },
    { symbol: "/CL", label: "WTI Crude", value: raw.cl, change: raw.clChange, cluster: "macro" },
    { symbol: "/BZ", label: "Brent Crude", value: raw.bz, change: raw.bzChange, cluster: "macro" },
    { symbol: "/HG", label: "Copper Fut", value: raw.hg, change: raw.hgChange, cluster: "macro" },

    { symbol: "/DX", label: "Dollar Index", value: raw.dx, change: raw.dxChange, cluster: "currency" },
    { symbol: "/6E", label: "Euro FX", value: raw.sixE, change: raw.sixEChange, cluster: "currency" },
    { symbol: "/6J", label: "Yen FX", value: raw.sixJ, change: raw.sixJChange, cluster: "currency" },

    { symbol: "$CPC", label: "CBOE P/C", value: raw.cpc, change: null, cluster: "options" },
    { symbol: "$CPCE", label: "Equity P/C", value: raw.cpce, change: null, cluster: "options" },
    { symbol: "$CPCI", label: "Index P/C", value: raw.cpci, change: null, cluster: "options" },
    { symbol: "$PCSPY", label: "SPY P/C", value: raw.pcspy, change: null, cluster: "options" },
    { symbol: "$PCQQQ", label: "QQQ P/C", value: raw.pcqqq, change: null, cluster: "options" },
    { symbol: "$PCIWM", label: "IWM P/C", value: raw.pciwm, change: null, cluster: "options" },
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

function qualityDot(q: string): string {
  if (q === "FRESH") return "#00d166";
  if (q === "STALE") return "#FFB800";
  return "#f23645";
}

const CLUSTER_ORDER: ClusterKey[] = ["rates", "credit", "volLevel", "volTerm", "breadth", "riskAppetite", "macro"];
const ALL_AUDIT_CLUSTERS: AuditCluster[] = ["rates", "credit", "volLevel", "volTerm", "breadth", "riskAppetite", "macro", "options", "currency"];

export function EngineAuditPanel({ data }: { data: MarketPulseData }) {
  const [expandedSection, setExpandedSection] = useState<"indicators" | "rules" | null>("indicators");

  const raw = data.rawIndicators;
  const rows = raw ? buildIndicatorRows(raw) : [];

  const groupedRows: Record<AuditCluster, IndicatorRow[]> = {} as any;
  for (const c of ALL_AUDIT_CLUSTERS) groupedRows[c] = [];
  for (const r of rows) groupedRows[r.cluster].push(r);

  const liveCount = rows.filter(r => r.value !== null).length;
  const totalCount = rows.length;

  return (
    <div className="border border-[#2A2A2C] overflow-hidden" style={{ background: "#0a0a0a" }}>
      <div className="px-3 py-2 flex items-center justify-between border-b border-[#2A2A2C]" style={{ background: "#0c0c0e" }}>
        <div className="flex items-center gap-2">
          <Database className="w-3 h-3 text-[#FFB800]" />
          <span className="font-mono text-[10px] font-bold text-[#FFB800] uppercase tracking-widest">Engine Audit</span>
          <span className="font-mono text-[9px] text-[#52525b]">{data.engineVersion}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[9px] text-[#52525b]">
            {liveCount}/{totalCount} live
          </span>
          <span className="font-mono text-[9px] text-[#52525b]">
            Composite <span className="text-[#e4e4e7] font-bold">{data.compositeScore > 0 ? "+" : ""}{data.compositeScore.toFixed(4)}</span>
          </span>
          <span className="font-mono text-[9px] text-[#52525b]">
            Conf <span className="text-[#e4e4e7] font-bold">{data.confidenceScore}/{data.maxConfidence}</span>
          </span>
        </div>
      </div>

      <div className="flex border-b border-[#2A2A2C]">
        <button
          type="button"
          onClick={() => setExpandedSection(expandedSection === "indicators" ? null : "indicators")}
          className="flex-1 px-3 py-1.5 flex items-center justify-center gap-1.5 hover:bg-[#1C1C1E] transition-colors"
          style={{ background: expandedSection === "indicators" ? "#111113" : "transparent" }}
        >
          <span className="font-mono text-[9px] font-bold uppercase tracking-widest" style={{ color: expandedSection === "indicators" ? "#FFB800" : "#71717a" }}>
            Indicators ({totalCount})
          </span>
          <ChevronDown className="w-2.5 h-2.5" style={{ color: expandedSection === "indicators" ? "#FFB800" : "#52525b", transform: expandedSection === "indicators" ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
        </button>
        <div className="w-px bg-[#2A2A2C]" />
        <button
          type="button"
          onClick={() => setExpandedSection(expandedSection === "rules" ? null : "rules")}
          className="flex-1 px-3 py-1.5 flex items-center justify-center gap-1.5 hover:bg-[#1C1C1E] transition-colors"
          style={{ background: expandedSection === "rules" ? "#111113" : "transparent" }}
        >
          <span className="font-mono text-[9px] font-bold uppercase tracking-widest" style={{ color: expandedSection === "rules" ? "#FFB800" : "#71717a" }}>
            Scoring Rules
          </span>
          <ChevronDown className="w-2.5 h-2.5" style={{ color: expandedSection === "rules" ? "#FFB800" : "#52525b", transform: expandedSection === "rules" ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
        </button>
      </div>

      {expandedSection === "indicators" && raw && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
          {ALL_AUDIT_CLUSTERS.map(cluster => {
            const clusterRows = groupedRows[cluster];
            if (clusterRows.length === 0) return null;
            const live = clusterRows.filter(r => r.value !== null).length;
            return (
              <div key={cluster} className="border-b border-[#2A2A2C]/60 last:border-b-0">
                <div className="px-3 py-1 flex items-center gap-2" style={{ background: "#0c0c0e" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: CLUSTER_COLORS[cluster] }} />
                  <span className="font-mono text-[9px] font-bold uppercase tracking-widest" style={{ color: CLUSTER_COLORS[cluster] }}>
                    {CLUSTER_LABELS[cluster]}
                  </span>
                  <span className="font-mono text-[8px] text-[#52525b]">{live}/{clusterRows.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  {clusterRows.map(r => (
                    <div key={r.symbol} className="flex items-center px-3 py-[3px] border-b border-[#2A2A2C]/20 hover:bg-[#111113]/80">
                      <span className="w-[60px] shrink-0 font-mono text-[10px] font-bold" style={{ color: r.value !== null ? "#d4d4d8" : "#3f3f46" }}>
                        {r.symbol.replace(/^\$/, '')}
                      </span>
                      <span className="flex-1 font-mono text-[9px] text-[#52525b] truncate">{r.label}</span>
                      <span className="w-[65px] text-right font-mono text-[10px] tabular-nums font-medium" style={{ color: r.value !== null ? "#e4e4e7" : "#3f3f46" }}>
                        {fmtVal(r.value)}
                      </span>
                      <span className="w-[60px] text-right font-mono text-[10px] tabular-nums" style={{ color: chgColor(r.change) }}>
                        {fmtChg(r.change)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {expandedSection === "rules" && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
          {CLUSTER_ORDER.map((key) => {
            const cluster = data.clusters[key];
            if (!cluster) return null;
            const rules = cluster.rulesApplied ?? [];
            const points = cluster.keyDataPoints ?? [];
            return (
              <div key={key} className="border-b border-[#2A2A2C]/60 last:border-b-0">
                <div className="px-3 py-1.5 flex items-center justify-between" style={{ background: "#0c0c0e" }}>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: CLUSTER_COLORS[key as AuditCluster] ?? "#71717a" }} />
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider" style={{ color: CLUSTER_COLORS[key as AuditCluster] ?? "#71717a" }}>
                      {CLUSTER_LABELS[key as AuditCluster] ?? key}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] tabular-nums font-bold"
                      style={{ color: cluster.score > 0 ? "#00d166" : cluster.score < 0 ? "#f23645" : "#71717a" }}
                    >
                      {cluster.score > 0 ? "+" : ""}{cluster.score.toFixed(4)}
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: qualityDot(cluster.dataQuality) }} />
                    <span className="font-mono text-[8px]" style={{ color: qualityDot(cluster.dataQuality) }}>
                      {cluster.dataQuality}
                    </span>
                  </div>
                </div>
                <div className="px-3 py-1.5 space-y-1">
                  {points.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {points.map((pt, i) => (
                        <span key={i} className="font-mono text-[9px] text-[#a1a1aa] bg-[#1C1C1E] px-1.5 py-0.5">{pt}</span>
                      ))}
                    </div>
                  )}
                  {rules.map((rule, i) => (
                    <div key={i} className="font-mono text-[9px] text-[#71717a] leading-relaxed flex items-start gap-1">
                      <span className="text-[#FFB800] mt-px shrink-0">›</span>
                      <span>{rule}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="px-3 py-2 flex items-center gap-4 flex-wrap" style={{ background: "#0c0c0e" }}>
            <span className="font-mono text-[9px] text-[#52525b]">
              Weights: <span className="text-[#71717a]">R18 C12 VL15 VT12 B18 RA15 M10</span>
            </span>
            {data.secondaryFlags && data.secondaryFlags.length > 0 && (
              <span className="font-mono text-[9px] text-[#FFB800]">
                Flags: {data.secondaryFlags.join(", ")}
              </span>
            )}
            {data.riskStateReasoning && data.riskStateReasoning.length > 0 && (
              <span className="font-mono text-[9px] text-[#71717a]">
                Risk: {data.riskStateReasoning.join(" | ")}
              </span>
            )}
          </div>

          {data.momentum && (
            <div className="px-3 py-1.5 border-t border-[#2A2A2C]/40 flex items-center gap-3" style={{ background: "#0c0c0e" }}>
              <span className="font-mono text-[9px] text-[#52525b] uppercase tracking-wider">Momentum</span>
              <span className="font-mono text-[10px] font-bold" style={{
                color: data.momentum.label === "ACCELERATING" ? "#00d166" :
                       data.momentum.label === "DECELERATING" ? "#f23645" :
                       data.momentum.label === "REVERSING" ? "#f87171" : "#71717a"
              }}>
                {data.momentum.label}
              </span>
              <span className="font-mono text-[9px] tabular-nums text-[#52525b]">
                Δ {data.momentum.delta > 0 ? "+" : ""}{data.momentum.delta.toFixed(4)}
              </span>
              <span className="font-mono text-[9px] text-[#52525b]">
                {data.momentum.entries} entries
              </span>
            </div>
          )}

          {data.optionsLayer && (
            <div className="px-3 py-1.5 border-t border-[#2A2A2C]/40" style={{ background: "#0c0c0e" }}>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[9px] text-[#52525b] uppercase tracking-wider">Options Layer</span>
                <span className="font-mono text-[9px] font-bold" style={{
                  color: data.optionsLayer.isSafe ? "#00d166" : "#f23645"
                }}>
                  {data.optionsLayer.isSafe ? "SAFE" : "UNSAFE"}
                </span>
              </div>
              <p className="font-mono text-[9px] text-[#71717a]">{data.optionsLayer.guidance}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
