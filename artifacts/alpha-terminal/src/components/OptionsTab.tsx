import { useState, useMemo, useEffect, useRef, useCallback, memo } from "react";
import { useTerminalStore } from "@/lib/store";
import { useActiveSymbol } from "@/components/dashboard/widgetSymbolContext";
import { ConnectBrokerPrompt } from "./ConnectBrokerPrompt";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useOptionsColumnsStore, COLUMN_REGISTRY, type ColumnDef } from "@/lib/options-columns-store";
import { useOptionTick, useOptionsStreamStore, type OptionTick } from "@/lib/options-stream-store";
import { useOptionTicksForKeys } from "@/lib/useOptionTicksForKeys";
import { useUICustomizationStore, ACCENT_COLORS } from "@/lib/ui-customization-store";

import { getGetOptionChainQueryOptions, useGetQuote, useGetOptionChain } from "@workspace/api-client-react";
import type { GetOptionChainParams, OptionChainResponse } from "@workspace/api-client-react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table2, ChevronDown, ChevronRight, X, Settings, GripVertical,
  Layers, TrendingUp, Plus, BarChart3,
} from "lucide-react";
import { Reorder } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { buildChainHoldSignature } from "@/lib/streamHoldSig";
import { useChainOptionHold } from "@/hooks/useChainOptionHold";
import {
  CHAIN_OTM_ROW_BG,
  STRIKE_COL_PAD_X,
  STRIKE_RAIL_LETTER_SPACING,
  STRIKE_RAIL_LINE_HEIGHT,
  strikeRailFontSize,
} from "@/lib/options/strikeColumnChrome";
import {
  AT_LADDER_PRICE_COLOR,
  AT_LADDER_PRICE_SIZE,
  AT_LADDER_PRICE_WEIGHT,
  AT_LADDER_STRIKE_BG,
  AT_LADDER_STRIKE_WEIGHT,
  AT_LADDER_THIN_SEP,
} from "@/lib/active-trader/atLadderLayout";
import {
  COL_W, STRIKE_W, ROW_H, TOOLBAR_H, HEADER_H, SUB_HEADER_H,
  BG, BG_HEADER, BG_EXP_BAR, BORDER, BORDER_ROW, GOLD, GOLD_DIM,
  UP, DOWN, WHITE, GRAY, DIM, MUTED, ITM_OCEAN, SEL_BORDER_COLOR,
  MONO, FW_LIGHT, FW_NORMAL, FW_PREMIUM, noScrollbar,
} from "@/components/options/optionsTheme";
import { ActiveTraderView, type AtExpirationGroup } from "@/components/active-trader/ActiveTraderView";
import { AtOrderDefaultsSheet } from "@/components/active-trader/AtOrderDefaultsSheet";
import {
  loadActiveTraderPrefs,
  saveActiveTraderPrefs,
  type ActiveTraderTemplatePrefs,
} from "@/lib/active-trader/activeTraderPrefs";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import {
  atChainDateWindow,
  optionsExpiryDiscoveryWindow,
} from "@/lib/active-trader/atLadderStrikeCount";
import { useOptionsExpiryStore } from "@/lib/options/optionsExpiryStore";
import {
  scrollViewportToNearestStrike,
  viewportNearestStrikeOffCenter,
} from "@/lib/active-trader/atLadderScroll";
import { SpotRecenterPill } from "@/components/options/SpotRecenterPill";
import {
  atLadderRestQuery,
  growAtLadderSide,
  mergeAtChainLegs,
  trimAtChainLegsToDepth,
  atLadderPlaceholderOk,
  type AtChainQueryParams,
} from "@/lib/active-trader/atLadderWindow";
import type { OptionsSubView } from "@/components/active-trader/OptionsSubViewToggle";
import { noteAtEntry } from "@/lib/active-trader/atInstrumentMode";
import {
  canAddChainDraftLeg,
  CHAIN_LEG_LIMIT_MESSAGE,
  CHAIN_MAX_DRAFT_LEGS,
} from "@/lib/orders/chainDraftLegLimits";
import { useChainDraftSessionStore, type ChainDraftSheetSession } from "@/lib/orders/chainDraftSessionStore";
import type { AtLadderLegPick } from "@/lib/active-trader/atLadderLegKeys";
import { getAtFixtureOverride } from "@/lib/active-trader/atFixtureBridge";
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import { formatAtExpiryPill } from "@/lib/active-trader/atExpiryPill";
import {
  expirationSeriesKey,
  occRoot,
  seriesRootFromExpiration,
  settlementForRoot,
  settlementFromExpiration,
} from "@/lib/active-trader/optionSeries";
import {
  filterAtExpiryPillGroups,
  nearestTradableExpiration,
} from "@/lib/optionsExpirationPick";
import { chainQuoteReasonLabel, resolveAtmStrike } from "@workspace/order-ticket-math";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import {
  OptionsChainOrderSheet,
  legsFromChainSelection,
  type StrategistSheetDispatchResult,
} from "@/components/OptionsChainOrderSheet";
import { getChainOrderFixtureOverride } from "@/lib/dev-only/chainOrderFixtureBridge";
import { getFuturesEsFixtureOverride } from "@/lib/dev-only/futuresEsFixtureBridge";
import {
  futuresChainPlaceholderPrimary,
  futuresChainPlaceholderSecondary,
  futuresRootForPlaceholder,
  isFuturesDisplaySymbol,
} from "@/lib/futuresSchwabUi";
import { optionChainMatchesActiveSymbol } from "@/lib/optionChainStaleGuard";
import { mergeChainContractWithStream, resolveChainDisplayQuote } from "@/lib/chainContractQuoteMerge";
import { useMinuteClock } from "@/lib/active-trader/useAtLadderQuote";
import { isAuthDisabled } from "@/lib/authMode";
import {
  hasSchwabBrokerageLinked,
  isServerHeldBrokerageSession,
  schwabAccessTokenForRequest,
} from "@/lib/schwabBrokerageSession";

const EPS = 0.0001;

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
  quoteTimeMs?: number;
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

interface OptionExpirationCatalogItem {
  expirationDate: string;
  daysToExpiration: number;
  expirationType?: string;
  standard?: boolean;
  settlementType?: string;
  optionRoots?: string;
}

interface OptionExpirationCatalogResponse {
  symbol: string;
  expirations: OptionExpirationCatalogItem[];
  fetchedAt?: number;
  error?: string;
}

interface ExpirationCatalogRow {
  expiration: string;
  dte: number;
  dateLabel: string;
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
  const base = !d ? expStr || "\u2014" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  const settlement = settlementFromExpiration(expStr);
  return settlement ? `${base} ${settlement}` : base;
}

/** Last Mon–Fri calendar day of the month. Month-end options expire that day, not the whole final week. */
function lastWeekdayOfMonth(year: number, month: number): number {
  const last = new Date(year, month + 1, 0, 12, 0, 0);
  const dow = last.getDay();
  if (dow === 0) last.setDate(last.getDate() - 2);
  else if (dow === 6) last.setDate(last.getDate() - 1);
  return last.getDate();
}

function getExpType(expStr: string): "Weekly" | "EOM" | "Quarterly" | null {
  const d = parseExpDate(expStr);
  if (!d) return null;
  const date = d.getDate();
  const month = d.getMonth();
  const dow = d.getDay();
  const isStandardMonthly = dow === 5 && date >= 15 && date <= 21;
  if (!isStandardMonthly && date === lastWeekdayOfMonth(d.getFullYear(), month)) {
    const isQuarterEnd = month === 2 || month === 5 || month === 8 || month === 11;
    return isQuarterEnd ? "Quarterly" : "EOM";
  }
  if (isStandardMonthly) return null;
  return "Weekly";
}

function buildExpirationCatalog(items: OptionExpirationCatalogItem[]): ExpirationCatalogRow[] {
  const rows = new Map<string, ExpirationCatalogRow>();
  for (const item of items) {
    const ymd = item.expirationDate.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    const roots = (item.optionRoots ?? "")
      .split(",")
      .map((root) => root.trim().replace(/^\./, "").toUpperCase())
      .filter(Boolean);
    const settlementRoots = [...new Set(roots.filter((root) => settlementForRoot(root) != null))];
    const keys = settlementRoots.length > 0
      ? settlementRoots.map((root) => `${ymd}~${root}`)
      : [ymd];
    for (const expiration of keys) {
      const dte = Math.max(0, Math.round(item.daysToExpiration));
      rows.set(expiration, {
        expiration,
        dte,
        dateLabel: formatExpDate(expiration),
      });
    }
  }
  return [...rows.values()].sort(
    (a, b) => a.dte - b.dte || a.expiration.localeCompare(b.expiration),
  );
}

function emptyExpirationGroup(row: ExpirationCatalogRow): ExpirationGroup {
  return {
    ...row,
    rows: [],
    totalStrikes: 0,
    expType: getExpType(row.expiration),
    atmIV: null,
    expectedMove: null,
    maxOI: 0,
    maxVol: 0,
    totalCallOI: 0,
    totalPutOI: 0,
    totalCallVol: 0,
    totalPutVol: 0,
    ivSkew: null,
  };
}

function putCallRatio(callVol: number, putVol: number, callOI: number, putOI: number): number | null {
  if (callVol > 0) return putVol / callVol;
  if (callOI > 0) return putOI / callOI;
  return null;
}

function findATMIndex(strikes: number[], lastPrice: number): number {
  if (strikes.length === 0) return -1;
  const atm = resolveAtmStrike(strikes, lastPrice);
  if (atm == null) return -1;
  return strikes.findIndex((s) => s === atm);
}

function normalizeStrike(v: number): number {
  return Math.round(v * 100) / 100;
}

function strikeKey(v: number): string {
  return normalizeStrike(v).toFixed(2);
}

function seriesBucketKey(c: Contract): string {
  const key = expirationSeriesKey(c.expiration, c.schwabSymbol || c.streamKey);
  if (seriesRootFromExpiration(key)) return key;
  const ymd = key.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : key;
}

function placeSeriesContract(c: Contract): Contract {
  const key = seriesBucketKey(c);
  return key === c.expiration ? c : { ...c, expiration: key };
}

/** Date plus optional OCC root from an expanded key such as 2026-11-20~SPXW. */
function expandedSeriesWindow(expiration: string): { ymd: string; series?: string } | null {
  const ymd = expiration.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const series = seriesRootFromExpiration(expiration);
  return { ymd, ...(series ? { series } : {}) };
}

type ExpiryChainParams = GetOptionChainParams & { series?: string };

type SeriesStrikeBook = { calls: Contract[]; puts: Contract[] };

export function buildExpirationGroups(
  calls: Contract[], puts: Contract[], lastPrice: number | null
): ExpirationGroup[] {
  const expMap = new Map<string, { calls: Map<string, Contract>; puts: Map<string, Contract>; dte: number }>();
  for (const raw of calls) {
    const c = placeSeriesContract(raw);
    if (!expMap.has(c.expiration)) expMap.set(c.expiration, { calls: new Map(), puts: new Map(), dte: c.dte ?? 0 });
    expMap.get(c.expiration)!.calls.set(strikeKey(c.strike), c);
  }
  for (const raw of puts) {
    const p = placeSeriesContract(raw);
    if (!expMap.has(p.expiration)) expMap.set(p.expiration, { calls: new Map(), puts: new Map(), dte: p.dte ?? 0 });
    expMap.get(p.expiration)!.puts.set(strikeKey(p.strike), p);
  }
  const groups: ExpirationGroup[] = [];
  for (const [exp, { calls: callMap, puts: putMap, dte }] of expMap) {
    const allStrikeKeys = [...new Set([...callMap.keys(), ...putMap.keys()])];
    const allStrikes = allStrikeKeys.map(k => parseFloat(k)).sort((a, b) => a - b);
    const totalStrikes = allStrikes.length;
    const atmIdx = lastPrice != null ? findATMIndex(allStrikes, lastPrice) : -1;
    const normalizedRows: NormalizedRow[] = allStrikes.map((strike) => ({
      strike, call: callMap.get(strikeKey(strike)) ?? null, put: putMap.get(strikeKey(strike)) ?? null,
    }));

    let atmIV: number | null = null;
    let expectedMove: number | null = null;
    if (atmIdx >= 0 && lastPrice != null) {
      const atmRow = normalizedRows[atmIdx];
      const callIV = atmRow?.call?.iv;
      const putIV = atmRow?.put?.iv;
      const ivValues = [callIV, putIV].filter((v): v is number => v != null && !isNaN(v) && v > 0);
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
        if (row.strike > lastPrice && row.call?.iv && row.call.iv > 0) otmCallIVs.push(row.call.iv);
        if (row.strike < lastPrice && row.put?.iv && row.put.iv > 0) otmPutIVs.push(row.put.iv);
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
  groups.sort((a, b) => a.dte - b.dte || a.expiration.localeCompare(b.expiration));
  return groups;
}

/** Replace one expanded series section. The rest of the expiry list stays. */
function overlayExpandedSeriesGroups(
  groups: ExpirationGroup[],
  books: Map<string, SeriesStrikeBook>,
  lastPrice: number | null,
): ExpirationGroup[] {
  if (books.size === 0) return groups;
  const merged = new Map(groups.map((group) => [group.expiration, group]));
  for (const [expiration, book] of books) {
    const rebuilt = buildExpirationGroups(book.calls, book.puts, lastPrice);
    const match = rebuilt.find((group) => group.expiration === expiration);
    if (match?.rows.length) merged.set(expiration, match);
  }
  return [...merged.values()].sort(
    (a, b) => a.dte - b.dte || a.expiration.localeCompare(b.expiration),
  );
}

/**
 * Expiration groups for the Active Trader ladder: strikes and contracts only.
 * `buildExpirationGroups` also derives ATM stats from the last price, so its
 * rows are new objects on every underlying tick; these are rebuilt only when
 * the chain itself changes, which lets the ladder skip those ticks entirely.
 */
export function buildAtLadderGroups(calls: Contract[], puts: Contract[]): AtExpirationGroup[] {
  const expMap = new Map<string, { calls: Map<string, Contract>; puts: Map<string, Contract>; dte: number }>();
  for (const raw of calls) {
    const c = placeSeriesContract(raw);
    if (!expMap.has(c.expiration)) expMap.set(c.expiration, { calls: new Map(), puts: new Map(), dte: c.dte ?? 0 });
    expMap.get(c.expiration)!.calls.set(strikeKey(c.strike), c);
  }
  for (const raw of puts) {
    const p = placeSeriesContract(raw);
    if (!expMap.has(p.expiration)) expMap.set(p.expiration, { calls: new Map(), puts: new Map(), dte: p.dte ?? 0 });
    expMap.get(p.expiration)!.puts.set(strikeKey(p.strike), p);
  }
  const groups: AtExpirationGroup[] = [];
  for (const [exp, { calls: callMap, puts: putMap, dte }] of expMap) {
    const strikes = [...new Set([...callMap.keys(), ...putMap.keys()])]
      .map((k) => parseFloat(k))
      .sort((a, b) => a - b);
    groups.push({
      expiration: exp,
      dte,
      dateLabel: formatExpDate(exp),
      rows: strikes.map((strike) => ({
        strike,
        call: callMap.get(strikeKey(strike)) ?? null,
        put: putMap.get(strikeKey(strike)) ?? null,
      })),
    });
  }
  groups.sort((a, b) => a.dte - b.dte || a.expiration.localeCompare(b.expiration));
  return groups;
}

function getContractVal(contract: Contract | null, key: string): number | undefined {
  if (!contract) return undefined;
  if (!(key in contract)) return undefined;
  const v = Reflect.get(contract, key);
  return typeof v === "number" && !isNaN(v) ? v : undefined;
}

function useStreamingExpirationStats(rows: NormalizedRow[], underlyingPrice: number | null) {
  const ticks = useOptionsStreamStore((s) => s.ticks);
  return useMemo(() => {
    let atmIV: number | null = null;
    let expectedMove: number | null = null;
    let maxOI = 0;
    let maxVol = 0;
    let totalCallOI = 0;
    let totalPutOI = 0;
    let totalCallVol = 0;
    let totalPutVol = 0;
    const dte = rows.length > 0 ? (rows[0].call?.dte ?? rows[0].put?.dte ?? 0) : 0;

    const strikes = rows.map(r => r.strike);
    const atmIdx = underlyingPrice != null ? findATMIndex(strikes, underlyingPrice) : -1;

    for (const row of rows) {
      const cTick = row.call?.streamKey ? ticks[row.call.streamKey] : undefined;
      const pTick = row.put?.streamKey ? ticks[row.put.streamKey] : undefined;
      const cOI = cTick?.openInterest ?? 0;
      const pOI = pTick?.openInterest ?? 0;
      const cVol = cTick?.volume ?? 0;
      const pVol = pTick?.volume ?? 0;
      maxOI = Math.max(maxOI, cOI, pOI);
      maxVol = Math.max(maxVol, cVol, pVol);
      totalCallOI += cOI;
      totalPutOI += pOI;
      totalCallVol += cVol;
      totalPutVol += pVol;
    }

    if (atmIdx >= 0 && underlyingPrice != null) {
      const atmRow = rows[atmIdx];
      const cTick = atmRow?.call?.streamKey ? ticks[atmRow.call.streamKey] : undefined;
      const pTick = atmRow?.put?.streamKey ? ticks[atmRow.put.streamKey] : undefined;
      const callIV = cTick?.iv;
      const putIV = pTick?.iv;
      const ivValues = [callIV, putIV].filter((v): v is number => v != null && !isNaN(v) && v > 0);
      if (ivValues.length > 0) {
        atmIV = ivValues.reduce((a, b) => a + b, 0) / ivValues.length;
        expectedMove = underlyingPrice * (atmIV / 100) * Math.sqrt(Math.max(dte, 1) / 365);
      }
    }

    const pcr = putCallRatio(totalCallVol, totalPutVol, totalCallOI, totalPutOI);

    return { atmIV, expectedMove, maxOI, maxVol, totalCallOI, totalPutOI, totalCallVol, totalPutVol, pcr };
  }, [rows, underlyingPrice, ticks]);
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

const STREAM_KEY_MAP: Record<string, string> = {
  bid: "bid", ask: "ask", last: "last",
  bidSize: "bidSize", askSize: "askSize",
  volume: "volume", openInterest: "openInterest",
  iv: "iv", delta: "delta", gamma: "gamma",
  theta: "theta", vega: "vega",
};

function getStreamVal(tick: OptionTick | undefined, key: string): number | undefined {
  if (!tick) return undefined;
  const mapped = STREAM_KEY_MAP[key];
  if (!mapped) return undefined;
  const v = tick[mapped as keyof OptionTick];
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
  return CHAIN_OTM_ROW_BG;
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
  col, contract, isSelected, onSelect, onLongPress, showInlineGreeks, maxOI, moneyness, chainQuoteTs,
}: {
  col: ColumnDef;
  contract: Contract | null;
  isSelected?: boolean;
  onSelect?: () => void;
  onLongPress?: (e: React.PointerEvent) => void;
  showInlineGreeks?: boolean;
  maxOI?: number;
  moneyness?: Moneyness;
  chainQuoteTs: number;
}) {
  const tick = useOptionTick(contract?.streamKey);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const didSwipe = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_THRESHOLD = 10;

  const isBid = col.id === "bid";
  const isAsk = col.id === "ask";
  const isPrice = isBid || isAsk;
  const paired = isPrice
    ? resolveChainDisplayQuote(contract, tick, chainQuoteTs)
    : null;
  const topVal =
    isPrice && paired
      ? col.id === "bid"
        ? paired.bid
        : paired.ask
      : getStreamVal(tick, col.topKey) ?? getContractVal(contract, col.topKey);
  const priceTapable =
    !isPrice ||
    (isBid ? (paired?.bidTapable ?? false) : (paired?.askTapable ?? false));
  const bottomVal = col.bottomKey
    ? (getStreamVal(tick, col.bottomKey) ?? getContractVal(contract, col.bottomKey))
    : undefined;
  const priceReason =
    isPrice && paired?.displayState && paired.displayState !== "ok" && paired.displayState !== "prior_session"
      ? chainQuoteReasonLabel(paired.displayState)
      : null;
  const priceDimmed = isPrice && paired?.dimmed;
  const asOfLabel = isPrice && isBid ? paired?.asOfLabel : null;
  const priceLocked = isPrice && paired?.locked;
  const showLockedFlag = isPrice && isBid && priceLocked;
  const topStr =
    isPrice && topVal == null && priceReason
      ? priceReason
      : fmtNum(topVal, col.topDecimals);
  const showPriceReason = isPrice && topVal != null ? priceReason : null;
  const isOI = col.id === "oi";
  const isVol = col.id === "vol";
  const oiVal = isVol ? getContractVal(contract, "openInterest") : undefined;
  const isGreek = col.group === "Greeks";
  const isIV = col.id === "iv";
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
    if (!didLongPress.current && !didSwipe.current && onSelect && priceTapable) onSelect();
    startPos.current = null;
  }, [onSelect, priceTapable]);

  const handlePointerLeave = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    startPos.current = null;
  }, []);

  let textColor: string;
  if (isPrice) {
    textColor = AT_LADDER_PRICE_COLOR;
  } else if (topStr === "\u2014") {
    textColor = MUTED;
  } else {
    textColor = WHITE;
  }

  const oiValue = isOI ? topVal : undefined;

  const inner = (
    <div
      className="flex flex-col justify-center overflow-hidden"
      style={{
        height: ROW_H,
        minHeight: ROW_H,
        padding: isBid ? "0 2px 0 8px" : "0 2px",
        boxSizing: "border-box",
      }}
    >
      <span
        className="leading-none"
        data-ui-audit={isPrice ? "chain-bid-cell" : undefined}
        data-chain-quote-reason={priceReason ?? undefined}
        style={{
          fontSize: isPrice ? AT_LADDER_PRICE_SIZE : 12,
          fontWeight: isPrice ? AT_LADDER_PRICE_WEIGHT : FW_LIGHT,
          color: textColor,
          opacity: isPrice && priceDimmed ? 0.72 : 1,
          fontVariantNumeric: "tabular-nums",
          ...(isPrice
            ? {
                letterSpacing: STRIKE_RAIL_LETTER_SPACING,
                lineHeight: STRIKE_RAIL_LINE_HEIGHT,
              }
            : { fontFamily: MONO }),
        }}
        data-chain-quote-as-of={asOfLabel ?? undefined}
        data-chain-quote-locked={showLockedFlag ? "1" : undefined}
      >
        {isVol || isOI ? fmtCompact(topVal) : topStr}
        {isIV && topStr !== "\u2014" ? "%" : ""}
      </span>
      {asOfLabel ? (
        <span
          title={asOfLabel}
          style={{
            fontSize: 8,
            color: MUTED,
            lineHeight: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          stale
        </span>
      ) : null}
      {showPriceReason ? (
        <span style={{ fontSize: 8, color: MUTED, lineHeight: 1.1 }}>{showPriceReason}</span>
      ) : null}
      {showLockedFlag ? (
        <span style={{ fontSize: 7, fontWeight: 600, color: MUTED, opacity: 0.85, letterSpacing: "0.04em" }}>Locked</span>
      ) : null}

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
          style={{ fontSize: 9, color: DIM, fontVariantNumeric: "tabular-nums", fontFamily: MONO, fontWeight: FW_LIGHT }}
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
        aria-label={`${isBid ? "Bid" : "Ask"} ${topStr} strike ${contract.strike}${asOfLabel ? `, ${asOfLabel}` : ""}`}
        title={asOfLabel ?? undefined}
        className="at-ladder-num w-full text-left cursor-pointer select-none relative"
        style={{ fontVariantNumeric: "tabular-nums", outline: isSelected ? "2px solid #ffffff" : "none", outlineOffset: -1 }}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      className={isPrice ? "at-ladder-num relative" : "relative"}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {inner}
    </div>
  );
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
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-white/5 transition-colors">
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
                      type="button"
                      aria-label={`${col.label} column, on`}
                      aria-pressed={true}
                      onClick={(e) => { e.stopPropagation(); toggleColumn(id); setLocalOrder(prev => prev.filter(x => x !== id)); }}
                      className="flex items-center justify-center shrink-0"
                      style={{ minWidth: 44, minHeight: 44, background: "transparent" }}
                      disabled={activeColumnIds.length <= 1}
                    >
                      <span aria-hidden className="w-8 h-4 rounded-full flex items-center transition-colors justify-end" style={{ background: GOLD }}>
                        <span className="w-3.5 h-3.5 rounded-full bg-black mx-0.5" />
                      </span>
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
                    <div
                      key={col.id}
                      className="w-full flex items-center justify-between px-3 rounded-lg border"
                      style={{ background: "transparent", borderColor: "#1a1a1a", minHeight: 44 }}
                    >
                      <span className="text-[11px]" style={{ color: DIM, fontFamily: MONO, fontWeight: FW_LIGHT }}>{col.label}</span>
                      <button
                        type="button"
                        aria-label={`${col.label} column, off`}
                        aria-pressed={false}
                        onClick={() => { toggleColumn(col.id); setLocalOrder(prev => [...prev, col.id]); }}
                        className="flex items-center justify-center shrink-0"
                        style={{ minWidth: 44, minHeight: 44, background: "transparent" }}
                      >
                        <span aria-hidden className="w-8 h-4 rounded-full flex items-center transition-colors justify-start" style={{ background: "#1a1a1a" }}>
                          <span className="w-3.5 h-3.5 rounded-full mx-0.5" style={{ background: "#333" }} />
                        </span>
                      </button>
                    </div>
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

function MetricsStrip({ groups, lastPrice, earningsInfo, isFetching, hasData }: {
  groups: ExpirationGroup[];
  lastPrice: number | null;
  earningsInfo?: {
    earningsDate?: string | null;
    confirmed?: boolean;
    time?: string | null;
    epsEstimate?: string | null;
    epsPrior?: string | null;
    period?: string | null;
    periodYear?: number | null;
  };
  isFetching: boolean;
  hasData: boolean;
}) {
  const frontMonth = nearestTradableExpiration(groups) ?? (groups.length > 0 ? groups[0] : null);
  const frontStats = useStreamingExpirationStats(frontMonth?.rows ?? [], lastPrice);

  const ticks = useOptionsStreamStore((s) => s.ticks);
  const allRows = useMemo(() => groups.flatMap(g => g.rows), [groups]);
  let totalCallVol = 0;
  let totalPutVol = 0;
  let totalCallOI = 0;
  let totalPutOI = 0;
  for (const row of allRows) {
    const cTick = row.call?.streamKey ? ticks[row.call.streamKey] : undefined;
    const pTick = row.put?.streamKey ? ticks[row.put.streamKey] : undefined;
    totalCallVol += cTick?.volume ?? 0;
    totalPutVol += pTick?.volume ?? 0;
    totalCallOI += cTick?.openInterest ?? 0;
    totalPutOI += pTick?.openInterest ?? 0;
  }

  const atmIV = frontStats.atmIV;
  const expectedMove = frontStats.expectedMove;
  const pcr = totalCallVol > 0
    ? (totalPutVol / totalCallVol).toFixed(2)
    : totalCallOI > 0
      ? (totalPutOI / totalCallOI).toFixed(2)
      : "\u2014";

  const eDate = earningsInfo?.earningsDate;
  let earnDisplay = "\u2014";
  let earnColor = MUTED;
  let earnTooltip = "";
  if (eDate) {
    const d = new Date(eDate + "T00:00:00");
    if (!isNaN(d.getTime())) {
      const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
      const timeSuffix = earningsInfo?.time ? ` ${earningsInfo.time}` : "";
      earnDisplay = mmdd + timeSuffix;
      const now = new Date();
      const daysUntil = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil <= 7 && daysUntil >= 0) earnColor = GOLD;
      else if (daysUntil < 0) earnColor = DIM;
      else earnColor = WHITE;
      const parts: string[] = [];
      if (earningsInfo?.period && earningsInfo?.periodYear) parts.push(`${earningsInfo.period} ${earningsInfo.periodYear}`);
      if (earningsInfo?.confirmed) parts.push("Confirmed");
      else parts.push("Estimated");
      if (earningsInfo?.epsEstimate) parts.push(`EPS Est: $${earningsInfo.epsEstimate}`);
      if (earningsInfo?.epsPrior) parts.push(`EPS Prior: $${earningsInfo.epsPrior}`);
      if (daysUntil >= 0) parts.push(`${daysUntil}d away`);
      earnTooltip = parts.join(" \u2022 ");
    }
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
      <span title={earnTooltip}>
        <span style={{ color: DIM }}>ERN </span>
        <span style={{ color: earnColor, fontWeight: FW_LIGHT }}>{earnDisplay}</span>
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
        borderBottom: `1px solid ${AT_LADDER_THIN_SEP}`,
      }}
    >
      <span
        data-ui-audit="chain-strike-cell"
        style={{
          fontSize: strikeRailFontSize(strike),
          fontWeight: AT_LADDER_STRIKE_WEIGHT,
          color: WHITE,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: STRIKE_RAIL_LETTER_SPACING,
          lineHeight: STRIKE_RAIL_LINE_HEIGHT,
          padding: `0 ${STRIKE_COL_PAD_X}px`,
          width: "100%",
          whiteSpace: "nowrap",
          textAlign: "center",
          overflow: "visible",
        }}
      >
        {strike % 1 === 0 ? strike : strike.toFixed(1)}
      </span>
      {moneynessLabel && (
        <span style={{ fontSize: 9, fontWeight: FW_LIGHT, color: GRAY, fontFamily: MONO, lineHeight: 1, marginTop: 2 }}>
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
  colW = COL_W,
  chainQuoteTs,
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
  colW?: number;
  chainQuoteTs: number;
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

  const wingWidth = columns.length * colW;

  const callWingRef = useRef<HTMLDivElement>(null);
  const putWingRef = useRef<HTMLDivElement>(null);

  const atmLineTop = useMemo(() => {
    if (transitionIdx >= 0) return transitionIdx * ROW_H;
    if (priceAboveAll && sortedRows.length > 0) return sortedRows.length * ROW_H;
    return -1;
  }, [transitionIdx, priceAboveAll, sortedRows.length]);

  const wingScrollStyle: React.CSSProperties = {
    overflowX: "hidden",
    overflowY: "hidden",
    scrollbarWidth: "none" as React.CSSProperties["scrollbarWidth"],
    msOverflowStyle: "none",
    willChange: "transform",
  };

  return (
    <div>
      <div
        className="at-ladder-num"
        data-chain-ladder-grid
        style={{ display: "flex", fontVariantNumeric: "tabular-nums", position: "relative" }}
      >
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
                    data-chain-strike={row.strike}
                    className="flex"
                    style={{
                      height: ROW_H,
                      borderBottom: `1px solid ${BORDER_ROW}`,
                      background: bg,
                    }}
                  >
                    {columns.map(col => (
                      <div key={col.id} style={{ width: colW }} className="shrink-0">
                        <DataCell
                          col={col}
                          contract={row.call}
                          chainQuoteTs={chainQuoteTs}
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

        <div
          className="flex-none"
          style={{
            width: STRIKE_W,
            background: AT_LADDER_STRIKE_BG,
            borderLeft: `1px solid ${AT_LADDER_THIN_SEP}`,
            borderRight: `1px solid ${AT_LADDER_THIN_SEP}`,
            zIndex: 10,
            position: "relative",
          }}
        >
          {sortedRows.map((row) => (
            <div key={row.strike} data-chain-strike={row.strike} data-chain-strike-rail style={{ height: ROW_H }}>
              <StrikeCell strike={row.strike} underlyingPrice={underlyingPrice} />
            </div>
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
                    }}
                  >
                    {columns.map(col => (
                      <div key={col.id} style={{ width: colW }} className="shrink-0">
                        <DataCell
                          col={col}
                          contract={row.put}
                          chainQuoteTs={chainQuoteTs}
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

function ExpirationSection({
  group, isOpen, onToggle, stickyTop, underlyingPrice,
  activeColumns, showCalls, showPuts, selectedLegs,
  onToggleLeg, onLongPressCell, showInlineGreeks, accentHex, colW = COL_W, chainQuoteTs,
}: {
  group: ExpirationGroup;
  isOpen: boolean;
  onToggle: () => void;
  stickyTop: number;
  underlyingPrice: number | null;
  activeColumns: ColumnDef[];
  showCalls: boolean;
  showPuts: boolean;
  selectedLegs: Map<string, SelectedLeg>;
  onToggleLeg: (contract: Contract, type: "CALL" | "PUT", side: "bid" | "ask") => void;
  onLongPressCell: (target: LongPressTarget) => void;
  showInlineGreeks: boolean;
  accentHex: string;
  colW?: number;
  chainQuoteTs: number;
}) {
  const live = useStreamingExpirationStats(group.rows, underlyingPrice);
  // Live ticks cover the expanded expiration. Collapsed rows still have the
  // chain snapshot (IV, volume, OI) on the group — show that until ticks arrive.
  const atmIV = live.atmIV ?? group.atmIV;
  const pcr = live.pcr ?? putCallRatio(group.totalCallVol, group.totalPutVol, group.totalCallOI, group.totalPutOI);
  const panelId = `options-exp-panel-${group.expiration.replace(/[^a-zA-Z0-9]/g, "-")}`;

  return (
    <div>
      <button
        type="button"
        data-ui-audit="chain-exp-btn"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="w-full flex items-center justify-between px-3 py-1 transition-colors sticky z-20"
        style={{
          top: stickyTop,
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
          {atmIV != null && (
            <span style={{ color: GOLD, fontWeight: FW_PREMIUM }}>
              IV {atmIV.toFixed(1)}%
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
        <div id={panelId}>
        <OptionsGrid
          rows={group.rows}
          underlyingPrice={underlyingPrice}
          columns={activeColumns}
          showCalls={showCalls}
          showPuts={showPuts}
          selectedLegs={selectedLegs}
          onToggleLeg={onToggleLeg}
          onLongPressCell={onLongPressCell}
          showInlineGreeks={showInlineGreeks}
          maxOI={live.maxOI || group.maxOI}
          accentHex={accentHex}
          colW={colW}
          chainQuoteTs={chainQuoteTs}
        />
        </div>
      )}
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
  colW = COL_W,
}: {
  showCalls: boolean;
  showPuts: boolean;
  columns: ColumnDef[];
  stickyTop: number;
  onColumnsEditor: () => void;
  onBuildStrategy?: () => void;
  colW?: number;
}) {
  const wingWidth = columns.length * colW;

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
            <span data-ui-audit="chain-calls-hdr" style={{ fontSize: 12, letterSpacing: "0.08em", color: GRAY, fontFamily: MONO, fontWeight: FW_PREMIUM }}>CALLS</span>
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
                <div key={col.id} style={{ width: colW, flexShrink: 0, padding: "0 4px" }}>
                  <span style={{ fontSize: 11, color: DIM, fontFamily: MONO, fontWeight: FW_NORMAL, textTransform: "uppercase", letterSpacing: "0.08em" }}>{col.topLabel}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ width: STRIKE_W, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", borderLeft: `1px solid ${BORDER}`, borderRight: `1px solid ${BORDER}`, background: "#111111" }}>
          <span data-ui-audit="chain-strike-hdr" style={{ fontSize: 9, color: WHITE, fontFamily: MONO, fontWeight: FW_PREMIUM, letterSpacing: "0.08em" }}>STRIKE</span>
        </div>
        {showPuts && (
          <div style={{ flex: 1, overflow: "hidden", height: SUB_HEADER_H }}>
            <div style={{ display: "flex", alignItems: "center", minWidth: wingWidth, height: SUB_HEADER_H }}>
              {columns.map(col => (
                <div key={col.id} style={{ width: colW, flexShrink: 0, padding: "0 4px" }}>
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

function seriesStrikeBooks(
  windows: { expiration: string }[],
  payloads: (OptionChainResponse | undefined)[],
  symbol: string,
): Map<string, SeriesStrikeBook> {
  const books = new Map<string, SeriesStrikeBook>();
  windows.forEach((window, i) => {
    const payload = payloads[i];
    if (!payload || !optionChainMatchesActiveSymbol(payload.symbol, symbol)) return;
    const calls = [...((payload.calls ?? []) as Contract[])];
    const puts = [...((payload.puts ?? []) as Contract[])];
    if (calls.length + puts.length === 0) return;
    calls.forEach((c) => assignStreamKey(c, "C", symbol));
    puts.forEach((c) => assignStreamKey(c, "P", symbol));
    books.set(window.expiration, { calls, puts });
  });
  return books;
}

function assignStreamKey(c: Contract, right: "C" | "P", underlying: string): void {
  const explicit = c.schwabSymbol?.trim();
  if (explicit) {
    c.streamKey = explicit;
    return;
  }
  const root = seriesRootFromExpiration(seriesBucketKey(c)) ?? underlying.replace(/^\$/, "");
  c.streamKey = buildSchwabOptionKey(root, c.expiration, c.strike, right);
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

/** Least time between re-centering fetches when the underlying has run away from the loaded strikes. */
const CHAIN_REANCHOR_MIN_MS = 5_000;

/** The chain order sheet re-prices from its legs' live quotes at most this often. */
const CHAIN_TICKET_TICK_MS = 150;

interface OptionsTabProps {
  subscribeOptionSymbols?: (
    symbols: string[],
    opts?: {
      purpose?: string;
      viewId?: string;
      holderId?: string;
      underlyingPrice?: number;
      isAborted?: () => boolean;
    },
  ) => Promise<string | void>;
  releaseOptionHold?: (holderId: string) => Promise<void>;
  stickyOffset?: number;
  onTradeSingle?: (contract: Contract, side: "BUY" | "SELL", type: "CALL" | "PUT") => void;
  onOpenStrategyBuilder?: (strikes: number[], expirations: { label: string; value: string }[], chainData: Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number; contractTs?: number; quoteTimeMs?: number }>, preSelectedLegs?: { contract: Contract; type: "CALL" | "PUT"; side?: "bid" | "ask" }[]) => void;
  onActiveTraderReview?: (contract: Contract, side: "BUY" | "SELL", type: "CALL" | "PUT") => void;
  onSendToStrategist?: (ticker?: string) => void;
}

export type { Contract as OptionsContract };

export function OptionsTab({
  subscribeOptionSymbols,
  releaseOptionHold,
  stickyOffset = 0,
  onTradeSingle,
  onOpenStrategyBuilder,
  onActiveTraderReview,
  onSendToStrategist,
}: OptionsTabProps) {
  const atFixtureOverride = import.meta.env.DEV ? getAtFixtureOverride() : null;
  const chainFixtureOverride = import.meta.env.DEV ? getChainOrderFixtureOverride() : null;
  const futuresEsFixture = import.meta.env.DEV ? getFuturesEsFixtureOverride() : null;
  const futuresEsFixtureChain = futuresEsFixture
    ? { chain: futuresEsFixture.chain, underlyingPrice: futuresEsFixture.underlyingPrice }
    : null;
  const fixtureChain = atFixtureOverride ?? chainFixtureOverride ?? futuresEsFixtureChain;
  const [optionsSubView, setOptionsSubView] = useState<OptionsSubView>(() => {
    const fixtureView = atFixtureOverride?.initialSubView ?? futuresEsFixture?.initialSubView;
    if (fixtureView) return fixtureView;
    const api = useAtChromeStore as unknown as {
      getState?: () => {
        requestedSubView?: "at" | "chain" | null;
        subViewIsAt?: boolean;
      };
    };
    const state = api.getState?.();
    const requested = state?.requestedSubView;
    if (requested === "at" || requested === "chain") {
      return requested;
    }
    if (state?.subViewIsAt) return "at";
    return "chain";
  });
  const enterActiveTrader = useAtChromeStore((s) => s.enterActiveTrader);
  const leaveActiveTrader = useAtChromeStore((s) => s.leaveActiveTrader);
  const setAtExpiryChrome = useAtChromeStore((s) => s.setAtExpiryChrome);
  const clearAtExpiryChrome = useAtChromeStore((s) => s.clearAtExpiryChrome);
  const requestedSubView = useAtChromeStore((s) => s.requestedSubView);
  const consumeRequestedSubView = useAtChromeStore((s) => s.consumeRequestedSubView);
  const expiryClockMinute = useMinuteClock();
  const expiryNowMs = expiryClockMinute * 60_000;
  const { accessToken, traderAccessToken } = useTerminalStore(
    useShallow((s) => ({ accessToken: s.accessToken, traderAccessToken: s.traderAccessToken })),
  );
  // Widget pin wins inside the dashboard; global symbol everywhere else.
  const symbol = useActiveSymbol();
  const atEntryViewRef = useRef(optionsSubView);
  atEntryViewRef.current = optionsSubView;
  useEffect(() => {
    if (requestedSubView !== "at" && requestedSubView !== "chain") return;
    if (requestedSubView === "at") {
      noteAtEntry(symbol, atEntryViewRef.current === "chain");
    }
    setOptionsSubView(requestedSubView);
    consumeRequestedSubView?.();
  }, [requestedSubView, consumeRequestedSubView, symbol]);
  useEffect(() => {
    if (optionsSubView === "at") {
      enterActiveTrader();
    } else {
      leaveActiveTrader();
    }
    return () => leaveActiveTrader();
  }, [optionsSubView, enterActiveTrader, leaveActiveTrader]);
  const [atExpiration, setAtExpirationState] = useState<string | null>(() =>
    useOptionsExpiryStore.getState().getSelected(symbol),
  );
  const setAtExpiration = useCallback(
    (exp: string | null) => {
      setAtExpirationState(exp);
      if (exp) useOptionsExpiryStore.getState().setSelected(symbol, exp);
    },
    [symbol],
  );
  const isFuturesSymbol = isFuturesDisplaySymbol(symbol);
  const { contractType, strikeCount, setCustomStrikeInput } = useOptionsSettingsStore();
  const setStrikeCount = useOptionsSettingsStore(s => s.setStrikeCount);
  const { activeColumnIds } = useOptionsColumnsStore();
  const accentKey = useUICustomizationStore(s => s.accentColor);
  const accentHex = ACCENT_COLORS[accentKey];
  const [columnsEditorOpen, setColumnsEditorOpen] = useState(false);
  const hydratedDraft = useMemo(() => {
    const d = useChainDraftSessionStore.getState();
    if (d.symbol !== symbol || d.selectedLegs.length === 0) return null;
    return d;
  }, [symbol]);
  const [selectedLegs, setSelectedLegs] = useState<Map<string, SelectedLeg>>(() => {
    if (!hydratedDraft) return new Map();
    const m = new Map<string, SelectedLeg>();
    for (const leg of hydratedDraft.selectedLegs) {
      m.set(leg.key, {
        contract: leg.contract as unknown as Contract,
        type: leg.type,
        expiration: leg.expiration,
        side: leg.side,
      });
    }
    return m;
  });
  const [showInlineGreeks, setShowInlineGreeks] = useState(false);
  const [longPressTarget, setLongPressTarget] = useState<LongPressTarget | null>(null);
  const [legLimitRejected, setLegLimitRejected] = useState(false);
  const [chainTicketOpen, setChainTicketOpen] = useState(() => hydratedDraft?.chainTicketOpen ?? false);
  const [sheetCollapsed, setSheetCollapsed] = useState(() => hydratedDraft?.sheetCollapsed ?? false);
  const [chainSheetPeek, setChainSheetPeek] = useState(false);
  const chainOrderSymbolClass = symbol.toUpperCase().includes("SPX") || symbol.startsWith("$") ? "index" : "equity";
  const [chainOrderPrefs, setChainOrderPrefs] = useState<ActiveTraderTemplatePrefs>(() =>
    loadActiveTraderPrefs(symbol.toUpperCase().includes("SPX") || symbol.startsWith("$") ? "index" : "equity"),
  );
  const [chainDefaultsOpen, setChainDefaultsOpen] = useState(false);
  const [chainDefaultsWindowSec, setChainDefaultsWindowSec] = useState<30 | 60 | 300>(30);
  useEffect(() => {
    setChainOrderPrefs(loadActiveTraderPrefs(chainOrderSymbolClass));
  }, [chainOrderSymbolClass]);
  const [chainSheetPad, setChainSheetPad] = useState(0);
  const chainSheetObserverRef = useRef<ResizeObserver | null>(null);
  const chainSheetRef = useCallback((node: HTMLDivElement | null) => {
    chainSheetObserverRef.current?.disconnect();
    chainSheetObserverRef.current = null;
    if (!node) {
      setChainSheetPad(0);
      return;
    }
    const sync = () => setChainSheetPad(Math.ceil(node.getBoundingClientRect().height));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(node);
    chainSheetObserverRef.current = ro;
  }, []);
  const [legQuantities, setLegQuantities] = useState<Map<string, number>>(() => {
    if (!hydratedDraft) return new Map();
    return new Map(Object.entries(hydratedDraft.legQuantities));
  });
  const legLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainScrollRef = useRef<HTMLDivElement>(null);
  const accounts = useSchwabAccountStore((s) => s.accounts);
  const tradingAccountHash = useSchwabAccountStore((s) => s.tradingAccountHash());
  const MAX_OPTION_LEGS = CHAIN_MAX_DRAFT_LEGS;
  const activeColumns = useMemo(
    () => activeColumnIds.map(id => COLUMN_REGISTRY.find(c => c.id === id)).filter(Boolean) as ColumnDef[],
    [activeColumnIds]
  );
  const CHAIN_COL_W = 62;
  const chainPriceColumns = useMemo(() => {
    const want = new Set(["bid", "ask", "vol"]);
    const cols = activeColumns.filter((c) => want.has(c.id));
    if (cols.length >= 2) return cols;
    return (["bid", "ask", "vol"] as const)
      .map((id) => COLUMN_REGISTRY.find((c) => c.id === id))
      .filter(Boolean) as ColumnDef[];
  }, [activeColumns]);

  const [expandedExps, setExpandedExps] = useState<Set<string>>(new Set());
  const [isCustomMode, setIsCustomMode] = useState(() => ![6, 10, 20].includes(strikeCount));
  const [localCustomValue, setLocalCustomValue] = useState(String(strikeCount));
  const strikeMode = useMemo(() => {
    if ([6, 10, 20].includes(strikeCount)) return String(strikeCount);
    return "custom";
  }, [strikeCount]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customStrikeGenRef = useRef(0);

  const [atDepth, setAtDepth] = useState({ above: 20, below: 20 });
  const atBookRef = useRef<{ symbol: string; ymd: string | null; series: string | null; calls: Contract[]; puts: Contract[] } | null>(null);
  useEffect(() => {
    setAtDepth({ above: 20, below: 20 });
    atBookRef.current = null;
  }, [symbol, atExpiration]);
  const atGrowAtRef = useRef({ up: 0, down: 0 });
  const growAtStrikeWindow = useCallback((edge: "up" | "down") => {
    const now = Date.now();
    if (now - atGrowAtRef.current[edge] < 700) return;
    atGrowAtRef.current[edge] = now;
    setAtDepth((d) => growAtLadderSide(d.above, d.below, edge));
  }, []);

  const atRest = useMemo(
    () => atLadderRestQuery(atDepth.above, atDepth.below),
    [atDepth.above, atDepth.below],
  );
  const atDates = useMemo(
    () =>
      atExpiration
        ? atChainDateWindow(atExpiration)
        : optionsExpiryDiscoveryWindow(),
    [atExpiration, expiryClockMinute],
  );
  const atSeriesRoot = seriesRootFromExpiration(atExpiration ?? "");

  const schwabLinked =
    hasSchwabBrokerageLinked(accessToken, traderAccessToken) ||
    isServerHeldBrokerageSession(accessToken, traderAccessToken);
  /** Fetch whenever a symbol is set — API uses query token or server-stored Schwab session. */
  const chainApiEnabled = !!symbol && !fixtureChain;

  const {
    data: expirationCatalogRaw,
    isLoading: expirationCatalogLoading,
  } = useQuery<OptionExpirationCatalogResponse>({
    queryKey: ["option-expiration-catalog", symbol],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ symbol });
      const schwabToken = schwabAccessTokenForRequest(accessToken);
      if (schwabToken) params.set("accessToken", schwabToken);
      const response = await fetchWithAuth(
        `/api/market/options/expirations?${params.toString()}`,
        { signal },
      );
      if (!response.ok) throw new Error(`Expiration catalog failed (${response.status})`);
      return response.json() as Promise<OptionExpirationCatalogResponse>;
    },
    enabled: chainApiEnabled && !isFuturesSymbol,
    staleTime: 15 * 60_000,
    gcTime: 60 * 60_000,
    retry: 2,
  });

  const optionChainParams = useMemo(
    () => ({
      symbol,
      contractType: "ALL" as const,
      strikeCount:
        atExpiration == null
          ? 1
          : optionsSubView === "at"
            ? atRest.strikeCount
            : strikeCount,
      ...(optionsSubView === "at" ? { range: atRest.range } : {}),
      ...(atDates ?? {}),
      ...(atSeriesRoot ? { series: atSeriesRoot } : {}),
      ...(schwabAccessTokenForRequest(accessToken)
        ? { accessToken: schwabAccessTokenForRequest(accessToken)! }
        : {}),
    }),
    [symbol, strikeCount, accessToken, atDates, atSeriesRoot, atRest.range, atRest.strikeCount, optionsSubView, atExpiration],
  );

  const { data: rawData, isLoading, error, isFetching, dataUpdatedAt, refetch: refetchOptionChain } =
    useGetOptionChain<OptionChainResponse>(optionChainParams, {
      query: {
        enabled: chainApiEnabled,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: isFuturesSymbol ? false : 2,
        placeholderData: (
          previous: OptionChainResponse | undefined,
          previousQuery?: { queryKey: readonly unknown[] },
        ) => {
          if (!previous) return undefined;
          const previousParams = previousQuery?.queryKey?.[1] as AtChainQueryParams | undefined;
          if (optionsSubView === "at") {
            // The ladder shows its own strike window or a loading state, never the Chain view's list.
            if (!atLadderPlaceholderOk(previousParams, { symbol, ...atDates, series: atSeriesRoot })) return undefined;
          } else if (
            previousParams?.symbol !== symbol ||
            previousParams.fromDate !== atDates.fromDate ||
            previousParams.toDate !== atDates.toDate ||
            (previousParams.series ?? "") !== (atSeriesRoot ?? "")
          ) {
            return undefined;
          }
          return previous;
        },
      },
    });

  useEffect(() => {
    if (optionsSubView !== "at" || fixtureChain || !chainApiEnabled) return;
    // Join a request that is already in flight for this window instead of cancelling and re-sending it.
    void refetchOptionChain({ cancelRefetch: false });
  }, [optionsSubView, fixtureChain, chainApiEnabled, refetchOptionChain]);

  const chainFetchedAt =
    rawData?.fetchedAt && rawData.fetchedAt > 0
      ? rawData.fetchedAt
      : dataUpdatedAt > 0
        ? dataUpdatedAt
        : Date.now();

  const data = useMemo(() => {
    if (fixtureChain) {
      let calls = (fixtureChain.chain.calls ?? []) as Contract[];
      let puts = (fixtureChain.chain.puts ?? []) as Contract[];
      if (contractType === "CALL") puts = [];
      else if (contractType === "PUT") calls = [];
      return { ...fixtureChain.chain, calls, puts, underlyingPrice: fixtureChain.underlyingPrice };
    }
    if (!rawData) return rawData;
    if (!optionChainMatchesActiveSymbol(rawData.symbol, symbol)) {
      return undefined;
    }
    let calls = (rawData.calls ?? []) as Contract[];
    let puts = (rawData.puts ?? []) as Contract[];
    if (optionsSubView === "at") {
      const ymd = atExpiration?.slice(0, 10) || null;
      const series = seriesRootFromExpiration(atExpiration ?? "");
      const pageHasYmd =
        !ymd ||
        [...calls, ...puts].some((c) => (c.expiration ?? "").slice(0, 10) === ymd);
      const pageHasSeries =
        !series ||
        [...calls, ...puts].some((c) => (occRoot(c.schwabSymbol) ?? occRoot(c.streamKey)) === series);
      const pageOk = pageHasYmd && pageHasSeries;
      const prev = atBookRef.current;
      const same = !!prev && prev.symbol === symbol && prev.ymd === ymd && prev.series === series;
      const mergedCalls = pageOk
        ? mergeAtChainLegs(same ? prev!.calls : [], calls, ymd, series)
        : same
          ? prev!.calls
          : [];
      const mergedPuts = pageOk
        ? mergeAtChainLegs(same ? prev!.puts : [], puts, ymd, series)
        : same
          ? prev!.puts
          : [];
      atBookRef.current = { symbol, ymd, series, calls: mergedCalls, puts: mergedPuts };
      const trimSpot = rawData.underlyingPrice ?? null;
      calls = trimAtChainLegsToDepth(mergedCalls, trimSpot, atDepth.above, atDepth.below);
      puts = trimAtChainLegsToDepth(mergedPuts, trimSpot, atDepth.above, atDepth.below);
    }
    if (contractType === "CALL") puts = [];
    else if (contractType === "PUT") calls = [];
    return { ...rawData, calls, puts };
  }, [rawData, contractType, fixtureChain, futuresEsFixture, symbol, optionsSubView, atExpiration, atDepth.above, atDepth.below]);

  const isLoadingEffective = fixtureChain ? false : isLoading || expirationCatalogLoading;

  const streamQuote = useTerminalStore((s) => {
    const u = symbol.toUpperCase();
    const alt = u.startsWith("$") ? u.slice(1) : `$${u}`;
    return s.streamPrices[u] ?? s.streamPrices[alt];
  });

  const { data: quote } = useGetQuote(
    { symbol, ...(schwabAccessTokenForRequest(accessToken) ? { accessToken: schwabAccessTokenForRequest(accessToken)! } : {}) },
    { query: { enabled: chainApiEnabled } },
  );

  const { data: earningsData } = useQuery({
    queryKey: ["earnings-date", symbol],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/market/earnings-date?symbol=${encodeURIComponent(symbol)}`);
      return res.json() as Promise<{
        earningsDate?: string | null;
        confirmed?: boolean;
        time?: string | null;
        epsEstimate?: string | null;
        epsPrior?: string | null;
        revenueEstimate?: string | null;
        revenuePrior?: string | null;
        period?: string | null;
        periodYear?: number | null;
        source?: string | null;
      }>;
    },
    enabled: !!symbol,
    staleTime: 30 * 60 * 1000,
  });

  const underlyingPrice =
    streamQuote?.last ??
    streamQuote?.regularLast ??
    streamQuote?.extendedLast ??
    quote?.last ??
    data?.underlyingPrice ??
    null;

  const chainAnchorPx = rawData?.underlyingPrice ?? null;
  const queryClient = useQueryClient();
  const expandedChainWindows = useMemo(() => {
    if (optionsSubView !== "chain" || fixtureChain) return [];
    const token = schwabAccessTokenForRequest(accessToken);
    const windows: { expiration: string; params: ExpiryChainParams }[] = [];
    for (const expiration of [...expandedExps].sort()) {
      const parsed = expandedSeriesWindow(expiration);
      if (!parsed) continue;
      windows.push({
        expiration,
        params: {
          symbol,
          contractType: "ALL",
          strikeCount,
          fromDate: parsed.ymd,
          toDate: parsed.ymd,
          ...(parsed.series ? { series: parsed.series } : {}),
          ...(token ? { accessToken: token } : {}),
        },
      });
    }
    return windows;
  }, [optionsSubView, fixtureChain, symbol, accessToken, expandedExps, strikeCount]);
  const expandedChainQueries = useQueries({
    queries: expandedChainWindows.map((window) =>
      getGetOptionChainQueryOptions(window.params, {
        query: {
          enabled: chainApiEnabled,
          staleTime: 30_000,
          gcTime: 5 * 60_000,
          retry: 2,
        },
      }),
    ),
  });
  const expandedChainWindowsRef = useRef(expandedChainWindows);
  expandedChainWindowsRef.current = expandedChainWindows;
  const expandedChainStamp = expandedChainWindows
    .map((window, i) => `${window.expiration}:${expandedChainQueries[i]?.dataUpdatedAt ?? 0}`)
    .join("|");
  const expandedChainBooks = useMemo(
    () => seriesStrikeBooks(
      expandedChainWindows,
      expandedChainQueries.map((query) => query.data),
      symbol,
    ),
    [expandedChainStamp, expandedChainWindows, symbol],
  );
  const lastReanchorAtRef = useRef(0);
  useEffect(() => {
    if (fixtureChain || underlyingPrice == null || chainAnchorPx == null) return;
    if (Math.abs(chainAnchorPx - underlyingPrice) < 25) return;
    // This runs on every underlying tick while the chain is off-center. A plain
    // refetch() cancels the request in flight; called per tick, none would finish.
    const now = Date.now();
    if (now - lastReanchorAtRef.current < CHAIN_REANCHOR_MIN_MS) return;
    lastReanchorAtRef.current = now;
    void refetchOptionChain({ cancelRefetch: false });
    const windows = expandedChainWindowsRef.current;
    if (windows.length === 0) return;
    void queryClient.refetchQueries({
      type: "active",
      predicate: (query) => {
        if (query.queryKey[0] !== "/api/market/options") return false;
        const params = query.queryKey[1] as ExpiryChainParams | undefined;
        if (!params || params.fromDate !== params.toDate) return false;
        return windows.some((window) =>
          window.params.symbol === params.symbol
          && window.params.fromDate === params.fromDate
          && window.params.toDate === params.toDate
          && (window.params.series ?? "") === (params.series ?? "")
          && window.params.strikeCount === params.strikeCount
        );
      },
    });
  }, [underlyingPrice, chainAnchorPx, fixtureChain, refetchOptionChain, queryClient]);

  const chainHoldSig = useMemo(() => {
    // Active Trader owns a viewport hold. Subscribing the loaded book here
    // would put every scrolled-in strike on the stream.
    if (optionsSubView === "at") return null;
    const calls: Contract[] = [];
    const puts: Contract[] = [];
    for (const c of (data?.calls ?? []) as Contract[]) {
      if (!expandedChainBooks.has(seriesBucketKey(c))) calls.push(c);
    }
    for (const p of (data?.puts ?? []) as Contract[]) {
      if (!expandedChainBooks.has(seriesBucketKey(p))) puts.push(p);
    }
    for (const book of expandedChainBooks.values()) {
      calls.push(...book.calls);
      puts.push(...book.puts);
    }
    const streamKeys: string[] = [];
    const expirations: string[] = [];
    const selectedYmd = atExpiration?.slice(0, 10) ?? "";
    const keep = (c: Contract) => {
      const key = seriesBucketKey(c);
      if (expandedExps.size > 0) return expandedExps.has(key);
      if (!atExpiration) return false;
      if (atExpiration.includes("~")) return key === atExpiration;
      return key.slice(0, 10) === selectedYmd;
    };
    const push = (c: Contract, right: "C" | "P") => {
      if (!keep(c)) return;
      const placed = placeSeriesContract(c);
      expirations.push(placed.expiration);
      const explicit = c.schwabSymbol?.trim() || c.streamKey?.trim();
      const root = seriesRootFromExpiration(placed.expiration) ?? symbol.replace(/^\$/, "");
      streamKeys.push(explicit || buildSchwabOptionKey(root, c.expiration, c.strike, right));
    };
    for (const c of calls) push(c, "C");
    for (const p of puts) push(p, "P");
    if (streamKeys.length === 0) return null;
    return buildChainHoldSignature(symbol, expirations, streamKeys);
  }, [data, symbol, optionsSubView, atExpiration, expandedExps, expandedChainBooks]);

  const brokerExpiryCatalog = useMemo(() => {
    if (
      !expirationCatalogRaw ||
      !optionChainMatchesActiveSymbol(expirationCatalogRaw.symbol, symbol)
    ) {
      return [];
    }
    return buildExpirationCatalog(expirationCatalogRaw.expirations ?? []);
  }, [expirationCatalogRaw, symbol]);

  const fixtureExpiryCatalog = useMemo(() => {
    if (!fixtureChain) return [];
    const calls = (fixtureChain.chain.calls ?? []) as Contract[];
    const puts = (fixtureChain.chain.puts ?? []) as Contract[];
    return buildExpirationGroups(calls, puts, underlyingPrice).map((g) => ({
      expiration: g.expiration,
      dte: g.dte,
      dateLabel: g.dateLabel,
    }));
  }, [fixtureChain, underlyingPrice]);

  const loadedGroups = useMemo(() => {
    if (!data) return [];
    const calls = (data.calls ?? []) as Contract[];
    const puts = (data.puts ?? []) as Contract[];
    calls.forEach(c => assignStreamKey(c, "C", symbol));
    puts.forEach(c => assignStreamKey(c, "P", symbol));
    return buildExpirationGroups(calls, puts, underlyingPrice);
  }, [data, underlyingPrice, symbol]);

  const expiryCatalog = useMemo(() => {
    const catalog = brokerExpiryCatalog.length
      ? brokerExpiryCatalog
      : fixtureExpiryCatalog.length
        ? fixtureExpiryCatalog
        : loadedGroups;
    return filterAtExpiryPillGroups(catalog, expiryNowMs);
  }, [brokerExpiryCatalog, fixtureExpiryCatalog, loadedGroups, expiryNowMs]);

  const groups = useMemo(() => {
    const merged = new Map<string, ExpirationGroup>();
    for (const row of expiryCatalog) merged.set(row.expiration, emptyExpirationGroup(row));
    for (const group of loadedGroups) merged.set(group.expiration, group);
    const base = [...merged.values()].sort(
      (a, b) => a.dte - b.dte || a.expiration.localeCompare(b.expiration),
    );
    return overlayExpandedSeriesGroups(base, expandedChainBooks, underlyingPrice);
  }, [expiryCatalog, loadedGroups, expandedChainBooks, underlyingPrice]);

  const [chainSpotOffCenter, setChainSpotOffCenter] = useState(false);

  const measureChainSpot = useCallback(() => {
    const el = chainScrollRef.current;
    if (!el || underlyingPrice == null) {
      setChainSpotOffCenter(false);
      return;
    }
    setChainSpotOffCenter(
      viewportNearestStrikeOffCenter(el, underlyingPrice, "data-chain-strike-rail", 56, chainSheetPad),
    );
  }, [underlyingPrice, chainSheetPad]);

  const scrollChainToSpot = useCallback(() => {
    scrollViewportToNearestStrike(
      chainScrollRef.current,
      underlyingPrice,
      "data-chain-strike-rail",
      chainSheetPad,
      "auto",
    );
  }, [underlyingPrice, chainSheetPad]);

  useEffect(() => {
    if (optionsSubView !== "chain") {
      setChainSpotOffCenter(false);
      return;
    }
    const el = chainScrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measureChainSpot);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    measureChainSpot();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [optionsSubView, measureChainSpot, data, groups.length]);

  const atGroups = useMemo(() => {
    if (!data) return [];
    const calls = (data.calls ?? []) as Contract[];
    const puts = (data.puts ?? []) as Contract[];
    calls.forEach(c => assignStreamKey(c, "C", symbol));
    puts.forEach(c => assignStreamKey(c, "P", symbol));
    return buildAtLadderGroups(calls, puts);
  }, [data, symbol]);
  const tradableAtGroups = useMemo(
    () => filterAtExpiryPillGroups(atGroups, expiryNowMs),
    [atGroups, expiryNowMs],
  );

  const atLadderHasRows = useMemo(() => {
    if (optionsSubView !== "at" || !tradableAtGroups.length) return false;
    const ymd = atExpiration?.slice(0, 10) ?? "";
    return tradableAtGroups.some((g) => {
      if (!g.rows.length) return false;
      if (atExpiration?.includes("~")) return g.expiration === atExpiration;
      if (!ymd) return true;
      return g.expiration === atExpiration || g.expiration.slice(0, 10) === ymd;
    });
  }, [optionsSubView, tradableAtGroups, atExpiration]);

  useEffect(() => {
    const stored = useOptionsExpiryStore.getState().getSelected(symbol);
    if (stored) setAtExpirationState(stored);
  }, [symbol]);

  useEffect(() => {
    const pool = expiryCatalog.length ? expiryCatalog : tradableAtGroups;
    if (!pool.length) return;
    if (atExpiration && pool.some((g) => g.expiration === atExpiration)) return;
    const explicit = useOptionsExpiryStore.getState().getExplicit(symbol);
    const resolved =
      (explicit && pool.some((g) => g.expiration === explicit) ? explicit : null) ??
      nearestTradableExpiration(pool, expiryNowMs)?.expiration ??
      null;
    if (resolved && resolved !== atExpiration) setAtExpiration(resolved);
  }, [expiryCatalog, tradableAtGroups, atExpiration, symbol, expiryNowMs, setAtExpiration]);

  useEffect(() => {
    if (optionsSubView === "chain" && atExpiration) {
      setExpandedExps((prev) => {
        if (prev.size === 1 && prev.has(atExpiration)) return prev;
        return new Set([atExpiration]);
      });
    }
  }, [optionsSubView, atExpiration]);

  const trySelectExpiry = useCallback(
    (exp: string) => {
      if (exp === atExpiration) return;
      const hasDraftLegs = selectedLegs.size > 0;
      const draftMismatch =
        hasDraftLegs && [...selectedLegs.values()].some((leg) => leg.expiration !== exp);
      if (draftMismatch) {
        const ok = window.confirm(
          "Changing expiration will clear your current option draft. Continue?",
        );
        if (!ok) return;
        setSelectedLegs(new Map());
        setLegQuantities(new Map());
        setSheetCollapsed(true);
        setChainTicketOpen(false);
        setLegLimitRejected(false);
        useChainDraftSessionStore.getState().clear();
      }
      setAtExpiration(exp);
      useOptionsExpiryStore.getState().setExplicit(symbol, exp);
      setExpandedExps(new Set([exp]));
    },
    [atExpiration, selectedLegs, setAtExpiration, symbol],
  );

  useEffect(() => {
    if (optionsSubView !== "at") {
      clearAtExpiryChrome();
      return;
    }
    const pickerPool = expiryCatalog.length ? expiryCatalog : tradableAtGroups;
    if (!pickerPool.length && !atExpiration) {
      clearAtExpiryChrome();
      return;
    }
    setAtExpiryChrome({
      options: pickerPool.map((g) => ({
        expiration: g.expiration,
        dte: g.dte,
        pillLabel: formatAtExpiryPill(g.expiration, g.dte),
      })),
      selectedExpiration: atExpiration ?? pickerPool[0]?.expiration ?? "",
      onSelect: trySelectExpiry,
    });
  }, [
    optionsSubView,
    expiryCatalog,
    tradableAtGroups,
    atExpiration,
    setAtExpiryChrome,
    clearAtExpiryChrome,
    trySelectExpiry,
  ]);

  useChainOptionHold(
    chainHoldSig?.holdSig,
    chainHoldSig?.keys ?? [],
    chainHoldSig?.viewId,
    { subscribeOptionSymbols, releaseOptionHold },
    underlyingPrice ?? data?.underlyingPrice ?? null,
  );

  const symbolResetRef = useRef<string | null>(null);
  useEffect(() => {
    // Mount runs this even when the symbol did not change, which wiped a draft
    // hydrated from the session store on Portfolio → Options.
    if (symbolResetRef.current === null || symbolResetRef.current === symbol) {
      symbolResetRef.current = symbol;
      return;
    }
    const prev = symbolResetRef.current;
    symbolResetRef.current = symbol;
    setExpandedExps(new Set());
    setAtExpiration(null);
    setSelectedLegs(new Map());
    setLegQuantities(new Map());
    setSheetCollapsed(false);
    setChainTicketOpen(false);
    setLegLimitRejected(false);
    useChainDraftSessionStore.getState().clear();
    useOptionsExpiryStore.getState().clearSymbol(prev);
  }, [symbol]);

  useEffect(() => {
    const stored = [...selectedLegs.entries()].map(([key, leg]) => ({
      key,
      contract: { ...leg.contract } as Record<string, unknown>,
      type: leg.type,
      expiration: leg.expiration,
      side: leg.side,
    }));
    const qty: Record<string, number> = {};
    legQuantities.forEach((v, k) => {
      qty[k] = v;
    });
    useChainDraftSessionStore.getState().setDraft(symbol, {
      selectedLegs: stored,
      legQuantities: qty,
      chainTicketOpen,
      sheetCollapsed,
    });
  }, [symbol, selectedLegs, legQuantities, chainTicketOpen, sheetCollapsed]);

  const withPreservedChainScroll = useCallback((run: () => void) => {
    const el = chainScrollRef.current;
    const scrollTop = el?.scrollTop ?? 0;
    run();
    requestAnimationFrame(() => {
      if (el) el.scrollTop = scrollTop;
    });
  }, []);

  const fixtureLegsAppliedRef = useRef(false);
  useEffect(() => {
    if (!chainFixtureOverride || groups.length === 0 || fixtureLegsAppliedRef.current) return;
    fixtureLegsAppliedRef.current = true;
    const group = groups[0];
    setExpandedExps(new Set([group.expiration]));
    const next = new Map<string, SelectedLeg>();
    for (const pick of chainFixtureOverride.selectedLegs) {
      const row = group.rows.find((r) => r.strike === pick.strike);
      const contract = pick.type === "CALL" ? row?.call : row?.put;
      if (!contract) continue;
      next.set(makeLegKey(contract, pick.type), {
        contract,
        type: pick.type,
        expiration: contract.expiration,
        side: pick.side,
      });
    }
    setSelectedLegs(next);
    if (chainFixtureOverride.sheetCollapsed === false) {
      setSheetCollapsed(false);
      setChainTicketOpen(true);
    }
    if (chainFixtureOverride.openReviewOnMount) setChainTicketOpen(true);
  }, [chainFixtureOverride, groups]);

  useEffect(() => {
    if (!fixtureChain || groups.length === 0) return;
    const explicit = useOptionsExpiryStore.getState().getExplicit(symbol);
    const target =
      (explicit && groups.some((g) => g.expiration === explicit) ? explicit : null) ??
      atExpiration ??
      groups[0]?.expiration;
    if (!target) return;
    setExpandedExps((prev) => {
      if (prev.has(target)) return prev;
      return new Set([target]);
    });
    if (!atExpiration || atExpiration !== target) setAtExpiration(target);
  }, [fixtureChain, groups, symbol, atExpiration, setAtExpiration]);

  const fixtureReviewRef = useRef(false);
  useEffect(() => {
    if (fixtureReviewRef.current) return;
    if (!atFixtureOverride || !onActiveTraderReview || !atFixtureOverride.openReviewOnMount) return;
    const strike = atFixtureOverride.tapStrike ?? 7545;
    const row = groups[0]?.rows.find((r) => r.strike === strike);
    const contract = row?.call;
    if (!contract) return;
    fixtureReviewRef.current = true;
    onActiveTraderReview(contract, "BUY", "CALL");
  }, [atFixtureOverride, groups, onActiveTraderReview]);

  useEffect(() => {}, [groups.length]);

  const toggleExp = (exp: string) => {
    const opening = !expandedExps.has(exp);
    setExpandedExps(opening ? new Set([exp]) : new Set());
    if (opening) {
      setAtExpiration(exp);
      useOptionsExpiryStore.getState().setExplicit(symbol, exp);
    }
  };

  const rejectLegLimit = useCallback(() => {
    setLegLimitRejected(true);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([35, 40, 35]);
    }
    if (legLimitTimerRef.current) clearTimeout(legLimitTimerRef.current);
    legLimitTimerRef.current = setTimeout(() => setLegLimitRejected(false), 800);
  }, []);

  const handleToggleLeg = useCallback((contract: Contract, type: "CALL" | "PUT", side: "bid" | "ask") => {
    const key = makeLegKey(contract, type);
    withPreservedChainScroll(() => {
      setSelectedLegs((prev) => {
        const next = new Map(prev);
        const existing = next.get(key);
        if (existing && existing.side === side) {
          next.delete(key);
          setLegLimitRejected(false);
        } else if (existing) {
          next.set(key, { contract, type, expiration: contract.expiration, side });
          setLegLimitRejected(false);
        } else {
          if (!canAddChainDraftLeg(prev.size)) {
            rejectLegLimit();
            return prev;
          }
          next.set(key, { contract, type, expiration: contract.expiration, side });
          setLegLimitRejected(false);
        }
        if (prev.size === 0 && next.size > 0) {
          setSheetCollapsed(false);
          setChainTicketOpen(true);
        }
        if (next.size === 0) setChainTicketOpen(false);
        return next;
      });
    });
  }, [withPreservedChainScroll, rejectLegLimit]);

  const handleLongPressCell = useCallback((target: LongPressTarget) => {
    setLongPressTarget(target);
  }, []);

  const handleQuickTrade = useCallback((contract: Contract, side: "BUY" | "SELL", type: "CALL" | "PUT") => {
    if (onTradeSingle) onTradeSingle(contract, side, type);
  }, [onTradeSingle]);

  const handleClearSelection = useCallback(() => {
    setSelectedLegs(new Map());
    setLegQuantities(new Map());
    setSheetCollapsed(true);
    setChainTicketOpen(false);
    setLegLimitRejected(false);
    useChainDraftSessionStore.getState().clear();
  }, []);

  const selectedLegsRef = useRef(selectedLegs);
  selectedLegsRef.current = selectedLegs;
  const handleAtDraftChange = useCallback((legs: AtLadderLegPick[], qty: Map<string, number>) => {
    if (legs.length === 0) {
      handleClearSelection();
      return;
    }
    const hadLegs = selectedLegsRef.current.size > 0;
    const next = new Map<string, SelectedLeg>();
    for (const leg of legs) {
      next.set(makeLegKey(leg.contract, leg.type), {
        contract: leg.contract,
        type: leg.type,
        expiration: leg.expiration,
        side: leg.side,
      });
    }
    setSelectedLegs(next);
    setLegQuantities(new Map(qty));
    setChainTicketOpen(true);
    if (!hadLegs) setSheetCollapsed(false);
  }, [handleClearSelection]);

  const persistSheetSession = useCallback((session: ChainDraftSheetSession) => {
    useChainDraftSessionStore.getState().setSheetSession(session);
  }, []);
  const restoredSheetSession =
    useChainDraftSessionStore.getState().symbol === symbol
      ? useChainDraftSessionStore.getState().sheet
      : undefined;

  const handleBuildStrategy = useCallback(() => {
    if (!onOpenStrategyBuilder || groups.length === 0) return;
    const allStrikes = new Set<number>();
    const expLabels: { label: string; value: string }[] = [];
    const cMap = new Map<string, { bid?: number; ask?: number; delta?: number; gamma?: number; theta?: number; vega?: number; iv?: number; contractTs?: number; quoteTimeMs?: number }>();
    const chainTs = chainFetchedAt;
    const streamTicks = useOptionsStreamStore.getState().ticks;
    for (const g of groups) {
      if (!expLabels.some((e) => e.value === g.expiration)) {
        expLabels.push({ label: `${g.dateLabel} (${Math.round(g.dte)}d)`, value: g.expiration });
      }
      for (const row of g.rows) {
        allStrikes.add(row.strike);
        const mapContract = (c: Contract | null) => {
          if (!c?.streamKey) return;
          const tick = streamTicks[c.streamKey];
          cMap.set(c.streamKey, mergeChainContractWithStream(c, tick, chainTs));
        };
        mapContract(row.call);
        mapContract(row.put);
      }
    }
    const preSelected =
      selectedLegs.size > 0
        ? [...selectedLegs.values()].map((l) => {
            const tick = l.contract.streamKey ? streamTicks[l.contract.streamKey] : undefined;
            const q = mergeChainContractWithStream(
              { ...l.contract, streamKey: l.contract.streamKey },
              tick,
              chainTs,
            );
            const merged: Contract = {
              ...l.contract,
              bid: q.bid,
              ask: q.ask,
              delta: q.delta,
              gamma: q.gamma,
              theta: q.theta,
              vega: q.vega,
              iv: q.iv,
              quoteTimeMs: q.quoteTimeMs ?? l.contract.quoteTimeMs,
            };
            return { contract: merged, type: l.type, side: l.side };
          })
        : undefined;
    onOpenStrategyBuilder([...allStrikes].sort((a, b) => a - b), expLabels, cMap, preSelected);
    setSelectedLegs(new Map());
    setLegQuantities(new Map());
  }, [onOpenStrategyBuilder, groups, selectedLegs, chainFetchedAt]);

  /**
   * Live quotes for the picked legs only. Reading the whole tick map here
   * re-rendered this entire tab (chain, Active Trader and all) on every option
   * quote for any contract.
   */
  const selectedLegStreamKeys = useMemo(
    () =>
      [...selectedLegs.values()]
        .map((l) => l.contract.streamKey)
        .filter((k): k is string => !!k)
        .sort(),
    [selectedLegs],
  );
  const streamTicksForLegs = useOptionTicksForKeys(selectedLegStreamKeys, CHAIN_TICKET_TICK_MS);

  const chainDefaultsInstruction = useMemo((): SchwabInstruction => {
    const first = selectedLegs.size > 0 ? [...selectedLegs.values()][0] : null;
    if (first) return first.side === "bid" ? "SELL_TO_OPEN" : "BUY_TO_OPEN";
    return "BUY_TO_OPEN";
  }, [selectedLegs]);

  const ticketLegs = useMemo(() => {
    if (selectedLegs.size === 0) return [];
    const entries = [...selectedLegs.entries()].map(([key, l]) => {
      const tick = l.contract.streamKey ? streamTicksForLegs[l.contract.streamKey] : undefined;
      const chainTs = chainFetchedAt;
      const q = mergeChainContractWithStream(l.contract, tick, chainTs);
      const merged: Contract = {
        ...l.contract,
        bid: q.bid,
        ask: q.ask,
        delta: q.delta,
        gamma: q.gamma,
        theta: q.theta,
        vega: q.vega,
        iv: q.iv,
        quoteTimeMs: q.quoteTimeMs ?? l.contract.quoteTimeMs,
      };
      const qty = legQuantities.get(key) ?? 1;
      return {
        key,
        contract: merged,
        type: l.type,
        side: l.side,
        quantity: qty,
      };
    });
    const legs = legsFromChainSelection(
      entries,
      symbol,
      accounts,
      buildSchwabOptionKey,
      tradingAccountHash,
    );
    if (selectedLegs.size > MAX_OPTION_LEGS) {
      return legs.slice(0, MAX_OPTION_LEGS);
    }
    return legs;
  }, [selectedLegs, streamTicksForLegs, symbol, accounts, legQuantities, tradingAccountHash, chainFetchedAt]);

  const handleLayersClick = useCallback(() => {
    if (selectedLegs.size > 0) {
      setChainTicketOpen(true);
      setSheetCollapsed(false);
      return;
    }
    handleBuildStrategy();
  }, [selectedLegs.size, handleBuildStrategy]);

  const selectionKeyFromLegId = (legId: string) => legId.split("#")[0];

  const handleFlipLegSides = useCallback(() => {
    setSelectedLegs((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const [key, leg] of prev) {
        next.set(key, { ...leg, side: leg.side === "bid" ? "ask" : "bid" });
      }
      return next;
    });
  }, []);

  const handleSheetLegQty = useCallback((legId: string, quantity: number) => {
    const key = selectionKeyFromLegId(legId);
    withPreservedChainScroll(() => {
      setLegQuantities((prev) => {
        const next = new Map(prev);
        next.set(key, Math.max(1, quantity));
        return next;
      });
    });
  }, [withPreservedChainScroll]);

  const handleSheetRemoveLeg = useCallback((legId: string) => {
    const key = selectionKeyFromLegId(legId);
    withPreservedChainScroll(() => {
      setSelectedLegs((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setLegQuantities((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    });
    if (selectedLegs.size <= 1) setChainTicketOpen(false);
  }, [withPreservedChainScroll, selectedLegs.size]);

  const clearPendingCustomStrike = useCallback(() => {
    customStrikeGenRef.current += 1;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const handleStrikeModeChange = useCallback((val: string) => {
    clearPendingCustomStrike();
    if (val === "custom") { setLocalCustomValue(String(strikeCount)); setIsCustomMode(true); return; }
    setIsCustomMode(false);
    const n = parseInt(val);
    if (!isNaN(n) && n > 0) setStrikeCount(n);
  }, [clearPendingCustomStrike, setStrikeCount, strikeCount]);

  const handleCustomStrikeChange = useCallback((raw: string) => {
    setLocalCustomValue(raw);
    setCustomStrikeInput(raw);
    clearPendingCustomStrike();
    if (raw === "") return;
    const gen = customStrikeGenRef.current;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      if (gen !== customStrikeGenRef.current) return;
      const n = parseInt(raw);
      if (!isNaN(n) && n >= 2 && n <= 100) setStrikeCount(n);
    }, 400);
  }, [clearPendingCustomStrike, setCustomStrikeInput, setStrikeCount]);

  const handleExitCustomMode = useCallback(() => {
    clearPendingCustomStrike();
    setIsCustomMode(false);
    if (![6, 10, 20].includes(strikeCount)) setStrikeCount(10);
  }, [clearPendingCustomStrike, strikeCount, setStrikeCount]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      chainSheetObserverRef.current?.disconnect();
    };
  }, []);

  const showCalls = contractType !== "PUT";
  const showPuts = contractType !== "CALL";
  const hasData = groups.length > 0;
  const apiError =
    ((rawData as Record<string, unknown> | undefined)?.error as string | undefined) ??
    expirationCatalogRaw?.error;
  const futuresChainUnsupported =
    apiError === "futures_chain_unsupported" ||
    (data as Record<string, unknown> | undefined)?.error === "futures_chain_unsupported";
  const futuresSecondary = futuresChainPlaceholderSecondary(symbol);

  const selCount = selectedLegs.size;

  const atSyncLegsFromChain = useMemo(
    () =>
      [...selectedLegs.values()].map((leg) => ({
        contract: leg.contract,
        type: leg.type,
        side: leg.side,
        expiration: leg.expiration,
      })),
    [selectedLegs],
  );

  const chainStickyHeader = HEADER_H + SUB_HEADER_H;
  const atChainLoading = !atLadderHasRows && (isLoadingEffective || isFetching);
  const atChainError = error
    ? "Option chain request failed"
    : rawData?.error ?? expirationCatalogRaw?.error ?? null;
  const atBrokerLinked = schwabLinked || isAuthDisabled();
  const atLadderPlug = useMemo(
    () => ({ chainLoading: atChainLoading, chainError: atChainError, brokerLinked: atBrokerLinked }),
    [atChainLoading, atChainError, atBrokerLinked],
  );
  const atLadderRestWindow = useMemo(
    () =>
      atDates
        ? {
            fromDate: atDates.fromDate,
            toDate: atDates.toDate,
            strikeCount: atRest.strikeCount,
            range: atRest.range,
            ...(atSeriesRoot ? { series: atSeriesRoot } : {}),
          }
        : undefined,
    [atDates, atRest.strikeCount, atRest.range, atSeriesRoot],
  );
  const atHoldSubs = useMemo(
    () => ({ subscribeOptionSymbols, releaseOptionHold }),
    [subscribeOptionSymbols, releaseOptionHold],
  );
  const handleAtAddLeg = useCallback(
    (contract: Contract, type: "CALL" | "PUT") => handleToggleLeg(contract, type, "ask"),
    [handleToggleLeg],
  );
  const handleAtOpenReview = useCallback(
    (contract: Contract, side: "BUY" | "SELL", type: "CALL" | "PUT") => {
      if (onActiveTraderReview) onActiveTraderReview(contract, side, type);
      else if (onTradeSingle) onTradeSingle(contract, side, type);
    },
    [onActiveTraderReview, onTradeSingle],
  );
  const atInitialTradeSelection = useMemo(
    () =>
      atFixtureOverride?.tapStrike != null &&
      (atFixtureOverride.scene === "strip" || atFixtureOverride.scene === "confirm")
        ? { strike: atFixtureOverride.tapStrike, type: "CALL" as const }
        : undefined,
    [atFixtureOverride?.tapStrike, atFixtureOverride?.scene],
  );

  const chainStrategistRef = useRef<
    ((opts: { thesis?: string }) => Promise<StrategistSheetDispatchResult>) | null
  >(null);
  const [chainStrategistBusy, setChainStrategistBusy] = useState(false);
  const [chainStrategistError, setChainStrategistError] = useState<string | null>(null);

  return (
    <div
      style={{ background: BG }}
      className="relative flex flex-1 min-h-0 flex-col overflow-hidden"
    >
      {optionsSubView === "at" && (
        <ActiveTraderView
          symbol={symbol}
          groups={tradableAtGroups}
          activeExpiration={atExpiration ?? undefined}
          underlyingPrice={underlyingPrice}
          stickyOffset={stickyOffset + 36}
          accentHex={accentHex}
          chainQuoteTs={chainFetchedAt}
          ladderPlug={atLadderPlug}
          ladderRestWindow={atLadderRestWindow}
          holdSubs={atHoldSubs}
          onReachEdge={growAtStrikeWindow}
          onAddLeg={handleAtAddLeg}
          onOpenReview={handleAtOpenReview}
          presentation={atFixtureOverride?.presentation}
          settingsPanelInitiallyOpen={atFixtureOverride?.settingsPanelOpen}
          initialTradeSelection={atInitialTradeSelection}
          buildLegsFromChain={atSyncLegsFromChain}
          buildLegQtyFromChain={legQuantities}
          onSharedDraftChange={handleAtDraftChange}
          sheetCollapsed={sheetCollapsed}
          onSheetCollapsedChange={setSheetCollapsed}
          restoredSheetSession={restoredSheetSession}
          onSheetSessionPersist={persistSheetSession}
          onSendToStrategist={onSendToStrategist}
        />
      )}
      {optionsSubView === "chain" && (
      <>
      {!isFuturesSymbol && (
      <div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
      <div
        className="flex items-center justify-between w-full pl-3 pr-2 shrink-0 z-40"
        style={{ height: TOOLBAR_H, background: BG_EXP_BAR, borderBottom: `1px solid ${BORDER}`, fontFamily: MONO }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span data-ui-audit="chain-strike-label" style={{ fontSize: 14, color: DIM, fontWeight: FW_NORMAL, fontFamily: MONO }}>Strike</span>
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
        <div className="flex items-center gap-1.5 shrink-0 min-w-0" data-at-chain-toolbar-end>
          <MetricsStrip
            groups={groups}
            lastPrice={underlyingPrice}
            earningsInfo={{
              earningsDate: earningsData?.earningsDate ?? quote?.nextEarningsDate,
              confirmed: earningsData?.confirmed,
              time: earningsData?.time,
              epsEstimate: earningsData?.epsEstimate,
              epsPrior: earningsData?.epsPrior,
              period: earningsData?.period,
              periodYear: earningsData?.periodYear,
            }}
            isFetching={isFetching}
            hasData={hasData}
          />
        </div>
      </div>

      <div className="relative flex-1 min-h-0 min-w-0">
      <div
        ref={chainScrollRef}
        data-options-chain-scroll
        data-options-chain-selected-expiration={atExpiration ?? undefined}
        className="relative h-full min-h-0 overflow-y-auto overscroll-y-none"
        style={{ background: BG, paddingBottom: selCount > 0 ? chainSheetPad : 0, WebkitOverflowScrolling: "touch" }}
      >
        {isLoadingEffective && !data && (
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
            <span className="text-2xl mb-2">{"\u26A0"}</span>
            <span className="text-[10px] tracking-widest" style={{ fontWeight: FW_LIGHT }}>FAILED TO LOAD OPTIONS</span>
          </div>
        )}

        {futuresChainUnsupported && !hasData && !isLoadingEffective && !error && (
          <div
            className="p-12 text-center font-mono flex flex-col items-center max-w-md mx-auto"
            style={{ color: GRAY }}
            data-ui-audit="futures-chain-placeholder"
            data-futures-root={futuresRootForPlaceholder(symbol)}
          >
            <span className="text-[11px] leading-relaxed" style={{ fontWeight: FW_NORMAL }}>
              {futuresChainPlaceholderPrimary()}
            </span>
            {futuresSecondary ? (
              <span className="text-[10px] mt-2 leading-relaxed" style={{ color: DIM, fontWeight: FW_LIGHT }}>
                {futuresSecondary}
              </span>
            ) : null}
          </div>
        )}

        {!hasData && !isLoadingEffective && !error && apiError && !futuresChainUnsupported && (
          <div className="p-12 text-center font-mono flex flex-col items-center" style={{ color: GOLD_DIM }}>
            <span className="text-2xl mb-2">{"\u26A0"}</span>
            <span className="text-[10px] tracking-widest" style={{ fontWeight: FW_LIGHT }}>OPTIONS UNAVAILABLE</span>
            <span className="text-[9px] mt-1" style={{ color: DIM, fontWeight: FW_LIGHT }}>{"Service may be down \u2014 retries automatically"}</span>
          </div>
        )}

        {!isLoadingEffective && !error && !data && !accessToken && (
          <div className="p-16 flex flex-col items-center justify-center font-mono">
            <Table2 className="w-7 h-7 mb-2" style={{ color: MUTED }} />
            <ConnectBrokerPrompt label="Connect Brokerage To View Options" compact />
          </div>
        )}

        {!isLoadingEffective && !error && !data && accessToken && !futuresChainUnsupported && (
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
              columns={chainPriceColumns}
              colW={CHAIN_COL_W}
              stickyTop={0}
              onColumnsEditor={() => setColumnsEditorOpen(true)}
              onBuildStrategy={onOpenStrategyBuilder ? handleLayersClick : undefined}
            />
            {groups.map(group => {
              const isOpen = expandedExps.has(group.expiration);
              return (
                <ExpirationSection
                  key={group.expiration}
                  group={group}
                  isOpen={isOpen}
                  onToggle={() => toggleExp(group.expiration)}
                  stickyTop={chainStickyHeader}
                  underlyingPrice={underlyingPrice}
                  activeColumns={chainPriceColumns}
                  colW={CHAIN_COL_W}
                  showCalls={showCalls}
                  showPuts={showPuts}
                  selectedLegs={selectedLegs}
                  onToggleLeg={handleToggleLeg}
                  onLongPressCell={handleLongPressCell}
                  showInlineGreeks={showInlineGreeks}
                  accentHex={accentHex}
                  chainQuoteTs={chainFetchedAt}
                />
              );
            })}
          </div>
        )}

        {!hasData && !isLoadingEffective && !error && !apiError && !isFuturesSymbol && (
          <div className="p-16 flex flex-col items-center justify-center font-mono">
            <Table2 className="w-7 h-7 mb-2" style={{ color: MUTED }} />
            <span className="text-[10px] tracking-widest" style={{ color: DIM, fontWeight: FW_LIGHT }}>NO OPTIONS DATA FOR THIS RANGE</span>
          </div>
        )}
      </div>
      <SpotRecenterPill
        visible={!!hasData && chainSpotOffCenter}
        onClick={scrollChainToSpot}
        dataAttribute="data-options-chain-recenter"
      />
      </div>
      {selCount > 0 && (
        <div
          ref={chainSheetRef}
          data-chain-order-sheet
          data-at-order-sheet
          className="absolute left-0 right-0 bottom-0"
          style={{ zIndex: 80 }}
        >
          {legLimitRejected ? (
            <p
              data-chain-leg-limit-msg
              className="px-3 text-center"
              style={{
                fontSize: 18,
                lineHeight: 1.3,
                fontWeight: 800,
                color: "#ff2d2d",
                background: "#000",
                paddingTop: 14,
                paddingBottom: 14,
              }}
            >
              {CHAIN_LEG_LIMIT_MESSAGE}
            </p>
          ) : null}
          <OptionsChainOrderSheet
            legs={ticketLegs}
            collapsed={sheetCollapsed}
            onCollapsedChange={setSheetCollapsed}
            sheetPeek={chainSheetPeek}
            onSheetPeekChange={setChainSheetPeek}
            onClearAll={handleClearSelection}
            onLegQuantityChange={handleSheetLegQty}
            onRemoveLeg={handleSheetRemoveLeg}
            onFlipSides={handleFlipLegSides}
            subscribeOptionSymbols={subscribeOptionSymbols}
            openReviewOnMount={chainFixtureOverride?.openReviewOnMount}
            demoFixture={!!chainFixtureOverride}
            draftDistinctLegCount={selectedLegs.size}
            atDocked
            restoredSheetSession={restoredSheetSession}
            onSheetSessionPersist={persistSheetSession}
            onAdvancedOrders={() => setChainDefaultsOpen(true)}
            strategistHandlerRef={chainStrategistRef}
            atBracketDraft={{ prefs: chainOrderPrefs, primaryInstruction: chainDefaultsInstruction }}
          />
        </div>
      )}
      <AtOrderDefaultsSheet
        open={chainDefaultsOpen}
        prefs={chainOrderPrefs}
        primaryInstruction={chainDefaultsInstruction}
        windowSec={chainDefaultsWindowSec}
        onWindowSecChange={setChainDefaultsWindowSec}
        onSendToStrategist={
          selCount > 0
            ? async ({ thesis }) => {
                const fn = chainStrategistRef.current;
                if (!fn) return;
                setChainStrategistBusy(true);
                setChainStrategistError(null);
                const res = await fn({ thesis });
                setChainStrategistBusy(false);
                if (!res.ok) {
                  setChainStrategistError(res.error);
                  return;
                }
                setChainDefaultsOpen(false);
                handleClearSelection();
                onSendToStrategist?.(res.ticker);
              }
            : undefined
        }
        strategistBusy={chainStrategistBusy}
        strategistError={chainStrategistError}
        onClose={() => {
          setChainStrategistError(null);
          setChainDefaultsOpen(false);
        }}
        onSave={(next) => {
          setChainOrderPrefs(next);
          saveActiveTraderPrefs(chainOrderSymbolClass, next);
          setChainDefaultsOpen(false);
        }}
      />
      </div>
      )}
      {isFuturesSymbol && (
      <div
        className="relative flex-1 min-h-0 overflow-y-auto overscroll-y-none"
        style={{ background: BG, paddingBottom: selCount > 0 ? 52 : 0, WebkitOverflowScrolling: "touch" }}
        data-options-chain-scroll
      >
        {futuresChainUnsupported && !hasData && !isLoadingEffective && !error && (
          <div
            className="p-12 text-center font-mono flex flex-col items-center max-w-md mx-auto"
            style={{ color: GRAY }}
            data-ui-audit="futures-chain-placeholder"
            data-futures-root={futuresRootForPlaceholder(symbol)}
          >
            <span className="text-[11px] leading-relaxed" style={{ fontWeight: FW_NORMAL }}>
              {futuresChainPlaceholderPrimary()}
            </span>
            {futuresSecondary ? (
              <span className="text-[10px] mt-2 leading-relaxed" style={{ color: DIM, fontWeight: FW_LIGHT }}>
                {futuresSecondary}
              </span>
            ) : null}
          </div>
        )}
      </div>
      )}
      </>
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
