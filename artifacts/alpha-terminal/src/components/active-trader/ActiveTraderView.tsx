import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OptionsContract } from "@/components/OptionsTab";
import {
  TOOLBAR_H, SUB_HEADER_H, BG, BG_EXP_BAR, BG_HEADER, BORDER, BORDER_ROW, DIM, GRAY, WHITE, MONO, FW_LIGHT, UP, DOWN, noScrollbar,
} from "@/components/options/optionsTheme";
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
import { AT_VERTICAL_LADDER_ENABLED } from "@/lib/active-trader/atOrderSend";
import { toast } from "@/hooks/use-toast";
import { AtSettingsPanel } from "./AtSettingsPanel";
import {
  loadAtSettingsPanelOpen,
  saveAtSettingsPanelOpen,
} from "@/lib/active-trader/atSettingsPanelState";
import { LadderBody, type AtTradeContext, type LadderRowModel } from "./LadderBody";
import { useAtLiveZones } from "@/lib/active-trader/useAtLiveZones";
import type { AtVerticalWidth } from "@/lib/active-trader/activeTraderPrefs";
import { AT_LADDER_PANEL_BG } from "@/lib/active-trader/atLadderLayout";
import { AtLadderSkeleton } from "./AtLadderSkeleton";
import { AtKeyLevelsStrip } from "./AtKeyLevelsStrip";
import { AT_LADDER_GRID, AT_LADDER_GROUP_HDR_H, AT_LADDER_ROW_H } from "@/lib/active-trader/atLadderLayout";
import { useAtChromeStore } from "@/lib/active-trader/atChromeStore";
import { useUICustomizationStore } from "@/lib/ui-customization-store";

export interface AtExpirationGroup {
  expiration: string;
  dte: number;
  dateLabel: string;
  rows: { strike: number; call: OptionsContract | null; put: OptionsContract | null }[];
}

interface ActiveTraderViewProps {
  symbol: string;
  groups: AtExpirationGroup[];
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
}

const LADDER_RADIUS = 20;

export const ActiveTraderView = memo(function ActiveTraderView({
  symbol,
  groups,
  underlyingPrice,
  stickyOffset,
  accentHex,
  holdSubs,
  onAddLeg,
  onOpenReview,
  presentation,
  initialTradeSelection,
  settingsPanelInitiallyOpen,
}: ActiveTraderViewProps) {
  const primary = groups[0];
  const ladderDataReady = !!(primary && primary.rows.length > 0);
  const [windowSec, setWindowSec] = useState<30 | 60 | 300>(30);
  const [laneFilters, setLaneFilters] = useState<Record<LaneFilterKey, boolean>>({
    call_buy: true,
    call_sell: true,
    put_buy: true,
    put_sell: true,
  });
  const [tradeStripStrike, setTradeStripStrike] = useState<number | null>(null);
  const [tradeContext, setTradeContext] = useState<AtTradeContext | null>(null);
  const [selected, setSelected] = useState<{ contract: OptionsContract; type: "CALL" | "PUT" } | null>(null);
  const [regimeLabel, setRegimeLabel] = useState<string | null>(null);
  const [regimeDegraded, setRegimeDegraded] = useState(false);

  const symbolClass = symbol.toUpperCase().includes("SPX") || symbol.startsWith("$") ? "index" : "equity";
  const [prefs, setPrefs] = useState<ActiveTraderTemplatePrefs>(() => loadActiveTraderPrefs(symbolClass));
  const ladderMode = AT_VERTICAL_LADDER_ENABLED ? prefs.ladderMode : "single";
  const [settingsOpen, setSettingsOpen] = useState(
    () => settingsPanelInitiallyOpen ?? loadAtSettingsPanelOpen(),
  );
  const chromeRef = useRef<HTMLDivElement>(null);
  const [chromeHeight, setChromeHeight] = useState(TOOLBAR_H);

  useEffect(() => {
    const node = chromeRef.current;
    if (!node) return;
    const ro = new ResizeObserver(() => setChromeHeight(node.offsetHeight));
    ro.observe(node);
    setChromeHeight(node.offsetHeight);
    return () => ro.disconnect();
  }, [settingsOpen]);

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
    const strikes = primary.rows.map((r) => r.strike);
    const atm = findAtmStrikeIndex(strikes, underlyingPrice);
  const start = Math.max(0, atm - LADDER_RADIUS);
    const end = Math.min(primary.rows.length, atm + LADDER_RADIUS + 1);
    const slice = primary.rows.slice(start, end);
    return slice
      .map((r) => ({ strike: r.strike, call: r.call, put: r.put }))
      .sort((a, b) => b.strike - a.strike);
  }, [primary, underlyingPrice]);

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

  const zones = useAtLiveZones(primary?.rows, underlyingPrice, presentation?.zones);

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
    return map;
  }, [positions]);

  const tradingHash = useSchwabAccountStore((s) => s.tradingAccountHash());
  const blockLiveSend = !!(presentation?.skipNetwork || getAtFixtureOverride());
  const autoSendBusyRef = useRef(false);

  const accounts = useSchwabAccountStore((s) => s.accounts);
  const accountLabel =
    accounts.length > 0
      ? `LIVE ••${String(accounts[0]?.accountNumber ?? "").replace(/\D/g, "").slice(-3)}`
      : presentation?.skipNetwork
        ? "LIVE ••495"
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

  const headerMode = useUICustomizationStore((s) => s.headerMode);
  const restoreSavedHeaderMode = useAtChromeStore((s) => s.restoreSavedHeaderMode);
  const reapplyAtCompactHeader = useAtChromeStore((s) => s.reapplyAtCompactHeader);
  const atHeaderCompact = headerMode === "collapsed";

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
      primaryInstruction: templatePrimaryInstruction,
      quantity: prefs.qty,
      limitPrice: templateLimitMid,
      takeProfit: prefs.takeProfit,
      stopLoss: prefs.stopLoss,
      entryOrderType: prefs.orderType,
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
            primaryInstruction,
            quantity: prefs.qty,
            limitPrice: entry,
            takeProfit: prefs.takeProfit,
            stopLoss: prefs.stopLoss,
            entryOrderType: prefs.orderType,
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
        const order = buildAtOrderPayload(contract, side, prefs, entry!);
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

  const handleQuoteTap = useCallback((contract: OptionsContract, type: "CALL" | "PUT", _side: "BUY" | "SELL") => {
    setSelected({ contract, type });
    setTradeContext({ mode: "single", contract, type });
    setTradeStripStrike(contract.strike);
  }, []);

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

  const keyLevelsTop = stickyOffset + chromeHeight;
  const ladderHeaderTop = keyLevelsTop + 68;
  const ladderHdrStack = AT_LADDER_GROUP_HDR_H + AT_LADDER_ROW_H;
  const ladderReserve = atHeaderCompact ? 44 : 80;
  const ladderMaxHeight = `max(360px, calc(100dvh - ${ladderHeaderTop + ladderHdrStack + ladderReserve}px))`;

  const expiryLabel = primary?.dateLabel ?? "\u2014";
  const dteLabel = primary ? (primary.dte === 0 ? "0DTE" : `${primary.dte}D`) : "0DTE";

  return (
    <div style={{ background: BG }}>
      <div ref={chromeRef}>
        <div className="sticky z-[39]" style={{ top: stickyOffset }}>
          <AtSettingsPanel
            open={settingsOpen}
            onToggle={toggleSettings}
            accentHex={accentHex}
            prefs={prefs}
            onPrefsChange={onPrefsChange}
            instrumentLabel={instrumentLabel}
            onSell={() => selected && handleTradeIntent(selected.contract, "SELL", selected.type)}
            onBuy={() => selected && handleTradeIntent(selected.contract, "BUY", selected.type)}
            autoSendArmBlock={autoSendArmBlock}
            accountLabel={accountLabel}
            isPaper={isPaper}
            sessionLabel={presentation?.sessionLabel}
            laneFilters={laneFilters}
            onToggleLane={toggleLane}
            classifiedPct={classifiedPct}
            windowLabel={`last ${windowSec}s`}
            primaryInstruction={templatePrimaryInstruction}
            limitMid={templateLimitMid}
            expiryLabel={expiryLabel}
            dteLabel={dteLabel}
            windowSec={windowSec}
            onWindowSecChange={setWindowSec}
          />
        </div>
      </div>

      <div style={{ top: keyLevelsTop }} className="sticky z-[38]">
        <AtKeyLevelsStrip
          accentHex={accentHex}
          zones={zones}
          regimeLabel={presentation?.regimeLabel ?? regimeLabel}
          regimeDegraded={presentation?.regimeDegraded ?? regimeDegraded}
          spot={underlyingPrice}
          headerCompact={atHeaderCompact}
          onExpandHeader={restoreSavedHeaderMode}
          onCompactHeader={reapplyAtCompactHeader}
        />
      </div>

      <div className="sticky z-[36]" style={{ top: ladderHeaderTop, background: BG_HEADER, borderBottom: `1px solid ${BORDER}` }}>
        <div
          className="grid items-center px-0.5"
          style={{
            height: AT_LADDER_GROUP_HDR_H,
            gridTemplateColumns: AT_LADDER_GRID,
            fontFamily: MONO,
            fontSize: 8,
            color: DIM,
            fontWeight: FW_LIGHT,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
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
            height: AT_LADDER_ROW_H,
            gridTemplateColumns: AT_LADDER_GRID,
            fontFamily: MONO,
            fontSize: 9,
            color: DIM,
            fontWeight: FW_LIGHT,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            borderTop: `1px solid ${BORDER_ROW}`,
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

      <div style={{ ...noScrollbar, maxHeight: ladderMaxHeight, overflowY: "auto", background: AT_LADDER_PANEL_BG }}>
        {ladderDataReady ? (
        <LadderBody
          rows={ladderRows}
          accentHex={accentHex}
          underlyingPrice={underlyingPrice}
          zones={zones}
          laneFilters={laneFilters}
          tradeStripStrike={tradeStripStrike}
          tradeContext={tradeContext}
          ladderMode={ladderMode}
          verticalWidth={prefs.verticalWidth}
          rowByStrike={rowByStrike}
          onVerticalTap={handleVerticalTap}
          onQuoteTap={handleQuoteTap}
          onTradeStripSell={(c, t) => handleTradeIntent(c, "SELL", t)}
          onTradeStripBuy={(c, t) => handleTradeIntent(c, "BUY", t)}
          onAddLeg={onAddLeg}
          positionQtyByKey={positionQtyByKey}
          flowByKey={flowByKey}
          symbolLabel={symbol.replace(/^\$/, "").slice(0, 3).toUpperCase()}
        />
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
    </div>
  );
});