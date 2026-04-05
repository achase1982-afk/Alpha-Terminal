import { useState, useMemo, useCallback, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { useQuote } from "@/hooks/useQuote";
import { Activity, TrendingUp, TrendingDown, Layers, Binary } from "lucide-react";

interface Candle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Props {
  candles?: Candle[];
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—%";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtVol(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function computeATR(candles: Candle[], period = 14): number | null {
  if (!candles || candles.length < period + 1) return null;
  const recent = candles.slice(-period - 1);
  let sum = 0;
  for (let i = 1; i < recent.length; i++) {
    const h = recent[i].high;
    const l = recent[i].low;
    const pc = recent[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / period;
}

function computeVWAP(candles: Candle[]): number | null {
  if (!candles || candles.length === 0) return null;
  let cumVol = 0;
  let cumTP = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    cumTP += tp * c.volume;
    cumVol += c.volume;
  }
  return cumVol > 0 ? cumTP / cumVol : null;
}

function computeTrend(candles: Candle[]): { bias: string; color: string } {
  if (!candles || candles.length < 20) return { bias: "N/A", color: "#71717a" };
  const sma20 = candles.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
  const last = candles[candles.length - 1].close;
  if (last > sma20 * 1.005) return { bias: "Bullish", color: "#00d166" };
  if (last < sma20 * 0.995) return { bias: "Bearish", color: "#f23645" };
  return { bias: "Neutral", color: "#FFB800" };
}

function computeVolumeProfile(candles: Candle[], bins = 20): { price: number; vol: number; poc: number; vah: number; val: number }[] {
  if (!candles || candles.length < 5) return [];
  let minP = Infinity, maxP = -Infinity;
  for (const c of candles) {
    if (c.low < minP) minP = c.low;
    if (c.high > maxP) maxP = c.high;
  }
  const range = maxP - minP;
  if (range <= 0) return [];
  const step = range / bins;
  const buckets = Array.from({ length: bins }, (_, i) => ({
    price: minP + step * (i + 0.5),
    vol: 0,
  }));
  for (const c of candles) {
    const mid = (c.high + c.low) / 2;
    const idx = Math.min(Math.floor((mid - minP) / step), bins - 1);
    if (idx >= 0) buckets[idx].vol += c.volume;
  }
  const maxVol = Math.max(...buckets.map((b) => b.vol), 1);
  let pocIdx = 0;
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i].vol > buckets[pocIdx].vol) pocIdx = i;
  }
  const poc = buckets[pocIdx].price;
  const totalVol = buckets.reduce((s, b) => s + b.vol, 0);
  const target70 = totalVol * 0.7;
  let accum = buckets[pocIdx].vol;
  let lo = pocIdx, hi = pocIdx;
  while (accum < target70 && (lo > 0 || hi < buckets.length - 1)) {
    const loVol = lo > 0 ? buckets[lo - 1].vol : -1;
    const hiVol = hi < buckets.length - 1 ? buckets[hi + 1].vol : -1;
    if (loVol >= hiVol && lo > 0) { lo--; accum += buckets[lo].vol; }
    else if (hi < buckets.length - 1) { hi++; accum += buckets[hi].vol; }
    else break;
  }
  return buckets.map((b) => ({
    ...b,
    vol: b.vol / maxVol,
    poc,
    vah: buckets[hi].price,
    val: buckets[lo].price,
  }));
}

function computeSequentialCount(candles: Candle[]): { count: number; direction: "up" | "down" } {
  if (!candles || candles.length < 5) return { count: 0, direction: "up" };
  let upCount = 0, downCount = 0;
  for (let i = candles.length - 1; i >= 4; i--) {
    if (candles[i].close > candles[i - 4].close) {
      if (downCount > 0) break;
      upCount++;
    } else if (candles[i].close < candles[i - 4].close) {
      if (upCount > 0) break;
      downCount++;
    } else break;
  }
  return upCount >= downCount
    ? { count: upCount, direction: "up" }
    : { count: downCount, direction: "down" };
}

function computeZScore(candles: Candle[], period = 20): { zscore: number; stddev: number } {
  if (!candles || candles.length < period) return { zscore: 0, stddev: 0 };
  const closes = candles.slice(-period).map((c) => c.close);
  const mean = closes.reduce((s, v) => s + v, 0) / period;
  const variance = closes.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const stddev = Math.sqrt(variance);
  const last = candles[candles.length - 1].close;
  return { zscore: stddev > 0 ? (last - mean) / stddev : 0, stddev };
}

function computeCVD(candles: Candle[]): number {
  if (!candles || candles.length < 2) return 0;
  let cvd = 0;
  for (const c of candles.slice(-50)) {
    const delta = c.close >= c.open ? c.volume : -c.volume;
    cvd += delta;
  }
  return cvd;
}

function computeOrderFlowImbalance(candles: Candle[]): number {
  if (!candles || candles.length < 10) return 0;
  const recent = candles.slice(-10);
  let buyVol = 0, sellVol = 0;
  for (const c of recent) {
    if (c.close >= c.open) buyVol += c.volume;
    else sellVol += c.volume;
  }
  const total = buyVol + sellVol;
  return total > 0 ? ((buyVol - sellVol) / total) * 100 : 0;
}

function DataCell({ label, value, color, mono = true }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-mono tracking-wider text-zinc-500">{label}</span>
      <span
        className={`text-[13px] font-semibold ${mono ? "font-mono" : ""}`}
        style={{ color: color || "#e4e4e7" }}
      >
        {value}
      </span>
    </div>
  );
}

const DEEP_TABS = ["Order Flow", "Derivatives", "Quant"] as const;
type DeepTab = typeof DEEP_TABS[number];

export function TechnicalAnalysisPage({ candles }: Props) {
  const symbol = useTerminalStore((s) => s.symbol);
  const { data: quote } = useQuote(symbol);
  const [activeDeepTab, setActiveDeepTab] = useState<DeepTab>("Order Flow");
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const [deepPage, setDeepPage] = useState(0);
  const deepStartX = useRef(0);
  const deepStartY = useRef(0);
  const deepLocked = useRef<"h" | "v" | null>(null);
  const deepSwiping = useRef(false);
  const deepDelta = useRef(0);
  const [deepDragOffset, setDeepDragOffset] = useState(0);

  const vwap = useMemo(() => computeVWAP(candles || []), [candles]);
  const atr = useMemo(() => computeATR(candles || []), [candles]);
  const trend = useMemo(() => computeTrend(candles || []), [candles]);
  const volProfile = useMemo(() => computeVolumeProfile(candles || [], 24), [candles]);
  const sequential = useMemo(() => computeSequentialCount(candles || []), [candles]);
  const zScore = useMemo(() => computeZScore(candles || []), [candles]);
  const cvd = useMemo(() => computeCVD(candles || []), [candles]);
  const ofi = useMemo(() => computeOrderFlowImbalance(candles || []), [candles]);

  const distToVwap = quote?.last && vwap ? ((quote.last - vwap) / vwap) * 100 : null;
  const poc = volProfile.length > 0 ? volProfile[0].poc : null;
  const vah = volProfile.length > 0 ? volProfile[0].vah : null;
  const val = volProfile.length > 0 ? volProfile[0].val : null;

  const handleRunAnalysis = useCallback(() => {
    setAnalysisRunning(true);
    setTimeout(() => setAnalysisRunning(false), 2000);
  }, []);

  const handleDeepTouchStart = useCallback((e: React.TouchEvent) => {
    deepStartX.current = e.touches[0].clientX;
    deepStartY.current = e.touches[0].clientY;
    deepSwiping.current = true;
    deepLocked.current = null;
    deepDelta.current = 0;
    setDeepDragOffset(0);
  }, []);

  const handleDeepTouchMove = useCallback((e: React.TouchEvent) => {
    if (!deepSwiping.current) return;
    const dx = e.touches[0].clientX - deepStartX.current;
    const dy = e.touches[0].clientY - deepStartY.current;
    if (!deepLocked.current) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        deepLocked.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
    }
    if (deepLocked.current === "h") {
      e.preventDefault();
      let clamped = dx;
      if ((deepPage === 0 && dx > 0) || (deepPage === DEEP_TABS.length - 1 && dx < 0)) {
        clamped = dx * 0.3;
      }
      deepDelta.current = clamped;
      setDeepDragOffset(clamped);
    }
  }, [deepPage]);

  const handleDeepTouchEnd = useCallback(() => {
    if (!deepSwiping.current) return;
    deepSwiping.current = false;
    const threshold = 60;
    const d = deepDelta.current;
    if (deepLocked.current === "h") {
      if (d < -threshold && deepPage < DEEP_TABS.length - 1) {
        const next = deepPage + 1;
        setDeepPage(next);
        setActiveDeepTab(DEEP_TABS[next]);
      } else if (d > threshold && deepPage > 0) {
        const next = deepPage - 1;
        setDeepPage(next);
        setActiveDeepTab(DEEP_TABS[next]);
      }
    }
    deepLocked.current = null;
    deepDelta.current = 0;
    setDeepDragOffset(0);
  }, [deepPage]);

  const chartCandles = useMemo(() => (candles || []).slice(-60), [candles]);
  const chartMin = useMemo(() => chartCandles.length > 0 ? Math.min(...chartCandles.map((c) => c.low)) * 0.999 : 0, [chartCandles]);
  const chartMax = useMemo(() => chartCandles.length > 0 ? Math.max(...chartCandles.map((c) => c.high)) * 1.001 : 1, [chartCandles]);
  const chartRange = chartMax - chartMin || 1;
  const maxChartVol = useMemo(() => Math.max(...chartCandles.map((c) => c.volume), 1), [chartCandles]);

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-3 py-3 border-b border-[#2a2a2c]">
        <div className="flex items-baseline gap-3 mb-2">
          <span className="font-mono font-black text-xl tracking-wide text-white">{symbol}</span>
          {quote?.last != null && (
            <span className="font-mono font-bold text-lg text-white">{fmt(quote.last)}</span>
          )}
          {quote?.change != null && (
            <span
              className="font-mono font-semibold text-sm"
              style={{ color: quote.change >= 0 ? "#00d166" : "#f23645" }}
            >
              {quote.change >= 0 ? "+" : ""}{fmt(quote.change)} ({fmtPct(quote.changePct)})
            </span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-3 mb-3">
          <DataCell label="VWAP" value={fmt(vwap)} />
          <DataCell
            label="Dist VWAP"
            value={fmtPct(distToVwap)}
            color={distToVwap != null ? (distToVwap >= 0 ? "#00d166" : "#f23645") : undefined}
          />
          <DataCell label="ATR(14)" value={fmt(atr)} />
          <DataCell label="Trend" value={trend.bias} color={trend.color} mono={false} />
        </div>

        <button
          onClick={handleRunAnalysis}
          disabled={analysisRunning || !candles?.length}
          className="w-full py-2 rounded-lg font-mono text-xs font-bold tracking-wider transition-all"
          style={{
            background: analysisRunning ? "#3a3a3c" : "linear-gradient(135deg, #FFB800, #FF8C00)",
            color: analysisRunning ? "#71717a" : "#000",
            opacity: !candles?.length ? 0.4 : 1,
          }}
        >
          {analysisRunning ? "Analyzing..." : "Run Technical Analysis"}
        </button>
      </div>

      <div className="border-b border-[#2a2a2c] px-1" style={{ height: "30vh", minHeight: 180 }}>
        {chartCandles.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-600 font-mono text-xs">
            Connect Brokerage For Chart Data
          </div>
        ) : (
          <div className="flex h-full">
            <div className="flex-1 overflow-x-auto overflow-y-hidden">
              <svg
                width={Math.max(chartCandles.length * 10, 400)}
                height="100%"
                viewBox={`0 0 ${Math.max(chartCandles.length * 10, 400)} 200`}
                preserveAspectRatio="none"
                className="block"
              >
                {chartCandles.map((c, i) => {
                  const x = i * 10 + 2;
                  const w = 6;
                  const volH = (c.volume / maxChartVol) * 50;
                  const oY = 200 - ((c.open - chartMin) / chartRange) * 160 - 20;
                  const cY = 200 - ((c.close - chartMin) / chartRange) * 160 - 20;
                  const hY = 200 - ((c.high - chartMin) / chartRange) * 160 - 20;
                  const lY = 200 - ((c.low - chartMin) / chartRange) * 160 - 20;
                  const bullish = c.close >= c.open;
                  const color = bullish ? "#00d166" : "#f23645";
                  return (
                    <g key={i}>
                      <rect
                        x={x}
                        y={200 - volH}
                        width={w}
                        height={volH}
                        fill={color}
                        opacity={0.15}
                      />
                      <line x1={x + w / 2} y1={hY} x2={x + w / 2} y2={lY} stroke={color} strokeWidth={1} />
                      <rect
                        x={x}
                        y={Math.min(oY, cY)}
                        width={w}
                        height={Math.max(Math.abs(cY - oY), 1)}
                        fill={bullish ? color : "transparent"}
                        stroke={color}
                        strokeWidth={0.5}
                      />
                    </g>
                  );
                })}
                {vwap != null && (
                  <line
                    x1={0}
                    y1={200 - ((vwap - chartMin) / chartRange) * 160 - 20}
                    x2={Math.max(chartCandles.length * 10, 400)}
                    y2={200 - ((vwap - chartMin) / chartRange) * 160 - 20}
                    stroke="#FFB800"
                    strokeWidth={1}
                    strokeDasharray="4,3"
                    opacity={0.6}
                  />
                )}
              </svg>
            </div>

            {volProfile.length > 0 && (
              <div className="w-16 shrink-0 flex flex-col justify-between py-1 pl-1 border-l border-[#2a2a2c]">
                {volProfile.slice().reverse().map((b, i) => {
                  const isPoc = Math.abs(b.price - b.poc) < 0.01;
                  const isVA = b.price >= b.val && b.price <= b.vah;
                  return (
                    <div key={i} className="flex items-center gap-0.5 h-full">
                      <div
                        className="h-[3px] rounded-sm"
                        style={{
                          width: `${Math.max(b.vol * 100, 4)}%`,
                          background: isPoc ? "#FFB800" : isVA ? "#3b82f6" : "#3a3a3c",
                        }}
                      />
                    </div>
                  );
                })}
                <div className="flex flex-col gap-0.5 mt-1 px-0.5">
                  <span className="text-[7px] font-mono text-[#FFB800]">POC {fmt(poc, 1)}</span>
                  <span className="text-[7px] font-mono text-[#3b82f6]">VAH {fmt(vah, 1)}</span>
                  <span className="text-[7px] font-mono text-[#3b82f6]">VAL {fmt(val, 1)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex border-b border-[#2a2a2c]">
          {DEEP_TABS.map((tab, i) => {
            const icons = [
              <Activity className="w-3.5 h-3.5" key="of" />,
              <Layers className="w-3.5 h-3.5" key="dv" />,
              <Binary className="w-3.5 h-3.5" key="qm" />,
            ];
            return (
              <button
                key={tab}
                onClick={() => { setActiveDeepTab(tab); setDeepPage(i); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 font-mono text-[10px] tracking-wider transition-all border-b-2"
                style={{
                  borderColor: activeDeepTab === tab ? "#FFB800" : "transparent",
                  color: activeDeepTab === tab ? "#FFB800" : "#71717a",
                }}
              >
                {icons[i]}
                {tab}
              </button>
            );
          })}
        </div>

        <div
          className="overflow-hidden"
          onTouchStart={handleDeepTouchStart}
          onTouchMove={handleDeepTouchMove}
          onTouchEnd={handleDeepTouchEnd}
          onTouchCancel={handleDeepTouchEnd}
        >
          <div
            className="flex"
            style={{
              transform: `translateX(calc(${-deepPage * 100}% + ${deepDragOffset}px))`,
              transition: deepSwiping.current ? "none" : "transform 0.3s ease-out",
              willChange: "transform",
            }}
          >
            <div className="w-full shrink-0 p-3">
              <div className="space-y-4">
                <div className="rounded-lg p-3" style={{ background: "#1a1a1c" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-4 h-4 text-[#FFB800]" />
                    <span className="font-mono text-[11px] tracking-wider text-zinc-400">Cumulative Volume Delta</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span
                      className="font-mono font-bold text-2xl"
                      style={{ color: cvd >= 0 ? "#00d166" : "#f23645" }}
                    >
                      {cvd >= 0 ? "+" : ""}{fmtVol(cvd)}
                    </span>
                    {cvd >= 0 ? (
                      <TrendingUp className="w-4 h-4 text-[#00d166]" />
                    ) : (
                      <TrendingDown className="w-4 h-4 text-[#f23645]" />
                    )}
                  </div>
                  <span className="text-[9px] font-mono text-zinc-600">50-bar rolling delta</span>
                </div>

                <div className="rounded-lg p-3" style={{ background: "#1a1a1c" }}>
                  <span className="font-mono text-[11px] tracking-wider text-zinc-400">Large Block Tracker</span>
                  <div className="mt-2 space-y-1.5">
                    {(candles || []).slice(-5).map((c, i) => {
                      const isBuy = c.close >= c.open;
                      return (
                        <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                          <div
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: isBuy ? "#00d166" : "#f23645" }}
                          />
                          <span className="text-zinc-500">{new Date(c.datetime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          <span className="text-zinc-300">{fmtVol(c.volume)} shares</span>
                          <span style={{ color: isBuy ? "#00d166" : "#f23645" }}>
                            @ {fmt(c.close)}
                          </span>
                        </div>
                      );
                    })}
                    {(!candles || candles.length === 0) && (
                      <span className="text-zinc-600 text-[10px]">No data</span>
                    )}
                  </div>
                </div>

                <div className="rounded-lg p-3" style={{ background: "#1a1a1c" }}>
                  <span className="font-mono text-[11px] tracking-wider text-zinc-400">Order Flow Imbalance</span>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-1 h-3 rounded-full overflow-hidden bg-[#2a2a2c]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(Math.max(50 + ofi / 2, 5), 95)}%`,
                          background: ofi >= 0
                            ? `linear-gradient(90deg, #1a1a1c, #00d166)`
                            : `linear-gradient(90deg, #f23645, #1a1a1c)`,
                        }}
                      />
                    </div>
                    <span
                      className="font-mono font-bold text-sm"
                      style={{ color: ofi >= 0 ? "#00d166" : "#f23645" }}
                    >
                      {ofi >= 0 ? "+" : ""}{ofi.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="w-full shrink-0 p-3">
              <div className="space-y-4">
                <div className="rounded-lg p-3" style={{ background: "#1a1a1c" }}>
                  <span className="font-mono text-[11px] tracking-wider text-zinc-400">Net Gamma Exposure (GEX)</span>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="font-mono font-bold text-2xl text-[#FFB800]">—</span>
                    <span className="text-[9px] font-mono text-zinc-600">Requires options chain</span>
                  </div>
                </div>

                <div className="rounded-lg p-3" style={{ background: "#1a1a1c" }}>
                  <span className="font-mono text-[11px] tracking-wider text-zinc-400">Call / Put Walls</span>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-mono text-zinc-600">Nearest Call Wall</span>
                      <span className="font-mono font-semibold text-sm text-[#00d166]">—</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-mono text-zinc-600">Nearest Put Wall</span>
                      <span className="font-mono font-semibold text-sm text-[#f23645]">—</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg p-3" style={{ background: "#1a1a1c" }}>
                  <span className="font-mono text-[11px] tracking-wider text-zinc-400">Dark Pool Prints</span>
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                      <span>Requires dark pool feed</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="w-full shrink-0 p-3">
              <div className="space-y-4">
                <div className="rounded-lg p-3" style={{ background: "#1a1a1c" }}>
                  <span className="font-mono text-[11px] tracking-wider text-zinc-400">Sequential Bar Count</span>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex gap-1">
                      {Array.from({ length: 9 }, (_, i) => (
                        <div
                          key={i}
                          className="w-5 h-5 rounded-sm flex items-center justify-center font-mono text-[9px] font-bold"
                          style={{
                            background: i < sequential.count
                              ? sequential.direction === "up" ? "#00d166" : "#f23645"
                              : "#2a2a2c",
                            color: i < sequential.count ? "#000" : "#71717a",
                          }}
                        >
                          {i + 1}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[9px] font-mono text-zinc-500">
                      Count: {sequential.count} {sequential.direction === "up" ? "Buy" : "Sell"}
                    </span>
                    {sequential.count >= 9 && (
                      <span className="text-[9px] font-mono font-bold text-[#FFB800]">EXHAUSTION</span>
                    )}
                  </div>
                </div>

                <div className="rounded-lg p-3" style={{ background: "#1a1a1c" }}>
                  <span className="font-mono text-[11px] tracking-wider text-zinc-400">Standard Deviation / Z-Score</span>
                  <div className="mt-2 grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[9px] font-mono text-zinc-600">Std Dev (20)</span>
                      <div className="font-mono font-bold text-lg text-white">{fmt(zScore.stddev)}</div>
                    </div>
                    <div>
                      <span className="text-[9px] font-mono text-zinc-600">Z-Score</span>
                      <div
                        className="font-mono font-bold text-lg"
                        style={{
                          color: Math.abs(zScore.zscore) > 2
                            ? "#f23645"
                            : Math.abs(zScore.zscore) > 1
                              ? "#FFB800"
                              : "#00d166",
                        }}
                      >
                        {zScore.zscore >= 0 ? "+" : ""}{zScore.zscore.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="relative h-2 rounded-full bg-[#2a2a2c]">
                      <div
                        className="absolute top-0 h-full rounded-full"
                        style={{
                          left: "16.67%",
                          width: "66.66%",
                          background: "rgba(0,209,102,0.15)",
                        }}
                      />
                      <div
                        className="absolute top-0 w-2 h-2 rounded-full border border-white"
                        style={{
                          left: `${Math.min(Math.max((zScore.zscore + 3) / 6 * 100, 2), 98)}%`,
                          background: Math.abs(zScore.zscore) > 2
                            ? "#f23645"
                            : Math.abs(zScore.zscore) > 1
                              ? "#FFB800"
                              : "#00d166",
                          transform: "translateX(-50%)",
                        }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[7px] font-mono text-zinc-600">-3σ</span>
                      <span className="text-[7px] font-mono text-zinc-600">-1σ</span>
                      <span className="text-[7px] font-mono text-zinc-600">μ</span>
                      <span className="text-[7px] font-mono text-zinc-600">+1σ</span>
                      <span className="text-[7px] font-mono text-zinc-600">+3σ</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center gap-1.5 py-2">
          {DEEP_TABS.map((_, i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full transition-all"
              style={{ background: deepPage === i ? "#FFB800" : "#3a3a3c" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
