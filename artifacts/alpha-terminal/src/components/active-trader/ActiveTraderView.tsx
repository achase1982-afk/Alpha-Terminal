import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  BG, BG_EXP_BAR, BG_HEADER, BORDER, BORDER_ROW, DIM, GRAY, WHITE, MONO, FW_LIGHT, UP, DOWN, noScrollbar,
} from "@/components/options/optionsTheme";
import { AT_LABEL } from "@/lib/active-trader/atChromeContrast";
import { buildAtHoldSignature } from "@/lib/active-trader/atHoldSig";
import type { ZoneModel } from "@/lib/active-trader/zonesModel";
import {
  loadActiveTraderPrefs,
  saveActiveTraderPrefs,
  type ActiveTraderTemplatePrefs,
} from "@/lib/active-trader/activeTraderPrefs";
import { useFlowByKey } from "@/lib/active-trader/useFlowByKey";
import { findAtmStrikeIndex } from "@/lib/optionsSchwabKey";
import { useChainOptionHold } from "@/hooks/useChainOptionHold";
import type { ChainHoldSubscribers } from "@/hooks/useChainOptionHold";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePortfolioStreamStore } from "@/lib/portfolio-stream-store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import type { LaneFilterKey } from "./FilterStrip";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import { useOptionTick, useOptionsStreamStore } from "@/lib/options-stream-store";
import { getAtFixtureOverride } from "@/lib/active-trader/atFixtureBridge";
import {
  canArmAutoSend,
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
import { AT_VERTICAL_LADDER_ENABLED } from "@/lib/active-trader/atOrderSend";
import {
  OptionsChainOrderSheet,
  legsFromChainSelection,
} from "@/components/OptionsChainOrderSheet";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";
import {
  AT_MAX_LADDER_LEGS,
  atLadderLegKey,
  quoteSideFromTap,
  type AtLadderLegPick,
} from "@/lib/active-trader/atLadderLegKeys";
import { AtActiveTraderSheetBrackets } from "@/components/active-trader/AtActiveTraderSheetBrackets";
import { aggregateSpreadNBBO, inferNetCreditFromLegStructure } from "@workspace/order-ticket-math";
import { toast } from "@/hooks/use-toast";
import { AtSettingsExpanded, AtSettingsSummary } from "./AtSettingsPanel";
import { AtGlanceTop } from "./AtGlanceTop";
import { mergeChainContractWithStream } from "@/lib/chainContractQuoteMerge";
import { atSheetPeekHeightPx } from "@/lib/active-trader/atSheetLayout";
import {
  loadAtSettingsPanelOpen,
  saveAtSettingsPanelOpen,
} from "@/lib/active-trader/atSettingsPanelState";
import { LadderBody, type AtTradeContext, type LadderRowModel } from "./LadderBody";
import { AtTradeActionBar } from "./AtTradeActionBar";
import {
  atLadderSpotOffCenter,
  scrollAtLadderToSpot,
  scrollAtLadderToStrike,
  scrollAtLadderToStrikeAboveSheet,
} from "@/lib/active-trader/atLadderScroll";
import { AT_MOBILE_PEEK_MAX_PX } from "@/components/active-trader/AtMobileGlanceOrderSheet";
import { useAtLiveZones } from "@/lib/active-trader/useAtLiveZones";
import type { AtVerticalWidth } from "@/lib/active-trader/activeTraderPrefs";
import { AT_LADDER_PANEL_BG } from "@/lib/active-trader/atLadderLayout";
import { AtLadderSkeleton } from "./AtLadderSkeleton";
import { AT_LADDER_GRID, AT_LADDER_GROUP_HDR_H, AT_LADDER_ROW_H } from "@/lib/active-trader/atLadderLayout";
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
}: ActiveTraderViewProps) {
  const primary =
    groups.find((g) => g.expiration === activeExpiration) ?? groups[0];
  const ladderDataReady = !!(primary && primary.rows.length > 0);
  /** Futures root without an options ladder (live); fixture/dev chains keep the AT ladder. */
  const futuresOnlyMode = isFuturesDisplaySymbol(symbol) && !ladderDataReady;
  const [windowSec, setWindowSec] = useState<30 | 60 | 300>(30);
  const [laneFilters, setLaneFilters] = useState<Record<LaneFilterKey, boolean>>({
    call_buy: true,
    call_sell: true,
    put_buy: true,
    put_sell: true,
  });
  const [tradeStripStrike, setTradeStripStrike] = useState<number | null>(null);
  const [tradeContext, setTradeContext] = useState<AtTradeContext | null>(null);
  const [selectedLegs, setSelectedLegs] = useState<Map<string, AtLadderLegPick>>(new Map());
  const [legQuantities, setLegQuantities] = useState<Map<string, number>>(new Map());
  const [chainSheetCollapsed, setChainSheetCollapsed] = useState(false);
  const [chainSheetPeek, setChainSheetPeek] = useState(true);
  const chainQuoteTs = chainQuoteTsProp ?? Date.now();
  const legShakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState<{ contract: OptionsContract; type: "CALL" | "PUT" } | null>(null);
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
  const ladderMode = AT_VERTICAL_LADDER_ENABLED ? prefs.ladderMode : "single";
  const [settingsOpen, setSettingsOpen] = useState(
    () => settingsPanelInitiallyOpen ?? loadAtSettingsPanelOpen(),
  );
  const chromeRef = useRef<HTMLDivElement>(null);
  const ladderScrollRef = useRef<HTMLDivElement>(null);
  const [ladderOffCenter, setLadderOffCenter] = useState(false);

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

  const ladderRows: LadderRowModel[] = useMemo(() => {
    if (!primary?.rows?.length) return [];
    return [...primary.rows]
      .map((r) => ({ strike: r.strike, call: r.call, put: r.put }))
      .sort((a, b) => b.strike - a.strike);
  }, [primary]);

  const streamKeys = useMemo(() => {
    const keys: string[] = [];
    for (const row of ladderRows) {
      if (row.call?.streamKey) keys.push(row.call.streamKey);
      if (row.put?.streamKey) keys.push(row.put.streamKey);
    }
    return keys;
  }, [ladderRows]);

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

  const flowByKey = useFlowByKey(streamKeys, windowSec * 1000);

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

  const classifiedPct = useMemo(() => {
    if (presentation?.classifiedPct != null) return presentation.classifiedPct;
    let cls = 0;
    let tot = 0;
    for (const k of streamKeys) {
      const f = flowByKey[k];
      if (!f) continue;
      const c = f.buy + f.sell + f.even;
      const t = c + f.unknown;
      cls += c;
      tot += t;
    }
    return tot > 0 ? cls / tot : null;
  }, [flowByKey, streamKeys, presentation?.classifiedPct]);

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
  const blockLiveSend = !!(presentation?.skipNetwork || getAtFixtureOverride());
  const autoSendBusyRef = useRef(false);

  const accountLabel =
    accounts.length > 0
      ? `Schwab ···${String(accounts[0]?.accountNumber ?? "").slice(-3)}`
      : presentation?.skipNetwork
        ? "Demo acct"
        : "Account";
  const isPaper = false;

  const toggleLane = useCallback((key: LaneFilterKey) => {
    setLaneFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const onPrefsChange = useCallback(
    (p: ActiveTraderTemplatePrefs) => {
      setPrefs(p);
      saveActiveTraderPrefs(symbolClass, p);
    },
    [symbolClass],
  );

  const selectedTick = useOptionTick(selected?.contract.streamKey);
  const templatePrimaryInstruction = useMemo((): SchwabInstruction => {
    if (!selected) return "BUY_TO_OPEN";
    return selected.type === "CALL"
      ? "BUY_TO_OPEN"
      : "BUY_TO_OPEN";
  }, [selected]);

  const atmRow = useMemo(() => {
    if (!primary?.rows?.length || underlyingPrice == null) return null;
    const idx = findAtmStrikeIndex(primary.rows.map((r) => r.strike), underlyingPrice);
    return primary.rows[idx] ?? null;
  }, [primary, underlyingPrice]);

  const atmTick = useOptionTick(atmRow?.call?.streamKey);
  const templateLimitMid = useMemo(() => {
    const tick = selectedTick ?? atmTick;
    if (!tick) return null;
    if (tick.bid != null && tick.ask != null) return (tick.bid + tick.ask) / 2;
    return tick.mark ?? tick.last ?? null;
  }, [selectedTick, atmTick]);

  const autoSendLegValidation = useMemo(() => {
    if (templateLimitMid == null || templateLimitMid <= 0 || !selected) return null;
    return planAtOrderLegs({
      template: prefs.template,
      assetType: "OPTION",
      symbol: "",
      underlyingSymbol: symbol.replace(/^\$/, ""),
      primaryInstruction: templatePrimaryInstruction,
      quantity: prefs.qty,
      limitPrice: templateLimitMid,
      takeProfit: prefs.takeProfit,
      stopLoss: prefs.stopLoss,
      entryOrderType: prefs.orderType,
      exitDuration: prefs.exitDuration,
      stopLossOrderType: prefs.stopLossOrderType,
      stopLimitOffset: prefs.stopLimitOffset,
    }).validationError;
  }, [prefs, selected, templateLimitMid, templatePrimaryInstruction]);

  const autoSendArmBlock = useMemo(
    () =>
      canArmAutoSend({
        accountHash: tradingHash,
        blockLiveSend,
        orderValidationError: autoSendLegValidation,
        entryPrice: templateLimitMid,
      }),
    [tradingHash, blockLiveSend, autoSendLegValidation, templateLimitMid],
  );

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
            exitDuration: prefs.exitDuration,
            stopLossOrderType: prefs.stopLossOrderType,
            stopLimitOffset: prefs.stopLimitOffset,
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

  const handleToggleLeg = useCallback((contract: OptionsContract, type: "CALL" | "PUT", side: "bid" | "ask") => {
    const key = atLadderLegKey(contract, type);
    setSelectedLegs((prev) => {
      const next = new Map(prev);
      const existing = next.get(key);
      if (existing && existing.side === side) {
        next.delete(key);
        setLegQuantities((q) => {
          const nq = new Map(q);
          nq.delete(key);
          return nq;
        });
      } else if (existing) {
        next.set(key, { contract, type, expiration: contract.expiration, side });
      } else {
        if (prev.size >= AT_MAX_LADDER_LEGS) {
          if (legShakeTimerRef.current) clearTimeout(legShakeTimerRef.current);
          legShakeTimerRef.current = setTimeout(() => undefined, 0);
          return prev;
        }
        next.set(key, { contract, type, expiration: contract.expiration, side });
      }
      return next;
    });
    setChainSheetCollapsed(false);
    setChainSheetPeek(true);
  }, []);

  const handleQuoteTap = useCallback(
    (contract: OptionsContract, type: "CALL" | "PUT", side: "BUY" | "SELL") => {
      setSelected({ contract, type });
      setTradeStripStrike(contract.strike);
      setTradeContext(null);
      handleToggleLeg(contract, type, quoteSideFromTap(side));
      requestAnimationFrame(() => {
        const sheetPx = chainSheetCollapsed ? 52 : chainSheetPeek ? atSheetPeekHeightPx() : 280;
        scrollAtLadderToStrikeAboveSheet(ladderScrollRef.current, contract.strike, sheetPx);
      });
    },
    [chainSheetCollapsed, chainSheetPeek, handleToggleLeg],
  );

  useEffect(() => {
    if (!tradeStripStrike) return;
    requestAnimationFrame(() => {
      scrollAtLadderToStrike(ladderScrollRef.current, tradeStripStrike, 0.32);
    });
  }, [tradeStripStrike, tradeContext]);

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

  const streamTicksForLegs = useOptionsStreamStore((s) => s.ticks);

  const selectedLegKeys = useMemo(() => new Set(selectedLegs.keys()), [selectedLegs]);

  const ticketLegs = useMemo(() => {
    if (selectedLegs.size === 0) return [];
    const entries = [...selectedLegs.entries()].map(([key, l]) => {
      const tick = l.contract.streamKey ? streamTicksForLegs[l.contract.streamKey] : undefined;
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
  }, [selectedLegs, streamTicksForLegs, symbol, accounts, legQuantities, tradingHash, chainQuoteTs]);

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
      .map((l) => l.contract.schwabSymbol ?? (l.contract.streamKey ? buildSchwabOptionKey(symbol, l.contract.expiration, l.contract.strike, l.type === "CALL" ? "C" : "P") : null))
      .filter((s): s is string => !!s);
    if (syms.length > 0) void holdSubs.subscribeOptionSymbols?.(syms);
  }, [selectedLegs, holdSubs, symbol]);

  const handleClearLegs = useCallback(() => {
    setSelectedLegs(new Map());
    setLegQuantities(new Map());
    setChainSheetCollapsed(false);
    setTradeStripStrike(null);
  }, []);

  const selectionKeyFromLegId = (legId: string) => legId.split("#")[0];

  const handleSheetLegQty = useCallback((legId: string, quantity: number) => {
    const key = selectionKeyFromLegId(legId);
    setLegQuantities((prev) => {
      const next = new Map(prev);
      next.set(key, Math.max(1, quantity));
      return next;
    });
  }, []);

  const handleSheetRemoveLeg = useCallback((legId: string) => {
    const key = selectionKeyFromLegId(legId);
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
  }, []);

  const atAddLegFromLadder = useCallback(
    (contract: OptionsContract, type: "CALL" | "PUT") => {
      handleToggleLeg(contract, type, "ask");
    },
    [handleToggleLeg],
  );

  const instrumentLabel = useMemo(() => {
    if (selected) {
      const root = symbol.replace(/^\$/, "").slice(0, 4);
      return `${root} ${selected.contract.strike}${selected.type === "CALL" ? "C" : "P"}`;
    }
    const und = symbol.replace(/^\$/, "").toUpperCase();
    return `${und} · pick strike`;
  }, [selected, symbol]);

  const toggleSettings = useCallback(() => {
    setSettingsOpen((prev) => {
      const next = !prev;
      saveAtSettingsPanelOpen(next);
      return next;
    });
  }, []);

  const fixtureTight = !!presentation?.skipNetwork;
  const sheetScrollPad =
    selectedLegs.size > 0
      ? chainSheetCollapsed
        ? 64
        : chainSheetPeek
          ? atSheetPeekHeightPx()
          : 300
      : 0;
  const ladderRowH = fixtureTight ? 36 : AT_LADDER_ROW_H;

  const expiryLabel = primary?.dateLabel ?? "\u2014";
  const underlyingSymbol = symbol.replace(/^\$/, "").toUpperCase();
  const symbolLabel = underlyingSymbol;
  const scrollLadderToSpot = useCallback(() => {
    requestAnimationFrame(() => {
      scrollAtLadderToSpot(ladderScrollRef.current, underlyingPrice);
    });
  }, [underlyingPrice]);

  useEffect(() => {
    scrollLadderToSpot();
  }, [symbol, activeExpiration, ladderDataReady, scrollLadderToSpot, ladderRows.length]);

  useEffect(() => {
    const el = ladderScrollRef.current;
    if (!el) return;
    const sync = () => setLadderOffCenter(atLadderSpotOffCenter(el, underlyingPrice));
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, [underlyingPrice, ladderRows.length, ladderDataReady]);

  useEffect(() => {
    if (underlyingPrice == null) return;
    scrollLadderToSpot();
  }, [underlyingPrice, scrollLadderToSpot]);

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
          embedded
        />
        <AtSettingsExpanded
          open={settingsOpen}
          accentHex={accentHex}
          prefs={prefs}
          onPrefsChange={onPrefsChange}
          instrumentLabel={instrumentLabel}
          onSell={() => selected && handleTradeIntent(selected.contract, "SELL", selected.type)}
          onBuy={() => selected && handleTradeIntent(selected.contract, "BUY", selected.type)}
          accountLabel={accountLabel}
          isPaper={isPaper}
          primaryInstruction={templatePrimaryInstruction}
          limitMid={templateLimitMid}
          autoSendArmBlock={autoSendArmBlock}
          underlyingSymbol={underlyingSymbol}
          windowSec={windowSec}
          onWindowSecChange={setWindowSec}
        />
      </div>

      <div
        className="shrink-0 z-[48]"
        style={{
          background: BG_HEADER,
          borderBottom: `1px solid ${BORDER}`,
          boxShadow: "0 2px 6px rgba(0,0,0,0.55)",
        }}
      >
        <AtSettingsSummary
          slim={false}
          glanceSlim
          open={settingsOpen}
          onToggle={toggleSettings}
          prefs={prefs}
          primaryInstruction={settingsSummaryInstruction}
          limitMid={settingsSummaryLimit}
          expiryLabel={expiryLabel}
          underlyingSymbol={underlyingSymbol}
        />
        <div
          className="grid items-center px-0.5"
          style={{
            height: AT_LADDER_GROUP_HDR_H,
            gridTemplateColumns: AT_LADDER_GRID,
            fontFamily: MONO,
            fontSize: 8,
            color: AT_LABEL,
            fontWeight: FW_LIGHT,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            background: BG_HEADER,
          }}
        >
          <span className="text-center leading-none font-semibold" style={{ color: DOWN, fontSize: 9 }}>
            Put flow
          </span>
          <span className="text-center col-span-2 font-bold" style={{ color: DOWN, fontSize: 10 }} data-ui-audit="at-puts-hdr">
            Puts
          </span>
          <span />
          <span className="text-center col-span-2 font-bold" style={{ color: UP, fontSize: 10 }}>
            Calls
          </span>
          <span className="text-center leading-none font-semibold" style={{ color: UP, fontSize: 9 }}>
            Call flow
          </span>
        </div>
        <div
          className="grid items-center px-0.5"
          style={{
            height: ladderRowH,
            gridTemplateColumns: AT_LADDER_GRID,
            fontFamily: MONO,
            fontSize: 9,
            color: AT_LABEL,
            fontWeight: FW_LIGHT,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            borderTop: `1px solid ${BORDER_ROW}`,
            background: BG_HEADER,
          }}
        >
          <span />
          <span className="text-right pr-1">Bid</span>
          <span className="text-right pr-1">Ask</span>
          <span className="text-center" style={{ color: WHITE, fontWeight: 600 }}>Strike</span>
          <span className="text-right pr-1">Bid</span>
          <span className="text-right pr-1">Ask</span>
          <span />
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
      <div
        ref={ladderScrollRef}
        data-at-ladder-scroll
        data-selected-strike={tradeStripStrike ?? undefined}
        className="at-ladder-scroll h-full min-h-0"
        style={{
          ...noScrollbar,
          overflowY: "auto",
          overflowX: "hidden",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          background: AT_LADDER_PANEL_BG,
          paddingBottom: sheetScrollPad,
        }}
      >
        {ladderDataReady ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
          <LadderBody
            rows={ladderRows}
            accentHex={accentHex}
            underlyingPrice={underlyingPrice}
            zones={zones}
            laneFilters={laneFilters}
            selectedStrike={tradeStripStrike}
            ladderMode={ladderMode}
            rowHeight={ladderRowH}
            verticalWidth={prefs.verticalWidth}
            rowByStrike={rowByStrike}
            onVerticalTap={handleVerticalTap}
            onQuoteTap={handleQuoteTap}
            onAddLeg={atAddLegFromLadder}
            selectedLegKeys={selectedLegKeys}
            positionQtyByKey={positionQtyByKey}
            flowByKey={flowByKey}
            symbolLabel={symbolLabel}
            keepawayPutLine={keepawayPutLine}
            keepawayCallLine={keepawayCallLine}
            chainQuoteTs={chainQuoteTs}
          />
          </div>
        ) : (
          <>
            {!presentation?.skipNetwork && (
              <p className="px-3 py-2 text-center" style={{ fontSize: 11, color: DIM, fontFamily: MONO }}>
                Waiting for live chain and stream quotes…
              </p>
            )}
            <AtLadderSkeleton accentHex={accentHex} />
          </>
        )}
      </div>
      {ladderOffCenter ? (
        <button
          type="button"
          data-at-ladder-recenter
          onClick={scrollLadderToSpot}
          style={{
            position: "absolute",
            right: 8,
            bottom: 12 + sheetScrollPad,
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
      </div>

      {selectedLegs.size > 0 ? (
        <span data-at-leg-count className="sr-only">
          {selectedLegs.size}
        </span>
      ) : null}
      {ticketLegs.length > 0 ? (
        <OptionsChainOrderSheet
          legs={ticketLegs}
          collapsed={chainSheetCollapsed}
          onCollapsedChange={setChainSheetCollapsed}
          sheetPeek={chainSheetPeek}
          onSheetPeekChange={setChainSheetPeek}
          onClearAll={handleClearLegs}
          onLegQuantityChange={handleSheetLegQty}
          onRemoveLeg={handleSheetRemoveLeg}
          subscribeOptionSymbols={holdSubs.subscribeOptionSymbols}
          demoFixture={blockLiveSend}
          sendPreviewOnly
          extrasAfterLimit={({ limitPerShare, isCredit, legCount }) => (
            <AtActiveTraderSheetBrackets
              prefs={prefs}
              onPrefsChange={onPrefsChange}
              entryPrice={limitPerShare}
              underlyingSymbol={underlyingSymbol}
              isSpread={legCount > 1}
              isCredit={isCredit}
              primaryInstruction={templatePrimaryInstruction}
            />
          )}
        />
      ) : tradeContext ? (
        <AtTradeActionBar
          accentHex={accentHex}
          tradeContext={tradeContext}
          ladderMode={ladderMode}
          verticalWidth={prefs.verticalWidth}
          rowByStrike={rowByStrike}
          positionQtyByKey={positionQtyByKey}
          onSell={(c, t) => handleTradeIntent(c, "SELL", t)}
          onBuy={(c, t) => handleTradeIntent(c, "BUY", t)}
          onAddLeg={atAddLegFromLadder}
        />
      ) : null}
    </div>
  );
});