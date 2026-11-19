import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  BG, BG_EXP_BAR, BORDER, BORDER_ROW, DIM, GRAY, WHITE, MONO, FW_LIGHT, UP, DOWN, noScrollbar,
} from "@/components/options/optionsTheme";
import { AT_LABEL } from "@/lib/active-trader/atChromeContrast";
import { buildAtHoldSignature } from "@/lib/active-trader/atHoldSig";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import {
  loadActiveTraderPrefs,
  saveActiveTraderPrefs,
  type ActiveTraderTemplatePrefs,
} from "@/lib/active-trader/activeTraderPrefs";
import { useAtLadderVolumeHeat } from "@/lib/active-trader/useAtLadderVolumeHeat";
import { selectAtStreamKeys } from "@/lib/active-trader/atLadderWindow";
import { auditNearAtmLadderQuotes, type LadderQuoteHealthAudit } from "@/lib/active-trader/atLadderQuoteHealth";
import {
  equityOptionsClosedPill,
  equityOptionsSessionEnded,
  equityOptionsSessionOpen,
} from "@workspace/order-ticket-math";
import { findAtmStrikeIndex } from "@/lib/optionsSchwabKey";
import { useChainOptionHold } from "@/hooks/useChainOptionHold";
import type { ChainHoldSubscribers } from "@/hooks/useChainOptionHold";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import { useOptionsStreamStore } from "@/lib/options-stream-store";
import { useOptionTicksForKeys } from "@/lib/useOptionTicksForKeys";
import { getAtFixtureOverride } from "@/lib/active-trader/atFixtureBridge";
import {
  isAutoSendLiveReady,
  patchAutoSendArmed,
} from "@/lib/active-trader/atAutoSend";
import {
  atPrimaryInstruction,
  buildAtOrderPayload,
  resolveAtEntryPrice,
  submitAtSchwabOrder,
} from "@/lib/active-trader/atPlaceOrder";
import { planAtOrderLegs } from "@/lib/active-trader/atSchwabOrderBuilder";
import { isFuturesDisplaySymbol } from "@/lib/futuresSchwabUi";
import { AtFuturesLiveQuote } from "@/components/active-trader/AtFuturesLiveQuote";
import {
  OptionsChainOrderSheet,
  legsFromChainSelection,
} from "@/components/OptionsChainOrderSheet";
import { AtLegBuildTray } from "@/components/active-trader/AtLegBuildTray";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";
import { seriesRootFromExpiration } from "@/lib/active-trader/optionSeries";
import {
  atLadderLegKey,
  quoteSideFromTap,
  type AtLadderLegPick,
} from "@/lib/active-trader/atLadderLegKeys";
import type { ChainDraftSheetSession } from "@/lib/orders/chainDraftSessionStore";
import {
  atSelectionClear,
  atSelectionRemoveLeg,
  atSelectionSetLegs,
  atSelectionToggleLeg,
  createAtLadderSelectionStore,
  useAtLadderLegs,
} from "@/lib/active-trader/atLadderSelection";
import { aggregateSpreadNBBO, inferNetCreditFromLegStructure } from "@workspace/order-ticket-math";
import { toast } from "@/hooks/use-toast";
import { AtOrderDefaultsSheet } from "./AtOrderDefaultsSheet";
import { AtGlanceTop } from "./AtGlanceTop";
import { mergeChainContractWithStream } from "@/lib/chainContractQuoteMerge";
import {
  loadAtSettingsPanelOpen,
  saveAtSettingsPanelOpen,
} from "@/lib/active-trader/atSettingsPanelState";
import { LadderBody, type AtTradeContext, type LadderRowModel } from "./LadderBody";
import { filterAtExpiryPillGroups } from "@/lib/optionsExpirationPick";
import { useMinuteClock } from "@/lib/active-trader/useAtLadderQuote";
import { AtTradeActionBar } from "./AtTradeActionBar";
import {
  atLadderNudgeToClearSheet,
  atLadderRowFullyVisible,
  atLadderScrollShiftForRows,
  atLadderScrollTopForRow,
  atLadderVisibleRowRange,
  scrollAtLadderToStrikeAboveSheet,
} from "@/lib/active-trader/atLadderScroll";
import { AT_MOBILE_PEEK_MAX_PX } from "@/components/active-trader/AtMobileGlanceOrderSheet";
import { useAtLiveZones } from "@/lib/active-trader/useAtLiveZones";
import type { AtVerticalWidth } from "@/lib/active-trader/activeTraderPrefs";
import {
  AT_LADDER_CALLS_HDR,
  AT_LADDER_COL_HDR_H,
  AT_LADDER_GRID,
  AT_LADDER_GROUP_HDR_H,
  AT_LADDER_GUTTER_X,
  AT_LADDER_PANEL_BG,
  AT_LADDER_PUTS_HDR,
  AT_LADDER_ROW_H,
  AT_LADDER_THIN_SEP,
} from "@/lib/active-trader/atLadderLayout";
import { AT_HEADER_BG, AT_ORDER_PANEL_BG } from "@/lib/active-trader/atChromeContrast";
import { AtLadderSkeleton } from "./AtLadderSkeleton";
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import { useQuote } from "@/hooks/useQuote";
import { useSpxKeepawayStats } from "@/hooks/useSpxKeepawayStats";
import {
  isSpxSymbol,
  spxKeepawayBoundary,
  type SpxKeepawayStats,
} from "@workspace/order-ticket-math";

export interface AtExpirationGroup {
  expiration: string;
  dte: number;
  dateLabel: string;
  rows: { strike: number; call: OptionsContract | null; put: OptionsContract | null }[];
}

interface ActiveTraderViewProps {
  symbol: string;
  groups: AtExpirationGroup[];
  /** Selected chain expiration (Options tab syncs via `atChromeStore`). */
  activeExpiration?: string;
  underlyingPrice: number | null;
  stickyOffset: number;
  accentHex: string;
  holdSubs: ChainHoldSubscribers;
  onAddLeg: (contract: OptionsContract, type: "CALL" | "PUT") => void;
  onOpenReview: (contract: OptionsContract, side: "BUY" | "SELL", type: "CALL" | "PUT") => void;
  presentation?: {
    regimeLabel: string | null;
    regimeDegraded: boolean;
    zones: ZoneModel;
    classifiedPct: number | null;
    headline: string;
    sessionLabel?: string;
    skipNetwork?: boolean;
  };
  initialTradeSelection?: { strike: number; type: "CALL" | "PUT" };
  /** Dev/screenshot: force settings panel expanded on mount. */
  settingsPanelInitiallyOpen?: boolean;
  /** REST chain fetch timestamp — used when stream quotes are empty or zero. */
  chainQuoteTs?: number;
  /** Ladder scrolled to the first or last loaded strike — ask for the next page. */
  onReachEdge?: (edge: "up" | "down") => void;
  /** Same expiry window the ladder REST-fetched, used only if the stream goes quiet. */
  ladderRestWindow?: {
    fromDate: string;
    toDate: string;
    strikeCount: number;
    range: string;
  };
  /** Chain fetch / brokerage state for skeleton messaging. */
  ladderPlug?: {
    chainLoading?: boolean;
    chainError?: string | null;
    brokerLinked?: boolean;
  };
  /** Legs built on the chain subview, applied when AT mounts or chain legs change. */
  buildLegsFromChain?: AtLadderLegPick[];
  buildLegQtyFromChain?: Map<string, number>;
  /** Writes ladder edits into the one Options draft the chain ticket uses. */
  onSharedDraftChange?: (legs: AtLadderLegPick[], quantities: Map<string, number>) => void;
  sheetCollapsed?: boolean;
  onSheetCollapsedChange?: (collapsed: boolean) => void;
  restoredSheetSession?: ChainDraftSheetSession;
  onSheetSessionPersist?: (session: ChainDraftSheetSession) => void;
}

function sharedDraftSig(legs: Iterable<AtLadderLegPick>, qty: Iterable<[string, number]>): string {
  const legPart = [...legs]
    .map((leg) => `${leg.expiration}|${leg.contract.strike}|${leg.type}|${leg.side}`)
    .sort()
    .join(",");
  const qtyPart = [...qty]
    .map(([key, value]) => `${key}:${value}`)
    .sort()
    .join(",");
  return `${legPart}#${qtyPart}`;
}

function selectedLegsFromChain(
  buildLegsFromChain: AtLadderLegPick[] | undefined,
): Map<string, AtLadderLegPick> {
  const next = new Map<string, AtLadderLegPick>();
  if (!buildLegsFromChain?.length) return next;
  for (const leg of buildLegsFromChain) {
    next.set(atLadderLegKey(leg.contract, leg.type), {
      contract: leg.contract,
      type: leg.type,
      expiration: leg.expiration,
      side: leg.side,
    });
  }
  return next;
}

/** Distance from the first / last loaded strike that asks for the next page. */
const AT_EDGE_LOAD_PX = 96;
/** The quote subscription follows the viewport once scrolling has paused this long. */
const AT_VISIBLE_SETTLE_MS = 140;
const AT_ORDER_SHEET_Z = 120;
/** After a tap, how long the tapped strike is kept clear of a sheet that is still opening or growing. */
const AT_NUDGE_WINDOW_MS = 1_200;

/** Header quote-health pill and order-settings mid: a human reads them, so a few updates a second is plenty. */
const AT_QUOTE_AUDIT_MS = 2_000;
const AT_SUMMARY_TICK_MS = 250;

const EMPTY_QUOTE_AUDIT: LadderQuoteHealthAudit = {
  nearAtmHasInvalid: false,
  counts: { crossed: 0, incomplete: 0, stale: 0, ok: 0 },
  nearAtm: [],
};

function sameQuoteAudit(a: LadderQuoteHealthAudit, b: LadderQuoteHealthAudit): boolean {
  return (
    a.nearAtmHasInvalid === b.nearAtmHasInvalid &&
    a.counts.crossed === b.counts.crossed &&
    a.counts.incomplete === b.counts.incomplete &&
    a.counts.stale === b.counts.stale &&
    a.counts.ok === b.counts.ok
  );
}

export const ActiveTraderView = memo(function ActiveTraderView({
  symbol,
  groups,
  activeExpiration,
  underlyingPrice,
  stickyOffset: _stickyOffset,
  accentHex,
  holdSubs,
  onAddLeg,
  onOpenReview,
  presentation,
  initialTradeSelection,
  settingsPanelInitiallyOpen,
  chainQuoteTs: chainQuoteTsProp,
  ladderPlug,
  onReachEdge,
  ladderRestWindow,
  buildLegsFromChain,
  buildLegQtyFromChain,
  onSharedDraftChange,
  sheetCollapsed: sheetCollapsedProp,
  onSheetCollapsedChange,
  restoredSheetSession,
  onSheetSessionPersist,
}: ActiveTraderViewProps) {
  const expiryClockMinute = useMinuteClock();
  const tradableGroups = useMemo(
    () => filterAtExpiryPillGroups(groups, expiryClockMinute * 60_000),
    [groups, expiryClockMinute],
  );
  const primary = useMemo(() => {
    if (!activeExpiration) return tradableGroups[0] ?? null;
    return tradableGroups.find((g) => g.expiration === activeExpiration) ?? null;
  }, [tradableGroups, activeExpiration]);
  const ladderDataReady = !!(primary && primary.rows.length > 0);
  const ladderWaitMessage = useMemo(() => {
    if (ladderDataReady || presentation?.skipNetwork) return null;
    if (ladderPlug?.chainLoading) return "Loading option chain…";
    if (ladderPlug?.chainError) return ladderPlug.chainError;
    if (ladderPlug?.brokerLinked === false) return "Connect Schwab to load the ladder.";
    return "Waiting for live chain and stream quotes…";
  }, [ladderDataReady, presentation?.skipNetwork, ladderPlug]);
  const noTradableExpirations = groups.length > 0 && tradableGroups.length === 0;
  /** Futures root without an options ladder (live); fixture/dev chains keep the AT ladder. */
  const futuresOnlyMode = isFuturesDisplaySymbol(symbol) && !ladderDataReady;
  const [windowSec, setWindowSec] = useState<30 | 60 | 300>(30);
  const [tradeStripStrike, setTradeStripStrike] = useState<number | null>(null);
  const [tradeContext, setTradeContext] = useState<AtTradeContext | null>(null);
  /**
   * Picked legs live in a store the ladder cells read directly, so a tap paints
   * its outline without waiting for this component. `selectedLegs` follows it
   * as a transition and feeds the ticket.
   */
  const [selection] = useState(() =>
    createAtLadderSelectionStore(selectedLegsFromChain(buildLegsFromChain)),
  );
  const selectedLegs = useAtLadderLegs(selection);
  const [legQuantities, setLegQuantities] = useState(
    () => (buildLegQtyFromChain ? new Map(buildLegQtyFromChain) : new Map<string, number>()),
  );
  const [chainSheetCollapsed, setChainSheetCollapsed] = useState(false);
  const [chainSheetPeek, setChainSheetPeek] = useState(false);
  const chainQuoteTs = chainQuoteTsProp ?? Date.now();
  const chainLegSyncSig = useMemo(
    () =>
      buildLegsFromChain?.length
        ? buildLegsFromChain
            .map((l) => `${l.expiration}|${l.contract.strike}|${l.type}|${l.side}`)
            .sort()
            .join(",")
        : "",
    [buildLegsFromChain],
  );
  const chainQtySig = useMemo(() => {
    if (!buildLegQtyFromChain?.size) return "";
    return [...buildLegQtyFromChain.entries()]
      .map(([key, value]) => `${key}:${value}`)
      .sort()
      .join(",");
  }, [buildLegQtyFromChain]);
  const publishedDraftSigRef = useRef<string | null>(null);
  const legQtyRef = useRef(legQuantities);
  legQtyRef.current = legQuantities;
  const publishDraft = useCallback(
    (legs: Iterable<AtLadderLegPick>, qty: Map<string, number>) => {
      if (!onSharedDraftChange) return;
      publishedDraftSigRef.current = sharedDraftSig(legs, qty.entries());
      onSharedDraftChange([...legs], qty);
    },
    [onSharedDraftChange],
  );

  useEffect(() => {
    const incoming = selectedLegsFromChain(buildLegsFromChain);
    const incomingQty = buildLegQtyFromChain ?? new Map<string, number>();
    const incomingSig = sharedDraftSig(incoming.values(), incomingQty.entries());
    const localSig = sharedDraftSig(selection.getState().legs.values(), legQtyRef.current.entries());
    if (localSig === incomingSig) {
      publishedDraftSigRef.current = null;
      return;
    }
    // The parent still has the draft from before this ladder edit.
    if (publishedDraftSigRef.current && publishedDraftSigRef.current !== incomingSig) return;
    publishedDraftSigRef.current = null;
    atSelectionSetLegs(selection, incoming);
    setLegQuantities((prev) => {
      if (prev.size === incomingQty.size && [...incomingQty].every(([key, value]) => prev.get(key) === value)) {
        return prev;
      }
      return new Map(incomingQty);
    });
  }, [chainLegSyncSig, chainQtySig, buildLegsFromChain, buildLegQtyFromChain, selection]);
  const sheetCollapsedControlled = onSheetCollapsedChange != null;
  const collapsed = sheetCollapsedControlled ? (sheetCollapsedProp ?? false) : chainSheetCollapsed;
  const setCollapsed = useCallback(
    (next: boolean) => {
      if (onSheetCollapsedChange) onSheetCollapsedChange(next);
      else setChainSheetCollapsed(next);
    },
    [onSheetCollapsedChange],
  );
  const [selected, setSelected] = useState<{ contract: OptionsContract; type: "CALL" | "PUT" } | null>(null);
  const [lastLegQuoteSide, setLastLegQuoteSide] = useState<"bid" | "ask">("ask");
  const [regimeLabel, setRegimeLabel] = useState<string | null>(null);
  const [regimeDegraded, setRegimeDegraded] = useState(false);

  const symbolClass = symbol.toUpperCase().includes("SPX") || symbol.startsWith("$") ? "index" : "equity";
  const spxMode = isSpxSymbol(symbol);
  const { data: underlyingQuote } = useQuote(symbol);
  const keepawayUseMean = useAtChromeStore((s) => s.keepawayUseMean);
  const setKeepawayUseMean = useAtChromeStore((s) => s.setKeepawayUseMean);
  const fetchedKeepaway = useSpxKeepawayStats(spxMode && !presentation?.skipNetwork);
  const keepawayStats: SpxKeepawayStats | null = useMemo(() => {
    if (!spxMode) return null;
    if (presentation?.skipNetwork) {
      return {
        symbol: "SPX",
        n: 221,
        startYmd: "2026-01-01",
        endYmd: "2026-11-17",
        lowSide: { median: 29.5, mean: 36.6 },
        highSide: { median: 24.2, mean: 34.6 },
      };
    }
    return fetchedKeepaway;
  }, [spxMode, presentation?.skipNetwork, fetchedKeepaway]);
  const sessionHigh = useMemo(() => {
    const h = underlyingQuote?.high;
    return h != null && Number.isFinite(h) ? h : null;
  }, [underlyingQuote?.high]);
  const sessionLow = useMemo(() => {
    const l = underlyingQuote?.low;
    return l != null && Number.isFinite(l) ? l : null;
  }, [underlyingQuote?.low]);
  const keepawayPutLine = useMemo(() => {
    if (!keepawayStats || sessionLow == null || sessionHigh == null) return null;
    return spxKeepawayBoundary(keepawayStats, "put", sessionLow, sessionHigh, keepawayUseMean);
  }, [keepawayStats, sessionLow, sessionHigh, keepawayUseMean]);
  const keepawayCallLine = useMemo(() => {
    if (!keepawayStats || sessionLow == null || sessionHigh == null) return null;
    return spxKeepawayBoundary(keepawayStats, "call", sessionLow, sessionHigh, keepawayUseMean);
  }, [keepawayStats, sessionLow, sessionHigh, keepawayUseMean]);
  const [prefs, setPrefs] = useState<ActiveTraderTemplatePrefs>(() => loadActiveTraderPrefs(symbolClass));
  const ladderMode = prefs.ladderMode;
  const [settingsOpen, setSettingsOpen] = useState(
    () => settingsPanelInitiallyOpen ?? loadAtSettingsPanelOpen(),
  );
  const chromeRef = useRef<HTMLDivElement>(null);
  const ladderScrollRef = useRef<HTMLDivElement>(null);
  const [spotOutOfView, setSpotOutOfView] = useState(false);

  useEffect(() => {
    if (presentation?.skipNetwork) {
      setRegimeLabel(presentation.regimeLabel);
      setRegimeDegraded(presentation.regimeDegraded);
      return;
    }
    void fetchWithAuth("/api/strategist/regime")
      .then((r) => r.json())
      .then((j: { directionalConviction?: string; degraded?: boolean }) => {
        setRegimeLabel(j.directionalConviction?.replace(/_/g, " ") ?? null);
        setRegimeDegraded(!!j.degraded);
      })
      .catch(() => setRegimeLabel("\u2014"));
  }, [presentation?.regimeDegraded, presentation?.regimeLabel, presentation?.skipNetwork]);

  useEffect(() => {
    if (!initialTradeSelection || !primary) return;
    const row = primary.rows.find((r) => r.strike === initialTradeSelection.strike);
    const contract =
      initialTradeSelection.type === "CALL" ? row?.call : row?.put;
    if (!contract) return;
    setSelected({ contract, type: initialTradeSelection.type });
    setTradeContext({ mode: "single", contract, type: initialTradeSelection.type });
    setTradeStripStrike(contract.strike);
  }, [initialTradeSelection, primary]);

  // Nothing tradable left for this symbol. A ladder that is still loading its strikes keeps its legs.
  useEffect(() => {
    if (!noTradableExpirations) return;
    atSelectionClear(selection);
    setLegQuantities(new Map());
    setSelected(null);
    setTradeContext(null);
    setTradeStripStrike(null);
  }, [noTradableExpirations, selection]);

  const ladderRows: LadderRowModel[] = useMemo(() => {
    if (!primary?.rows?.length) return [];
    return [...primary.rows]
      .map((r) => ({ strike: r.strike, call: r.call, put: r.put }))
      .sort((a, b) => b.strike - a.strike);
  }, [primary]);
  const ladderStrikes = useMemo(() => ladderRows.map((r) => r.strike), [ladderRows]);
  /** Loaded strike nearest the underlying. The ladder only re-renders when this moves to another strike. */
  const spotStrike = useMemo(() => {
    if (underlyingPrice == null || ladderStrikes.length === 0) return null;
    const idx = findAtmStrikeIndex(ladderStrikes, underlyingPrice);
    return idx >= 0 ? ladderStrikes[idx]! : null;
  }, [ladderStrikes, underlyingPrice]);

  /** Always mockup row pitch — fixture used to tighten to 36 and broke 1:1 overlay. */
  const ladderRowH = AT_LADDER_ROW_H;

  /**
   * The order sheet floats over the bottom of the ladder; it never takes
   * height away from it. Its measured height becomes scroll room below the
   * last strike, so every strike can still be pulled above the sheet.
   */
  const [sheetPad, setSheetPad] = useState(0);
  const sheetObserverRef = useRef<ResizeObserver | null>(null);
  const sheetRef = useCallback((node: HTMLDivElement | null) => {
    sheetObserverRef.current?.disconnect();
    sheetObserverRef.current = null;
    if (!node) {
      setSheetPad(0);
      return;
    }
    const sync = () => setSheetPad(Math.ceil(node.getBoundingClientRect().height));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(node);
    sheetObserverRef.current = ro;
  }, []);
  useEffect(() => () => sheetObserverRef.current?.disconnect(), []);

  const scrollInputRef = useRef({ ladderStrikes, ladderRowH, spotStrike, onReachEdge, sheetPad });
  scrollInputRef.current = { ladderStrikes, ladderRowH, spotStrike, onReachEdge, sheetPad };

  /** The part of the ladder that is not under the order sheet. */
  const readViewport = useCallback((el: HTMLElement) => {
    const cur = scrollInputRef.current;
    return {
      scrollTop: el.scrollTop,
      viewportPx: Math.max(cur.ladderRowH, el.clientHeight - cur.sheetPad),
      rowHeight: cur.ladderRowH,
      rowCount: cur.ladderStrikes.length,
    };
  }, []);

  /**
   * A just-tapped strike that the sheet covers is pulled up just far enough to
   * clear it. Runs right after the tap and again when the sheet opens or grows.
   */
  const nudgeRef = useRef<{ strike: number; until: number } | null>(null);
  const nudgeTappedStrikeAboveSheet = useCallback(() => {
    const pending = nudgeRef.current;
    const el = ladderScrollRef.current;
    if (!pending || !el) return;
    if (performance.now() > pending.until) {
      nudgeRef.current = null;
      return;
    }
    const idx = scrollInputRef.current.ladderStrikes.indexOf(pending.strike);
    if (idx < 0) return;
    const px = atLadderNudgeToClearSheet(idx, readViewport(el));
    if (px > 0) el.scrollBy({ top: px, behavior: "smooth" });
  }, [readViewport]);
  useLayoutEffect(() => {
    nudgeTappedStrikeAboveSheet();
  }, [sheetPad, nudgeTappedStrikeAboveSheet]);

  const [visibleStrikes, setVisibleStrikes] = useState<{ min: number; max: number } | null>(null);
  const streamKeys = useMemo(() => {
    const rows = ladderRows.map((row) => ({
      strike: row.strike,
      callKey: row.call?.streamKey ?? null,
      putKey: row.put?.streamKey ?? null,
    }));
    if (visibleStrikes) {
      return selectAtStreamKeys({
        rows,
        visibleMin: visibleStrikes.min,
        visibleMax: visibleStrikes.max,
      });
    }
    // Not measured yet: the strikes around spot, which is where the ladder opens.
    if (spotStrike == null) {
      return selectAtStreamKeys({ rows, visibleMin: -1e12, visibleMax: 1e12, overscan: 0 }).slice(0, 80);
    }
    return selectAtStreamKeys({
      rows,
      visibleMin: spotStrike,
      visibleMax: spotStrike,
      overscan: 20,
    });
  }, [ladderRows, visibleStrikes, spotStrike]);

  const holdSig = useMemo(() => {
    if (!primary || streamKeys.length === 0) return null;
    return buildAtHoldSignature(symbol, primary.expiration, streamKeys);
  }, [primary, streamKeys, symbol]);

  useChainOptionHold(
    holdSig?.holdSig,
    holdSig?.keys ?? [],
    holdSig?.viewId,
    holdSubs,
    underlyingPrice,
  );

  const seedContracts = useMemo(() => {
    const out: { key: string; volume?: number | null; volumeSampledAt?: number | null }[] = [];
    for (const row of ladderRows) {
      for (const leg of [row.call, row.put]) {
        if (!leg?.streamKey) continue;
        const raw = leg as OptionsContract & { volumeSampledAt?: number };
        out.push({
          key: leg.streamKey,
          volume: leg.volume ?? null,
          volumeSampledAt: raw.volumeSampledAt ?? chainQuoteTs,
        });
      }
    }
    return out;
  }, [ladderRows, chainQuoteTs]);

  const { heatStore, source: ladderHeatSource } = useAtLadderVolumeHeat({
    symbol,
    streamKeys,
    skipNetwork: presentation?.skipNetwork,
    restWindow: ladderRestWindow,
    seedContracts,
  });

  /**
   * Near-ATM quote health for the header pill. Checked on a timer against the
   * tick store rather than on every quote.
   */
  const [quoteAudit, setQuoteAudit] = useState<LadderQuoteHealthAudit>(EMPTY_QUOTE_AUDIT);
  const auditInputRef = useRef({ ladderRows, underlyingPrice, chainQuoteTs });
  auditInputRef.current = { ladderRows, underlyingPrice, chainQuoteTs };
  useEffect(() => {
    if (ladderRows.length === 0) {
      setQuoteAudit(EMPTY_QUOTE_AUDIT);
      return;
    }
    const run = () => {
      const cur = auditInputRef.current;
      const next = auditNearAtmLadderQuotes({
        rows: cur.ladderRows,
        underlyingPrice: cur.underlyingPrice,
        ticks: useOptionsStreamStore.getState().ticks,
        chainQuoteTs: cur.chainQuoteTs,
      });
      setQuoteAudit((prev) => (sameQuoteAudit(prev, next) ? prev : next));
    };
    run();
    const id = window.setInterval(run, AT_QUOTE_AUDIT_MS);
    return () => window.clearInterval(id);
  }, [ladderRows]);

  const ladderHeatSourceDisplay = useMemo(() => {
    const now = Date.now();
    if (!equityOptionsSessionOpen(now)) {
      return { ...ladderHeatSource, label: equityOptionsClosedPill(now), sourceFresh: false };
    }
    if (
      quoteAudit.nearAtmHasInvalid &&
      (ladderHeatSource.kind === "poll" || ladderHeatSource.kind === "stream") &&
      ladderHeatSource.label.length > 0
    ) {
      return { ...ladderHeatSource, label: "Quotes degraded", sourceFresh: false };
    }
    const label = ladderHeatSource.label.trim();
    if (!label) {
      const staleCount = quoteAudit.counts.stale + quoteAudit.counts.crossed + quoteAudit.counts.incomplete;
      if (staleCount > 0 || quoteAudit.nearAtmHasInvalid) {
        return { ...ladderHeatSource, label: "Quotes degraded", sourceFresh: false };
      }
      if (equityOptionsSessionOpen(now)) {
        return { ...ladderHeatSource, label: "", sourceFresh: false };
      }
      return { ...ladderHeatSource, label: "Snapshot · prior session", sourceFresh: false };
    }
    return ladderHeatSource;
  }, [ladderHeatSource, quoteAudit]);

  const { zones, sessionClosed: glanceSessionClosed } = useAtLiveZones(
    symbol,
    primary?.rows,
    underlyingPrice,
    presentation?.zones,
    presentation?.skipNetwork,
  );

  const rowByStrike = useMemo(() => {
    const m = new Map<number, LadderRowModel>();
    for (const r of primary?.rows ?? []) {
      m.set(r.strike, { strike: r.strike, call: r.call, put: r.put });
    }
    return m;
  }, [primary]);

  const positions = usePortfolioStreamStore((s) => s.account?.positions);
  const positionQtyByKey = useMemo(() => {
    const map = new Map<string, number>();
    const list = positions ?? [];
    for (const p of list) {
      const sym = p.instrument?.symbol ?? p.symbol;
      if (typeof sym !== "string") continue;
      const qty = p.longQuantity ?? p.shortQuantity ?? p.quantity ?? 0;
      const signed = p.shortQuantity ? -Math.abs(p.shortQuantity) : qty;
      map.set(sym.trim(), signed);
    }
    for (const row of primary?.rows ?? []) {
      for (const leg of [row.call, row.put]) {
        if (!leg) continue;
        const stream = leg.streamKey?.trim();
        const schwab = typeof leg.schwabSymbol === "string" ? leg.schwabSymbol.trim() : "";
        if (stream && schwab && map.has(schwab)) map.set(stream, map.get(schwab)!);
        if (schwab && stream && map.has(stream)) map.set(schwab, map.get(stream)!);
      }
    }
    return map;
  }, [positions, primary?.rows]);

  const tradingHash = useSchwabAccountStore((s) => s.tradingAccountHash());
  const accounts = useSchwabAccountStore((s) => s.accounts);
  const tradeEpochRef = useRef<string | null>(null);
  useEffect(() => {
    const epoch = `${symbol}|${tradingHash ?? ""}|${activeExpiration ?? ""}`;
    if (tradeEpochRef.current === null) {
      tradeEpochRef.current = epoch;
      return;
    }
    if (tradeEpochRef.current === epoch) return;
    tradeEpochRef.current = epoch;
    atSelectionClear(selection);
    setLegQuantities(new Map());
    setSelected(null);
    setTradeContext(null);
    setTradeStripStrike(null);
    setPrefs((p) => {
      if (!p.autoSend.armed) return p;
      const next = patchAutoSendArmed(p, false);
      saveActiveTraderPrefs(symbolClass, next);
      return next;
    });
  }, [symbol, tradingHash, activeExpiration, symbolClass, selection]);
  const blockLiveSend = !!(presentation?.skipNetwork || getAtFixtureOverride());
  const autoSendBusyRef = useRef(false);

  const onPrefsChange = useCallback(
    (p: ActiveTraderTemplatePrefs) => {
      setPrefs(p);
      saveActiveTraderPrefs(symbolClass, p);
    },
    [symbolClass],
  );

  const templatePrimaryInstruction = useMemo((): SchwabInstruction => {
    const firstLeg = selectedLegs.size > 0 ? [...selectedLegs.values()][0] : null;
    if (firstLeg) return firstLeg.side === "bid" ? "SELL_TO_OPEN" : "BUY_TO_OPEN";
    return lastLegQuoteSide === "bid" ? "SELL_TO_OPEN" : "BUY_TO_OPEN";
  }, [selectedLegs, lastLegQuoteSide]);

  const atmRow = useMemo(() => {
    if (!primary?.rows?.length || underlyingPrice == null) return null;
    const idx = findAtmStrikeIndex(primary.rows.map((r) => r.strike), underlyingPrice);
    return primary.rows[idx] ?? null;
  }, [primary, underlyingPrice]);

  /**
   * Live quotes for the few contracts the header summary and the ticket read
   * (picked legs, last tapped contract, ATM call), a few times a second. The
   * ladder cells subscribe to their own contracts and do not go through here.
   */
  const summaryTickKeys = useMemo(() => {
    const keys = new Set<string>();
    if (selected?.contract.streamKey) keys.add(selected.contract.streamKey);
    if (atmRow?.call?.streamKey) keys.add(atmRow.call.streamKey);
    for (const leg of selectedLegs.values()) {
      if (leg.contract.streamKey) keys.add(leg.contract.streamKey);
    }
    return [...keys].sort();
  }, [selected, atmRow, selectedLegs]);
  const summaryTicks = useOptionTicksForKeys(summaryTickKeys, AT_SUMMARY_TICK_MS);
  const selectedTick = selected?.contract.streamKey ? summaryTicks[selected.contract.streamKey] : undefined;
  const atmTick = atmRow?.call?.streamKey ? summaryTicks[atmRow.call.streamKey] : undefined;
  const templateLimitMid = useMemo(() => {
    const tick = selectedTick ?? atmTick;
    if (!tick) return null;
    if (tick.bid != null && tick.ask != null) return (tick.bid + tick.ask) / 2;
    return tick.mark ?? tick.last ?? null;
  }, [selectedTick, atmTick]);

  useEffect(() => {
    if (!blockLiveSend && tradingHash) return;
    setPrefs((p) => {
      if (!p.autoSend.armed) return p;
      const next = patchAutoSendArmed(p, false);
      saveActiveTraderPrefs(symbolClass, next);
      return next;
    });
  }, [blockLiveSend, tradingHash, symbolClass]);

  const handleTradeIntent = useCallback(
    async (contract: OptionsContract, side: "BUY" | "SELL", type: "CALL" | "PUT") => {
      setLastLegQuoteSide(quoteSideFromTap(side));
      const tick = useOptionsStreamStore.getState().ticks[contract.streamKey ?? ""];
      const entry = resolveAtEntryPrice(tick, prefs, side);
      const primaryInstruction = atPrimaryInstruction(side);
      const validationError = entry
        ? planAtOrderLegs({
            template: prefs.template,
            assetType: "OPTION",
            symbol: contract.streamKey ?? "",
            underlyingSymbol: symbol.replace(/^\$/, ""),
            primaryInstruction,
            quantity: prefs.qty,
            limitPrice: entry,
            takeProfit: prefs.takeProfit,
            stopLoss: prefs.stopLoss,
            entryOrderType: prefs.orderType,
            entryDuration: prefs.entryDuration,
            exitDuration: prefs.exitDuration,
            stopLossOrderType: prefs.stopLossOrderType,
            stopLimitOffset: prefs.stopLimitOffset,
            session: prefs.session,
            advancedRoute: prefs.advancedRoute,
            schwabEntryType: prefs.schwabEntryType,
            routing: prefs.routing,
            trailOffset: prefs.trailOffset,
            trailLinkType: prefs.trailLinkType,
          }).validationError
        : "Missing quote";

      const ready = isAutoSendLiveReady(prefs, {
        accountHash: tradingHash,
        blockLiveSend,
        orderValidationError: validationError,
        entryPrice: entry,
      });

      if (!ready) {
        onOpenReview(contract, side, type);
        return;
      }

      if (autoSendBusyRef.current) return;
      autoSendBusyRef.current = true;
      try {
        const order = buildAtOrderPayload(contract, side, prefs, entry!, symbol.replace(/^\$/, ""), "DAY");
        const result = await submitAtSchwabOrder({
          accountHash: tradingHash!,
          order,
          symbol,
          side,
          quantity: prefs.qty,
          limitPrice: entry,
          dryRun: blockLiveSend,
        });
        if (result.ok) {
          toast({
            title: "Order sent",
            description: `Active Trader · ${side} ${prefs.qty} · #${result.orderId}`,
          });
        } else {
          toast({
            title: "Order failed",
            description: result.message,
            variant: "destructive",
          });
        }
      } finally {
        autoSendBusyRef.current = false;
      }
    },
    [prefs, tradingHash, blockLiveSend, onOpenReview, symbol],
  );

  /**
   * The leg change itself is one synchronous store write, so the tapped cell's
   * outline is on the next frame. Everything that hangs off it (ticket, sheet
   * state, header summary) is a transition and renders after that paint.
   */
  const handleToggleLeg = useCallback(
    (contract: OptionsContract, type: "CALL" | "PUT", side: "bid" | "ask") => {
      const result = atSelectionToggleLeg(selection, contract, type, side);
      if (result === "rejected") return result;
      const key = atLadderLegKey(contract, type);
      const qty = new Map(legQtyRef.current);
      if (result === "removed") qty.delete(key);
      if (result === "removed") {
        startTransition(() => setLegQuantities(qty));
      }
      publishDraft(selection.getState().legs.values(), result === "removed" ? qty : legQtyRef.current);
      return result;
    },
    [selection, publishDraft],
  );

  const handleQuoteTap = useCallback(
    (contract: OptionsContract, type: "CALL" | "PUT", side: "BUY" | "SELL") => {
      const legSide = quoteSideFromTap(side);
      const result = handleToggleLeg(contract, type, legSide);
      startTransition(() => {
        setLastLegQuoteSide(legSide);
        setSelected({ contract, type });
        setTradeStripStrike(contract.strike);
        setTradeContext(null);
      });
      if (result === "added" || result === "flipped") {
        nudgeRef.current = { strike: contract.strike, until: performance.now() + AT_NUDGE_WINDOW_MS };
        // Next frame: measuring the ladder here would force a layout before the outline can paint.
        requestAnimationFrame(nudgeTappedStrikeAboveSheet);
      } else {
        nudgeRef.current = null;
      }
    },
    [handleToggleLeg, nudgeTappedStrikeAboveSheet],
  );

  // A new ticket opens expanded; one the user collapsed stays collapsed while they pick more legs.
  const hasLegs = selectedLegs.size > 0;
  useEffect(() => {
    if (!hasLegs && !sheetCollapsedControlled) setChainSheetCollapsed(false);
  }, [hasLegs, sheetCollapsedControlled]);

  useEffect(() => {
    const onSheet = (ev: Event) => {
      const peekPx = (ev as CustomEvent<{ peekPx?: number }>).detail?.peekPx ?? AT_MOBILE_PEEK_MAX_PX;
      if (tradeStripStrike == null) return;
      requestAnimationFrame(() => {
        scrollAtLadderToStrikeAboveSheet(ladderScrollRef.current, tradeStripStrike, peekPx);
      });
    };
    window.addEventListener("at-mobile-sheet-open", onSheet);
    return () => window.removeEventListener("at-mobile-sheet-open", onSheet);
  }, [tradeStripStrike]);

  const handleVerticalTap = useCallback(
    (payload: {
      anchorStrike: number;
      farStrike: number;
      type: "CALL" | "PUT";
      side: "BUY" | "SELL";
      nearContract: OptionsContract;
    }) => {
      setSelected({ contract: payload.nearContract, type: payload.type });
      setTradeContext({
        mode: "vertical",
        type: payload.type,
        anchorStrike: payload.anchorStrike,
        farStrike: payload.farStrike,
        width: prefs.verticalWidth,
        nearContract: payload.nearContract,
      });
      setTradeStripStrike(payload.anchorStrike);
    },
    [prefs.verticalWidth],
  );

  useEffect(() => {
    const fx = getAtFixtureOverride();
    if (!fx || !primary) return;
    const strike = fx.tapStrike ?? 7545;
    const row = primary.rows.find((r) => r.strike === strike);
    if (fx.verticalStripOnMount && row?.call) {
      handleVerticalTap({
        anchorStrike: strike,
        farStrike: strike + prefs.verticalWidth,
        type: "CALL",
        side: "BUY",
        nearContract: row.call,
      });
      return;
    }
    if (fx.scene !== "strip" || !row?.call) return;
    handleQuoteTap(row.call, "CALL", "BUY");
  }, [primary, handleQuoteTap, handleVerticalTap, prefs.verticalWidth]);

  const trayLegs = useMemo(() => [...selectedLegs.values()], [selectedLegs]);

  const ticketLegs = useMemo(() => {
    if (selectedLegs.size === 0) return [];
    const entries = [...selectedLegs.entries()].map(([key, l]) => {
      const tick = l.contract.streamKey ? summaryTicks[l.contract.streamKey] : undefined;
      const q = mergeChainContractWithStream(l.contract, tick, chainQuoteTs);
      const merged: OptionsContract = {
        ...l.contract,
        bid: q.bid,
        ask: q.ask,
        delta: q.delta,
        gamma: q.gamma,
        theta: q.theta,
        vega: q.vega,
        iv: q.iv,
        contractTs: chainQuoteTs,
      } as OptionsContract & { contractTs?: number };
      const qty = legQuantities.get(key) ?? 1;
      return {
        key,
        contract: merged,
        type: l.type,
        side: l.side,
        quantity: qty,
      };
    });
    return legsFromChainSelection(
      entries,
      symbol,
      accounts,
      buildSchwabOptionKey,
      tradingHash,
    );
  }, [selectedLegs, summaryTicks, symbol, accounts, legQuantities, tradingHash, chainQuoteTs]);

  const ladderOrderSummary = useMemo(() => {
    if (ticketLegs.length === 0) return null;
    const agg = aggregateSpreadNBBO(
      ticketLegs.map((l) => ({
        instruction: l.direction,
        bid: l.bid,
        ask: l.ask,
        quantity: l.quantity,
      })),
    );
    const structure = ticketLegs.map((l) => ({
      strike: l.strike,
      optionType: l.optionType,
      instruction: l.direction,
      quantity: l.quantity,
    }));
    const isCredit = inferNetCreditFromLegStructure(structure) ?? false;
    const spreadMid = agg?.mid ?? null;
    const primaryInstruction: SchwabInstruction =
      ticketLegs.length === 1
        ? ticketLegs[0]!.direction
        : isCredit
          ? "SELL_TO_OPEN"
          : "BUY_TO_OPEN";
    return { spreadMid, primaryInstruction, isCredit };
  }, [ticketLegs]);

  const settingsSummaryLimit = ladderOrderSummary?.spreadMid ?? templateLimitMid;
  const settingsSummaryInstruction = ladderOrderSummary?.primaryInstruction ?? templatePrimaryInstruction;

  useEffect(() => {
    if (selectedLegs.size === 0) return;
    const syms = [...selectedLegs.values()]
      .map((l) => {
        const explicit = l.contract.schwabSymbol?.trim() || l.contract.streamKey?.trim();
        if (explicit) return explicit;
        const root = seriesRootFromExpiration(l.contract.expiration) ?? symbol.replace(/^\$/, "");
        return buildSchwabOptionKey(root, l.contract.expiration, l.contract.strike, l.type === "CALL" ? "C" : "P");
      })
      .filter((s): s is string => !!s);
    if (syms.length > 0) void holdSubs.subscribeOptionSymbols?.(syms);
  }, [selectedLegs, holdSubs, symbol]);

  const handleClearLegs = useCallback(() => {
    atSelectionClear(selection);
    const empty = new Map<string, number>();
    setLegQuantities(empty);
    setTradeStripStrike(null);
    if (onSharedDraftChange) publishDraft([], empty);
    else setChainSheetCollapsed(false);
  }, [selection, onSharedDraftChange, publishDraft]);

  const selectionKeyFromLegId = (legId: string) => legId.split("#")[0];

  const handleFlipLegSides = useCallback(() => {
    const current = selection.getState().legs;
    if (current.size === 0) return;
    const next = new Map<string, AtLadderLegPick>();
    for (const [key, leg] of current) {
      next.set(key, { ...leg, side: leg.side === "bid" ? "ask" : "bid" });
    }
    atSelectionSetLegs(selection, next);
    publishDraft([...next.values()], legQtyRef.current);
  }, [selection, publishDraft]);

  const handleSheetLegQty = useCallback((legId: string, quantity: number) => {
    const key = selectionKeyFromLegId(legId);
    const next = new Map(legQtyRef.current);
    next.set(key, Math.max(1, quantity));
    setLegQuantities(next);
    publishDraft(selection.getState().legs.values(), next);
  }, [selection, publishDraft]);

  const handleSheetRemoveLeg = useCallback(
    (legId: string) => {
      const key = selectionKeyFromLegId(legId);
      atSelectionRemoveLeg(selection, key);
      const next = new Map(legQtyRef.current);
      next.delete(key);
      setLegQuantities(next);
      publishDraft(selection.getState().legs.values(), next);
    },
    [selection, publishDraft],
  );

  const atAddLegFromLadder = useCallback(
    (contract: OptionsContract, type: "CALL" | "PUT", side?: "bid" | "ask") => {
      const legSide = side ?? lastLegQuoteSide;
      setLastLegQuoteSide(legSide);
      handleToggleLeg(contract, type, legSide);
    },
    [handleToggleLeg, lastLegQuoteSide],
  );

  const actionBarContext = useMemo((): AtTradeContext | null => {
    if (tradeContext) return tradeContext;
    if (selectedLegs.size === 0) return null;
    const last = [...selectedLegs.values()][selectedLegs.size - 1];
    if (!last) return null;
    return { mode: "single", contract: last.contract, type: last.type };
  }, [tradeContext, selectedLegs]);

  const showFloatingActionBar = false;
  const showDockedActionBar = ticketLegs.length === 0 && actionBarContext != null;

  const atBracketDraft = useMemo(
    () => ({ prefs, primaryInstruction: settingsSummaryInstruction }),
    [prefs, settingsSummaryInstruction],
  );
  const toggleSettings = useCallback(() => {
    setSettingsOpen((prev) => {
      const next = !prev;
      saveAtSettingsPanelOpen(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeIfOutside = (event: Event) => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      if (
        node.closest(
          "[data-at-order-defaults], [data-at-settings-expanded], [data-at-advanced-order-trigger], [data-radix-popper-content-wrapper], [role='listbox']",
        )
      ) {
        return;
      }
      setSettingsOpen(false);
      saveAtSettingsPanelOpen(false);
    };
    document.addEventListener("pointerdown", closeIfOutside, true);
    return () => document.removeEventListener("pointerdown", closeIfOutside, true);
  }, [settingsOpen]);

  const expiryLabel = primary?.dateLabel ?? "\u2014";
  const underlyingSymbol = symbol.replace(/^\$/, "").toUpperCase();

  useEffect(() => {
    setVisibleStrikes(null);
  }, [symbol, activeExpiration]);

  /** Keep the strikes on screen where they are when a page of strikes lands above them. */
  const prevStrikesRef = useRef<{ key: string; strikes: number[] }>({ key: "", strikes: [] });
  useLayoutEffect(() => {
    const el = ladderScrollRef.current;
    const key = `${symbol}|${activeExpiration ?? ""}`;
    const prev = prevStrikesRef.current;
    if (el && prev.key === key) {
      const shift = atLadderScrollShiftForRows(prev.strikes, ladderStrikes, ladderRowH);
      if (shift !== 0) el.scrollTop += shift;
    }
    prevStrikesRef.current = { key, strikes: ladderStrikes };
  }, [ladderStrikes, ladderRowH, symbol, activeExpiration]);

  /**
   * Center on spot once, when this symbol and expiry's strikes first arrive,
   * before that frame paints. After that the ladder only moves when the user
   * scrolls it, taps Recenter, or a tapped strike would sit under the sheet.
   */
  const centeredKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = ladderScrollRef.current;
    if (!ladderDataReady) {
      // Back to the loading state: the next strikes to arrive open centered again.
      centeredKeyRef.current = null;
      return;
    }
    if (!el || spotStrike == null) return;
    const key = `${symbol}|${activeExpiration ?? ""}`;
    if (centeredKeyRef.current === key) return;
    const idx = ladderStrikes.indexOf(spotStrike);
    if (idx < 0) return;
    centeredKeyRef.current = key;
    el.scrollTop = atLadderScrollTopForRow(idx, readViewport(el));
  }, [symbol, activeExpiration, ladderDataReady, spotStrike, ladderStrikes, readViewport]);

  const scrollLadderToSpot = useCallback(() => {
    const el = ladderScrollRef.current;
    const cur = scrollInputRef.current;
    if (!el || cur.spotStrike == null) return;
    const idx = cur.ladderStrikes.indexOf(cur.spotStrike);
    if (idx < 0) return;
    el.scrollTo({ top: atLadderScrollTopForRow(idx, readViewport(el)), behavior: "smooth" });
  }, [readViewport]);

  const upArmedRef = useRef(true);
  const downArmedRef = useRef(true);
  useEffect(() => {
    upArmedRef.current = true;
    downArmedRef.current = true;
  }, [ladderRows.length]);

  /**
   * Scroll bookkeeping: which strikes are on screen (drives the quote
   * subscription), whether the spot row is still in view (Recenter), and
   * whether the user scrolled into an edge (load the next strikes).
   *
   * Rows are a fixed height, so this is arithmetic on `scrollTop`, once per
   * frame, with no per-row layout reads.
   */
  const measureLadderRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const el = ladderScrollRef.current;
    if (!el || !ladderDataReady) return;
    let frame = 0;
    let visibleTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingVisible: { min: number; max: number } | null = null;
    let lastScrollTop = el.scrollTop;

    const commitVisible = () => {
      visibleTimer = null;
      const next = pendingVisible;
      pendingVisible = null;
      if (!next) return;
      setVisibleStrikes((prev) => (prev && prev.min === next.min && prev.max === next.max ? prev : next));
    };

    const measure = (fromScroll: boolean) => {
      const cur = scrollInputRef.current;
      const strikes = cur.ladderStrikes;
      const viewport = readViewport(el);
      const direction = viewport.scrollTop - lastScrollTop;
      lastScrollTop = viewport.scrollTop;

      const spotIdx = cur.spotStrike != null ? strikes.indexOf(cur.spotStrike) : -1;
      setSpotOutOfView(spotIdx >= 0 && !atLadderRowFullyVisible(spotIdx, viewport));

      const range = atLadderVisibleRowRange({ ...viewport, viewportPx: el.clientHeight });
      if (!range) return;
      const topStrike = strikes[range.first]!;
      const bottomStrike = strikes[range.last]!;
      pendingVisible = {
        min: Math.min(topStrike, bottomStrike),
        max: Math.max(topStrike, bottomStrike),
      };
      if (visibleTimer != null) clearTimeout(visibleTimer);
      if (fromScroll) visibleTimer = setTimeout(commitVisible, AT_VISIBLE_SETTLE_MS);
      else commitVisible();

      // Only a scroll toward an edge loads more strikes: opening the ladder,
      // centering it or nudging a strike must not.
      if (!fromScroll || !cur.onReachEdge || !centeredKeyRef.current) return;
      const contentPx = strikes.length * cur.ladderRowH;
      if (contentPx <= viewport.viewportPx + 8) return;
      const nearTop = viewport.scrollTop < AT_EDGE_LOAD_PX;
      const nearBottom = contentPx - viewport.scrollTop - viewport.viewportPx < AT_EDGE_LOAD_PX;
      if (!nearTop) upArmedRef.current = true;
      if (!nearBottom) downArmedRef.current = true;
      if (nearTop && direction < 0 && upArmedRef.current) {
        upArmedRef.current = false;
        // Highest strike is at the top, so scrolling up asks for higher strikes.
        cur.onReachEdge("up");
      } else if (nearBottom && direction > 0 && downArmedRef.current) {
        downArmedRef.current = false;
        cur.onReachEdge("down");
      }
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure(true);
      });
    };
    measureLadderRef.current = () => measure(false);
    measure(false);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => measure(false));
    ro.observe(el);
    return () => {
      measureLadderRef.current = null;
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (visibleTimer != null) clearTimeout(visibleTimer);
    };
  }, [ladderDataReady, readViewport]);

  // The strike list, the spot strike or the sheet changed without a scroll event.
  useEffect(() => {
    measureLadderRef.current?.();
  }, [ladderStrikes, spotStrike, ladderRowH, sheetPad]);

  if (futuresOnlyMode) {
    return (
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden" style={{ background: BG }}>
        <AtFuturesLiveQuote symbol={symbol} layout="fill" />
      </div>
    );
  }

  return (
    <div
      data-at-root
      className="flex flex-1 min-h-0 flex-col overflow-hidden"
      style={{ background: BG, overscrollBehavior: "none" }}
    >
      <div ref={chromeRef} className="shrink-0 z-[50]" style={{ background: BG_EXP_BAR }}>
        <AtGlanceTop
          symbol={symbol}
          underlyingPrice={underlyingPrice}
          zones={zones}
          glanceCaption={zones.glanceCaption}
          sessionClosed={glanceSessionClosed}
          keepawayPutLine={keepawayPutLine}
          keepawayCallLine={keepawayCallLine}
          keepawayStats={keepawayStats}
          sessionOpen={underlyingQuote?.close ?? null}
          skipNetwork={!!presentation?.skipNetwork}
          embedded
          expiryPickerLoading={!ladderDataReady && !!activeExpiration}
          orderSettings={{
            prefs,
            primaryInstruction: settingsSummaryInstruction,
            limitMid: settingsSummaryLimit,
            open: settingsOpen,
            onToggle: toggleSettings,
          }}
          ladderHeatSource={ladderHeatSourceDisplay}
        />
        <AtOrderDefaultsSheet
          open={settingsOpen}
          prefs={prefs}
          primaryInstruction={templatePrimaryInstruction}
          windowSec={windowSec}
          onWindowSecChange={setWindowSec}
          onClose={() => {
            setSettingsOpen(false);
            saveAtSettingsPanelOpen(false);
          }}
          onSave={(next) => {
            onPrefsChange(next);
            setSettingsOpen(false);
            saveAtSettingsPanelOpen(false);
          }}
        />
      </div>

      <div
        className="shrink-0 z-[48]"
        style={{
          background: AT_HEADER_BG,
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div
          className="grid items-center at-ladder-num"
          style={{
            height: AT_LADDER_GROUP_HDR_H,
            gridTemplateColumns: AT_LADDER_GRID,
            paddingLeft: AT_LADDER_GUTTER_X,
            paddingRight: AT_LADDER_GUTTER_X,
            fontSize: 13,
            color: AT_LABEL,
            fontWeight: FW_LIGHT,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            background: AT_HEADER_BG,
            boxSizing: "border-box",
          }}
        >
          <span
            className="text-center col-span-2 font-bold"
            style={{ color: AT_LADDER_CALLS_HDR, fontSize: 13, letterSpacing: "0.03em" }}
          >
            CALLS
          </span>
          <span
            data-at-ladder-heat-caption
            data-at-ladder-group-metric
            className="text-center"
            title={
              equityOptionsSessionEnded(Date.now())
                ? "Contracts traded in the completed session"
                : "Contracts traded in the last 30 seconds"
            }
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: AT_LABEL,
              letterSpacing: 0,
              textTransform: "none",
              whiteSpace: "nowrap",
              lineHeight: 1.15,
            }}
          >
            {equityOptionsSessionEnded(Date.now()) ? "Contracts · day" : "Contracts · 30s"}
          </span>
          <span
            className="text-center col-span-2 font-bold"
            style={{ color: AT_LADDER_PUTS_HDR, fontSize: 13, letterSpacing: "0.03em" }}
            data-ui-audit="at-puts-hdr"
          >
            PUTS
          </span>
        </div>
        <div
          className="grid items-center at-ladder-num"
          style={{
            height: AT_LADDER_COL_HDR_H,
            gridTemplateColumns: AT_LADDER_GRID,
            paddingLeft: AT_LADDER_GUTTER_X,
            paddingRight: AT_LADDER_GUTTER_X,
            fontSize: 13,
            color: AT_LABEL,
            fontWeight: FW_LIGHT,
            letterSpacing: "0.02em",
            textTransform: "uppercase",
            borderTop: `1px solid ${AT_LADDER_THIN_SEP}`,
            background: AT_HEADER_BG,
            boxSizing: "border-box",
          }}
        >
          <span className="text-center">BID</span>
          <span className="text-center">ASK</span>
          <span className="text-center" style={{ color: AT_LABEL, fontWeight: 600, fontSize: 13 }}>
            STRIKE
          </span>
          <span className="text-center">BID</span>
          <span className="text-center">ASK</span>
        </div>
      </div>

      <div
        className="shrink-0"
        data-at-leg-tray-slot
        style={{
          minHeight: trayLegs.length > 0 && ticketLegs.length === 0 ? 44 : 0,
          background: AT_ORDER_PANEL_BG,
          borderBottom: trayLegs.length > 0 && ticketLegs.length === 0 ? `1px solid ${BORDER_ROW}` : "none",
        }}
      >
        {ticketLegs.length === 0 ? (
          <AtLegBuildTray
            legs={trayLegs}
            qtyByKey={legQuantities}
            onRemove={(key) => {
              const leg = selectedLegs.get(key);
              if (leg) handleToggleLeg(leg.contract, leg.type, leg.side);
            }}
          />
        ) : null}
      </div>

      {/*
        The ladder owns everything from the column header down to the bottom
        nav. The order sheet is drawn over its lower part and never resizes it.
      */}
      <div className="relative flex-1 min-h-0" data-at-ladder-area>
        <div
          ref={ladderScrollRef}
          data-at-ladder-scroll
          data-at-ladder-expiration={activeExpiration ?? undefined}
          data-selected-strike={tradeStripStrike ?? undefined}
          className="at-ladder-scroll h-full min-h-0"
          style={{
            ...noScrollbar,
            overflowY: "auto",
            overflowX: "hidden",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-y",
            background: AT_LADDER_PANEL_BG,
          }}
        >
          {noTradableExpirations ? (
            <p className="px-3 py-4 text-center" style={{ fontSize: 11, color: DIM, fontFamily: MONO }}>
              No current expirations
            </p>
          ) : activeExpiration && !ladderDataReady && !ladderPlug?.chainLoading ? (
            <p
              data-testid="at-expiry-empty"
              className="px-3 py-4 text-center"
              style={{ fontSize: 11, color: DIM, fontFamily: MONO }}
            >
              No contracts for the selected expiration.
            </p>
          ) : ladderDataReady ? (
            <>
              <LadderBody
                rows={ladderRows}
                accentHex={accentHex}
                spotStrike={spotStrike}
                flip={zones.flip}
                callWall={zones.callWall}
                putWall={zones.putWall}
                pinStrike={zones.gammaPinStrike ?? null}
                wallsRolling={!!zones.wallsRollLabel}
                selectedStrike={tradeStripStrike}
                ladderMode={ladderMode}
                rowHeight={ladderRowH}
                verticalWidth={prefs.verticalWidth}
                rowByStrike={rowByStrike}
                onVerticalTap={handleVerticalTap}
                onQuoteTap={handleQuoteTap}
                positionQtyByKey={positionQtyByKey}
                heat={heatStore}
                selection={selection}
                keepawayPutLine={keepawayPutLine}
                keepawayCallLine={keepawayCallLine}
                chainQuoteTs={chainQuoteTs}
                expiryLabel={expiryLabel}
              />
              {/* Scroll room the height of the sheet, so the last strikes can be pulled above it. */}
              <div aria-hidden data-at-ladder-sheet-pad style={{ height: sheetPad }} />
            </>
          ) : (
            <AtLadderSkeleton rowHeight={ladderRowH} message={ladderWaitMessage} />
          )}
        </div>
        {spotOutOfView && ladderDataReady ? (
          <button
            type="button"
            data-at-ladder-recenter
            onClick={scrollLadderToSpot}
            style={{
              position: "absolute",
              right: 8,
              bottom: 12 + sheetPad,
              zIndex: 40,
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 600,
              padding: "6px 10px",
              borderRadius: 999,
              border: `1px solid ${BORDER_ROW}`,
              background: "rgba(12,12,12,0.92)",
              color: WHITE,
            }}
          >
            Recenter
          </button>
        ) : null}
        {ticketLegs.length > 0 ? (
          <div
            ref={sheetRef}
            data-at-order-sheet
            data-at-order-sheet-state={collapsed ? "collapsed" : "open"}
            className="absolute left-0 right-0 bottom-0"
            // Above the ladder rows and Recenter, and above the header (z 50) for the
            // full-screen review step, which is rendered inside this element.
            style={{ zIndex: AT_ORDER_SHEET_Z }}
          >
            <OptionsChainOrderSheet
              legs={ticketLegs}
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
              sheetPeek={chainSheetPeek}
              onSheetPeekChange={setChainSheetPeek}
              onClearAll={handleClearLegs}
              onLegQuantityChange={handleSheetLegQty}
              onRemoveLeg={handleSheetRemoveLeg}
              onFlipSides={handleFlipLegSides}
              subscribeOptionSymbols={holdSubs.subscribeOptionSymbols}
              demoFixture={blockLiveSend}
              atDocked
              atBracketDraft={atBracketDraft}
              onAdvancedOrders={toggleSettings}
              restoredSheetSession={restoredSheetSession}
              onSheetSessionPersist={onSheetSessionPersist}
            />
          </div>
        ) : null}
      </div>

      {selectedLegs.size > 0 ? (
        <span data-at-leg-count className="sr-only">
          {selectedLegs.size}
        </span>
      ) : null}
      {showFloatingActionBar && actionBarContext ? (
        <div
          className="fixed left-0 right-0 z-[112]"
          style={{ bottom: 52 }}
          data-at-collapsed-action-bar
        >
          <AtTradeActionBar
            accentHex={accentHex}
            tradeContext={actionBarContext}
            ladderMode={ladderMode}
            verticalWidth={prefs.verticalWidth}
            rowByStrike={rowByStrike}
            positionQtyByKey={positionQtyByKey}
            onSell={(c, t) => handleTradeIntent(c, "SELL", t)}
            onBuy={(c, t) => handleTradeIntent(c, "BUY", t)}
            onAddLeg={atAddLegFromLadder}
            lastLegQuoteSide={lastLegQuoteSide}
          />
        </div>
      ) : null}
      {showDockedActionBar && actionBarContext ? (
        <AtTradeActionBar
          accentHex={accentHex}
          tradeContext={actionBarContext}
          ladderMode={ladderMode}
          verticalWidth={prefs.verticalWidth}
          rowByStrike={rowByStrike}
          positionQtyByKey={positionQtyByKey}
          onSell={(c, t) => handleTradeIntent(c, "SELL", t)}
          onBuy={(c, t) => handleTradeIntent(c, "BUY", t)}
          onAddLeg={atAddLegFromLadder}
          lastLegQuoteSide={lastLegQuoteSide}
        />
      ) : null}
    </div>
  );
});