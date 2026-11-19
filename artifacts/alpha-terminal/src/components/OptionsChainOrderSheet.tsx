import { useState, useMemo, useCallback, useEffect, useRef, type CSSProperties } from "react";
import {
  aggregateSpreadNBBO,
  computeChainTicketSummary,
  displaySubmittedLimit,
  mergeLegStreamQuotes,
  optionPremiumTickForSymbol,
  parseCanonicalLimit,
  resolveSubmittedLimit,
  roundOptionPriceToTick,
  schwabPriceFromTicket,
  inferNetCreditFromLegStructure,
  inferSchwabComplexOrderStrategyType,
  midpointFromBidAsk,
  chainLegHydrateKey,
  quoteSideState,
  formatNetGreekDisplay,
  type LimitTickContext,
} from "@workspace/order-ticket-math";
import { AT_SHEET_FULL_VH, AT_SHEET_PEEK_VH } from "@/lib/active-trader/atSheetLayout";
import {
  resolveChainLegInstructions,
  type SchwabAccountRow,
} from "@/lib/chainOrderLegInstructions";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toast } from "@/hooks/use-toast";
import { useTerminalStore } from "@/lib/store";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { useOptionTicksForKeys } from "@/lib/useOptionTicksForKeys";
import {
  detectStrategyType,
  type StrategyLeg,
} from "@/components/StrategyBuilder";
import {
  ChevronDown,
  ChevronUp,
  Minus,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeOrderEconomics } from "@workspace/order-ticket-math";
import { estimateSchwabOptionFees, computeOrderNetCash } from "@/lib/orders/schwabOrderFees";
import { humanInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import { buildChainSheetSchwabOrder, resolveVisibleChainOrderType } from "@/lib/active-trader/chainSheetSchwabOrder";
import { interpretBracketPlaceOrderResult } from "@/lib/active-trader/bracketPlaceOrderResult";
import {
  assertChainDraftLegCount,
  CHAIN_LEG_LIMIT_MESSAGE,
} from "@/lib/orders/chainDraftLegLimits";
import {
  type ActiveTraderTemplatePrefs,
} from "@/lib/active-trader/activeTraderPrefs";
import { atOrderSendAllowed, atOrderSendUnavailableReason } from "@/lib/active-trader/atOrderSend";
import {
  buildChainSheetAtBracketConfirm,
  type ChainSheetAtBracketConfirm,
} from "@/lib/active-trader/chainSheetAtBracketConfirm";
import { buildChainSheetBracketEconomics } from "@/lib/active-trader/chainSheetBracketEconomics";
import { buildSchwabOptionKey } from "@/lib/optionsSchwabKey";
import { seriesRootFromExpiration } from "@/lib/active-trader/optionSeries";
import { TriggerOrderConfirmSummary } from "@/components/orders/TriggerOrderConfirmSummary";
import { formatAtExitDuration } from "@/lib/active-trader/atSummaryFormat";
import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import { AtApprovedMobileOrderSheet } from "@/components/active-trader/AtApprovedMobileOrderSheet";
import type { ChainDraftSheetSession } from "@/lib/orders/chainDraftSessionStore";

const SYS_FONT =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const BG = "#000000";
const BORDER = "#2a2a2a";
const GOLD = "#fbbf24";
const UP = "#00d166";
const DOWN = "#f23645";
const WHITE = "#f0f0f0";
const GRAY = "#a1a1aa";
const MUTED = "#71717a";
const DIM = "#52525b";
const DIVIDER = "#1a1a1a";
const LABEL_STYLE: CSSProperties = { fontSize: 12, color: GRAY, letterSpacing: "-0.02em" };
const VALUE_STYLE: CSSProperties = { fontSize: 14, color: WHITE, fontVariantNumeric: "tabular-nums" };
/** Clear bottom nav (~76px) + home indicator. */
const SHEET_BOTTOM_OFFSET = "calc(76px + max(env(safe-area-inset-bottom, 0px), 12px))";

type Stage = "form" | "review" | "submitting" | "success" | "error";

/** How often the ticket re-prices from live leg quotes. */
const TICKET_TICK_MS = 120;

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export interface OptionsChainOrderSheetProps {
  legs: StrategyLeg[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onClearAll: () => void;
  onLegQuantityChange: (legId: string, quantity: number) => void;
  onRemoveLeg: (legId: string) => void;
  /** Reverse every draft leg in place. Strikes, expirations, and quantities stay. */
  onFlipSides?: () => void;
  subscribeOptionSymbols?: (
    symbols: string[],
    opts?: import("@/lib/optionHoldClient").OptionHoldPostOpts,
  ) => Promise<string | void | undefined>;
  /** Fixture / screenshot harness only — never enables real submit bypass in prod. */
  demoFixture?: boolean;
  /** Dev fixture: open in-sheet confirm on mount (after quotes/limit hydrate). */
  openReviewOnMount?: boolean;
  /** TP/SL or other rows below limit (Active Trader). Receives spread limit + credit flag. */
  extrasAfterLimit?:
    | React.ReactNode
    | ((ctx: { limitPerShare: number | null; isCredit: boolean; legCount: number }) => React.ReactNode);
  /** Render docked inline at bottom of Active Trader instead of a fixed overlay covering ladder rows. */
  atDocked?: boolean;
  /** Compact peek height (~38vh) vs full sheet (~58vh). */
  sheetPeek?: boolean;
  onSheetPeekChange?: (peek: boolean) => void;
  /** Distinct chain draft legs (pre-ticket builder guard). */
  draftDistinctLegCount?: number;
  /** Active Trader bracket draft — chain confirm shows entry + attached exits (or explicit unsupported). */
  atBracketDraft?: {
    prefs: ActiveTraderTemplatePrefs;
    primaryInstruction: SchwabInstruction;
  };
  /** Active Trader: open bracket/advanced builder; restores scroll in parent. */
  onAdvancedOrders?: () => void;
  /** Restored limit lock after Options remount (chunk recovery). */
  restoredSheetSession?: ChainDraftSheetSession;
  onSheetSessionPersist?: (session: ChainDraftSheetSession) => void;
}

function distinctChainLegsFromStrategy(legs: StrategyLeg[]): number {
  const keys = new Set<string>();
  for (const leg of legs) {
    keys.add(leg.id.split("#")[0]);
  }
  return keys.size;
}

function bracketPrefsActive(prefs: ActiveTraderTemplatePrefs): boolean {
  return (
    prefs.template !== "Single" || !!(prefs.takeProfit?.enabled || prefs.stopLoss?.enabled)
  );
}

/**
 * Broker acceptance is `success: true` with no error. The order id is optional:
 * a successful upstream response can omit it. Anything else is not an acknowledgment.
 */
function brokerAcceptance(data: unknown): { accepted: true; orderId: string | null } | { accepted: false } {
  if (!data || typeof data !== "object") return { accepted: false };
  const row = data as Record<string, unknown>;
  if (row.success !== true) return { accepted: false };
  if (typeof row.error === "string" && row.error.trim()) return { accepted: false };
  if (typeof row.orderId !== "string") return { accepted: true, orderId: null };
  const id = row.orderId.trim();
  if (!id || id === "—") return { accepted: true, orderId: null };
  return { accepted: true, orderId: id };
}

/**
 * Identity of the draft that was sent.
 * The limit string is not included: Send formats 2.5 to 2.50, and an unlocked
 * price follows the live mid. Neither is a trader edit. `limitEditEpoch`
 * advances only when the trader types, nudges, or replaces the limit.
 */
function chainDraftRevision(input: {
  legs: StrategyLeg[];
  quantity: number;
  limitLocked: boolean;
  orderType: string;
  limitEditEpoch: number;
}): string {
  const legs = input.legs
    .map((leg) =>
      [leg.id, leg.direction, leg.optionType, leg.strike, leg.expiration, leg.quantity].join(":"),
    )
    .join("|");
  return `${legs}#${input.quantity}#${input.limitLocked ? 1 : 0}#${input.orderType}#${input.limitEditEpoch}`;
}

type PreparedAcceptSound = { play: () => void; close: () => void };

const SILENT_ACCEPT_SOUND: PreparedAcceptSound = { play() {}, close() {} };

/**
 * Create the audio graph on the Send gesture. iOS only allows playback that
 * was unlocked by that tap, so the context exists before the request returns
 * and `play` runs only after the broker accepts.
 */
function prepareOrderAcceptedSound(): PreparedAcceptSound {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return SILENT_ACCEPT_SOUND;
  try {
    const ctx = new AudioCtx();
    void ctx.resume();
    let played = false;
    return {
      play() {
        if (played || ctx.state === "closed") return;
        played = true;
        try {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.17);
          osc.onended = () => {
            void ctx.close();
          };
        } catch {
          void ctx.close();
        }
      },
      close() {
        if (played || ctx.state === "closed") return;
        void ctx.close();
      },
    };
  } catch {
    return SILENT_ACCEPT_SOUND;
  }
}

function primaryLegOptionSymbol(leg: StrategyLeg, underlying: string): string | undefined {
  const trimmed = leg.schwabSymbol?.trim();
  if (trimmed) return trimmed;
  const built = buildSchwabOptionKey(
    seriesRootFromExpiration(leg.expiration) ?? underlying,
    leg.expiration,
    leg.strike,
    leg.optionType === "CALL" ? "C" : "P",
  );
  const key = built.trim();
  return key || undefined;
}

export function OptionsChainOrderSheet({
  legs,
  collapsed,
  onCollapsedChange,
  onClearAll,
  onLegQuantityChange,
  onRemoveLeg,
  onFlipSides,
  subscribeOptionSymbols,
  demoFixture,
  openReviewOnMount,
  extrasAfterLimit,
  atDocked,
  sheetPeek = true,
  onSheetPeekChange,
  draftDistinctLegCount,
  atBracketDraft,
  onAdvancedOrders,
  restoredSheetSession,
  onSheetSessionPersist,
}: OptionsChainOrderSheetProps) {
  const symbol = useTerminalStore((s) => s.symbol);
  const sendAllowed = atOrderSendAllowed();
  const underlyingSpot = useTerminalStore((s) => {
    const u = symbol.toUpperCase();
    const alt = u.startsWith("$") ? u.slice(1) : `$${u}`;
    const q = s.streamPrices[u] ?? s.streamPrices[alt];
    return q?.last ?? q?.regularLast ?? q?.extendedLast ?? null;
  });
  const accounts = useSchwabAccountStore((s) => s.accounts);
  const accountHash = useSchwabAccountStore((s) => s.tradingAccountHash());
  /**
   * Live quotes for this ticket's legs only, a few times a second. The whole
   * tick map changes on every quote for every contract, which re-ran all of
   * the ticket math far more often than the numbers can be read.
   */
  const legSymbols = useMemo(
    () => [...new Set(legs.map((l) => l.schwabSymbol).filter(Boolean))].sort(),
    [legs],
  );
  const optionTicks = useOptionTicksForKeys(legSymbols, TICKET_TICK_MS);

  const [limitPrice, setLimitPrice] = useState(restoredSheetSession?.limitPrice ?? "");
  const [quantity, setQuantity] = useState(() => {
    const restored = restoredSheetSession?.spreadQuantity;
    return typeof restored === "number" && Number.isInteger(restored) && restored >= 1 ? restored : 1;
  });
  const [timeInForce, setTimeInForce] = useState<string>("DAY");
  const [stage, setStage] = useState<Stage>("form");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [priceError, setPriceError] = useState("");
  const [reviewLimitSnapped, setReviewLimitSnapped] = useState<number | null>(null);
  const [atBracketConfirmSnapshot, setAtBracketConfirmSnapshot] =
    useState<ChainSheetAtBracketConfirm | null>(null);
  const limitUserEditedRef = useRef(restoredSheetSession?.limitUserEdited === true);
  const limitEditEpochRef = useRef(0);
  const noteLimitReplaced = () => {
    limitEditEpochRef.current += 1;
  };
  const legsHydrateKeyRef = useRef("");
  const legDirectionKeyRef = useRef<string | null>(null);
  const [limitLocked, setLimitLocked] = useState(restoredSheetSession?.limitLocked ?? false);
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET">("LIMIT");

  const pricedLegs = useMemo(
    () => legs.map((leg) => mergeLegStreamQuotes(leg, optionTicks[leg.schwabSymbol])),
    [legs, optionTicks],
  );

  useEffect(() => {
    const symbols = legs.map((l) => l.schwabSymbol).filter(Boolean);
    if (symbols.length > 0 && subscribeOptionSymbols) {
      void subscribeOptionSymbols([...new Set(symbols)]);
    }
  }, [legs, subscribeOptionSymbols]);

  useEffect(() => {
    if (legs.length === 0) {
      setStage("form");
      setLimitPrice("");
      setQuantity(1);
      limitUserEditedRef.current = false;
      legsHydrateKeyRef.current = "";
      legDirectionKeyRef.current = null;
      setAtBracketConfirmSnapshot(null);
    }
  }, [legs.length]);

  useEffect(() => {
    onSheetSessionPersist?.({
      limitPrice,
      limitLocked,
      limitUserEdited: limitUserEditedRef.current,
      spreadQuantity: quantity,
    });
  }, [limitPrice, limitLocked, quantity, onSheetSessionPersist]);

  const legsHydrateKey = useMemo(
    () =>
      chainLegHydrateKey(
        legs.map((l) => ({
          id: l.id,
          direction: l.direction,
          strike: l.strike,
          quantity: l.quantity,
          schwabSymbol: l.schwabSymbol,
        })),
      ),
    [legs],
  );

  const limitTickCtx = useMemo((): LimitTickContext => ({ underlyingSymbol: symbol, isOption: true }), [symbol]);

  const spreadPrices = useMemo(() => {
    if (pricedLegs.length === 0) return null;
    const agg = aggregateSpreadNBBO(
      pricedLegs.map((l) => ({
        instruction: l.direction,
        bid: l.bid,
        ask: l.ask,
        quantity: l.quantity,
      })),
    );
    if (!agg) return null;
    const roundedMid = agg.mid != null ? parseCanonicalLimit(agg.mid, limitTickCtx) : null;
    return { spreadBid: agg.bid, spreadMid: roundedMid, spreadAsk: agg.ask, crossed: agg.crossed };
  }, [pricedLegs, limitTickCtx]);

  const submittedLimit = useMemo(
    () => resolveSubmittedLimit(limitTickCtx, limitPrice),
    [limitTickCtx, limitPrice],
  );

  const isCredit = useMemo(() => {
    const econLegs = pricedLegs.map((l) => ({
      strike: l.strike,
      optionType: l.optionType,
      instruction: l.direction,
      quantity: l.quantity,
    }));
    const inferred = inferNetCreditFromLegStructure(econLegs);
    if (inferred != null) return inferred;
    let netMid = 0;
    let complete = true;
    for (const leg of pricedLegs) {
      const mid = midpointFromBidAsk(leg.bid, leg.ask);
      if (mid == null) {
        complete = false;
        break;
      }
      netMid += leg.direction.startsWith("BUY") ? mid * leg.quantity : -mid * leg.quantity;
    }
    if (complete && Math.abs(netMid) > 1e-6) return netMid < 0;
    return false;
  }, [pricedLegs]);

  const resolvedOrder = useMemo(
    () =>
      resolveVisibleChainOrderType({
        visible: orderType,
        isCredit,
        legCount: legs.length,
      }),
    [orderType, isCredit, legs.length],
  );
  const resolvedOrderLabel = resolvedOrder.label;

  const summary = useMemo(
    () =>
      computeChainTicketSummary({
        underlyingSymbol: symbol,
        legs: pricedLegs.map((l) => ({
          strike: l.strike,
          optionType: l.optionType,
          instruction: l.direction,
          expiration: l.expiration.split(":")[0].trim(),
          quantity: l.quantity,
          bid: l.bid,
          ask: l.ask,
          delta: l.delta,
          gamma: l.gamma,
          theta: l.theta,
          vega: l.vega,
          iv: l.iv,
        })),
        limitPrice: submittedLimit ?? spreadPrices?.spreadMid ?? null,
        spreadQuantity: quantity,
        isCredit,
        spotPrice: underlyingSpot,
      }),
    [pricedLegs, symbol, submittedLimit, spreadPrices, quantity, isCredit, underlyingSpot],
  );

  const buyingPowerDisplay = useMemo(
    () => summary?.buyingPowerEffect ?? null,
    [summary?.buyingPowerEffect],
  );

  const feeAdjustedNetCash = useMemo(() => {
    if (summary?.grossNotional == null) return null;
    const totalContracts = legs.reduce((s, l) => s + l.quantity, 0) * quantity;
    const fees = estimateSchwabOptionFees(totalContracts);
    const cash = computeOrderNetCash(Math.abs(summary.grossNotional), isCredit, totalContracts, fees);
    return isCredit ? cash.net : -cash.net;
  }, [summary?.grossNotional, legs, quantity, isCredit]);

  const netDebitForName = summary?.grossNotional != null ? (isCredit ? -summary.grossNotional : summary.grossNotional) : 0;
  const strategyId = useMemo(() => detectStrategyType(legs, netDebitForName), [legs, netDebitForName]);

  const allLegsQuoted = useMemo(
    () => pricedLegs.length > 0 && pricedLegs.every((l) => quoteSideState(l.bid, l.ask) === "ok"),
    [pricedLegs],
  );
  const legDirectionKey = useMemo(
    () => legs.map((leg) => `${leg.id.split("#")[0]}:${leg.direction}`).join("|"),
    [legs],
  );

  useEffect(() => {
    if (legs.length === 0 || stage !== "form") return;
    const prevDirections = legDirectionKeyRef.current;
    const directionsChanged = prevDirections != null && prevDirections !== legDirectionKey;
    legDirectionKeyRef.current = legDirectionKey;
    if (directionsChanged) limitUserEditedRef.current = false;
    if (limitLocked && !directionsChanged) return;
    const keyChanged = legsHydrateKeyRef.current !== legsHydrateKey;
    if (keyChanged) {
      legsHydrateKeyRef.current = legsHydrateKey;
      if (!limitUserEditedRef.current && !allLegsQuoted) {
        setLimitPrice("");
      }
    }
    if (!allLegsQuoted || spreadPrices?.spreadMid == null) {
      if (directionsChanged && limitLocked) setLimitLocked(false);
      return;
    }
    if (directionsChanged || (keyChanged && !limitUserEditedRef.current)) {
      setLimitPrice(displaySubmittedLimit(limitTickCtx, spreadPrices.spreadMid));
      if (directionsChanged && limitLocked) setLimitLocked(false);
      return;
    }
    // An unlocked working price follows the live spread mid. A typed, nudged, or locked price stays put.
    if (!limitUserEditedRef.current) {
      const next = displaySubmittedLimit(limitTickCtx, spreadPrices.spreadMid);
      if (next !== limitPrice) setLimitPrice(next);
    }
  }, [legDirectionKey, legsHydrateKey, legs.length, spreadPrices?.spreadMid, limitTickCtx, stage, limitPrice, allLegsQuoted, limitLocked]);

  const snapLimitForSubmit = useCallback((): number | null => {
    const snapped = resolveSubmittedLimit(limitTickCtx, limitPrice);
    if (snapped == null) return null;
    setLimitPrice(displaySubmittedLimit(limitTickCtx, snapped));
    return snapped;
  }, [limitTickCtx, limitPrice]);

  const nudgePrice = useCallback(
    (dir: "up" | "down") => {
      const base = parseCanonicalLimit(limitPrice, limitTickCtx) ?? spreadPrices?.spreadMid;
      if (base == null) return;
      const tick = optionPremiumTickForSymbol(symbol, base) ?? 0.01;
      const raw = dir === "up" ? base + tick : Math.max(tick, base - tick);
      const rounded = roundOptionPriceToTick(raw, limitTickCtx, dir === "up" ? "up" : "down");
      limitUserEditedRef.current = true;
      noteLimitReplaced();
      setLimitPrice(displaySubmittedLimit(limitTickCtx, rounded));
      setPriceError("");
    },
    [limitPrice, limitTickCtx, spreadPrices, symbol],
  );

  const buildSchwabOrder = useCallback(
    (priceOverride?: number) => {
      const parsed = priceOverride ?? schwabPriceFromTicket(limitTickCtx, limitPrice);
      const complexType = inferSchwabComplexOrderStrategyType(
        legs.map((leg) => ({
          strike: leg.strike,
          optionType: leg.optionType,
          instruction: leg.direction,
          quantity: leg.quantity,
          expiration: leg.expiration,
          schwabSymbol: leg.schwabSymbol,
        })),
      );
      return buildChainSheetSchwabOrder({
        prefs: atBracketDraft?.prefs,
        primaryInstruction: atBracketDraft?.primaryInstruction,
        legs: legs.map((leg) => ({
          direction: leg.direction,
          quantity: leg.quantity,
          schwabSymbol: leg.schwabSymbol,
          expiration: leg.expiration,
          delta: leg.delta,
          iv: leg.iv,
        })),
        quantityMultiplier: quantity,
        limitPrice: parsed,
        isCredit,
        visibleOrderType: orderType,
        complexOrderStrategyType: complexType,
        underlyingSymbol: symbol,
        underlyingPrice: underlyingSpot,
        timeInForce,
      });
    },
    [isCredit, timeInForce, legs, quantity, limitPrice, limitTickCtx, atBracketDraft, symbol, underlyingSpot, orderType],
  );

  const guardDraftLegCount = useCallback(() => {
    const distinct = draftDistinctLegCount ?? distinctChainLegsFromStrategy(legs);
    try {
      assertChainDraftLegCount(distinct);
      return true;
    } catch {
      setPriceError(CHAIN_LEG_LIMIT_MESSAGE);
      return false;
    }
  }, [draftDistinctLegCount, legs]);

  const validateAndReview = useCallback(() => {
    if (!guardDraftLegCount()) return;
    const px = resolvedOrder.orderType === "MARKET" ? 0 : snapLimitForSubmit();
    if (resolvedOrder.orderType !== "MARKET" && (px == null || px <= 0)) {
      setPriceError("Set a valid limit price (Mid / Natural or enter manually).");
      return;
    }
    setReviewLimitSnapped(px);
    setPriceError("");
    const draft = atBracketDraft;
    if (draft && bracketPrefsActive(draft.prefs)) {
      const leg = legs[0];
      const sym = leg ? primaryLegOptionSymbol(leg, symbol) : undefined;
      const distinctLegs = draftDistinctLegCount ?? distinctChainLegsFromStrategy(legs);
      const entryGross =
        summary?.grossNotional != null ? Math.abs(summary.grossNotional) : null;
      const totalContracts = legs.reduce((s, l) => s + l.quantity, 0) * quantity;
      if (sym) {
        const econ = buildChainSheetBracketEconomics({
          prefs: draft.prefs,
          primaryInstruction: draft.primaryInstruction,
          lockedLimit: px,
          legCount: distinctLegs,
          optionSymbol: sym,
          underlyingSymbol: symbol.replace(/^\$/, ""),
          spreadQuantity: quantity,
          totalContracts,
          entryGrossDollars: entryGross,
          isCredit,
        });
        setAtBracketConfirmSnapshot(econ.bracketConfirm);
      } else {
        setAtBracketConfirmSnapshot({
          mode: "unsupported",
          testId: "at-chain-bracket-unsupported",
          message: "Missing option symbol — cannot preview bracket exits on this leg.",
        });
      }
    } else {
      setAtBracketConfirmSnapshot(null);
    }
    setStage("review");
  }, [
    snapLimitForSubmit,
    guardDraftLegCount,
    atBracketDraft,
    legs,
    draftDistinctLegCount,
    symbol,
    summary?.grossNotional,
    quantity,
    isCredit,
    resolvedOrder,
  ]);

  const openReviewRef = useRef(false);
  const placeOrderInFlightRef = useRef(false);
  const draftRevisionRef = useRef("");
  draftRevisionRef.current = chainDraftRevision({
    legs,
    quantity,
    limitLocked,
    orderType,
    limitEditEpoch: limitEditEpochRef.current,
  });
  const [sendLocked, setSendLocked] = useState(false);
  useEffect(() => {
    if (!openReviewOnMount || openReviewRef.current || legs.length === 0) return;
    const px = submittedLimit ?? spreadPrices?.spreadMid;
    if (px == null || px <= 0) return;
    openReviewRef.current = true;
    const t = window.setTimeout(() => validateAndReview(), 500);
    return () => window.clearTimeout(t);
  }, [openReviewOnMount, legs.length, submittedLimit, spreadPrices?.spreadMid, validateAndReview]);

  const handleSubmit = useCallback(async () => {
    if (!guardDraftLegCount()) return;
    if (!sendAllowed) return;
    if (placeOrderInFlightRef.current || stage === "submitting") return;
    if (!demoFixture && !accountHash) return;
    if (demoFixture) {
      placeOrderInFlightRef.current = true;
      setSendLocked(true);
      setOrderId("SCREENSHOT-DEMO");
      setStage("success");
      return;
    }
    const px = resolvedOrder.orderType === "MARKET" ? 0 : snapLimitForSubmit();
    if (resolvedOrder.orderType !== "MARKET" && (px == null || px <= 0)) {
      setPriceError("A limit price is required.");
      setStage("form");
      return;
    }
    placeOrderInFlightRef.current = true;
    setSendLocked(true);
    setReviewLimitSnapped(px);
    setStage("submitting");
    const submittedRevision = draftRevisionRef.current;
    const acceptSound = atDocked ? prepareOrderAcceptedSound() : SILENT_ACCEPT_SOUND;
    try {
      const order = buildSchwabOrder(px ?? 0);
      if (typeof order.error === "string") {
        acceptSound.close();
        placeOrderInFlightRef.current = false;
        setSendLocked(false);
        setPriceError(order.error);
        setStage("form");
        return;
      }
      const res = await fetchWithAuth("/api/portfolio/place-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountHash, order }),
      });
      const data = await res.json();
      const partial = demoFixture ? interpretBracketPlaceOrderResult(data) : null;
      if (!res.ok || data.error) {
        acceptSound.close();
        placeOrderInFlightRef.current = false;
        setSendLocked(false);
        setErrorMsg(data.message || data.error || "Order rejected");
        setStage("error");
        return;
      }
      if (demoFixture && partial?.entryAccepted && !partial.exitsAccepted && partial.userMessage) {
        acceptSound.close();
        setOrderId(partial.orderId ?? "—");
        setErrorMsg(`${partial.userMessage} (fixture harness — requires broker exit status fields)`);
        setStage("error");
        return;
      }
      if (atDocked) {
        const acceptance = brokerAcceptance(data);
        if (!acceptance.accepted) {
          acceptSound.close();
          placeOrderInFlightRef.current = false;
          setSendLocked(false);
          setErrorMsg("Order was not confirmed.");
          setStage("error");
          return;
        }
        acceptSound.play();
        toast({
          title: "Order sent",
          description: acceptance.orderId ? `#${acceptance.orderId}` : undefined,
          duration: 2500,
        });
        placeOrderInFlightRef.current = false;
        setSendLocked(false);
        if (draftRevisionRef.current !== submittedRevision) {
          setStage("form");
          return;
        }
        setOrderId(acceptance.orderId);
        onSheetSessionPersist?.({ limitPrice: "", limitLocked: false, limitUserEdited: false, spreadQuantity: 1 });
        setLimitPrice("");
        setLimitLocked(false);
        setQuantity(1);
        limitUserEditedRef.current = false;
        legsHydrateKeyRef.current = "";
        setStage("form");
        onCollapsedChange(true);
        onClearAll();
        return;
      }
      acceptSound.close();
      setOrderId(data.orderId ?? partial?.orderId ?? "—");
      setStage("success");
    } catch (err: unknown) {
      acceptSound.close();
      placeOrderInFlightRef.current = false;
      setSendLocked(false);
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setStage("error");
    }
  }, [accountHash, buildSchwabOrder, snapLimitForSubmit, demoFixture, stage, sendAllowed, guardDraftLegCount, resolvedOrder, atDocked, onCollapsedChange, onClearAll, onSheetSessionPersist]);

  const handleClearAllClick = useCallback(() => {
    limitUserEditedRef.current = false;
    legsHydrateKeyRef.current = "";
    onClearAll();
  }, [onClearAll]);

  const isValid =
    legs.length > 0 &&
    submittedLimit != null &&
    submittedLimit > 0 &&
    quantity > 0 &&
    (demoFixture || !!accountHash);

  const effectiveAtBracketDraft = atBracketDraft;

  const bracketEconomics = useMemo(() => {
    const draft = atBracketDraft;
    if (!draft || !bracketPrefsActive(draft.prefs)) return null;
    const leg = legs[0];
    const sym = leg ? primaryLegOptionSymbol(leg, symbol) : undefined;
    if (!sym) return null;
    const limitForBracket = submittedLimit;
    const entryGross =
      summary?.grossNotional != null ? Math.abs(summary.grossNotional) : null;
    const totalContracts = legs.reduce((s, l) => s + l.quantity, 0) * quantity;
    const econ = buildChainSheetBracketEconomics({
      prefs: draft.prefs,
      primaryInstruction: draft.primaryInstruction,
      lockedLimit: limitForBracket,
      legCount: draftDistinctLegCount ?? distinctChainLegsFromStrategy(legs),
      optionSymbol: sym,
      underlyingSymbol: symbol.replace(/^\$/, ""),
      spreadQuantity: quantity,
      totalContracts,
      entryGrossDollars: entryGross,
      isCredit,
    });
    return econ;
  }, [
    atBracketDraft,
    legs,
    symbol,
    quantity,
    submittedLimit,
    summary?.grossNotional,
    isCredit,
    draftDistinctLegCount,
  ]);

  const atBracketConfirm = useMemo((): ChainSheetAtBracketConfirm | null => {
    if (stage !== "review") return null;
    const snap = atBracketConfirmSnapshot;
    if (snap?.mode === "trigger" || snap?.mode === "unsupported") return snap;

    const draft = effectiveAtBracketDraft;
    if (!draft || !bracketPrefsActive(draft.prefs)) return snap;

    const leg = legs[0];
    const px = reviewLimitSnapped;
    if (!leg || px == null || px <= 0) return snap;

    const sym = primaryLegOptionSymbol(leg, symbol);
    if (!sym) {
      return {
        mode: "unsupported",
        testId: "at-chain-bracket-unsupported",
        message: "Missing option symbol — cannot preview bracket exits on this leg.",
      };
    }

    const built = buildChainSheetAtBracketConfirm({
      prefs: draft.prefs,
      legCount: draftDistinctLegCount ?? distinctChainLegsFromStrategy(legs),
      primaryInstruction: draft.primaryInstruction,
      limitPrice: px,
      optionSymbol: sym,
      underlyingSymbol: symbol.replace(/^\$/, ""),
    });

    if (built.mode === "trigger" || built.mode === "unsupported") return built;
    if (bracketPrefsActive(draft.prefs)) {
      return {
        mode: "unsupported",
        testId: "at-chain-bracket-unsupported",
        message: "Bracket exit preview could not be built for this draft.",
      };
    }
    return snap;
  }, [
    stage,
    atBracketConfirmSnapshot,
    effectiveAtBracketDraft,
    legs,
    symbol,
    reviewLimitSnapped,
    draftDistinctLegCount,
  ]);

  if (legs.length === 0) return null;

  if (atDocked) {
    const entryMultiplier = quantity * 100;
    const entryDollars =
      summary?.grossNotional != null ? Math.abs(summary.grossNotional) : null;
    const legacyEntryAbs =
      summary?.grossNotional != null ? Math.abs(summary.grossNotional) * entryMultiplier : null;
    const exitAbs = bracketEconomics?.targetExitDollars ?? null;
    const dockedEstNetProfit = bracketEconomics?.estNetUnavailable
      ? null
      : bracketEconomics?.estNetProfit ?? null;
    const maxLossLabel =
      summary?.maxLoss != null
        ? `$${Math.round(summary.maxLoss).toLocaleString("en-US")}`
        : summary?.maxLoss === null
          ? "uncapped"
          : "—";
    const mid = summary?.spreadMid != null ? fmt(summary.spreadMid) : null;
    const limitInvalid = orderType !== "MARKET" && !(submittedLimit != null && submittedLimit > 0);
    const bracketMessage =
      bracketEconomics?.bracketConfirm.mode === "unsupported"
        ? bracketEconomics.bracketConfirm.message
        : null;
    const sendUnavailableReason =
      legs.length === 0
        ? "Add a leg before sending."
        : limitInvalid
          ? "Invalid limit."
          : quantity <= 0
            ? "Enter a quantity."
            : bracketMessage
              ? bracketMessage
              : atOrderSendUnavailableReason();

    if (stage === "review") {
      return (
        <div
          className={atDocked ? "fixed inset-0 z-[120]" : undefined}
          data-testid="options-chain-order-sheet"
          data-at-approved-ticket
        >
          <ConfirmPanel
            strategyName={strategyId.name}
            strategyColor={strategyId.color}
            symbol={symbol}
            legs={legs}
            quantity={quantity}
            timeInForce={timeInForce}
            isCredit={isCredit}
            orderTypeLabel={resolvedOrderLabel}
            limitTickCtx={limitTickCtx}
            reviewLimitSnapped={reviewLimitSnapped}
            submittedLimit={submittedLimit}
            summary={summary}
            feeAdjustedNetCash={feeAdjustedNetCash}
            atBracketConfirm={atBracketConfirm}
            atExitDurationLabel={
              effectiveAtBracketDraft
                ? formatAtExitDuration(effectiveAtBracketDraft.prefs.exitDuration)
                : undefined
            }
            onBack={() => {
              placeOrderInFlightRef.current = false;
              setSendLocked(false);
              setStage("form");
            }}
            onSend={() => void handleSubmit()}
            sendDisabled={sendLocked || !sendAllowed}
            sendLabel={sendAllowed ? "Send" : "Send unavailable"}
            sendDetail={sendAllowed ? null : sendUnavailableReason}
          />
        </div>
      );
    }

    const bracketBlocksSend = bracketEconomics?.bracketConfirm.mode === "unsupported";
    const dockedValid =
      legs.length > 0 &&
      (resolvedOrder.orderType === "MARKET" || (submittedLimit != null && submittedLimit > 0)) &&
      quantity > 0 &&
      !bracketBlocksSend;

    return (
      <AtApprovedMobileOrderSheet
        legs={legs}
        collapsed={collapsed}
        sheetPeek={sheetPeek}
        docked={!!atDocked}
        onCollapsedChange={onCollapsedChange}
        onClearAll={handleClearAllClick}
        onRemoveLeg={onRemoveLeg}
        onFlipSides={onFlipSides}
        isCredit={isCredit}
        entryLabel={isCredit ? "Entry credit" : "Entry debit"}
        entryAmount={atDocked ? entryDollars : legacyEntryAbs}
        targetExitAmount={exitAbs}
        estNetAmount={atDocked ? dockedEstNetProfit : feeAdjustedNetCash}
        estNetUnavailable={
          atDocked
            ? (bracketEconomics?.estNetUnavailable ?? true)
            : feeAdjustedNetCash == null && summary?.grossNotional != null
        }
        maxLossLabel={atDocked ? maxLossLabel : summary?.maxLoss != null ? fmtCurrency(summary.maxLoss) : summary?.maxLoss === null ? "uncapped" : "—"}
        midDisplay={mid}
        spreadQuantity={quantity}
        onSpreadQuantityChange={setQuantity}
        limitPrice={limitPrice}
        onLimitPriceChange={(v) => {
          limitUserEditedRef.current = true;
          noteLimitReplaced();
          setLimitPrice(v);
          setPriceError("");
        }}
        limitLocked={limitLocked}
        onLimitLockedChange={(locked) => {
          if (locked) limitUserEditedRef.current = true;
          setLimitLocked(locked);
        }}
        onNudgeLimit={nudgePrice}
        orderType={orderType}
        onOrderTypeChange={setOrderType}
        limitTickCtx={limitTickCtx}
        sendLabel={
          sendUnavailableReason
            ? "Send unavailable"
            : atBracketDraft?.prefs.submission === "send"
              ? "Send"
              : atDocked
                ? "Send"
                : limitLocked
                  ? "Review (sending off)"
                  : "Lock limit to send"
        }
        sendDetail={atDocked ? sendUnavailableReason : null}
        sendPhase={
          stage === "submitting" ? "submitting" : stage === "error" ? "error" : stage === "success" ? "sent" : "idle"
        }
        sendError={errorMsg}
        orderReceipt={orderId}
        onDismissSendError={() => {
          placeOrderInFlightRef.current = false;
          setSendLocked(false);
          setErrorMsg("");
          setStage("form");
        }}
        sendDisabled={atDocked ? !dockedValid || sendLocked || stage === "submitting" : !limitLocked || !isValid}
        primaryActionTestId="chain-sheet-review"
        onSend={() => {
          if (!atDocked && !limitLocked) return;
          if (atBracketDraft?.prefs.submission === "send") void handleSubmit();
          else validateAndReview();
        }}
        onAdvancedOrders={onAdvancedOrders}
      />
    );
  }

  const sheetHeight = collapsed ? 52 : sheetPeek ? AT_SHEET_PEEK_VH : AT_SHEET_FULL_VH;

  return (
    <div
      className="fixed left-0 right-0 z-[110] flex flex-col"
      style={{
        bottom: SHEET_BOTTOM_OFFSET,
        height: sheetHeight,
        background: `linear-gradient(180deg, #0a0a0a 0%, #000000 100%)`,
        borderTop: `1px solid ${GOLD}30`,
        boxShadow: `0 -8px 32px rgba(0,0,0,0.85)`,
        fontFamily: SYS_FONT,
        transition: "height 0.25s ease",
      }}
      data-testid="options-chain-order-sheet"
    >
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0 cursor-pointer"
        style={{ borderBottom: collapsed ? "none" : `1px solid ${BORDER}` }}
        onClick={() => onCollapsedChange(!collapsed)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
      >
        <div className="flex items-center gap-2 min-w-0">
          {collapsed ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: GOLD }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: GOLD }} />}
          <span className="text-[12px] font-bold tracking-wider truncate" style={{ color: strategyId.color }}>
            {strategyId.name}
          </span>
          <span className="text-[10px]" style={{ color: GRAY }}>
            {legs.length} leg{legs.length !== 1 ? "s" : ""} · {isCredit ? "Cr" : "Dr"}
          </span>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {!collapsed && onSheetPeekChange ? (
            <button
              type="button"
              className="text-[9px] px-1.5 py-0.5 tracking-wider"
              style={{ color: GRAY, border: `1px solid ${BORDER}`, borderRadius: 6 }}
              onClick={() => onSheetPeekChange(!sheetPeek)}
            >
              {sheetPeek ? "Expand" : "Peek"}
            </button>
          ) : null}
          {summary?.spreadMid != null && (
            <span className="text-[11px] tabular-nums" style={{ color: WHITE }}>
              Mid {fmt(summary.spreadMid)}
            </span>
          )}
          <button
            type="button"
            onClick={handleClearAllClick}
            className="text-[10px] px-2 py-1 tracking-wider"
            style={{ color: GRAY, border: `1px solid ${BORDER}`, borderRadius: 6 }}
          >
            CLEAR
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-2">
          {stage === "success" ? (
            <div className="py-6 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8" style={{ color: UP }} />
              <p className="text-[13px]" style={{ color: WHITE }}>Sent to Schwab</p>
              {orderId && <p className="text-[10px]" style={{ color: MUTED }}>Order {orderId}</p>}
              <button type="button" onClick={handleClearAllClick} className="mt-2 text-[12px] px-4 py-2" style={{ background: GOLD, color: "#000", borderRadius: 8 }}>
                Done
              </button>
            </div>
          ) : stage === "submitting" ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: GOLD }} />
            </div>
          ) : stage === "error" ? (
            <div className="py-4 text-center">
              <p className="text-[12px]" style={{ color: DOWN }}>{errorMsg}</p>
              <button type="button" onClick={() => setStage("form")} className="mt-2 text-[11px]" style={{ color: GRAY }}>
                Edit order
              </button>
            </div>
          ) : (
            <>
              <div
                className="py-2 grid grid-cols-2 gap-x-4 gap-y-2"
                style={{ borderBottom: `1px solid ${BORDER}` }}
              >
                <StatCell label="Natural" value={fmt(isCredit ? summary?.spreadBid : summary?.spreadAsk)} />
                <StatCell label="Mid" value={fmt(summary?.spreadMid)} />
                <StatCell
                  label="Max profit"
                  value={summary?.maxProfit != null ? fmtCurrency(summary.maxProfit) : "—"}
                  valueColor={UP}
                />
                <StatCell
                  label="Max loss"
                  value={summary?.maxLoss != null ? fmtCurrency(summary.maxLoss) : "—"}
                  valueColor={DOWN}
                />
                <div className="col-span-2 flex items-baseline justify-between gap-2">
                  <span style={LABEL_STYLE}>Breakeven</span>
                  <span style={VALUE_STYLE}>
                    {summary?.breakevens.length
                      ? summary.breakevens.map((b) => `$${b.toFixed(2)}`).join(" / ")
                      : "—"}
                  </span>
                </div>
              </div>

              <div
                className="flex flex-wrap gap-x-3 gap-y-1 py-2 text-[13px]"
                style={{ borderBottom: `1px dashed ${DIVIDER}`, color: GRAY }}
              >
                <span style={VALUE_STYLE}>Δ {formatNetGreekDisplay(summary?.netDelta, 1) ?? "—"}</span>
                <span style={VALUE_STYLE}>Γ {formatNetGreekDisplay(summary?.netGamma, 2) ?? "—"}</span>
                <span style={VALUE_STYLE}>Θ {formatNetGreekDisplay(summary?.netTheta, 2) ?? "—"}</span>
                <span style={VALUE_STYLE}>V {formatNetGreekDisplay(summary?.netVega, 2) ?? "—"}</span>
                {summary?.pop != null && (
                  <span style={VALUE_STYLE}>POP {summary.pop.toFixed(0)}%</span>
                )}
                {buyingPowerDisplay != null && (
                  <span style={VALUE_STYLE}>
                    BP est {fmtCurrency(Math.abs(buyingPowerDisplay))}
                  </span>
                )}
              </div>

              <div className="mt-2 space-y-1.5">
                {pricedLegs.map((leg) => {
                  const isBuy = leg.direction.startsWith("BUY");
                  const mid = midpointFromBidAsk(leg.bid, leg.ask);
                  const quoteOk = quoteSideState(leg.bid, leg.ask) === "ok";
                  const typeLabel = leg.optionType === "CALL" ? "Call" : "Put";
                  return (
                    <div
                      key={leg.id}
                      className="flex items-center gap-2 py-1 px-1.5 rounded-md"
                      style={{ background: "#111", border: `1px solid ${BORDER}` }}
                    >
                      <span className="shrink-0 text-[13px] font-medium" style={{ color: isBuy ? UP : DOWN }}>
                        {isBuy ? "Buy" : "Sell"}
                      </span>
                      <span className="flex-1 min-w-0 text-[13px] tabular-nums truncate" style={{ color: WHITE }}>
                        {leg.strike} {typeLabel}
                      </span>
                      <span className="text-[11px] tabular-nums shrink-0" style={{ color: quoteOk ? MUTED : DOWN }}>
                        {quoteOk
                          ? `${leg.bid != null && leg.bid >= 0 ? fmt(leg.bid) : "—"} / ${leg.ask != null && leg.ask > 0 ? fmt(leg.ask) : "—"}${mid != null ? ` · ${fmt(mid)}` : ""}`
                          : "No quote"}
                      </span>
                      <LegQtyStepper
                        qty={leg.quantity}
                        onChange={(q: number) => onLegQuantityChange(leg.id, q)}
                      />
                      <button type="button" onClick={() => onRemoveLeg(leg.id)} aria-label="Remove leg">
                        <X className="w-3.5 h-3.5" style={{ color: MUTED }} />
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <span style={LABEL_STYLE}>Order type</span>
                  <div
                    className="h-7 px-2 flex items-center rounded-md"
                    style={{ fontSize: 14, background: "#111", border: `1px solid ${BORDER}`, color: WHITE, fontFamily: SYS_FONT }}
                    aria-label={`Order type ${resolvedOrderLabel}`}
                  >
                    {resolvedOrderLabel}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span style={LABEL_STYLE}>Time in force</span>
                  <Select value={timeInForce} onValueChange={(v) => setTimeInForce(v as "DAY" | "GTC")}>
                    <SelectTrigger
                      className="h-7 px-2 border rounded-md text-white"
                      style={{ fontSize: 14, background: "#111", borderColor: BORDER, fontFamily: SYS_FONT }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAY">DAY</SelectItem>
                      <SelectItem value="GTC">GTC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-2">
                <div className="text-[9px] mb-1" style={{ color: DIM }}>Net {isCredit ? "credit" : "debit"}</div>
                <div className="flex items-center gap-1" style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: "4px 8px" }}>
                  <button type="button" onClick={() => nudgePrice("down")} aria-label="Tick down">
                    <Minus className="w-3.5 h-3.5" style={{ color: GRAY }} />
                  </button>
                  <input
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="done"
                    value={limitPrice}
                    className="flex-1 text-[12px] text-right bg-transparent outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    onChange={(e) => {
                      limitUserEditedRef.current = true;
                      noteLimitReplaced();
                      setLimitPrice(e.target.value);
                      setPriceError("");
                    }}
                    onBlur={() => {
                      const snapped = resolveSubmittedLimit(limitTickCtx, limitPrice);
                      if (snapped != null) setLimitPrice(displaySubmittedLimit(limitTickCtx, snapped));
                    }}
                    style={{ color: WHITE }}
                    data-testid="chain-sheet-limit"
                  />
                  <button type="button" onClick={() => nudgePrice("up")} aria-label="Tick up">
                    <Plus className="w-3.5 h-3.5" style={{ color: GRAY }} />
                  </button>
                </div>
                <div className="flex justify-between mt-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      const px = spreadPrices?.spreadMid;
                      if (px != null) {
                        limitUserEditedRef.current = false;
                        noteLimitReplaced();
                        setLimitPrice(displaySubmittedLimit(limitTickCtx, px));
                      }
                    }}
                    style={{ color: GOLD }}
                  >
                    Mid {fmt(spreadPrices?.spreadMid)}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const raw = isCredit ? spreadPrices?.spreadBid : spreadPrices?.spreadAsk;
                      const px = raw != null ? parseCanonicalLimit(raw, limitTickCtx) : null;
                      if (px != null) {
                        limitUserEditedRef.current = false;
                        noteLimitReplaced();
                        setLimitPrice(displaySubmittedLimit(limitTickCtx, px));
                      }
                    }}
                    style={{ color: GRAY }}
                  >
                    Natural {fmt(isCredit ? spreadPrices?.spreadBid : spreadPrices?.spreadAsk)}
                  </button>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <span className="text-[9px]" style={{ color: DIM }}>Spreads</span>
                <div className="inline-flex items-center" style={{ border: `1px solid ${BORDER}`, borderRadius: 8 }}>
                  <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="px-2 py-1">
                    <Minus className="w-3 h-3" style={{ color: GRAY }} />
                  </button>
                  <span className="text-[12px] px-2 tabular-nums" style={{ color: WHITE }}>{quantity}</span>
                  <button type="button" onClick={() => setQuantity(quantity + 1)} className="px-2 py-1">
                    <Plus className="w-3 h-3" style={{ color: GRAY }} />
                  </button>
                </div>
              </div>

              {typeof extrasAfterLimit === "function"
                ? extrasAfterLimit({
                    limitPerShare: submittedLimit ?? summary?.limitPerShare ?? spreadPrices?.spreadMid ?? null,
                    isCredit,
                    legCount: legs.length,
                  })
                : extrasAfterLimit}

              {priceError && (
                <p className="mt-2 text-[10px]" style={{ color: DOWN }}>{priceError}</p>
              )}
            </>
          )}
        </div>
        {stage === "form" && (
          <div
            className="shrink-0 px-3 pt-2 border-t"
            style={{
              borderColor: BORDER,
              paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
            }}
          >
            <button
              type="button"
              disabled={!isValid}
              onClick={validateAndReview}
              className="w-full text-[13px] font-bold tracking-wider py-2.5 disabled:opacity-40"
              style={{ background: GOLD, color: "#000", borderRadius: 8 }}
              data-testid="chain-sheet-review"
            >
              Review
            </button>
          </div>
        )}
        </>
      )}

      {stage === "review" && !collapsed && (
        <ConfirmPanel
          strategyName={strategyId.name}
          strategyColor={strategyId.color}
          symbol={symbol}
          legs={legs}
          quantity={quantity}
          timeInForce={timeInForce}
          isCredit={isCredit}
          orderTypeLabel={resolvedOrderLabel}
          limitTickCtx={limitTickCtx}
          reviewLimitSnapped={reviewLimitSnapped}
          submittedLimit={submittedLimit}
          summary={summary}
          feeAdjustedNetCash={feeAdjustedNetCash}
          atBracketConfirm={atBracketConfirm}
          atExitDurationLabel={
            effectiveAtBracketDraft
              ? formatAtExitDuration(effectiveAtBracketDraft.prefs.exitDuration)
              : undefined
          }
          onBack={() => {
            placeOrderInFlightRef.current = false;
            setSendLocked(false);
            setStage("form");
          }}
          onSend={() => void handleSubmit()}
          sendDisabled={sendLocked || !sendAllowed}
          sendLabel={sendAllowed ? "Send" : "Send unavailable"}
          sendDetail={sendAllowed ? null : atOrderSendUnavailableReason()}
        />
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  valueColor = WHITE,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span style={LABEL_STYLE}>{label}</span>
      <span style={{ ...VALUE_STYLE, color: valueColor }}>{value}</span>
    </div>
  );
}

function formatLegLine(
  leg: StrategyLeg,
  underlying: string,
  spreadQty: number,
): string {
  const type = leg.optionType === "CALL" ? "Call" : "Put";
  const sym = underlying.toUpperCase().replace(/^\$/, "");
  const instr = humanInstruction(leg.direction);
  return `${instr} · ${leg.quantity * spreadQty} × ${sym} ${leg.strike} ${type}`;
}

function ConfirmPanel({
  strategyName,
  strategyColor,
  symbol,
  legs,
  quantity,
  timeInForce,
  isCredit,
  limitTickCtx,
  reviewLimitSnapped,
  submittedLimit,
  summary,
  feeAdjustedNetCash,
  onBack,
  onSend,
  sendDisabled,
  sendLabel = "Send",
  sendDetail,
  orderTypeLabel = "Limit",
  atBracketConfirm,
  atExitDurationLabel,
}: {
  strategyName: string;
  strategyColor: string;
  symbol: string;
  legs: StrategyLeg[];
  quantity: number;
  timeInForce: string;
  isCredit: boolean;
  limitTickCtx: LimitTickContext;
  reviewLimitSnapped: number | null;
  submittedLimit: number | null;
  summary: ReturnType<typeof computeChainTicketSummary> | null;
  feeAdjustedNetCash: number | null;
  onBack: () => void;
  onSend: () => void;
  sendDisabled?: boolean;
  sendLabel?: string;
  sendDetail?: string | null;
  orderTypeLabel?: string;
  atBracketConfirm?: ChainSheetAtBracketConfirm | null;
  atExitDurationLabel?: string;
}) {
  const px = reviewLimitSnapped ?? submittedLimit ?? 0;
  const totalContracts = legs.reduce((s, l) => s + l.quantity, 0) * quantity;
  const fees = estimateSchwabOptionFees(totalContracts);
  const gross =
    summary?.grossNotional != null
      ? Math.abs(summary.grossNotional)
      : Math.abs(px) * quantity * 100;
  const cash = computeOrderNetCash(gross, isCredit, totalContracts, fees);
  const netCashAfterFees = feeAdjustedNetCash ?? (isCredit ? cash.net : -cash.net);
  const reviewEcon = computeOrderEconomics({
    underlyingSymbol: symbol,
    isOption: true,
    legs: legs.map((l) => ({
      strike: l.strike,
      optionType: l.optionType,
      instruction: l.direction,
      expiration: l.expiration.split(":")[0].trim(),
      quantity: l.quantity,
    })),
    limitPrice: px,
    quantity,
    isCredit,
    contractCount: totalContracts,
  });
  const maxLoss = reviewEcon?.maxRisk ?? summary?.maxLoss ?? null;
  const bpEffect = summary?.buyingPowerEffect ?? reviewEcon?.buyingPowerEffect ?? null;
  const bpKind = summary?.buyingPowerEffectKind ?? reviewEcon?.buyingPowerEffectKind ?? "estimated";

  const hidePlainSingleLegConfirm =
    atBracketConfirm?.mode === "trigger" || atBracketConfirm?.mode === "unsupported";

  return (
    <div
      className="absolute inset-0 flex flex-col justify-end z-10"
      style={{ background: "rgba(0,0,0,0.55)" }}
      data-testid="chain-sheet-confirm"
    >
      <div
        className="p-3 space-y-2 animate-in slide-in-from-bottom duration-300 max-h-[85%] overflow-y-auto"
        style={{ background: BG, borderTop: `1px solid ${GOLD}40`, borderRadius: "14px 14px 0 0" }}
      >
        <div className="flex justify-between items-center">
          <span className="text-[14px] font-semibold" style={{ color: WHITE }}>
            Order confirmation
          </span>
          <button type="button" onClick={onBack} aria-label="Close">
            <X className="w-4 h-4" style={{ color: MUTED }} />
          </button>
        </div>
        {atBracketConfirm?.mode === "unsupported" ? (
          <div
            className="p-3 rounded-lg space-y-2"
            style={{ background: `${DOWN}12`, border: `1px solid ${DOWN}44` }}
            data-testid="at-chain-bracket-unsupported"
          >
            <p className="text-[13px] font-semibold" style={{ color: DOWN }}>
              Bracket review not supported here
            </p>
            <p className="text-[12px] leading-snug" style={{ color: GRAY }}>
              {atBracketConfirm.message}
            </p>
          </div>
        ) : null}
        {atBracketConfirm?.mode === "trigger" ? (
          <div className="p-2.5 rounded-lg" style={{ background: "#111", border: `1px solid ${BORDER}` }}>
            <ButtonRow
              label="Entry"
              value={humanInstruction(atBracketConfirm.primaryInstruction)}
            />
            <ButtonRow label="Template qty" value={String(atBracketConfirm.quantity)} />
            <ButtonRow
              label="Limit price"
              value={`$${displaySubmittedLimit(limitTickCtx, px)}`}
            />
            <ButtonRow label="Time in force" value={timeInForce} />
            <TriggerOrderConfirmSummary
              summary={atBracketConfirm.summary}
              ocoPairNote={
                atBracketConfirm.summary.orders.length >= 3
                  ? "Orders #2 and #3: one cancels other (OCO)."
                  : undefined
              }
              exitDurationLabel={atExitDurationLabel}
            />
          </div>
        ) : null}
        {!hidePlainSingleLegConfirm ? (
          <div className="space-y-1 p-2.5 rounded-lg" style={{ background: "#111", border: `1px solid ${BORDER}` }}>
            <ButtonRow label="Strategy" value={strategyName} valueColor={strategyColor} />
            <ButtonRow label="Order type" value={orderTypeLabel} />
            {legs.map((leg, i) => (
              <p key={i} className="text-[13px] leading-snug" style={{ color: WHITE }}>
                {formatLegLine(leg, symbol, quantity)}
              </p>
            ))}
            <ButtonRow label={`Net ${isCredit ? "credit" : "debit"}`} value={fmtCurrency(gross)} />
            <ButtonRow
              label={`Est. commissions (${totalContracts} × $0.65)`}
              value={fmtCurrency(fees.commission)}
            />
            <ButtonRow label="Est. regulatory fees" value={fmtCurrency(fees.regulatoryEst)} />
            <ButtonRow
              label={isCredit ? "Net credit (after est. fees)" : "Net debit (after est. fees)"}
              value={`${netCashAfterFees >= 0 ? "+" : "−"}${fmtCurrency(Math.abs(netCashAfterFees))}`}
              valueColor={netCashAfterFees >= 0 ? UP : DOWN}
              emphasize
            />
            <ButtonRow label="Time in force" value={timeInForce} />
            <ButtonRow
              label="Limit price"
              value={`$${displaySubmittedLimit(limitTickCtx, px)}`}
            />
            {maxLoss != null && (
              <ButtonRow label="Max loss" value={fmtCurrency(maxLoss)} valueColor={DOWN} />
            )}
            {bpEffect != null && (
              <ButtonRow
                label={
                  bpKind === "cash_secured"
                    ? "Cash-secured collateral (est.)"
                    : "Buying power (est.)"
                }
                value={`−${fmtCurrency(Math.abs(bpEffect))}`}
                valueColor={DOWN}
              />
            )}
            {bpEffect == null && bpKind === "not_estimated" && (
              <ButtonRow label="Buying power" value="Not estimated" />
            )}
          </div>
        ) : null}
        {sendDetail ? (
          <p data-at-send-reason className="text-[13px] leading-snug font-semibold" style={{ color: DOWN }}>
            {sendDetail}
          </p>
        ) : !hidePlainSingleLegConfirm ? (
          <div
            className="px-2 py-1.5 flex items-center gap-1.5"
            style={{ background: `${GOLD}08`, borderRadius: 8, border: `1px solid ${GOLD}33` }}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: GOLD }} />
            <p className="text-[12px] leading-tight" style={{ color: `${GOLD}dd` }}>
              Live order via Schwab. Verify all details.
            </p>
          </div>
        ) : null}
        {hidePlainSingleLegConfirm && atBracketConfirm?.mode === "trigger" ? (
          <p className="text-[11px] px-1" style={{ color: MUTED }}>
            Preview only — order sending is off. Attached exits match your Active Trader template draft.
          </p>
        ) : null}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 py-2.5 text-[13px]"
            style={{ border: `1px solid ${BORDER}`, color: GRAY, borderRadius: 8 }}
          >
            Back
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={sendDisabled}
            className="flex-[2] py-2.5 text-[13px] font-bold disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: GOLD, color: "#000", borderRadius: 8 }}
            data-testid="chain-sheet-send"
          >
            {sendLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ButtonRow({
  label,
  value,
  valueColor = WHITE,
  emphasize,
}: {
  label: string;
  value: string;
  valueColor?: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex justify-between gap-2 text-[13px]">
      <span style={{ color: MUTED }}>{label}</span>
      <span
        style={{
          color: valueColor,
          fontWeight: emphasize ? 600 : 400,
          fontSize: emphasize ? 14 : 13,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function LegQtyStepper({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <span className="inline-flex items-center" style={{ border: `1px solid ${BORDER}`, borderRadius: 6 }}>
      <button type="button" onClick={() => onChange(Math.max(1, qty - 1))} className="px-1">
        <Minus className="w-2.5 h-2.5" style={{ color: DIM }} />
      </button>
      <span className="px-1 text-[10px] tabular-nums" style={{ color: WHITE }}>{qty}</span>
      <button type="button" onClick={() => onChange(qty + 1)} className="px-1">
        <Plus className="w-2.5 h-2.5" style={{ color: DIM }} />
      </button>
    </span>
  );
}

/** Build StrategyLeg rows from chain selection + portfolio close detection. */
export function legsFromChainSelection(
  entries: Array<{
    key: string;
    contract: {
      strike: number;
      expiration: string;
      schwabSymbol?: string;
      streamKey?: string;
      bid?: number;
      ask?: number;
      delta?: number;
      gamma?: number;
      theta?: number;
      vega?: number;
      iv?: number;
      contractTs?: number;
    };
    type: "CALL" | "PUT";
    side: "bid" | "ask";
    quantity?: number;
  }>,
  symbol: string,
  accounts: SchwabAccountRow[],
  buildSchwabOptionKey: (sym: string, exp: string, strike: number, cp: "C" | "P") => string,
  tradingAccountHash: string | null,
): StrategyLeg[] {
  const rows: StrategyLeg[] = [];
  for (const l of entries) {
    const schwabSymbol =
      l.contract.schwabSymbol?.trim() ||
      l.contract.streamKey?.trim() ||
      buildSchwabOptionKey(
        seriesRootFromExpiration(l.contract.expiration) ?? symbol,
        l.contract.expiration,
        l.contract.strike,
        l.type === "CALL" ? "C" : "P",
      );
    const qty = l.quantity ?? 1;
    const { slices } = resolveChainLegInstructions(
      schwabSymbol,
      l.side,
      qty,
      accounts,
      tradingAccountHash,
    );
    const base = {
      optionType: l.type,
      strike: l.contract.strike,
      expiration: l.contract.expiration,
      bid: l.contract.bid,
      ask: l.contract.ask,
      delta: l.contract.delta,
      gamma: l.contract.gamma,
      theta: l.contract.theta,
      vega: l.contract.vega,
      iv: l.contract.iv,
      schwabSymbol,
      contractTs: l.contract.contractTs,
    };
    for (const [idx, slice] of slices.entries()) {
      rows.push({
        ...base,
        id: slices.length > 1 ? `${l.key}#${idx}:${slice.instruction}` : l.key,
        direction: slice.instruction,
        quantity: slice.quantity,
      });
    }
  }
  return rows;
}