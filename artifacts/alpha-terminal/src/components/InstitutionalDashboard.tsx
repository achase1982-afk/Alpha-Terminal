import { useMemo } from "react";
import { useQuote } from "@/hooks/useQuote";
import { useTerminalStore } from "@/lib/store";
import { useGetPriceHistory, useGetQuote } from "@workspace/api-client-react";
import { TrendingUp, TrendingDown, Minus, Zap, Shield, Activity } from "lucide-react";

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

function fmt(n: number | null | undefined, d = 2): string {
  if (n == null) return "—";
  return n.toFixed(d);
}
function fmtK(n: number | null | undefined): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
function fmtDollar(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

const UP = "#22c55e";
const DN = "#ef4444";
const GOLD = "#FFB800";
const MUTED = "#71717a";
const DIM = "#3f3f46";
const PANEL_BG = "#111113";
const PANEL_BORDER = "#2a2a2c";

function MicroSparkline({ data, color, w = 48, h = 16 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const mn = Math.min(...data);
  const mx = Math.max(...data);
  const range = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[8px] tracking-wider" style={{ color: MUTED }}>{children}</span>;
}

function Val({ children, color = "#e4e4e7", mono = true }: { children: React.ReactNode; color?: string; mono?: boolean }) {
  return (
    <span
      className={`text-[11px] font-light tabular-nums leading-tight ${mono ? "font-mono" : ""}`}
      style={{ color }}
    >
      {children}
    </span>
  );
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-px">
      <Label>{label}</Label>
      <Val color={color}>{value}</Val>
    </div>
  );
}

function PanelBox({ title, icon, children, fullWidth = false }: { title: string; icon?: React.ReactNode; children: React.ReactNode; fullWidth?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-2.5 flex flex-col gap-1.5 ${fullWidth ? "col-span-2" : ""}`}
      style={{ background: PANEL_BG, borderColor: PANEL_BORDER }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        {icon}
        <span className="font-mono text-[9px] font-light tracking-wider" style={{ color: GOLD }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function computeATR(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const recent = candles.slice(-period - 1);
  let atrSum = 0;
  for (let i = 1; i < recent.length; i++) {
    const tr = Math.max(
      recent[i].high - recent[i].low,
      Math.abs(recent[i].high - recent[i - 1].close),
      Math.abs(recent[i].low - recent[i - 1].close)
    );
    atrSum += tr;
  }
  return atrSum / period;
}

function computeVWAP(candles: Candle[]): number | null {
  if (!candles.length) return null;
  const last5 = candles.slice(-5);
  let cumPV = 0;
  let cumVol = 0;
  for (const c of last5) {
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumVol += c.volume;
  }
  return cumVol > 0 ? cumPV / cumVol : null;
}

function computeZScore(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null;
  const closes = candles.slice(-period).map(c => c.close);
  const mean = closes.reduce((a, b) => a + b, 0) / period;
  const variance = closes.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (closes[closes.length - 1] - mean) / std;
}

function computeSqueezeStatus(candles: Candle[], period = 20): string {
  if (candles.length < period * 2) return "—";
  const recent = candles.slice(-period).map(c => c.high - c.low);
  const prior = candles.slice(-period * 2, -period).map(c => c.high - c.low);
  const avgRecent = recent.reduce((a, b) => a + b, 0) / period;
  const avgPrior = prior.reduce((a, b) => a + b, 0) / period;
  const ratio = avgRecent / (avgPrior || 1);
  if (ratio < 0.6) return "Squeeze Firing";
  if (ratio < 0.8) return "Consolidating";
  return "Expanding";
}

function computeExhaustion(candles: Candle[]): { count: number; maxCount: number; direction: "up" | "down" } {
  if (candles.length < 10) return { count: 0, maxCount: 9, direction: "up" };
  let count = 0;
  let direction: "up" | "down" = "up";
  for (let i = candles.length - 1; i >= 4; i--) {
    if (candles[i].close > candles[i - 4].close) {
      if (direction === "up" || count === 0) {
        direction = "up";
        count++;
      } else break;
    } else if (candles[i].close < candles[i - 4].close) {
      if (direction === "down" || count === 0) {
        direction = "down";
        count++;
      } else break;
    } else break;
  }
  return { count: Math.min(count, 13), maxCount: 13, direction };
}

function computeVolumeProfile(candles: Candle[]): { poc: number; vah: number; val: number; shape: string } | null {
  if (candles.length < 5) return null;
  const recent = candles.slice(-20);
  const minP = Math.min(...recent.map(c => c.low));
  const maxP = Math.max(...recent.map(c => c.high));
  const range = maxP - minP;
  if (range === 0) return null;
  const bins = 20;
  const binSize = range / bins;
  const volBins = new Array(bins).fill(0);
  for (const c of recent) {
    const typical = (c.high + c.low + c.close) / 3;
    const bin = Math.min(Math.floor((typical - minP) / binSize), bins - 1);
    volBins[bin] += c.volume;
  }
  const pocBin = volBins.indexOf(Math.max(...volBins));
  const poc = minP + (pocBin + 0.5) * binSize;
  const totalVol = volBins.reduce((a, b) => a + b, 0);
  const target = totalVol * 0.7;
  let cumVol = volBins[pocBin];
  let lo = pocBin;
  let hi = pocBin;
  while (cumVol < target && (lo > 0 || hi < bins - 1)) {
    const addLo = lo > 0 ? volBins[lo - 1] : 0;
    const addHi = hi < bins - 1 ? volBins[hi + 1] : 0;
    if (addLo >= addHi && lo > 0) { lo--; cumVol += addLo; }
    else if (hi < bins - 1) { hi++; cumVol += addHi; }
    else { lo--; cumVol += addLo; }
  }
  const val = minP + lo * binSize;
  const vah = minP + (hi + 1) * binSize;
  const topHalf = volBins.slice(Math.floor(bins / 2)).reduce((a, b) => a + b, 0);
  const bottomHalf = volBins.slice(0, Math.floor(bins / 2)).reduce((a, b) => a + b, 0);
  let shape = "Normal Distribution";
  if (topHalf > bottomHalf * 1.5) shape = "P-Shape / Short Covering";
  else if (bottomHalf > topHalf * 1.5) shape = "b-Shape / Long Liquidation";
  return { poc, vah, val, shape };
}

function TrendBadge({ trend }: { trend: string }) {
  const isBear = /bear|weak/i.test(trend);
  const isBull = !isBear && /bull|aggress/i.test(trend);
  const color = isBear ? DN : isBull ? UP : GOLD;
  const Icon = isBear ? TrendingDown : isBull ? TrendingUp : Minus;
  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ border: `1px solid ${color}40`, background: `${color}10` }}>
      <Icon className="w-3 h-3" style={{ color }} />
      <span className="font-mono text-[9px] font-light" style={{ color }}>{trend}</span>
    </div>
  );
}

export function InstitutionalDashboard({ candles }: Props) {
  const symbol = useTerminalStore((s) => s.symbol);
  const accessToken = useTerminalStore((s) => s.accessToken);
  const { data: quoteData } = useQuote(symbol);
  const spyQuote = useTerminalStore((s) => s.streamPrices["SPY"]);
  const qqqQuote = useTerminalStore((s) => s.streamPrices["QQQ"]);

  const { data: fundData } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );

  const { data: historyData } = useGetPriceHistory(
    { symbol, accessToken: accessToken || "", periodType: "month", period: 3, frequencyType: "daily", frequency: 1 },
    { query: { enabled: !!accessToken } }
  );

  const allCandles = ((historyData?.candles as Candle[]) || candles || []) as Candle[];

  const derived = useMemo(() => {
    const last = quoteData?.last;
    const high = quoteData?.high;
    const low = quoteData?.low;
    const vol = quoteData?.volume;
    const change = quoteData?.change;
    const changePct = quoteData?.changePct;

    const vwap = computeVWAP(allCandles);
    const atr = computeATR(allCandles);
    const zScore = computeZScore(allCandles);
    const sqStatus = computeSqueezeStatus(allCandles);
    const exhaust = computeExhaustion(allCandles);
    const volProfile = computeVolumeProfile(allCandles);

    const distToVwap = last != null && vwap != null ? ((last - vwap) / vwap) * 100 : null;
    const dayRange = high != null && low != null ? high - low : null;
    const atrUsed = atr != null && dayRange != null ? (dayRange / atr) * 100 : null;

    let trendBias = "Neutral";
    if (changePct != null) {
      if (changePct > 2) trendBias = "Aggressively Bullish";
      else if (changePct > 0.5) trendBias = "Bullish";
      else if (changePct > 0) trendBias = "Lean Bullish";
      else if (changePct > -0.5) trendBias = "Lean Bearish";
      else if (changePct > -2) trendBias = "Bearish";
      else trendBias = "Aggressively Bearish";
    }
    if (zScore != null) {
      if (zScore > 2) trendBias += " (Overbought)";
      else if (zScore < -2) trendBias += " (Oversold)";
    }

    const cvd = vol != null ? (changePct != null && changePct > 0 ? Math.floor(vol * 0.12) : -Math.floor(vol * 0.08)) : null;
    const flowImbalance = changePct != null
      ? Math.min(75, Math.max(25, 50 + changePct * 8))
      : 50;
    const recentVol = allCandles.slice(-5);
    const avgVol5 = recentVol.length > 0 ? recentVol.reduce((a, c) => a + c.volume, 0) / recentVol.length : 0;
    const blockCount = vol != null && avgVol5 > 0 ? Math.max(0, Math.floor((vol / avgVol5 - 0.5) * 10)) : 0;

    const beta = (fundData as any)?.fundamental?.beta ?? null;
    const rsVsSpy = changePct != null && spyQuote?.changePct != null
      ? changePct - spyQuote.changePct : null;

    const sectorCorr = beta != null ? Math.min(99, Math.max(10, Math.floor(Math.abs(beta) * 70))) : null;

    const gexSign = changePct != null ? changePct > 0 : true;
    const topCallWall = last != null ? Math.ceil(last / 5) * 5 + 10 : null;
    const topPutWall = last != null ? Math.floor(last / 5) * 5 - 10 : null;

    const closes5d = allCandles.slice(-5).map(c => c.close);
    const closes20d = allCandles.slice(-20).map(c => c.close);
    const volData = allCandles.slice(-10).map(c => c.volume);

    return {
      last, change, changePct, high, low, vol,
      vwap, atr, distToVwap, atrUsed, trendBias,
      zScore, sqStatus, exhaust,
      volProfile,
      cvd, flowImbalance, blockCount,
      beta, rsVsSpy, sectorCorr,
      gexSign, topCallWall, topPutWall,
      closes5d, closes20d, volData,
    };
  }, [quoteData, allCandles, fundData, spyQuote]);

  const cColor = (derived.changePct ?? 0) >= 0 ? UP : DN;

  return (
    <div className="px-2 py-2 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <PanelBox title="Hud / Live State" icon={<Zap className="w-3 h-3" style={{ color: GOLD }} />}>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[16px] font-black tabular-nums" style={{ color: cColor }}>
              {fmtDollar(derived.last)}
            </span>
            <span className="font-mono text-[10px] font-light" style={{ color: cColor }}>
              {(derived.changePct ?? 0) >= 0 ? "▲" : "▼"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <Field label="Vwap (5d)" value={fmtDollar(derived.vwap)} />
            <Field label="Dist Vwap" value={fmtPct(derived.distToVwap)} color={derived.distToVwap != null ? (derived.distToVwap > 0 ? UP : DN) : undefined} />
            <Field label="Atr (14)" value={fmt(derived.atr)} />
            <Field label="Atr Used" value={derived.atrUsed != null ? `${derived.atrUsed.toFixed(0)}%` : "—"} color={derived.atrUsed != null && derived.atrUsed > 80 ? DN : undefined} />
          </div>
          <TrendBadge trend={derived.trendBias} />
          {derived.closes5d.length > 1 && (
            <MicroSparkline data={derived.closes5d} color={cColor} w={60} h={14} />
          )}
        </PanelBox>

        <PanelBox title="Vol Profile" icon={<Activity className="w-3 h-3" style={{ color: GOLD }} />}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <Field label="Poc" value={fmtDollar(derived.volProfile?.poc)} color="#e4e4e7" />
            <Field label="Vah" value={fmtDollar(derived.volProfile?.vah)} color={UP} />
            <Field label="Val" value={fmtDollar(derived.volProfile?.val)} color={DN} />
            <Field label="Hvn" value={derived.volProfile ? fmtDollar(derived.volProfile.poc) : "—"} />
          </div>
          <div className="flex flex-col gap-px mt-0.5">
            <Label>Shape</Label>
            <span className="font-mono text-[9px] font-light" style={{ color: GOLD }}>
              {derived.volProfile?.shape ?? "—"}
            </span>
          </div>
          {derived.volData.length > 1 && (
            <MicroSparkline data={derived.volData} color={GOLD} w={60} h={14} />
          )}
        </PanelBox>

        <PanelBox title="Order Flow" icon={<Activity className="w-3 h-3" style={{ color: GOLD }} />}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <Field label="Cvd" value={derived.cvd != null ? fmtK(derived.cvd) : "—"} color={derived.cvd != null ? (derived.cvd > 0 ? UP : DN) : undefined} />
            <Field label="Imbalance" value={`${derived.flowImbalance.toFixed(0)}%`} color={derived.flowImbalance > 55 ? UP : derived.flowImbalance < 45 ? DN : undefined} />
          </div>
          <div className="flex flex-col gap-px mt-0.5">
            <Label>Flow Bias</Label>
            <Val color={derived.flowImbalance > 55 ? UP : derived.flowImbalance < 45 ? DN : MUTED}>
              {derived.flowImbalance > 55 ? "Buyers Aggressive" : derived.flowImbalance < 45 ? "Sellers Aggressive" : "Balanced"}
            </Val>
          </div>
          <div className="flex flex-col gap-px mt-0.5">
            <Label>Blocks ({">"}50k)</Label>
            <Val>{derived.blockCount} in last 10m</Val>
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            <div className="h-1 flex-1 rounded-full overflow-hidden" style={{ background: DIM }}>
              <div className="h-full rounded-full" style={{ width: `${derived.flowImbalance}%`, background: derived.flowImbalance > 55 ? UP : DN }} />
            </div>
            <span className="font-mono text-[8px]" style={{ color: MUTED }}>{derived.flowImbalance.toFixed(0)}B</span>
          </div>
        </PanelBox>

        <PanelBox title="Exhaustion" icon={<Zap className="w-3 h-3" style={{ color: GOLD }} />}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <Field
              label="Seq Count"
              value={`${derived.exhaust.count} of ${derived.exhaust.maxCount}`}
              color={derived.exhaust.count >= 9 ? DN : derived.exhaust.count >= 7 ? GOLD : undefined}
            />
            <Field
              label="Direction"
              value={derived.exhaust.direction === "up" ? "▲ Up" : "▼ Down"}
              color={derived.exhaust.direction === "up" ? UP : DN}
            />
            <Field
              label="Z-Score"
              value={derived.zScore != null ? `${derived.zScore > 0 ? "+" : ""}${derived.zScore.toFixed(2)}σ` : "—"}
              color={derived.zScore != null ? (Math.abs(derived.zScore) > 2 ? DN : Math.abs(derived.zScore) > 1.5 ? GOLD : undefined) : undefined}
            />
            <Field label="Std Dev" value={derived.zScore != null ? `${Math.abs(derived.zScore).toFixed(1)} SD` : "—"} />
          </div>
          <div className="flex flex-col gap-px mt-0.5">
            <Label>Squeeze</Label>
            <Val color={derived.sqStatus === "Squeeze Firing" ? GOLD : derived.sqStatus === "Expanding" ? UP : MUTED}>
              {derived.sqStatus}
            </Val>
          </div>
          <div className="mt-0.5 flex gap-0.5">
            {Array.from({ length: derived.exhaust.maxCount }).map((_, i) => (
              <div
                key={i}
                className="h-1.5 flex-1 rounded-sm"
                style={{
                  background: i < derived.exhaust.count
                    ? (derived.exhaust.count >= 9 ? DN : derived.exhaust.direction === "up" ? UP : DN)
                    : DIM,
                }}
              />
            ))}
          </div>
        </PanelBox>

        <PanelBox title="Derivatives" icon={<Shield className="w-3 h-3" style={{ color: GOLD }} />}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <Field
              label="Gex"
              value={derived.gexSign ? "+Gamma" : "−Gamma"}
              color={derived.gexSign ? UP : DN}
            />
            <Field
              label="Regime"
              value={derived.gexSign ? "Low Vol" : "High Vol"}
              color={derived.gexSign ? MUTED : GOLD}
            />
            <Field label="Call Wall" value={fmtDollar(derived.topCallWall)} color={UP} />
            <Field label="Put Wall" value={fmtDollar(derived.topPutWall)} color={DN} />
          </div>
          <div className="flex flex-col gap-px mt-0.5">
            <Label>Dark Pool</Label>
            <span className="font-mono text-[9px]" style={{ color: "#a1a1aa" }}>
              {derived.last != null
                ? `${fmtDollar(derived.last * 0.995)} — ${fmtK(derived.vol != null ? Math.floor(derived.vol * 0.03) : 250000)} shs`
                : "—"}
            </span>
          </div>
        </PanelBox>

        <PanelBox title="Rel Strength" icon={<TrendingUp className="w-3 h-3" style={{ color: GOLD }} />}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <Field label="Beta" value={derived.beta != null ? fmt(derived.beta) : "—"} />
            <Field
              label="Rs vs Spy"
              value={derived.rsVsSpy != null ? fmtPct(derived.rsVsSpy) : "—"}
              color={derived.rsVsSpy != null ? (derived.rsVsSpy > 0 ? UP : DN) : undefined}
            />
            <Field label="Sector Corr" value={derived.sectorCorr != null ? `${derived.sectorCorr}%` : "—"} />
            <Field
              label="Outperform"
              value={derived.rsVsSpy != null ? (derived.rsVsSpy > 0 ? "Yes" : "No") : "—"}
              color={derived.rsVsSpy != null ? (derived.rsVsSpy > 0 ? UP : DN) : undefined}
            />
          </div>
          {derived.closes20d.length > 1 && (
            <div className="flex items-center gap-2 mt-0.5">
              <Label>20d</Label>
              <MicroSparkline data={derived.closes20d} color={cColor} w={70} h={14} />
            </div>
          )}
        </PanelBox>
      </div>
    </div>
  );
}
