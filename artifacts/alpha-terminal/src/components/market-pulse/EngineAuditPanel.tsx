import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { MarketPulseData, RawIndicators, ClusterKey } from "../../types/marketPulse";

type AuditCluster = "rates" | "credit" | "volLevel" | "volTerm" | "breadth" | "riskAppetite" | "macro" | "options" | "currency";

interface IndicatorRow {
  symbol: string;
  label: string;
  value: number | null;
  change: number | null;
  cluster: AuditCluster;
}

const CLUSTER_LABELS: Record<AuditCluster, string> = {
  rates: "RATES",
  credit: "CREDIT",
  volLevel: "VOL LEVEL",
  volTerm: "VOL TERM",
  breadth: "BREADTH",
  riskAppetite: "RISK APP",
  macro: "MACRO",
  options: "OPTIONS",
  currency: "CURRENCY",
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
    { symbol: "$VIX", label: "CBOE VIX", value: raw.vix, change: raw.vixChange, cluster: "volLevel" },
    { symbol: "$VVIX", label: "Vol of Vol", value: raw.vvix, change: raw.vvixChange, cluster: "volLevel" },
    { symbol: "$VIX1D", label: "1-Day VIX", value: raw.vix1d, change: raw.vix1dChange, cluster: "volLevel" },
    { symbol: "$VXN", label: "NDX Vol", value: raw.vxn, change: raw.vxnChange, cluster: "volLevel" },
    { symbol: "$RVX", label: "Russell Vol", value: raw.rvx, change: raw.rvxChange, cluster: "volLevel" },
    { symbol: "$OVX", label: "Oil Vol", value: raw.ovx, change: raw.ovxChange, cluster: "volLevel" },
    { symbol: "$GVZ", label: "Gold Vol", value: raw.gvz, change: raw.gvzChange, cluster: "volLevel" },
    { symbol: "$VIX9D", label: "9-Day VIX", value: raw.vix9d, change: raw.vix9dChange, cluster: "volTerm" },
    { symbol: "$VIX3M", label: "3-Month VIX", value: raw.vix3m, change: raw.vix3mChange, cluster: "volTerm" },
    { symbol: "/VX", label: "VIX Futures", value: raw.vixFut, change: raw.vixFutChange, cluster: "volTerm" },
    { symbol: "$ADVN", label: "NYSE Adv", value: raw.advn, change: null, cluster: "breadth" },
    { symbol: "$DECN", label: "NYSE Dec", value: raw.decn, change: null, cluster: "breadth" },
    { symbol: "$ADD", label: "NYSE A/D", value: raw.add, change: null, cluster: "breadth" },
    { symbol: "$UVOL", label: "NYSE UpVol", value: raw.uvol, change: null, cluster: "breadth" },
    { symbol: "$DVOL", label: "NYSE DnVol", value: raw.dvol, change: null, cluster: "breadth" },
    { symbol: "$TICK", label: "NYSE Tick", value: raw.tick, change: null, cluster: "breadth" },
    { symbol: "$TRIN", label: "Arms Index", value: raw.trin, change: null, cluster: "breadth" },
    { symbol: "$ADVN/Q", label: "NASD Adv", value: raw.advnq, change: null, cluster: "breadth" },
    { symbol: "$DECN/Q", label: "NASD Dec", value: raw.decnq, change: null, cluster: "breadth" },
    { symbol: "$ADD/Q", label: "NASD A/D", value: raw.addq, change: null, cluster: "breadth" },
    { symbol: "$UVOL/Q", label: "NASD UpVol", value: raw.uvolq, change: null, cluster: "breadth" },
    { symbol: "$DVOL/Q", label: "NASD DnVol", value: raw.dvolq, change: null, cluster: "breadth" },
    { symbol: "$TICK/Q", label: "NASD Tick", value: raw.ticki, change: null, cluster: "breadth" },
    { symbol: "$TRIN/Q", label: "NASD TRIN", value: raw.trinq, change: null, cluster: "breadth" },
    { symbol: "/ES", label: "S&P Fut", value: raw.es, change: raw.esChange, cluster: "riskAppetite" },
    { symbol: "/NQ", label: "Nasdaq Fut", value: raw.nq, change: raw.nqChange, cluster: "riskAppetite" },
    { symbol: "/YM", label: "Dow Fut", value: raw.ym, change: raw.ymChange, cluster: "riskAppetite" },
    { symbol: "/RTY", label: "Russell Fut", value: raw.rty, change: raw.rtyChange, cluster: "riskAppetite" },
    { symbol: "SPY", label: "S&P ETF", value: raw.spy, change: raw.spyChange, cluster: "riskAppetite" },
    { symbol: "QQQ", label: "Nasdaq ETF", value: raw.qqq, change: raw.qqqChange, cluster: "riskAppetite" },
    { symbol: "IWM", label: "Russell ETF", value: raw.iwm, change: raw.iwmChange, cluster: "riskAppetite" },
    { symbol: "/GC", label: "Gold", value: raw.gc, change: raw.gcChange, cluster: "macro" },
    { symbol: "/CL", label: "WTI Crude", value: raw.cl, change: raw.clChange, cluster: "macro" },
    { symbol: "/BZ", label: "Brent", value: raw.bz, change: raw.bzChange, cluster: "macro" },
    { symbol: "/HG", label: "Copper", value: raw.hg, change: raw.hgChange, cluster: "macro" },
    { symbol: "DXY", label: "Dollar Idx (Synth)", value: raw.dx, change: raw.dxChange, cluster: "currency" },
    { symbol: "/6E", label: "Euro FX", value: raw.sixE, change: raw.sixEChange, cluster: "currency" },
    { symbol: "/6J", label: "Yen FX", value: raw.sixJ, change: raw.sixJChange, cluster: "currency" },
    { symbol: "$PCUSEQTR", label: "Equity P/C", value: raw.cpce, change: null, cluster: "options" },
    { symbol: "$PCUSINXR", label: "Index P/C", value: raw.cpci, change: null, cluster: "options" },
  ];
}

function fmtVal(v: number | null): string {
  if (v === null || v === undefined) return "—";
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 10_000) return (v / 1_000).toFixed(1) + "K";
  return v.toFixed(2);
}

function fmtChg(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function chgColor(v: number | null): string {
  if (v === null || v === undefined) return "#71717a";
  if (v > 0) return "#00d166";
  if (v < 0) return "#f23645";
  return "#9CA3AF";
}

function scoreColor(s: number): string {
  if (s > 0) return "#00d166";
  if (s < 0) return "#f23645";
  return "#9CA3AF";
}

const CLUSTER_ORDER: ClusterKey[] = ["rates", "credit", "volLevel", "volTerm", "breadth", "riskAppetite", "macro"];
const ALL_CLUSTERS: AuditCluster[] = ["rates", "credit", "volLevel", "volTerm", "breadth", "riskAppetite", "macro", "options", "currency"];

export function EngineAuditPanel({ data }: { data: MarketPulseData }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"indicators" | "rules">("indicators");

  const raw = data.rawIndicators;
  const rows = raw ? buildIndicatorRows(raw) : [];
  const grouped: Record<AuditCluster, IndicatorRow[]> = {} as any;
  for (const c of ALL_CLUSTERS) grouped[c] = [];
  for (const r of rows) grouped[r.cluster].push(r);

  const liveCount = rows.filter(r => r.value !== null).length;

  return (
    <div className="rounded-lg border border-zinc-800/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <ChevronRight
            className="w-4 h-4 text-[#FFB800] transition-transform duration-200"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          />
          <span className="font-mono text-xs font-bold text-[#FFB800] tracking-wider">ENGINE AUDIT</span>
          <span className="font-mono text-xs text-zinc-500">{data.engineVersion}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs text-zinc-400">{liveCount}<span className="text-zinc-500">/{rows.length}</span> LIVE</span>
          <span className="font-mono text-xs text-zinc-400">COMP <span className="font-bold" style={{ color: scoreColor(data.compositeScore) }}>{data.compositeScore > 0 ? "+" : ""}{data.compositeScore.toFixed(4)}</span></span>
          <span className="font-mono text-xs text-zinc-400">CONF <span className="font-bold text-zinc-200">{data.confidenceScore}<span className="text-zinc-500">/{data.maxConfidence}</span></span></span>
        </div>
      </button>

      {open && (
        <>
          <div className="flex border-t border-b border-zinc-800/50">
            {(["indicators", "rules"] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className="flex-1 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-colors"
                style={{
                  color: activeTab === tab ? "#FFB800" : "#71717a",
                  background: activeTab === tab ? "rgba(255,184,0,0.04)" : "transparent",
                  borderBottom: activeTab === tab ? "2px solid #FFB800" : "2px solid transparent",
                }}
              >
                {tab === "indicators" ? `INDICATORS (${rows.length})` : "SCORING RULES"}
              </button>
            ))}
          </div>

          {activeTab === "indicators" && raw && (
            <div>
              {ALL_CLUSTERS.map(cluster => {
                const cr = grouped[cluster];
                if (!cr.length) return null;
                const live = cr.filter(r => r.value !== null).length;
                return (
                  <div key={cluster}>
                    <div className="px-4 py-2 flex items-center gap-2 bg-zinc-900 border-b border-zinc-800/50">
                      <span className="font-mono text-[11px] font-bold text-[#FFB800] tracking-wider">{CLUSTER_LABELS[cluster]}</span>
                      <span className="font-mono text-[11px] text-zinc-500">{live}/{cr.length}</span>
                    </div>
                    <table className="w-full">
                      <tbody>
                        {cr.map(r => (
                          <tr key={r.symbol} className="hover:bg-zinc-800/30 border-b border-zinc-800/30">
                            <td className="pl-4 pr-2 py-1.5 w-[80px]">
                              <span className="font-mono text-[12px] font-bold" style={{ color: r.value !== null ? "#e4e4e7" : "#52525b" }}>
                                {r.symbol.replace(/^\$/, "")}
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <span className="font-mono text-[11px] text-zinc-400">{r.label}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right w-[80px]">
                              <span className="font-mono text-[12px] tabular-nums" style={{ color: r.value !== null ? "#e4e4e7" : "#52525b" }}>
                                {fmtVal(r.value)}
                              </span>
                            </td>
                            <td className="pr-4 pl-2 py-1.5 text-right w-[75px]">
                              <span className="font-mono text-[12px] tabular-nums" style={{ color: chgColor(r.change) }}>
                                {fmtChg(r.change)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === "rules" && (
            <div>
              {CLUSTER_ORDER.map((key) => {
                const cluster = data.clusters[key];
                if (!cluster) return null;
                const rules = cluster.rulesApplied ?? [];
                const points = cluster.keyDataPoints ?? [];
                return (
                  <div key={key} className="border-b border-zinc-800/50">
                    <div className="px-4 py-2 flex items-center justify-between bg-zinc-900">
                      <span className="font-mono text-[11px] font-bold text-[#FFB800] tracking-wider">
                        {CLUSTER_LABELS[key as AuditCluster] ?? key}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs tabular-nums font-bold" style={{ color: scoreColor(cluster.score) }}>
                          {cluster.score > 0 ? "+" : ""}{cluster.score.toFixed(4)}
                        </span>
                        <span className="font-mono text-[11px] font-bold" style={{
                          color: cluster.dataQuality === "FRESH" ? "#00d166" : cluster.dataQuality === "STALE" ? "#FFB800" : "#f23645"
                        }}>
                          {cluster.dataQuality}
                        </span>
                      </div>
                    </div>
                    <div className="px-4 py-2">
                      {points.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {points.map((pt, i) => (
                            <span key={i} className="font-mono text-[11px] text-zinc-300 bg-zinc-800/50 px-2 py-0.5 rounded">{pt}</span>
                          ))}
                        </div>
                      )}
                      {rules.map((rule, i) => (
                        <div key={i} className="font-mono text-[11px] text-zinc-400 leading-relaxed">
                          <span className="text-[#FFB800] mr-1.5">›</span>{rule}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              <div className="px-4 py-3 flex items-center gap-4 flex-wrap bg-zinc-900 border-t border-zinc-800/50">
                <span className="font-mono text-[11px] text-zinc-500">WT R18 C12 VL15 VT12 B18 RA15 M10</span>
                {data.secondaryFlags && data.secondaryFlags.length > 0 && (
                  <span className="font-mono text-[11px] text-[#FFB800]">FLAGS: {data.secondaryFlags.join(", ")}</span>
                )}
              </div>

              {data.riskStateReasoning && data.riskStateReasoning.length > 0 && (
                <div className="px-4 py-2 bg-zinc-900">
                  <span className="font-mono text-[11px] text-zinc-500">RISK: </span>
                  <span className="font-mono text-[11px] text-zinc-400">{data.riskStateReasoning.join(" | ")}</span>
                </div>
              )}

              {data.momentum && (
                <div className="px-4 py-2 flex items-center gap-3 bg-zinc-900 border-t border-zinc-800/50">
                  <span className="font-mono text-[11px] text-zinc-500">MOMENTUM</span>
                  <span className="font-mono text-xs font-bold" style={{
                    color: data.momentum.label === "ACCELERATING" || data.momentum.label === "IMPROVING" ? "#00d166" :
                           data.momentum.label === "FADING" || data.momentum.label === "DETERIORATING" ? "#f23645" : "#9CA3AF"
                  }}>{data.momentum.label}</span>
                  <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                    {data.momentum.delta != null ? `${data.momentum.delta > 0 ? "+" : ""}${data.momentum.delta.toFixed(4)}` : "—"}
                  </span>
                </div>
              )}

              {data.optionsLayer && (
                <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800/50">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-zinc-500">OPTIONS</span>
                    <span className="font-mono text-[11px] font-bold" style={{ color: !data.optionsLayer.avoidShortPremium ? "#00d166" : "#f23645" }}>
                      {data.optionsLayer.avoidShortPremium ? "UNSAFE" : "SAFE"}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-zinc-400 mt-1">
                    {data.optionsLayer.avoidReason ?? data.optionsLayer.tradeTypeRecommendation}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
