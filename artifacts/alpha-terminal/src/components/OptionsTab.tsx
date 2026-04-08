import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { useTerminalStore } from "@/lib/store";
import { ConnectBrokerPrompt } from "./ConnectBrokerPrompt";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useOptionsColumnsStore, COLUMN_REGISTRY, type ColumnDef } from "@/lib/options-columns-store";
import { useOptionTick } from "@/lib/options-stream-store";
import { useUICustomizationStore, ACCENT_COLORS } from "@/lib/ui-customization-store";

import { useGetQuote, useGetOptionChain } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table2, ChevronDown, ChevronRight, X, Settings, GripVertical,
  Layers, TrendingUp, Plus, BarChart3,
} from "lucide-react";
import { Reorder } from "framer-motion";

const EPS = 0.0001;
const COL_W = 74;
const STRIKE_W = 44;
const ROW_H = 40;
const TOOLBAR_H = 32;
const HEADER_H = 32;
const SUB_HEADER_H = 20;

const BG = "#000000";
const BG_HEADER = "#060606";
const BG_EXP_BAR = "#070707";
const BORDER = "#1a1a1a";
const BORDER_ROW = "#0c0c0c";
const GOLD = "#fbbf24";
const GOLD_DIM = "#b8941c";
const UP = "#00d166";
const DOWN = "#f23645";
const WHITE = "#f0f0f0";
const GRAY = "#a1a1aa";
const DIM = "#52525b";
const MUTED = "#3f3f46";

const ITM_OCEAN = "rgba(180,140,50,0.22)";
const OTM_PURPLE = "rgba(168,130,255,0.04)";
const SEL_BORDER_COLOR = "#fbbf2480";

const MONO = "'SFMono-Regular', 'SF Mono', ui-monospace, 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace";
const FW_LIGHT = 400;
const FW_NORMAL = 450;
const FW_PREMIUM = 600;

interface Contract {
  strike: number;
  expiration: string;
  schwabSymbol?: string;
  bid?: number;
  ask?: number;
  bidSize?: number;
  askSize?: number;
  last?: number;
  volume?: number;
  openInterest?: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  dte?: number;
  streamKey?: string;
}

interface NormalizedRow {
  strike: number;
  call: Contract | null;
  put: Contract | null;
}

interface ExpirationGroup {
  expiration: string;
  dte: number;
  dateLabel: string;
  rows: NormalizedRow[];
  totalStrikes: number;
  expType: "Weekly" | "EOM" | "Quarterly" | null;
  atmIV: number | null;
  expectedMove: number | null;
  maxOI: number;
  maxVol: number;
  totalCallOI: number;
  totalPutOI: number;
  totalCallVol: number;
  totalPutVol: number;
  ivSkew: number | null;
}

interface SelectedLeg {
  contract: Contract;
  type: "CALL" | "PUT";
  expiration: string;
  side: "bid" | "ask";
}

interface LongPressTarget {
  contract: Contract;
  type: "CALL" | "PUT";
  side: "BUY" | "SELL";
  x: number;
  y: number;
}

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

function parseExpDate(expStr: string): Date | null {
  if (!expStr) return null;
  const clean = expStr.split(":")[0].trim();
  const iso = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]), 12, 0, 0);
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}

function formatExpDate(expStr: string): string {
  const d = parseExpDate(expStr);
  if (!d) return expStr || "\u2014";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

function getExpType(expStr: string): "Weekly" | "EOM" | "Quarterly" | null {
  const d = parseExpDate(expStr);
  if (!d) return null;
  const date = d.getDate();
  const month = d.getMonth();
  const dow = d.getDay();
  const lastDayOfMonth = new Date(d.getFullYear(), month + 1, 0).getDate();
  if (date >= lastDayOfMonth - 4) {
    const isQuarterEnd = month === 2 || month === 5 || month === 8 || month === 11;
    return isQuarterEnd ? "Quarterly" : "EOM";
  }
  if (dow === 5 && date >= 15 && date <= 21) return null;
  return "Weekly";
}

function findATMIndex(strikes: number[], lastPrice: number): number {
  if (strikes.length === 0) return -1;
  let best = 0;
  let bestDiff = Math.abs(strikes[0] - lastPrice);
  for (let i = 1; i < strikes.length; i++) {
    const diff = Math.abs(strikes[i] - lastPrice);
    if (diff < bestDiff || (diff === bestDiff && strikes[i] < strikes[best])) {
      best = i;
      bestDiff = diff;
    }
  }
  return best;
}

function buildExpirationGroups(
  calls: Contract[], puts: Contract[], lastPrice: number | null
): ExpirationGroup[] {
  const expMap = new Map<string, { calls: Map<number, Contract>; puts: Map<number, Contract>; dte: number }>();
  for (const c of calls) {
    if (!expMap.has(c.expiration)) expMap.set(c.expiration, { calls: new Map(), puts: new Map(), dte: c.dte ?? 0 });
    expMap.get(c.expiration)!.calls.set(c.strike, c);
  }
  for (const p of puts) {
    if (!expMap.has(p.expiration)) expMap.set(p.expiration, { calls: new Map(), puts: new Map(), dte: p.dte ?? 0 });
    expMap.get(p.expiration)!.puts.set(p.strike, p);
  }
  const groups: ExpirationGroup[] = [];
  for (const [exp, { calls: callMap, puts: putMap, dte }] of expMap) {
    const allStrikes = [...new Set([...callMap.keys(), ...putMap.keys()])].sort((a, b) => a - b);
    const totalStrikes = allStrikes.length;
    const atmIdx = lastPrice != null ? findATMIndex(allStrikes, lastPrice) : -1;
    const normalizedRows: NormalizedRow[] = allStrikes.map((strike) => ({
      strike, call: callMap.get(strike) ?? null, put: putMap.get(strike) ?? null,
    }));

    let atmIV: number | null = null;
    let expectedMove: number | null = null;
    if (atmIdx >= 0 && lastPrice != null) {
      const atmRow = normalizedRows[atmIdx];
      const callIV = atmRow?.call?.iv;
      const putIV = atmRow?.put?.iv;
      const ivValues = [callIV, putIV].filter((v): v is number => v != null && !isNaN(v));
      if (ivValues.length > 0) {
        atmIV = ivValues.reduce((a, b) => a + b, 0) / ivValues.length;
        expectedMove = lastPrice * (atmIV / 100) * Math.sqrt(Math.max(dte, 1) / 365);
      }
    }

    let maxOI = 0;
    let maxVol = 0;
    let totalCallOI = 0;
    let totalPutOI = 0;
    let totalCallVol = 0;
    let totalPutVol = 0;
    for (const row of normalizedRows) {
      const cOI = row.call?.openInterest ?? 0;
      const pOI = row.put?.openInterest ?? 0;
      const cVol = row.call?.volume ?? 0;
      const pVol = row.put?.volume ?? 0;
      maxOI = Math.max(maxOI, cOI, pOI);
      maxVol = Math.max(maxVol, cVol, pVol);
      totalCallOI += cOI;
      totalPutOI += pOI;
      totalCallVol += cVol;
      totalPutVol += pVol;
    }

    const otmCallIVs: number[] = [];
    const otmPutIVs: number[] = [];
    if (lastPrice != null) {
      for (const row of normalizedRows) {
        if (row.strike > lastPrice && row.call?.iv) otmCallIVs.push(row.call.iv);
        if (row.strike < lastPrice && row.put?.iv) otmPutIVs.push(row.put.iv);
      }
    }
    const avgOtmCallIV = otmCallIVs.length > 0 ? otmCallIVs.reduce((a, b) => a + b, 0) / otmCallIVs.length : null;
    const avgOtmPutIV = otmPutIVs.length > 0 ? otmPutIVs.reduce((a, b) => a + b, 0) / otmPutIVs.length : null;
    const ivSkew = avgOtmPutIV != null && avgOtmCallIV != null ? avgOtmPutIV - avgOtmCallIV : null;

    groups.push({
      expiration: exp, dte, dateLabel: formatExpDate(exp),
      rows: normalizedRows, totalStrikes,
      expType: getExpType(exp), atmIV, expectedMove,
      maxOI, maxVol, totalCallOI, totalPutOI, totalCallVol, totalPutVol, ivSkew,
    });
  }
  groups.sort((a, b) => a.dte - b.dte);
  return groups;
}

function getContractVal(contract: Contract | null, key: string): number | undefined {
  if (!contract) return undefined;
  return (contract as unknown as Record<string, unknown>)[key] as number | undefined;
}

function fmtNum(val: number | undefined, decimals: number): string {
  if (val == null || isNaN(val) || val <= -999) return "\u2014";
  return decimals === 0 ? String(Math.round(val)) : val.toFixed(decimals);
}

function fmtCompact(val: number | undefined): string {
  if (val == null || isNaN(val)) return "\u2014";
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + "M";
  if (val >= 1_000) return (val / 1_000).toFixed(1) + "K";
  return String(Math.round(val));
}

const noScrollbar: React.CSSProperties = {
  scrollbarWidth: "none",
  msOverflowStyle: "none",
  scrollSnapType: "none",
};

const STREAM_KEY_MAP: Record<string, string> = {
  bid: "bid", ask: "ask", last: "last",
  bidSize: "bidSize", askSize: "askSize",
  volume: "volume", openInterest: "openInterest",
  iv: "iv", delta: "delta", gamma: "gamma",
  theta: "theta", vega: "vega",
};

function getStreamVal(tick: ReturnType<typeof useOptionTick>, key: string): number | undefined {
  if (!tick) return undefined;
  const mapped = STREAM_KEY_MAP[key];
  if (!mapped) return undefined;
  const v = (tick as unknown as Record<string, unknown>)[mapped];
  return typeof v === "number" && !isNaN(v) ? v : undefined;
}

function makeLegKey(contract: Contract, type: "CALL" | "PUT"): string {
  return `${contract.expiration}|${contract.strike}|${type}`;
}

type Moneyness = "itm" | "otm" | "atm" | "none";

function classifyMoneyness(strike: number, underlyingPrice: number | null, isCallSide: boolean): Moneyness {
  if (underlyingPrice == null) return "none";
  if (Math.abs(strike - underlyingPrice) < underlyingPrice * 0.003) return "atm";
  if (isCallSide) return strike < underlyingPrice - EPS ? "itm" : "otm";
  return strike > underlyingPrice + EPS ? "itm" : "otm";
}

function isStrikeITM(strike: number, underlyingPrice: number | null, isCallSide: boolean): boolean {
  if (underlyingPrice == null) return false;
  if (isCallSide) return strike < underlyingPrice - EPS;
  return strike > underlyingPrice + EPS;
}

function getRowBg(strike: number, underlyingPrice: number | null, isCallSide: boolean): string {
  if (isStrikeITM(strike, underlyingPrice, isCallSide)) return ITM_OCEAN;
  return OTM_PURPLE;
}

const OIBar = memo(function OIBar({ value, max }: { value: number; max: number }) {
  if (!value || !max) return null;
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="w-full h-[2px] rounded-full mt-0.5" style={{ background: "#111" }}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${GOLD}50, ${GOLD}20)`,
        }}
      />
    </div>
  );
});

const DataCell = memo(function DataCell({
  col, contract, isSelected, onSelect, onLongPress, showInlineGreeks, maxOI, moneyness,
}: {
  col: ColumnDef;
  contract: Contract | null;
  isSelected?: boolean;
  onSelect?: () => void;
  onLongPress?: (e: React.PointerEvent) => void;
  showInlineGreeks?: boolean;
  maxOI?: number;
  moneyness?: Moneyness;
}) {
  const tick = useOptionTick(contract?.streamKey);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const didSwipe = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_THRESHOLD = 10;

  const topVal = getStreamVal(tick, col.topKey) ?? getContractVal(contract, col.topKey);
  const bottomVal = col.bottomKey
    ? (getStreamVal(tick, col.bottomKey) ?? getContractVal(contract, col.bottomKey))
    : undefined;
  const topStr = fmtNum(topVal, col.topDecimals);

  const isBid = col.id === "bid";
  const isAsk = col.id === "ask";
  const isOI = col.id === "oi";
  const isVol = col.id === "vol";
  const oiVal = isVol ? getContractVal(contract, "openInterest") : undefined;
  const isGreek = col.group === "Greeks";
  const isIV = col.id === "iv";
  const isPrice = isBid || isAsk;
  const isShaded = moneyness === "itm" || moneyness === "otm";

  const deltaVal = isPrice && showInlineGreeks
    ? (getStreamVal(tick, "delta") ?? getContractVal(contract, "delta"))
    : undefined;
  const thetaVal = isPrice && showInlineGreeks
    ? (getStreamVal(tick, "theta") ?? getContractVal(contract, "theta"))
    : undefined;

  const cancelGesture = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    didSwipe.current = true;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    didLongPress.current = false;
    didSwipe.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    if (onLongPress) {
      longPressTimer.current = setTimeout(() => {
        if (!didSwipe.current) {
          didLongPress.current = true;
          onLongPress(e);
        }
      }, 500);
    }
  }, [onLongPress]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (didSwipe.current || !startPos.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.abs(dx) > SWIPE_THRESHOLD || Math.abs(dy) > SWIPE_THRESHOLD) {
      cancelGesture();
    }
  }, [cancelGesture]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (!didLongPress.current && !didSwipe.current && onSelect) onSelect();
    startPos.current = null;
  }, [onSelect]);

  const handlePointerLeave = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    startPos.current = null;
  }, []);

  let textColor: string;
  if (topStr === "\u2014") textColor = MUTED;
  else if (isBid) textColor = "#f23645";
  else textColor = WHITE;

  const oiValue = isOI ? topVal : undefined;

  const inner = (
    <div className="flex flex-col justify-center" style={{ height: ROW_H, minHeight: ROW_H, padding: isBid ? "0 2px 0 8px" : "0 2px" }}>
      <span
        className="leading-none"
        style={{
          fontSize: isPrice ? 14 : 12,
          fontWeight: FW_LIGHT,
          color: textColor,
          fontVariantNumeric: "tabular-nums",
          fontFamily: MONO,
          letterSpacing: "0.01em",
        }}
      >
        {isVol || isOI ? fmtCompact(topVal) : topStr}
        {isIV && topStr !== "\u2014" ? "%" : ""}
      </span>

      {isVol && oiVal != null && (
        <span className="leading-none mt-0.5" style={{ fontSize: 10, color: WHITE, fontVariantNumeric: "tabular-nums", fontFamily: MONO, fontWeight: FW_LIGHT }}>
          OI: {fmtCompact(oiVal)}
        </span>
      )}

      {isPrice && showInlineGreeks && deltaVal != null ? (
        <div className="flex gap-1 mt-0.5" style={{ fontSize: 10, color: isShaded ? "#a0a0a8" : GRAY, fontFamily: MONO, fontVariantNumeric: "tabular-nums", fontWeight: FW_LIGHT }}>
          <span>{"Δ"}{fmtNum(deltaVal, 2)}</span>
          {thetaVal != null && <span>{"Θ"}{fmtNum(thetaVal, 2)}</span>}
        </div>
      ) : isPrice && !showInlineGreeks ? (
        <span
          className="leading-none mt-0.5"
          style={{ fontSize: 10, color: WHITE, fontVariantNumeric: "tabular-nums", fontFamily: MONO, fontWeight: FW_LIGHT }}
        >
          {bottomVal != null ? <>Size: {fmtCompact(bottomVal)}</> : ""}
        </span>
      ) : null}

      {isOI && oiValue != null && maxOI != null && maxOI > 0 && (
        <OIBar value={oiValue} max={maxOI} />
      )}
    </div>
  );

  if (col.isPrice && contract && (onSelect || onLongPress)) {
    return (
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(); } }}
        aria-pressed={isSelected}
        aria-label={`${isBid ? "Bid" : "Ask"} ${topStr} strike ${contract.strike}`}
        className="w-full text-left cursor-pointer select-none relative"
        style={{ fontVariantNumeric: "tabular-nums", outline: isSelected ? "1px solid #ffffff" : "none", outlineOffset: -1 }}
      >
        {inner}
      </button>
    );
  }

  return <div className="relative" style={{ fontVariantNumeric: "tabular-nums" }}>{inner}</div>;
});

function LongPressMenu({
  target,
  onClose,
  onTradeSingle,
  onAddToStrategy,
}: {
  target: LongPressTarget;
  onClose: () => void;
  onTradeSingle: () => void;
  onAddToStrategy: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: PointerEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("pointerdown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [onClose]);

  const menuY = Math.min(target.y, window.innerHeight - 160);
  const menuX = Math.min(Math.max(target.x - 100, 8), window.innerWidth - 216);

  return (
    <div className="fixed inset-0 z-[300]" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div
        ref={menuRef}
        className="absolute rounded-lg border shadow-2xl overflow-hidden"
        style={{
          top: menuY,
          left: menuX,
          width: 208,
          background: "#111111",
          borderColor: "#2a2a2a",
          boxShadow: `0 8px 32px rgba(0,0,0,0.8), 0 0 0 1px ${GOLD}15`,
        }}
      >
        <div className="px-3 py-2 border-b" style={{ borderColor: "#1a1a1a", background: "#0a0a0a" }}>
          <span className="text-[10px] tracking-widest" style={{ color: GRAY, fontFamily: MONO, fontWeight: FW_NORMAL }}>
            {target.type} ${target.contract.strike} \u2022 {target.side}
          </span>
        </div>
        <button
          onClick={() => { onTradeSingle(); onClose(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/5 active:bg-white/10"
        >
          <TrendingUp className="w-3.5 h-3.5" style={{ color: GOLD }} />
          <span className="text-[11px] text-white" style={{ fontFamily: MONO, fontWeight: FW_NORMAL }}>Trade Single Leg</span>
        </button>
        <button
          onClick={() => { onAddToStrategy(); onClose(); }}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/5 active:bg-white/10"
        >
          <Plus className="w-3.5 h-3.5" style={{ color: GOLD }} />
          <span className="text-[11px] text-white" style={{ fontFamily: MONO, fontWeight: FW_NORMAL }}>Add to Strategy</span>
        </button>
        <button
          onClick={onClose}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/5 active:bg-white/10"
        >
          <BarChart3 className="w-3.5 h-3.5" style={{ color: GOLD }} />
          <span className="text-[11px] text-white" style={{ fontFamily: MONO, fontWeight: FW_NORMAL }}>Analyze Payoff</span>
        </button>
      </div>
    </div>
  );
}

function ColumnsEditorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { activeColumnIds, toggleColumn, reorderColumns } = useOptionsColumnsStore();
  const [localOrder, setLocalOrder] = useState(activeColumnIds);

  useEffect(() => {
    if (open) setLocalOrder(activeColumnIds);
  }, [open, activeColumnIds]);

  const handleReorder = (newOrder: string[]) => {
    setLocalOrder(newOrder);
    reorderColumns(newOrder);
  };

  if (!open) return null;

  const groups = [
    { label: "PRICE", ids: ["bid", "ask", "last"] },
    { label: "FLOW", ids: ["vol", "oi"] },
    { label: "GREEKS", ids: ["delta", "gamma", "theta", "vega"] },
    { label: "VOLATILITY", ids: ["iv"] },
  ];

  return (
    <div className="fixed inset-0 z-[250] flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div
        className="relative border rounded-t-2xl w-full max-w-md mx-auto z-10"
        style={{ background: "#0a0a0a", borderColor: "#1a1a1a", maxHeight: "75vh" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#1a1a1a" }}>
          <span className="text-[11px] tracking-[0.2em]" style={{ color: GOLD, fontFamily: MONO, fontWeight: FW_PREMIUM }}>COLUMN CONFIG</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" style={{ color: GRAY }} />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-4" style={{ maxHeight: "60vh", ...noScrollbar }}>
          <Reorder.Group axis="y" values={localOrder} onReorder={handleReorder} className="space-y-1">
            {localOrder.map(id => {
              const col = COLUMN_REGISTRY.find(c => c.id === id);
              if (!col) return null;
              return (
                <Reorder.Item
                  key={id}
                  value={id}
                  style={{ touchAction: "none" }}
                  whileDrag={{ scale: 1.02, boxShadow: `0 4px 16px rgba(0,0,0,0.6)` }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <div
                    className="flex items-center justify-between px-3 py-2 rounded-lg border select-none"
                    style={{ background: "#111111", borderColor: `${GOLD}20` }}
                  >
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-3.5 h-3.5" style={{ color: DIM }} />
                      <span className="text-[11px] text-white" style={{ fontFamily: MONO, fontWeight: FW_NORMAL }}>{col.label}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded" style={{ color: DIM, background: "#1a1a1a" }}>{col.group}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleColumn(id); setLocalOrder(prev => prev.filter(x => x !== id)); }}
                      className="w-8 h-4 rounded-full flex items-center transition-colors justify-end"
                      style={{ background: GOLD }}
                      disabled={activeColumnIds.length <= 1}
                    >
                      <div className="w-3.5 h-3.5 rounded-full bg-black mx-0.5" />
                    </button>
                  </div>
                </Reorder.Item>
              );
            })}
          </Reorder.Group>

          {groups.map(group => {
            const offCols = COLUMN_REGISTRY.filter(c => group.ids.includes(c.id) && !localOrder.includes(c.id));
            if (offCols.length === 0) return null;
            return (
              <div key={group.label}>
                <span className="text-[9px] tracking-[0.15em] mb-1.5 block" style={{ color: DIM, fontWeight: FW_NORMAL }}>{group.label}</span>
                <div className="space-y-1">
                  {offCols.map(col => (
                    <button
                      key={col.id}
                      onClick={() => { toggleColumn(col.id); setLocalOrder(prev => [...prev, col.id]); }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg border transition-colors hover:border-white/10"
                      style={{ background: "transparent", borderColor: "#1a1a1a" }}
                    >
                      <span className="text-[11px]" style={{ color: DIM, fontFamily: MONO, fontWeight: FW_LIGHT }}>{col.label}</span>
                      <div className="w-8 h-4 rounded-full flex items-center transition-colors justify-start" style={{ background: "#1a1a1a" }}>
                        <div className="w-3.5 h-3.5 rounded-full mx-0.5" style={{ background: "#333" }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MetricsStrip({ groups, lastPrice, rawCalls, rawPuts, earningsDate, isFetching, hasData }: {
  groups: ExpirationGroup[];
  lastPrice: number | null;
  rawCalls: Contract[];
  rawPuts: Contract[];
  earningsDate?: string | null;
  isFetching: boolean;
  hasData: boolean;
}) {
  const frontMonth = groups.length > 0 ? groups[0] : null;
  const atmIV = frontMonth?.atmIV ?? null;
  const expectedMove = frontMonth?.expectedMove ?? null;

  const totalCallVol = rawCalls.reduce((sum, c) => sum + (c.volume ?? 0), 0);
  const totalPutVol = rawPuts.reduce((sum, p) => sum + (p.volume ?? 0), 0);
  const totalCallOI = rawCalls.reduce((sum, c) => sum + (c.openInterest ?? 0), 0);
  const totalPutOI = rawPuts.reduce((sum, p) => sum + (p.openInterest ?? 0), 0);
  const pcr = totalCallVol > 0
    ? (totalPutVol / totalCallVol).toFixed(2)
    : totalCallOI > 0
      ? (totalPutOI / totalCallOI).toFixed(2)
      : "\u2014";

  let earnDisplay = "\u2014";
  if (earningsDate) {
    const d = new Date(earningsDate);
    if (!isNaN(d.getTime())) earnDisplay = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }

  return (
    <div className="flex gap-2 items-center shrink-0" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", fontFamily: MONO, fontWeight: FW_LIGHT }}>
      {isFetching && hasData && (
        <span className="w-2 h-2 border border-amber-400 border-t-transparent rounded-full animate-spin" />
      )}
      <span>
        <span style={{ color: DIM }}>IV </span>
        <span style={{ color: atmIV != null ? GOLD : MUTED, fontWeight: FW_LIGHT }}>
          {atmIV != null ? atmIV.toFixed(1) + "%" : "\u2014"}
        </span>
      </span>
      <span>
        <span style={{ color: DIM }}>MV </span>
        <span style={{ color: expectedMove != null ? WHITE : MUTED, fontWeight: FW_LIGHT }}>
          {expectedMove != null ? "\u00B1$" + expectedMove.toFixed(2) : "\u2014"}
        </span>
      </span>
      <span>
        <span style={{ color: DIM }}>P/C </span>
        <span style={{ color: pcr !== "\u2014" ? (Number(pcr) > 1 ? DOWN : UP) : MUTED, fontWeight: FW_LIGHT }}>{pcr}</span>
      </span>
      <span>
        <span style={{ color: DIM }}>ERN </span>
        <span style={{ color: WHITE, fontWeight: FW_LIGHT }}>{earnDisplay}</span>
      </span>
    </div>
  );
}


function StrikeCell({ strike, underlyingPrice }: { strike: number; underlyingPrice: number | null }) {
  const isATM = underlyingPrice != null && Math.abs(strike - underlyingPrice) < (underlyingPrice * 0.003);

  let moneynessLabel: string | null = null;

  if (underlyingPrice != null) {
    const diff = strike - underlyingPrice;
    const pct = (diff / underlyingPrice) * 100;
    const absPct = Math.abs(pct);

    if (absPct < 0.3) {
      moneynessLabel = "ATM";
    } else if (absPct < 10) {
      moneynessLabel = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
    }
  }

  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{
        height: ROW_H,
        borderBottom: `1px solid rgba(0,0,0,0.25)`,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: FW_LIGHT, color: "#000", fontVariantNumeric: "tabular-nums", fontFamily: MONO, lineHeight: 1 }}>
        {strike % 1 === 0 ? strike : strike.toFixed(1)}
      </span>
      {moneynessLabel && (
        <span style={{ fontSize: 9, fontWeight: FW_LIGHT, color: "rgba(0,0,0,0.5)", fontFamily: MONO, lineHeight: 1, marginTop: 2 }}>
          {moneynessLabel}
        </span>
      )}
    </div>
  );
}

function OptionsGrid({
  rows,
  underlyingPrice,
  columns,
  showCalls,
  showPuts,
  selectedLegs,
  onToggleLeg,
  onLongPressCell,
  showInlineGreeks,
  maxOI,
  accentHex,
}: {
  rows: NormalizedRow[];
  underlyingPrice: number | null;
  columns: ColumnDef[];
  showCalls: boolean;
  showPuts: boolean;
  selectedLegs: Map<string, SelectedLeg>;
  onToggleLeg: (contract: Contract, type: "CALL" | "PUT", side: "bid" | "ask") => void;
  onLongPressCell: (target: LongPressTarget) => void;
  showInlineGreeks: boolean;
  maxOI: number;
  accentHex: string;
}) {
  const sortedRows = useMemo(() => [...rows].sort((a, b) => a.strike - b.strike), [rows]);

  const transitionIdx = useMemo(() => {
    if (underlyingPrice == null) return -1;
    return sortedRows.findIndex(r => r.strike > underlyingPrice + EPS);
  }, [sortedRows, underlyingPrice]);

  const priceAboveAll = useMemo(() => {
    if (underlyingPrice == null || sortedRows.length === 0) return false;
    return underlyingPrice > sortedRows[sortedRows.length - 1].strike + EPS;
  }, [underlyingPrice, sortedRows]);

  const wingWidth = columns.length * COL_W;

  const callWingRef = useRef<HTMLDivElement>(null);
  const putWingRef = useRef<HTMLDivElement>(null);

  const atmLineTop = useMemo(() => {
    if (transitionIdx >= 0) return transitionIdx * ROW_H;
    if (priceAboveAll && sortedRows.length > 0) return sortedRows.length * ROW_H;
    return -1;
  }, [transitionIdx, priceAboveAll, sortedRows.length]);

  const wingScrollStyle: React.CSSProperties = {
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none" as React.CSSProperties["scrollbarWidth"],
    msOverflowStyle: "none",
    willChange: "transform",
  };

  return (
    <div>
      <div style={{ display: "flex", fontVariantNumeric: "tabular-nums", fontFamily: MONO, position: "relative" }}>
        {atmLineTop >= 0 && (
          <div
            className="pointer-events-none"
            style={{ position: "absolute", left: 0, right: 0, top: atmLineTop, borderTop: "1px dotted #FF6B2B", zIndex: 5 }}
          />
        )}

        {showCalls && (
          <div
            ref={callWingRef}
            style={{ ...wingScrollStyle, flex: 1 }}
          >
            <div style={{ minWidth: wingWidth }}>
              {sortedRows.map((row) => {
                const callKey = row.call ? makeLegKey(row.call, "CALL") : "";
                const callLeg = callKey ? selectedLegs.get(callKey) : undefined;
                const isCallSelected = !!callLeg;
                const moneyness = classifyMoneyness(row.strike, underlyingPrice, true);
                const bg = getRowBg(row.strike, underlyingPrice, true);
                return (
                  <div
                    key={row.strike}
                    className="flex"
                    style={{
                      height: ROW_H,
                      borderBottom: `1px solid ${BORDER_ROW}`,
                      background: bg,
                      boxShadow: isCallSelected ? `inset 2px 0 0 ${SEL_BORDER_COLOR}` : undefined,
                    }}
                  >
                    {columns.map(col => (
                      <div key={col.id} style={{ width: COL_W }} className="shrink-0">
                        <DataCell
                          col={col}
                          contract={row.call}
                          isSelected={isCallSelected && col.isPrice && callLeg?.side === col.id}
                          onSelect={col.isPrice && row.call ? () => onToggleLeg(row.call!, "CALL", col.id as "bid" | "ask") : undefined}
                          onLongPress={col.isPrice && row.call ? (e) => onLongPressCell({
                            contract: row.call!, type: "CALL",
                            side: col.id === "bid" ? "SELL" : "BUY",
                            x: e.clientX, y: e.clientY,
                          }) : undefined}
                          showInlineGreeks={showInlineGreeks}
                          maxOI={col.id === "oi" ? maxOI : undefined}
                          moneyness={moneyness}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex-none" style={{ width: STRIKE_W, background: accentHex, borderLeft: `1px solid ${accentHex}`, borderRight: `1px solid ${accentHex}`, zIndex: 10, position: "relative" }}>
          {sortedRows.map((row) => (
            <StrikeCell key={row.strike} strike={row.strike} underlyingPrice={underlyingPrice} />
          ))}
        </div>

        {showPuts && (
          <div
            ref={putWingRef}
            style={{ ...wingScrollStyle, flex: 1 }}
          >
            <div style={{ minWidth: wingWidth }}>
              {sortedRows.map((row) => {
                const putKey = row.put ? makeLegKey(row.put, "PUT") : "";
                const putLeg = putKey ? selectedLegs.get(putKey) : undefined;
                const isPutSelected = !!putLeg;
                const moneyness = classifyMoneyness(row.strike, underlyingPrice, false);
                const bg = getRowBg(row.strike, underlyingPrice, false);
                return (
                  <div
                    key={row.strike}
                    className="flex"
                    style={{
                      height: ROW_H,
                      borderBottom: `1px solid ${BORDER_ROW}`,
                      background: bg,
                      boxShadow: isPutSelected ? `inset -2px 0 0 ${SEL_BORDER_COLOR}` : undefined,
                    }}
                  >
                    {columns.map(col => (
                      <div key={col.id} style={{ width: COL_W }} className="shrink-0">
                        <DataCell
                          col={col}
                          contract={row.put}
                          isSelected={isPutSelected && col.isPrice && putLeg?.side === col.id}
                          onSelect={col.isPrice && row.put ? () => onToggleLeg(row.put!, "PUT", col.id as "bid" | "ask") : undefined}
                          onLongPress={col.isPrice && row.put ? (e) => onLongPressCell({
                            contract: row.put!, type: "PUT",
                            side: col.id === "bid" ? "SELL" : "BUY",
                            x: e.clientX, y: e.clientY,
                          }) : undefined}
                          showInlineGreeks={showInlineGreeks}
                          maxOI={col.id === "oi" ? maxOI : undefined}
                          moneyness={moneyness}
                        />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OptionsChainHeader({
  showCalls,
  showPuts,
  columns,
  stickyTop,
  onColumnsEditor,
  onBuildStrategy,
}: {
  showCalls: boolean;
  showPuts: boolean;
  columns: ColumnDef[];
  stickyTop: number;
  onColumnsEditor: () => void;
  onBuildStrategy?: () => void;
}) {
  const wingWidth = columns.length * COL_W;

  return (
    <>
      <div
        style={{
          display: "flex",
          height: HEADER_H,
          background: BG_HEADER,
          borderBottom: `1px solid ${BORDER}`,
          alignItems: "center",
          position: "sticky",
          top: stickyTop,
          zIndex: 50,
        }}
      >
        {showCalls && (
          <div style={{ flex: 1, textAlign: "center" }}>
            <span style={{ fontSize: 12, letterSpacing: "0.08em", color: GRAY, fontFamily: MONO, fontWeight: FW_PREMIUM }}>CALLS</span>
          </div>
        )}
        <div style={{ width: STRIKE_W, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}` }}>
          {onBuildStrategy && (
            <button
              onClick={onBuildStrategy}
              style={{ width: STRIKE_W / 2, height: HEADER_H, color: GRAY, display: "flex", alignItems: "center", justifyContent: "center" }}
              aria-label="Strategy builder"
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onColumnsEditor}
            style={{ width: onBuildStrategy ? STRIKE_W / 2 : STRIKE_W, height: HEADER_H, color: GRAY, display: "flex", alignItems: "center", justifyContent: "center" }}
            aria-label="Edit columns"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
        {showPuts && (
          <div style={{ flex: 1, textAlign: "center" }}>
            <span style={{ fontSize: 12, letterSpacing: "0.08em", color: GRAY, fontFamily: MONO, fontWeight: FW_PREMIUM }}>PUTS</span>
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          height: SUB_HEADER_H,
          background: "#111111",
          borderBottom: `1px solid ${BORDER}`,
          alignItems: "center",
          position: "sticky",
          top: stickyTop + HEADER_H,
          zIndex: 45,
          boxShadow: "0 2px 4px rgba(0,0,0,0.5)",
        }}
      >
        {showCalls && (
          <div style={{ flex: 1, overflow: "hidden", height: SUB_HEADER_H }}>
            <div style={{ display: "flex", alignItems: "center", minWidth: wingWidth, height: SUB_HEADER_H }}>
              {columns.map(col => (
                <div key={col.id} style={{ width: COL_W, flexShrink: 0, padding: "0 4px" }}>
                  <span style={{ fontSize: 10, color: DIM, fontFamily: MONO, fontWeight: FW_LIGHT, textTransform: "uppercase", letterSpacing: "0.08em" }}>{col.topLabel}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ width: STRIKE_W, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}`, background: "#111111" }}>
          <span style={{ fontSize: 9, color: WHITE, fontFamily: MONO, fontWeight: FW_PREMIUM, letterSpacing: "0.08em" }}>STRIKE</span>
        </div>
        {showPuts && (
          <div style={{ flex: 1, overflow: "hidden", height: SUB_HEADER_H }}>
            <div style={{ display: "flex", alignItems: "center", minWidth: wingWidth, height: SUB_HEADER_H }}>
              {columns.map(col => (
                <div key={col.id} style={{ width: COL_W, flexShrink: 0, padding: "0 4px" }}>
                  <span style={{ fontSize: 10, color: DIM, fontFamily: MONO, fontWeight: FW_LIGHT, textTransform: "uppercase", letterSpacing: "0.08em" }}>{col.topLabel}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function buildSchwabOptionKey(underlying: string, expiration: string, strike: number, type: "C" | "P"): string {
  const d = parseExpDate(expiration);
  if (!d) return "";
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  const sym = underlying.toUpperCase().padEnd(6, " ");
  return `${sym}${yy}${mm}${dd}${type}${strikePadded}`;
}

interface OptionsTabProps {
  subscribeOptionSymbols?: (symbols: string[]) => Promise<void>;
  stickyOffset?: number;
  onTradeSingle?: (contract: Contract, side: "BUY" | "SELL", type: "CALL" | "PUT") => void;
  onOpenStrategyBuilder?: (strikes: number[], expirations: { label: string; value: string }[], chainData: Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number }>, preSelectedLegs?: { contract: Contract; type: "CALL" | "PUT"; side?: "bid" | "ask" }[]) => void;
}

export type { Contract as OptionsContract };

export function OptionsTab({ subscribeOptionSymbols, stickyOffset = 0, onTradeSingle, onOpenStrategyBuilder }: OptionsTabProps) {
  const { symbol, accessToken } = useTerminalStore();
  const { contractType, strikeCount, setCustomStrikeInput } = useOptionsSettingsStore();
  const setStrikeCount = useOptionsSettingsStore(s => s.setStrikeCount);
  const { activeColumnIds } = useOptionsColumnsStore();
  const accentKey = useUICustomizationStore(s => s.accentColor);
  const accentHex = ACCENT_COLORS[accentKey];
  const [columnsEditorOpen, setColumnsEditorOpen] = useState(false);
  const [selectedLegs, setSelectedLegs] = useState<Map<string, SelectedLeg>>(new Map());
  const [showInlineGreeks, setShowInlineGreeks] = useState(false);
  const [longPressTarget, setLongPressTarget] = useState<LongPressTarget | null>(null);

  const activeColumns = useMemo(
    () => activeColumnIds.map(id => COLUMN_REGISTRY.find(c => c.id === id)).filter(Boolean) as ColumnDef[],
    [activeColumnIds]
  );

  const [expandedExps, setExpandedExps] = useState<Set<string>>(new Set());
  const [isCustomMode, setIsCustomMode] = useState(() => ![6, 10, 20].includes(strikeCount));
  const [localCustomValue, setLocalCustomValue] = useState(String(strikeCount));
  const strikeMode = useMemo(() => {
    if ([6, 10, 20].includes(strikeCount)) return String(strikeCount);
    return "custom";
  }, [strikeCount]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: rawData, isLoading, error, isFetching } = useGetOptionChain(
    { symbol, accessToken: accessToken || "", contractType: "ALL", strikeCount },
    { query: { enabled: !!accessToken && !!symbol, staleTime: 25_000, gcTime: 60_000 } }
  );

  const data = useMemo(() => {
    if (!rawData) return rawData;
    let calls = (rawData.calls ?? []) as Contract[];
    let puts = (rawData.puts ?? []) as Contract[];
    if (contractType === "CALL") puts = [];
    else if (contractType === "PUT") calls = [];
    return { ...rawData, calls, puts };
  }, [rawData, contractType]);

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );

  const { data: earningsData } = useQuery({
    queryKey: ["earnings-date", symbol],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/market/earnings-date?symbol=${encodeURIComponent(symbol)}`);
      return res.json() as Promise<{ earningsDate?: string | null }>;
    },
    enabled: !!symbol,
    staleTime: 30 * 60 * 1000,
  });

  const underlyingPrice = quote?.last ?? (data as unknown as { underlyingPrice?: number })?.underlyingPrice ?? null;

  const groups = useMemo(() => {
    if (!data) return [];
    const calls = (data.calls ?? []) as Contract[];
    const puts = (data.puts ?? []) as Contract[];
    calls.forEach(c => { c.streamKey = c.schwabSymbol || buildSchwabOptionKey(symbol, c.expiration, c.strike, "C"); });
    puts.forEach(c => { c.streamKey = c.schwabSymbol || buildSchwabOptionKey(symbol, c.expiration, c.strike, "P"); });
    return buildExpirationGroups(calls, puts, underlyingPrice);
  }, [data, underlyingPrice, symbol]);

  useEffect(() => {
    if (!subscribeOptionSymbols || groups.length === 0) return;
    const keys: string[] = [];
    for (const g of groups) {
      for (const row of g.rows) {
        if (row.call?.streamKey) keys.push(row.call.streamKey);
        if (row.put?.streamKey) keys.push(row.put.streamKey);
      }
    }
    if (keys.length > 0) void subscribeOptionSymbols(keys);
  }, [groups, subscribeOptionSymbols]);

  useEffect(() => { setExpandedExps(new Set()); setSelectedLegs(new Map()); }, [symbol]);

  useEffect(() => {}, [groups.length]);

  const toggleExp = (exp: string) => {
    setExpandedExps(prev => {
      const next = new Set(prev);
      if (next.has(exp)) next.delete(exp); else next.add(exp);
      return next;
    });
  };

  const handleToggleLeg = useCallback((contract: Contract, type: "CALL" | "PUT", side: "bid" | "ask") => {
    const key = makeLegKey(contract, type);
    setSelectedLegs(prev => {
      const next = new Map(prev);
      const existing = next.get(key);
      if (existing && existing.side === side) next.delete(key);
      else next.set(key, { contract, type, expiration: contract.expiration, side });
      return next;
    });
  }, []);

  const handleLongPressCell = useCallback((target: LongPressTarget) => {
    setLongPressTarget(target);
  }, []);

  const handleQuickTrade = useCallback((contract: Contract, side: "BUY" | "SELL", type: "CALL" | "PUT") => {
    if (onTradeSingle) onTradeSingle(contract, side, type);
  }, [onTradeSingle]);

  const handleClearSelection = useCallback(() => {
    setSelectedLegs(new Map());
  }, []);

  const handleBuildStrategy = useCallback(() => {
    if (!onOpenStrategyBuilder || groups.length === 0) return;
    const allStrikes = new Set<number>();
    const expLabels: { label: string; value: string }[] = [];
    const cMap = new Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number }>();
    for (const g of groups) {
      if (!expLabels.some(e => e.value === g.expiration)) {
        expLabels.push({ label: `${g.dateLabel} (${Math.round(g.dte)}d)`, value: g.expiration });
      }
      for (const row of g.rows) {
        allStrikes.add(row.strike);
        const mapContract = (c: Contract | null) => {
          if (!c?.streamKey) return;
          cMap.set(c.streamKey, { bid: c.bid, ask: c.ask, delta: c.delta, gamma: c.gamma, theta: c.theta, vega: c.vega, iv: c.iv });
        };
        mapContract(row.call);
        mapContract(row.put);
      }
    }
    const preSelected = selectedLegs.size > 0
      ? [...selectedLegs.values()].map(l => ({ contract: l.contract, type: l.type, side: l.side }))
      : undefined;
    onOpenStrategyBuilder([...allStrikes].sort((a, b) => a - b), expLabels, cMap, preSelected);
    setSelectedLegs(new Map());
  }, [onOpenStrategyBuilder, groups, selectedLegs]);

  const handleStrikeModeChange = useCallback((val: string) => {
    if (val === "custom") { setLocalCustomValue(String(strikeCount)); setIsCustomMode(true); return; }
    setIsCustomMode(false);
    const n = parseInt(val);
    if (!isNaN(n) && n > 0) setStrikeCount(n);
  }, [setStrikeCount, strikeCount]);

  const handleCustomStrikeChange = useCallback((raw: string) => {
    setLocalCustomValue(raw);
    setCustomStrikeInput(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (raw === "") return;
    debounceRef.current = setTimeout(() => {
      const n = parseInt(raw);
      if (!isNaN(n) && n >= 2 && n <= 100) setStrikeCount(n);
    }, 400);
  }, [setCustomStrikeInput, setStrikeCount]);

  const handleExitCustomMode = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    setIsCustomMode(false);
    if (![6, 10, 20].includes(strikeCount)) setStrikeCount(10);
  }, [strikeCount, setStrikeCount]);

  useEffect(() => { return () => { if (debounceRef.current) clearTimeout(debounceRef.current); }; }, []);

  const showCalls = contractType !== "PUT";
  const showPuts = contractType !== "CALL";
  const hasData = data && groups.length > 0;
  const apiError = (rawData as Record<string, unknown> | undefined)?.error as string | undefined;

  const selCount = selectedLegs.size;

  return (
    <div style={{ background: BG }} className="relative">
      <div
        className="flex items-center justify-between w-full px-3 shrink-0 sticky z-40"
        style={{ top: stickyOffset, height: TOOLBAR_H, background: BG_EXP_BAR, borderBottom: `1px solid ${BORDER}`, fontFamily: MONO }}
      >
        <div className="flex items-center gap-1.5">
          <span style={{ fontSize: 14, color: DIM, fontWeight: FW_NORMAL, fontFamily: MONO }}>Strike</span>
          {isCustomMode ? (
            <div className="flex items-center gap-1">
              <Input
                type="number" min={2} max={100} autoFocus
                value={localCustomValue}
                onChange={e => handleCustomStrikeChange(e.target.value)}
                onKeyDown={e => { if (e.key === "Escape") handleExitCustomMode(); }}
                className="w-[52px] h-6 px-1.5 border rounded text-white"
                style={{ fontSize: 14, background: "#111", borderColor: "#2a2a2a", fontFamily: MONO }}
                placeholder="10"
              />
              <button onClick={handleExitCustomMode} className="p-0.5 rounded hover:bg-white/5 transition-colors" aria-label="Exit custom mode">
                <X className="w-3 h-3" style={{ color: DIM }} />
              </button>
            </div>
          ) : (
            <Select value={strikeMode} onValueChange={handleStrikeModeChange}>
              <SelectTrigger className="w-[52px] h-6 px-1.5 border rounded text-white" style={{ fontSize: 14, background: "#111", borderColor: "#2a2a2a", fontFamily: MONO }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
        <MetricsStrip
          groups={groups}
          lastPrice={underlyingPrice}
          rawCalls={(data?.calls ?? []) as Contract[]}
          rawPuts={(data?.puts ?? []) as Contract[]}
          earningsDate={earningsData?.earningsDate ?? quote?.nextEarningsDate}
          isFetching={isFetching}
          hasData={!!data}
        />
      </div>

      <div className="relative" style={{ background: BG, paddingBottom: selCount > 0 ? 52 : 0 }}>
        {isLoading && !data && (
          <div className="p-4 space-y-1">
            {Array.from({ length: strikeCount }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full rounded" style={{ background: "#0a0a0a" }} />
            ))}
          </div>
        )}

        {isFetching && data && (
          <div className="absolute inset-0 z-40 pointer-events-none" style={{ background: "rgba(0,0,0,0.12)" }} />
        )}

        {error && !data && (
          <div className="p-12 text-center font-mono flex flex-col items-center" style={{ color: DOWN }}>
            <span className="text-2xl mb-2">\u26A0</span>
            <span className="text-[10px] tracking-widest" style={{ fontWeight: FW_LIGHT }}>FAILED TO LOAD OPTIONS</span>
          </div>
        )}

        {!hasData && !isLoading && !error && apiError && (
          <div className="p-12 text-center font-mono flex flex-col items-center" style={{ color: GOLD_DIM }}>
            <span className="text-2xl mb-2">\u26A0</span>
            <span className="text-[10px] tracking-widest" style={{ fontWeight: FW_LIGHT }}>OPTIONS UNAVAILABLE</span>
            <span className="text-[9px] mt-1" style={{ color: DIM, fontWeight: FW_LIGHT }}>Service may be down \u2014 retries automatically</span>
          </div>
        )}

        {!isLoading && !error && !data && !accessToken && (
          <div className="p-16 flex flex-col items-center justify-center font-mono">
            <Table2 className="w-7 h-7 mb-2" style={{ color: MUTED }} />
            <ConnectBrokerPrompt label="Connect Brokerage To View Options" compact />
          </div>
        )}

        {!isLoading && !error && !data && accessToken && (
          <div className="p-16 flex flex-col items-center justify-center font-mono">
            <Table2 className="w-7 h-7 mb-2 animate-pulse" style={{ color: MUTED }} />
            <span className="text-[10px] tracking-widest" style={{ color: DIM, fontWeight: FW_LIGHT }}>LOADING OPTIONS CHAIN...</span>
          </div>
        )}

        {hasData && (
          <div>
            <OptionsChainHeader
              showCalls={showCalls}
              showPuts={showPuts}
              columns={activeColumns}
              stickyTop={stickyOffset + TOOLBAR_H}
              onColumnsEditor={() => setColumnsEditorOpen(true)}
              onBuildStrategy={onOpenStrategyBuilder ? handleBuildStrategy : undefined}
            />
            {groups.map(group => {
              const isOpen = expandedExps.has(group.expiration);
              const pcr = group.totalCallVol > 0
                ? (group.totalPutVol / group.totalCallVol)
                : group.totalCallOI > 0
                  ? (group.totalPutOI / group.totalCallOI)
                  : null;
              return (
                <div key={group.expiration}>
                  <button
                    onClick={() => toggleExp(group.expiration)}
                    className="w-full flex items-center justify-between px-3 py-1 transition-colors sticky z-20"
                    style={{
                      top: stickyOffset + TOOLBAR_H + HEADER_H + SUB_HEADER_H,
                      background: BG_EXP_BAR,
                      borderBottom: `1px solid ${BORDER}`,
                      fontFamily: MONO,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      {isOpen
                        ? <ChevronDown className="w-3 h-3" style={{ color: DIM }} />
                        : <ChevronRight className="w-3 h-3" style={{ color: DIM }} />
                      }
                      <span className="text-[13px] tracking-wide" style={{ color: WHITE, fontWeight: FW_NORMAL }}>
                        {group.dateLabel}
                      </span>
                      <span className="text-[12px]" style={{ color: GRAY, fontWeight: FW_LIGHT }}>
                        {Math.round(group.dte)}d
                      </span>
                      {group.expType && (
                        <span className="text-[13px]" style={{
                          color: group.expType === "Quarterly" ? "#22d3ee" : group.expType === "EOM" ? "#60a5fa" : "#FF6B2B",
                          fontWeight: FW_NORMAL,
                        }}>
                          {group.expType}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", fontFamily: MONO }}>
                      {group.atmIV != null && (
                        <span style={{ color: GOLD, fontWeight: FW_PREMIUM }}>
                          IV {group.atmIV.toFixed(1)}%
                        </span>
                      )}
                      {pcr != null && (
                        <span style={{ color: pcr > 1 ? DOWN : UP, fontWeight: FW_NORMAL }}>
                          P/C {pcr.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </button>

                  {isOpen && (
                    <OptionsGrid
                      rows={group.rows}
                      underlyingPrice={underlyingPrice}
                      columns={activeColumns}
                      showCalls={showCalls}
                      showPuts={showPuts}
                      selectedLegs={selectedLegs}
                      onToggleLeg={handleToggleLeg}
                      onLongPressCell={handleLongPressCell}
                      showInlineGreeks={showInlineGreeks}
                      maxOI={group.maxOI}
                      accentHex={accentHex}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {data && groups.length === 0 && (
          <div className="p-16 flex flex-col items-center justify-center font-mono">
            <Table2 className="w-7 h-7 mb-2" style={{ color: MUTED }} />
            <span className="text-[10px] tracking-widest" style={{ color: DIM, fontWeight: FW_LIGHT }}>NO OPTIONS DATA FOR THIS RANGE</span>
          </div>
        )}
      </div>

      {selCount > 0 && (
        <div
          className="fixed left-0 right-0 z-[100] flex items-center justify-between px-4 py-3"
          style={{
            bottom: 80,
            background: "linear-gradient(180deg, #0a0a0a 0%, #000000 100%)",
            borderTop: `1px solid ${GOLD}30`,
            boxShadow: `0 -4px 24px rgba(0,0,0,0.8), 0 -1px 0 ${GOLD}15`,
            fontFamily: MONO,
          }}
        >
          <button
            onClick={handleBuildStrategy}
            className="font-mono text-sm font-bold tracking-wider px-6 py-2.5 rounded-lg transition-all active:scale-95"
            style={{
              background: GOLD,
              color: "#000",
              boxShadow: `0 2px 12px ${GOLD}40`,
            }}
          >
            Next
          </button>
          <button
            onClick={handleClearSelection}
            className="px-4 py-3 rounded-lg text-[13px] tracking-wider transition-colors"
            style={{ color: GRAY, background: "transparent", border: `1px solid ${BORDER}`, fontWeight: FW_LIGHT }}
          >
            CLEAR
          </button>
        </div>
      )}

      {longPressTarget && (
        <LongPressMenu
          target={longPressTarget}
          onClose={() => setLongPressTarget(null)}
          onTradeSingle={() => handleQuickTrade(longPressTarget.contract, longPressTarget.side, longPressTarget.type)}
          onAddToStrategy={() => handleToggleLeg(longPressTarget.contract, longPressTarget.type, longPressTarget.side === "SELL" ? "bid" : "ask")}
        />
      )}

      <ColumnsEditorModal open={columnsEditorOpen} onClose={() => setColumnsEditorOpen(false)} />
    </div>
  );
}
