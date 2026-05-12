import type { CSSProperties } from "react";
import type { ScannerCardData } from "@/lib/unifiedScanTypes";
import { cn } from "@/lib/utils";
import { getNextUsRegularSessionOpenEtIso } from "@/lib/usMarketHours";

export const SCANNER_V3_MUTED_SYMBOLS_KEY = "scanner_v3_muted_symbols";

export type ScannerV3MutedEntry = { symbol: string; mutedUntil: string };

const MONO =
  "'SFMono-Regular', 'SF Mono', ui-monospace, 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace";

export const scannerNumericFontStyle: CSSProperties = { fontFamily: MONO };

/** UI labels / event-type copy — Inter per scanner mockup (numerics use `scannerNumericFontStyle`). */
export const scannerSansFontStyle: CSSProperties = {
  fontFamily:
    "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif",
};

/**
 * UAI scanner mockup palette (mobile reference): discrete bull/bear, gold CTAs / mixed, orange urgency.
 * Tailwind class fragments (full literals) so JIT always emits utilities.
 */
export const scannerUiTw = {
  bull: "text-[#00C08B]",
  bear: "text-[#FF4D6D]",
  gold: "text-[#FFD100]",
  orange: "text-[#FFA500]",
  bgGold: "bg-[#FFD100]",
  bgOrange: "bg-[#FFA500]",
  bgBull: "bg-[#00C08B]",
  bgBear: "bg-[#FF4D6D]",
} as const;

/**
 * Collapsed scanner universe row layout: chevron column + flexible main column
 * (identity + price, UAI signal, compact context). Matches `ScannerLayer1ColumnHeader`.
 */
export const SCANNER_LAYER1_CARD_GRID_CLASS =
  "flex w-full min-w-0 items-stretch gap-2 bg-black px-3 py-2 text-sm tabular-nums";

/**
 * Urgency readout for collapsed-row bar (0–99). Prefers Layer-7 composite score when present;
 * otherwise a monotone blend of sweep/block density vs `events_today` (no randomness).
 */
export function scannerRowUrgencyScore(data: {
  score: number | null;
  flow: ScannerCardData["flow"];
}): number {
  const sc = data.score;
  if (sc != null && Number.isFinite(sc)) {
    return Math.min(99, Math.max(0, Math.round(sc)));
  }
  const f = data.flow;
  const et = f?.eventsToday ?? 0;
  if (et <= 0) return 0;
  const sweeps = f?.sweepCount ?? f?.sweeps4h ?? 0;
  const blocks = f?.blockCount ?? f?.blocks4h ?? 0;
  const density = (typeof sweeps === "number" ? sweeps : 0) + 0.5 * (typeof blocks === "number" ? blocks : 0);
  return Math.min(99, Math.max(12, Math.round(28 + (density / et) * 70)));
}

/** `$552k` / `$1.2M` style for mockup timeline + strike rows. */
export function formatNotionalTickerUi(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return dashCell();
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

export function dashCell(): string {
  return "-";
}

/** Layer 7 tier dot: green ≥70, amber 40–69, red below 40, zinc = null. */
export function scannerScoreTierDotClassName(
  score: number | null | undefined,
  size: "sm" | "md" = "md",
): string {
  const dim = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  const base = cn("inline-block shrink-0 rounded-full", dim);
  if (score == null || !Number.isFinite(score)) {
    return cn(base, "bg-zinc-600");
  }
  if (score >= 70) {
    return cn(
      base,
      "bg-emerald-400",
      size === "sm" ? "shadow-[0_0_4px_hsl(var(--terminal-success)/0.35)]" : "shadow-[0_0_6px_hsl(var(--terminal-success)/0.5)]",
    );
  }
  if (score >= 40) return cn(base, "bg-amber-400");
  return cn(base, "bg-red-400");
}

export function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dashCell();
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 52-week range cell: `$LOW – $HIGH` */
export function formatDollarRange(low: number | null | undefined, high: number | null | undefined): string {
  if (low == null || high == null || !Number.isFinite(low) || !Number.isFinite(high)) return dashCell();
  return `$${formatPrice(low)} – $${formatPrice(high)}`;
}

export function formatSignedMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dashCell();
  const sign = n >= 0 ? "+" : "−";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatSignedPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dashCell();
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export function formatCompactInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dashCell();
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `YYYY-MM-DD` → `Nov 14` (US-style short month, no year). */
export function formatShortMonthDay(ymd: string): string {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const mi = parseInt(m[2]!, 10) - 1;
  const day = parseInt(m[3]!, 10);
  if (mi < 0 || mi > 11 || day < 1 || day > 31) return ymd;
  return `${MONTHS_SHORT[mi]} ${day}`;
}

export function formatIvPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dashCell();
  return `${(n * 100).toFixed(1)}%`;
}

export function formatRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dashCell();
  return n.toFixed(2);
}

export function volumeVsAvgMultiplier(volume: number | null, avg: number | null): string {
  if (volume == null || avg == null || !Number.isFinite(volume) || !Number.isFinite(avg) || avg <= 0) {
    return dashCell();
  }
  return `${(volume / avg).toFixed(1)}×`;
}

/** Non-null multiplier string only when ratio is meaningful (> 0); hides "0.0×" and missing data. */
export function meaningfulVolVsAvgMultiplier(volume: number | null, avg: number | null): string | null {
  const s = volumeVsAvgMultiplier(volume, avg);
  if (s === dashCell()) return null;
  const n = parseFloat(s.replace(/×/g, "").replace(/x/gi, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return s;
}

export function readMutedSymbols(): ScannerV3MutedEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SCANNER_V3_MUTED_SYMBOLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const o = x as Record<string, unknown>;
        const symbol = typeof o.symbol === "string" ? o.symbol.trim().toUpperCase() : "";
        const mutedUntil = typeof o.mutedUntil === "string" ? o.mutedUntil : "";
        if (!symbol || !mutedUntil) return null;
        return { symbol, mutedUntil };
      })
      .filter((x): x is ScannerV3MutedEntry => x != null);
  } catch {
    return [];
  }
}

export function pruneAndFilterMutedSymbols(
  entries: ScannerV3MutedEntry[],
  nowMs: number,
): { activeMuted: Set<string>; pruned: ScannerV3MutedEntry[] } {
  const pruned = entries.filter((e) => {
    const t = Date.parse(e.mutedUntil);
    return Number.isFinite(t) && t > nowMs;
  });
  const activeMuted = new Set(pruned.map((e) => e.symbol));
  return { activeMuted, pruned };
}

export function persistMutedSymbols(entries: ScannerV3MutedEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCANNER_V3_MUTED_SYMBOLS_KEY, JSON.stringify(entries));
  } catch {
    /* ignore quota / private mode */
  }
}

export function muteSymbolForNextSession(symbol: string): void {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return;
  const until = getNextUsRegularSessionOpenEtIso();
  const existing = readMutedSymbols();
  const without = existing.filter((e) => e.symbol !== sym);
  persistMutedSymbols([...without, { symbol: sym, mutedUntil: until }]);
}

export function emptyScannerCardData(symbol: string): ScannerCardData {
  return {
    symbol,
    name: null,
    sector: null,
    price: null,
    changePct: null,
    changeAbs: null,
    volume: null,
    avgVolume20d: null,
    dayRange: null,
    iv30: null,
    ivr: null,
    ivPercentile: null,
    hv30: null,
    ivVsHv: null,
    termStructure: null,
    nextEarnings: null,
    nextExDiv: null,
    earningsHistory: null,
    flow: null,
    technical: null,
    score: null,
    scoreComponents: null,
    matchedPreset: null,
    lastUpdate: "",
    dataQualityFlags: [],
  };
}

export function catalystPillEligible(data: ScannerCardData): boolean {
  const d = data.nextEarnings?.daysTo;
  return d != null && Number.isFinite(d) && d <= 14;
}

export function catalystPillLabel(data: ScannerCardData): string | null {
  if (!catalystPillEligible(data)) return null;
  const d = data.nextEarnings!.daysTo;
  return `Earnings ${d}d`;
}
