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
import { useTerminalStore, type LiveQuote } from "@/lib/store";
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
import {
   estimateSchwabOptionFees,
  computeOrderNetCash,
  roundMoney,
} from "@/lib/orders/schwabOrderFees";
import {
  humanInstruction,
  type SchwabEquityInstruction,
  type SchwabInstruction,
} from "@/lib/active-trader/atSchwabOrderBuilder";
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
import {
  AtApprovedMobileOrderSheet,
  type EquitySheetDisplayLeg,
} from "@/components/active-trader/AtApprovedMobileOrderSheet";
import type { ChainDraftSheetSession } from "@/lib/orders/chainDraftSessionStore";
import { dispatchStrategistValidation } from "@/lib/orders/dispatchStrategistValidation";

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
/** Clear bottom nav (~80px) + home indicator. */
const SHEET_BOTTOM_OFFSET = "calc(80px + max(env(safe-area-inset-bottom, 0px), 12px))";

type Stage = "form" | "review" | "submitting" | "success" | "error";

/** How often the ticket re-prices from live leg quotes. */
const TICKET_TICK_MS = 120;

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Every key a Schwab equity quote may be stored under. No session filter. */
function equityStreamLookupKeys(symbol: string): string[] {
  const u = symbol.trim().toUpperCase();
  if (!u) return [];
  const keys = new Set<string>([u]);
  if (u.startsWith("$")) keys.add(u.slice(1));
  else keys.add(`$${u}`);
  if (u.includes(".")) keys.add(u.split(".").join("/"));
  if (u.includes("/")) keys.add(u.split("/").join("."));
  return [...keys];
}

function freshestEquityStreamQuote(
  prices: Record<string, LiveQuote>,
  symbol: string,
): LiveQuote | null {
  let best: LiveQuote | null = null;
  let bestTs = -1;
  for (const key of equityStreamLookupKeys(symbol)) {
    const row = prices[key];
    if (!row) continue;
    const ts = typeof row.ts === "number" && Number.isFinite(row.ts) ? row.ts : 0;
    if (!best || ts >= bestTs) {
      best = row;
      bestTs = ts;
    }
  }
  return best;
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export interface EquityTicketDraft {
  symbol: string;
  side: "BUY" | "SELL";
  instruction?: SchwabEquityInstruction;
  quantity: number;
  isClose?: boolean;
  initialLimitPrice?: number | null;
}

export type StrategistSheetDispatchResult =
  | { ok: true; ticker: string }
  | { ok: false; error: string };

export interface OptionsChainOrderSheetProps {
  legs: StrategyLeg[];
  /** Unified equity draft (opening or closing stock position). */
  equityDraft?: EquityTicketDraft | null;
  onEquityQuantityChange?: (quantity: number) => void;
  /** Initial net/contract limit price when opening from AI Strategist or reopen card. */
  initialLimitPrice?: number | null;
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
  /** Populated while a draft is mounted so the Order Defaults popup can dispatch to AI Strategist. */
  strategistHandlerRef?: React.MutableRefObject<
    ((opts: { thesis?: string }) => Promise<StrategistSheetDispatchResult>) | null
  >;
  /** Restored limit lock after Options remount (chunk recovery). */
  restoredSheetSession?: ChainDraftSheetSession;
  onSheetSessionPersist?: (session: ChainDraftSheetSession) => void;
  /** Docked send accepted. The parent keeps this after the draft closes. */
  onWorkingOrderAccepted?: (anchor: {
    orderId: string | null;
    accountHash: string;
    occSymbols: string[];
  }) => void;
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
  equityKey?: string;
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
  return `${input.equityKey ?? legs}#${input.quantity}#${input.limitLocked ? 1 : 0}#${input.orderType}#${input.limitEditEpoch}`;
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

function resolveEquityPositionAndInstruction(input: {
  draft: EquityTicketDraft;
  quantity: number;
  accounts: Array<{
    hashValue: string | null;
    positions: Array<{
      symbol: string;
      assetType?: string;
      longQuantity?: number;
      shortQuantity?: number;
    }>;
  }>;
  accountHash: string | null;
}): {
  cleanSymbol: string;
  instruction: SchwabEquityInstruction;
  isClosing: boolean;
  heldLong: number;
  heldShort: number;
} {
  const cleanSymbol = input.draft.symbol.replace(/^\$/, "").trim().toUpperCase();
  const activeAccount =
    input.accounts.find((a) => a.hashValue != null && a.hashValue === input.accountHash) ??
    input.accounts[0];
  const pos = (activeAccount?.positions ?? []).find((p) => {
    const sym = p.symbol.trim().toUpperCase();
    if (sym !== cleanSymbol) return false;
    if (p.assetType) return p.assetType.toUpperCase() === "EQUITY";
    return sym.length < 15;
  });
  const heldLong = Number(pos?.longQuantity ?? 0);
  const heldShort = Number(pos?.shortQuantity ?? 0);

  if (input.draft.instruction) {
    const instruction = input.draft.instruction;
    const isClosing =
      Boolean(input.draft.isClose) || instruction === "SELL" || instruction === "BUY_TO_COVER";
    return { cleanSymbol, instruction, isClosing, heldLong, heldShort };
  }

  if (input.draft.isClose) {
    if (input.draft.side === "BUY" || (heldShort > 0 && heldLong <= 0)) {
      return { cleanSymbol, instruction: "BUY_TO_COVER", isClosing: true, heldLong, heldShort };
    }
    return { cleanSymbol, instruction: "SELL", isClosing: true, heldLong, heldShort };
  }

  if (input.draft.side === "BUY") {
    if (heldShort > 0 && input.quantity <= heldShort) {
      return { cleanSymbol, instruction: "BUY_TO_COVER", isClosing: true, heldLong, heldShort };
    }
    return { cleanSymbol, instruction: "BUY", isClosing: false, heldLong, heldShort };
  }

  if (heldLong > 0 && input.quantity <= heldLong) {
    return { cleanSymbol, instruction: "SELL", isClosing: true, heldLong, heldShort };
  }
  return { cleanSymbol, instruction: "SELL_SHORT", isClosing: false, heldLong, heldShort };
}

export function OptionsChainOrderSheet({
  legs,
  equityDraft,
  onEquityQuantityChange,
  initialLimitPrice,
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
  strategistHandlerRef,
  restoredSheetSession,
  onSheetSessionPersist,
  onWorkingOrderAccepted,
}: OptionsChainOrderSheetProps) {
  const storeSymbol = useTerminalStore((s) => s.symbol);
  const isEquityDraft = legs.length === 0 && equityDraft != null;
  const hasDraft = legs.length > 0 || isEquityDraft;
  const symbol = isEquityDraft ? equityDraft.symbol : storeSymbol;
  const sendAllowed = atOrderSendAllowed();
  const liveStreamQuote = useTerminalStore((s) => freshestEquityStreamQuote(s.streamPrices, symbol));
  const underlyingSpot =
    liveStreamQuote?.last ?? liveStreamQuote?.extendedLast ?? liveStreamQuote?.regularLast ?? null;
  const accounts = useSchwabAccountStore((s) => s.accounts);
  const accountHash = useSchwabAccountStore((s) => s.tradingAccountHash());
  /**
   * Live quotes for this ticket's legs only, a few times a second. The whole
   * tick map changes on every quote for every contract, which re-ran all of
   * the ticket math far more often than the numbers can be read.
   */
  const legSymbols = useMemo(
    () =>
      [
        ...new Set(
          legs.flatMap((l) => [l.schwabSymbol, l.streamKey].filter((key): key is string => !!key)),
        ),
      ].sort(),
    [legs],
  );
  const optionTicks = useOptionTicksForKeys(legSymbols, TICKET_TICK_MS);

  const [limitPrice, setLimitPrice] = useState(restoredSheetSession?.limitPrice ?? "");
  const [quantity, setQuantity] = useState(() => {
    const restored = restoredSheetSession?.spreadQuantity;
    return typeof restored === "number" && Number.isInteger(restored) && restored >= 1 ? restored : 1;
  });
  const effectiveQuantity = isEquityDraft
    ? Math.max(1, Math.floor(equityDraft.quantity || quantity) || 1)
    : quantity;
  const handleQuantityChange = useCallback(
    (next: number) => {
      const clamped = Math.max(1, Math.floor(next) || 1);
      setQuantity(clamped);
      if (isEquityDraft) onEquityQuantityChange?.(clamped);
    },
    [isEquityDraft, onEquityQuantityChange],
  );
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
  const equityHydrateKeyRef = useRef("");
  const [limitLocked, setLimitLocked] = useState(restoredSheetSession?.limitLocked ?? false);
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET">("LIMIT");

  useEffect(() => {
    const prefType = atBracketDraft?.prefs.schwabEntryType;
    if (prefType === "MARKET") setOrderType("MARKET");
    else if (prefType === "LIMIT") setOrderType("LIMIT");
  }, [atBracketDraft?.prefs.schwabEntryType]);

  const equityResolved = useMemo(
    () =>
      isEquityDraft && equityDraft
        ? resolveEquityPositionAndInstruction({
            draft: equityDraft,
            quantity: effectiveQuantity,
            accounts,
            accountHash,
          })
        : null,
    [isEquityDraft, equityDraft, effectiveQuantity, accounts, accountHash],
  );

  const isClosingOption = useMemo(
    () => !isEquityDraft && legs.length > 0 && legs.every((l) => l.direction.endsWith("_TO_CLOSE")),
    [isEquityDraft, legs],
  );
  const isClosingOrder = isEquityDraft ? Boolean(equityResolved?.isClosing) : isClosingOption;

  const pricedLegs = useMemo(
    () =>
      legs.map((leg) =>
        mergeLegStreamQuotes(
          leg,
          optionTicks[leg.schwabSymbol] ?? (leg.streamKey ? optionTicks[leg.streamKey] : undefined),
        ),
      ),
    [legs, optionTicks],
  );

  useEffect(() => {
    const symbols = legs.flatMap((l) => [l.schwabSymbol, l.streamKey].filter((key): key is string => !!key));
    if (symbols.length > 0 && subscribeOptionSymbols) {
      void subscribeOptionSymbols([...new Set(symbols)]);
    }
  }, [legs, subscribeOptionSymbols]);

  useEffect(() => {
    if (!isEquityDraft) return;
    const sym = symbol.replace(/^\$/, "").trim().toUpperCase();
    if (!sym || sym.startsWith("/")) return;
    void fetchWithAuth("/api/stream/symbols", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [sym] }),
    }).catch(() => {});
  }, [isEquityDraft, symbol]);

  useEffect(() => {
    if (!hasDraft) {
      setStage("form");
      setLimitPrice("");
      setQuantity(1);
      limitUserEditedRef.current = false;
      legsHydrateKeyRef.current = "";
      legDirectionKeyRef.current = null;
      equityHydrateKeyRef.current = "";
      setAtBracketConfirmSnapshot(null);
    }
  }, [hasDraft]);

  useEffect(() => {
    onSheetSessionPersist?.({
      limitPrice,
      limitLocked,
      limitUserEdited: limitUserEditedRef.current,
      spreadQuantity: effectiveQuantity,
    });
  }, [limitPrice, limitLocked, effectiveQuantity, onSheetSessionPersist]);

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

  const limitTickCtx = useMemo(
    (): LimitTickContext => ({ underlyingSymbol: symbol, isOption: !isEquityDraft }),
    [symbol, isEquityDraft],
  );

  const eqBid =
    liveStreamQuote && "bid" in liveStreamQuote && typeof liveStreamQuote.bid === "number"
      ? liveStreamQuote.bid
      : null;
  const eqAsk =
    liveStreamQuote && "ask" in liveStreamQuote && typeof liveStreamQuote.ask === "number"
      ? liveStreamQuote.ask
      : null;
  const eqChangePct =
    liveStreamQuote && "changePct" in liveStreamQuote && typeof liveStreamQuote.changePct === "number"
      ? liveStreamQuote.changePct
      : null;
  const eqMid = useMemo(() => {
    if (!isEquityDraft) return null;
    const frameTs = liveStreamQuote?.ts ?? 0;
    const bookTs = Math.max(liveStreamQuote?.bidQuoteTs ?? 0, liveStreamQuote?.askQuoteTs ?? 0);
    const bookOnLatestFrame = bookTs > 0 && frameTs > 0 && bookTs + 500 >= frameTs;
    const bookMid =
      eqBid != null && eqBid > 0 && eqAsk != null && eqAsk > 0
        ? midpointFromBidAsk(eqBid, eqAsk)
        : null;
    const rawMid =
      bookOnLatestFrame && bookMid != null && bookMid > 0
        ? bookMid
        : underlyingSpot != null && underlyingSpot > 0
          ? underlyingSpot
          : bookMid;
    if (rawMid == null || !(rawMid > 0)) return null;
    return parseCanonicalLimit(rawMid, limitTickCtx);
  }, [isEquityDraft, liveStreamQuote, eqBid, eqAsk, underlyingSpot, limitTickCtx]);

  const spreadPrices = useMemo(() => {
    if (isEquityDraft) {
      if (eqMid == null && eqBid == null && eqAsk == null) return null;
      return {
        spreadBid: eqBid,
        spreadMid: eqMid,
        spreadAsk: eqAsk,
        crossed: false,
      };
    }
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
  }, [isEquityDraft, eqBid, eqMid, eqAsk, pricedLegs, limitTickCtx]);

  const submittedLimit = useMemo(
    () => resolveSubmittedLimit(limitTickCtx, limitPrice),
    [limitTickCtx, limitPrice],
  );

  const isCredit = useMemo(() => {
    if (isEquityDraft && equityResolved) {
      return (
        equityResolved.instruction === "SELL" || equityResolved.instruction === "SELL_SHORT"
      );
    }
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
  }, [isEquityDraft, equityResolved, pricedLegs]);

  const resolvedOrder = useMemo(
    () =>
      resolveVisibleChainOrderType({
        visible: orderType,
        isCredit,
        legCount: isEquityDraft ? 1 : legs.length,
      }),
    [orderType, isCredit, isEquityDraft, legs.length],
  );
  const resolvedOrderLabel = resolvedOrder.label;

  const summary = useMemo(
    () =>
      isEquityDraft
        ? null
        : computeChainTicketSummary({
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
            spreadQuantity: effectiveQuantity,
            isCredit,
            spotPrice: underlyingSpot,
          }),
    [isEquityDraft, pricedLegs, symbol, submittedLimit, spreadPrices, effectiveQuantity, isCredit, underlyingSpot],
  );

  const equityUnitPrice = submittedLimit ?? eqMid ?? null;
  const equityGrossDollars = useMemo(() => {
    if (!isEquityDraft || equityUnitPrice == null || !(equityUnitPrice > 0)) return null;
    return roundMoney(equityUnitPrice * effectiveQuantity);
  }, [isEquityDraft, equityUnitPrice, effectiveQuantity]);

  const buyingPowerDisplay = useMemo(
    () =>
      isEquityDraft
        ? isClosingOrder
          ? null
          : equityGrossDollars != null
            ? -equityGrossDollars
            : null
        : (summary?.buyingPowerEffect ?? null),
    [isEquityDraft, isClosingOrder, equityGrossDollars, summary?.buyingPowerEffect],
  );

  const feeAdjustedNetCash = useMemo(() => {
    if (isEquityDraft) {
      if (equityGrossDollars == null) return null;
      return isCredit ? equityGrossDollars : -equityGrossDollars;
    }
    if (summary?.grossNotional == null) return null;
    const totalContracts = legs.reduce((s, l) => s + l.quantity, 0) * effectiveQuantity;
    const fees = estimateSchwabOptionFees(totalContracts);
    const cash = computeOrderNetCash(Math.abs(summary.grossNotional), isCredit, totalContracts, fees);
    return isCredit ? cash.net : -cash.net;
  }, [isEquityDraft, equityGrossDollars, summary?.grossNotional, legs, effectiveQuantity, isCredit]);

  const netDebitForName = summary?.grossNotional != null ? (isCredit ? -summary.grossNotional : summary.grossNotional) : 0;
  const strategyId = useMemo(() => {
    if (isEquityDraft && equityResolved) {
      switch (equityResolved.instruction) {
        case "BUY":
          return { id: "buy_stock", name: "Buy Stock (Open)", color: UP };
        case "SELL_SHORT":
          return { id: "short_stock", name: "Short Stock (Open)", color: DOWN };
        case "SELL":
          return { id: "sell_stock_close", name: "Sell Stock (Close)", color: DOWN };
        case "BUY_TO_COVER":
          return { id: "cover_stock_close", name: "Buy to Cover (Close)", color: UP };
      }
    }
    return detectStrategyType(legs, netDebitForName);
  }, [isEquityDraft, equityResolved, legs, netDebitForName]);

  const allLegsQuoted = useMemo(
    () => pricedLegs.length > 0 && pricedLegs.every((l) => quoteSideState(l.bid, l.ask) === "ok"),
    [pricedLegs],
  );
  const legDirectionKey = useMemo(
    () => legs.map((leg) => `${leg.id.split("#")[0]}:${leg.direction}`).join("|"),
    [legs],
  );

  const equityHydrateKey = useMemo(
    () =>
      isEquityDraft && equityDraft && equityResolved
        ? `${equityResolved.cleanSymbol}:${equityDraft.side}:${equityResolved.instruction}:${equityDraft.initialLimitPrice ?? ""}`
        : "",
    [isEquityDraft, equityDraft, equityResolved],
  );

  useEffect(() => {
    if (!isEquityDraft || stage !== "form") return;
    const keyChanged = equityHydrateKeyRef.current !== equityHydrateKey;
    if (keyChanged) {
      equityHydrateKeyRef.current = equityHydrateKey;
      setQuantity(Math.max(1, Math.floor(equityDraft?.quantity ?? 1) || 1));
      limitUserEditedRef.current = false;
      if (limitLocked) setLimitLocked(false);
      if (eqMid != null) {
        setLimitPrice(displaySubmittedLimit(limitTickCtx, eqMid));
      } else if (equityDraft?.initialLimitPrice != null && equityDraft.initialLimitPrice > 0) {
        setLimitPrice(displaySubmittedLimit(limitTickCtx, equityDraft.initialLimitPrice));
      } else {
        setLimitPrice("");
      }
      return;
    }
    if (limitLocked || limitUserEditedRef.current) return;
    if (eqMid != null) {
      const next = displaySubmittedLimit(limitTickCtx, eqMid);
      if (next !== limitPrice) setLimitPrice(next);
    }
  }, [isEquityDraft, stage, equityHydrateKey, equityDraft, limitTickCtx, eqMid, limitLocked, limitPrice]);

  useEffect(() => {
    if (isEquityDraft || legs.length === 0 || stage !== "form") return;
    const prevDirections = legDirectionKeyRef.current;
    const directionsChanged = prevDirections != null && prevDirections !== legDirectionKey;
    legDirectionKeyRef.current = legDirectionKey;
    if (directionsChanged) limitUserEditedRef.current = false;
    if (limitLocked && !directionsChanged) return;
    const keyChanged = legsHydrateKeyRef.current !== legsHydrateKey;
    if (keyChanged) {
      legsHydrateKeyRef.current = legsHydrateKey;
      if (initialLimitPrice != null && initialLimitPrice > 0) {
        limitUserEditedRef.current = true;
        setLimitPrice(displaySubmittedLimit(limitTickCtx, initialLimitPrice));
        return;
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
  }, [isEquityDraft, initialLimitPrice, legDirectionKey, legsHydrateKey, legs.length, spreadPrices?.spreadMid, limitTickCtx, stage, limitPrice, allLegsQuoted, limitLocked]);

  const snapLimitForSubmit = useCallback((): number | null => {
    const snapped = resolveSubmittedLimit(limitTickCtx, limitPrice);
    if (snapped == null) return null;
    setLimitPrice(displaySubmittedLimit(limitTickCtx, snapped));
    return snapped;
  }, [limitTickCtx, limitPrice]);

  const nudgePrice = useCallback(
    (dir: "up" | "down") => {
      const base =
        parseCanonicalLimit(limitPrice, limitTickCtx) ??
        (isEquityDraft ? eqMid : spreadPrices?.spreadMid);
      if (base == null) return;
      if (isEquityDraft) {
        const raw = dir === "up" ? base + 0.01 : Math.max(0.01, base - 0.01);
        const rounded = Math.round(raw * 100) / 100;
        limitUserEditedRef.current = true;
        noteLimitReplaced();
        setLimitPrice(displaySubmittedLimit(limitTickCtx, rounded));
        setPriceError("");
        return;
      }
      const tick = optionPremiumTickForSymbol(symbol, base) ?? 0.01;
      const raw = dir === "up" ? base + tick : Math.max(tick, base - tick);
      const rounded = roundOptionPriceToTick(raw, limitTickCtx, dir === "up" ? "up" : "down");
      limitUserEditedRef.current = true;
      noteLimitReplaced();
      setLimitPrice(displaySubmittedLimit(limitTickCtx, rounded));
      setPriceError("");
    },
    [limitPrice, limitTickCtx, isEquityDraft, eqMid, spreadPrices, symbol],
  );

  const effectiveAtBracketDraft = useMemo(() => {
    if (!atBracketDraft) return undefined;
    if (isClosingOrder) {
      return {
        primaryInstruction: isEquityDraft && equityResolved ? equityResolved.instruction : atBracketDraft.primaryInstruction,
        prefs: {
          ...atBracketDraft.prefs,
          template: "Single" as const,
          advancedRoute: "SINGLE" as const,
          takeProfit: { ...atBracketDraft.prefs.takeProfit, enabled: false },
          stopLoss: { ...atBracketDraft.prefs.stopLoss, enabled: false },
        },
      };
    }
    if (isEquityDraft && equityResolved) {
      return {
        prefs: atBracketDraft.prefs,
        primaryInstruction: equityResolved.instruction,
      };
    }
    return atBracketDraft;
  }, [atBracketDraft, isClosingOrder, isEquityDraft, equityResolved]);

  const buildSchwabOrder = useCallback(
    (priceOverride?: number) => {
      const parsed = priceOverride ?? schwabPriceFromTicket(limitTickCtx, limitPrice);
      if (isEquityDraft && equityResolved) {
        return buildChainSheetSchwabOrder({
          prefs: effectiveAtBracketDraft?.prefs ?? atBracketDraft?.prefs,
          primaryInstruction: equityResolved.instruction,
          legs: [],
          equityLeg: {
            symbol: equityResolved.cleanSymbol,
            instruction: equityResolved.instruction,
            quantity: effectiveQuantity,
            isClosing: equityResolved.isClosing,
          },
          quantityMultiplier: 1,
          limitPrice: parsed,
          isCredit,
          visibleOrderType: orderType,
          complexOrderStrategyType: "NONE",
          underlyingSymbol: equityResolved.cleanSymbol,
          underlyingPrice: underlyingSpot,
          timeInForce,
        });
      }
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
        prefs: effectiveAtBracketDraft?.prefs ?? atBracketDraft?.prefs,
        primaryInstruction: effectiveAtBracketDraft?.primaryInstruction ?? atBracketDraft?.primaryInstruction,
        legs: legs.map((leg) => ({
          direction: leg.direction,
          quantity: leg.quantity,
          schwabSymbol: leg.schwabSymbol,
          expiration: leg.expiration,
          delta: leg.delta,
          iv: leg.iv,
        })),
        quantityMultiplier: effectiveQuantity,
        limitPrice: parsed,
        isCredit,
        visibleOrderType: orderType,
        complexOrderStrategyType: complexType,
        underlyingSymbol: symbol,
        underlyingPrice: underlyingSpot,
        timeInForce,
      });
    },
    [
      isEquityDraft,
      equityResolved,
      effectiveAtBracketDraft,
      isCredit,
      timeInForce,
      legs,
      effectiveQuantity,
      limitPrice,
      limitTickCtx,
      atBracketDraft,
      symbol,
      underlyingSpot,
      orderType,
    ],
  );

  const guardDraftLegCount = useCallback(() => {
    if (isEquityDraft) return true;
    const distinct = draftDistinctLegCount ?? distinctChainLegsFromStrategy(legs);
    try {
      assertChainDraftLegCount(distinct);
      return true;
    } catch {
      setPriceError(CHAIN_LEG_LIMIT_MESSAGE);
      return false;
    }
  }, [isEquityDraft, draftDistinctLegCount, legs]);

  const validateAndReview = useCallback(() => {
    if (!guardDraftLegCount()) return;
    const px = resolvedOrder.orderType === "MARKET" ? 0 : snapLimitForSubmit();
    if (resolvedOrder.orderType !== "MARKET" && (px == null || px <= 0)) {
      setPriceError("Set a valid limit price (Mid / Natural or enter manually).");
      return;
    }
    setReviewLimitSnapped(px);
    setPriceError("");
    const draft = effectiveAtBracketDraft;
    if (draft && bracketPrefsActive(draft.prefs)) {
      if (isEquityDraft && equityResolved) {
        const entryGross = px != null && px > 0 ? roundMoney(px * effectiveQuantity) : null;
        const econ = buildChainSheetBracketEconomics({
          prefs: draft.prefs,
          primaryInstruction: equityResolved.instruction,
          lockedLimit: px,
          legCount: 1,
          optionSymbol: equityResolved.cleanSymbol,
          underlyingSymbol: equityResolved.cleanSymbol,
          spreadQuantity: effectiveQuantity,
          totalContracts: 0,
          entryGrossDollars: entryGross,
          isCredit,
          assetType: "EQUITY",
        });
        setAtBracketConfirmSnapshot(econ.bracketConfirm);
      } else {
        const leg = legs[0];
        const sym = leg ? primaryLegOptionSymbol(leg, symbol) : undefined;
        const distinctLegs = draftDistinctLegCount ?? distinctChainLegsFromStrategy(legs);
        const entryGross =
          summary?.grossNotional != null ? Math.abs(summary.grossNotional) : null;
        const totalContracts = legs.reduce((s, l) => s + l.quantity, 0) * effectiveQuantity;
        if (sym) {
          const econ = buildChainSheetBracketEconomics({
            prefs: draft.prefs,
            primaryInstruction: draft.primaryInstruction,
            lockedLimit: px,
            legCount: distinctLegs,
            optionSymbol: sym,
            underlyingSymbol: symbol.replace(/^\$/, ""),
            spreadQuantity: effectiveQuantity,
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
      }
    } else {
      setAtBracketConfirmSnapshot(null);
    }
    setStage("review");
  }, [
    snapLimitForSubmit,
    guardDraftLegCount,
    effectiveAtBracketDraft,
    isEquityDraft,
    equityResolved,
    legs,
    draftDistinctLegCount,
    symbol,
    summary?.grossNotional,
    effectiveQuantity,
    isCredit,
    resolvedOrder,
  ]);

  const openReviewRef = useRef(false);
  const placeOrderInFlightRef = useRef(false);
  const draftRevisionRef = useRef("");
  draftRevisionRef.current = chainDraftRevision({
    legs,
    equityKey: isEquityDraft ? equityHydrateKey : undefined,
    quantity: effectiveQuantity,
    limitLocked,
    orderType,
    limitEditEpoch: limitEditEpochRef.current,
  });
  const [sendLocked, setSendLocked] = useState(false);
  useEffect(() => {
    if (!openReviewOnMount || openReviewRef.current || !hasDraft) return;
    const px = submittedLimit ?? spreadPrices?.spreadMid;
    if (px == null || px <= 0) return;
    openReviewRef.current = true;
    const t = window.setTimeout(() => validateAndReview(), 500);
    return () => window.clearTimeout(t);
  }, [openReviewOnMount, hasDraft, submittedLimit, spreadPrices?.spreadMid, validateAndReview]);

  useEffect(() => {
    if (!strategistHandlerRef) return;
    if (!hasDraft) {
      strategistHandlerRef.current = null;
      return;
    }
    strategistHandlerRef.current = async ({ thesis }) => {
      const duration =
        effectiveAtBracketDraft?.prefs.entryDuration ??
        (timeInForce === "GTC" ? "GOOD_TILL_CANCEL" : "DAY");
      const estMaxRisk = isEquityDraft
        ? isClosingOrder
          ? null
          : equityResolved?.instruction === "SELL_SHORT"
            ? null
            : equityGrossDollars
        : (summary?.maxLoss ?? null);
      const estMaxProfit = isEquityDraft
        ? null
        : (summary?.maxProfit ?? null);
      const breakeven = isEquityDraft
        ? (submittedLimit ?? eqMid ?? null)
        : (summary?.breakevens?.[0] ?? null);
      return dispatchStrategistValidation({
        symbol,
        legs: pricedLegs,
        isEquityDraft,
        equitySide: equityDraft?.side,
        equityInstruction: equityResolved?.instruction,
        isClosingOrder,
        orderType: resolvedOrder.orderType === "MARKET" ? "MARKET" : "LIMIT",
        duration,
        quantity: effectiveQuantity,
        limitPrice: resolvedOrder.orderType === "MARKET" ? null : (submittedLimit ?? spreadPrices?.spreadMid ?? null),
        isCredit,
        underlyingPrice: underlyingSpot,
        underlyingChangePct: eqChangePct,
        estMaxRisk,
        estMaxProfit,
        breakeven,
        thesis,
      });
    };
    return () => {
      strategistHandlerRef.current = null;
    };
  }, [
    strategistHandlerRef,
    hasDraft,
    effectiveAtBracketDraft,
    timeInForce,
    isEquityDraft,
    isClosingOrder,
    equityResolved,
    equityGrossDollars,
    summary,
    submittedLimit,
    eqMid,
    symbol,
    pricedLegs,
    equityDraft?.side,
    resolvedOrder.orderType,
    effectiveQuantity,
    spreadPrices?.spreadMid,
    isCredit,
    underlyingSpot,
    eqChangePct,
  ]);

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
    const submittedAccount = accountHash;
    const submittedOcc = legs.map((leg) => leg.schwabSymbol).filter((symbol) => !!symbol.trim());
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
        if (submittedAccount) {
          onWorkingOrderAccepted?.({
            orderId: acceptance.orderId,
            accountHash: submittedAccount,
            occSymbols: submittedOcc,
          });
        }
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
  }, [accountHash, buildSchwabOrder, snapLimitForSubmit, demoFixture, stage, sendAllowed, guardDraftLegCount, resolvedOrder, atDocked, onCollapsedChange, onClearAll, onSheetSessionPersist, onWorkingOrderAccepted, legs]);

  const handleClearAllClick = useCallback(() => {
    limitUserEditedRef.current = false;
    legsHydrateKeyRef.current = "";
    equityHydrateKeyRef.current = "";
    onClearAll();
  }, [onClearAll]);

  const isValid =
    hasDraft &&
    (resolvedOrder.orderType === "MARKET" || (submittedLimit != null && submittedLimit > 0)) &&
    effectiveQuantity > 0 &&
    (demoFixture || !!accountHash);

  const bracketEconomics = useMemo(() => {
    const draft = effectiveAtBracketDraft;
    if (!draft || !bracketPrefsActive(draft.prefs)) return null;
    if (isEquityDraft && equityResolved) {
      return buildChainSheetBracketEconomics({
        prefs: draft.prefs,
        primaryInstruction: equityResolved.instruction,
        lockedLimit: submittedLimit,
        legCount: 1,
        optionSymbol: equityResolved.cleanSymbol,
        underlyingSymbol: equityResolved.cleanSymbol,
        spreadQuantity: effectiveQuantity,
        totalContracts: 0,
        entryGrossDollars: equityGrossDollars,
        isCredit,
        assetType: "EQUITY",
      });
    }
    const leg = legs[0];
    const sym = leg ? primaryLegOptionSymbol(leg, symbol) : undefined;
    if (!sym) return null;
    const limitForBracket = submittedLimit;
    const entryGross =
      summary?.grossNotional != null ? Math.abs(summary.grossNotional) : null;
    const totalContracts = legs.reduce((s, l) => s + l.quantity, 0) * effectiveQuantity;
    const econ = buildChainSheetBracketEconomics({
      prefs: draft.prefs,
      primaryInstruction: draft.primaryInstruction,
      lockedLimit: limitForBracket,
      legCount: draftDistinctLegCount ?? distinctChainLegsFromStrategy(legs),
      optionSymbol: sym,
      underlyingSymbol: symbol.replace(/^\$/, ""),
      spreadQuantity: effectiveQuantity,
      totalContracts,
      entryGrossDollars: entryGross,
      isCredit,
    });
    return econ;
  }, [
    effectiveAtBracketDraft,
    isEquityDraft,
    equityResolved,
    equityGrossDollars,
    legs,
    symbol,
    effectiveQuantity,
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

    const px = reviewLimitSnapped;
    if (px == null || px <= 0) return snap;

    if (isEquityDraft && equityResolved) {
      const built = buildChainSheetAtBracketConfirm({
        prefs: draft.prefs,
        legCount: 1,
        primaryInstruction: equityResolved.instruction,
        limitPrice: px,
        optionSymbol: equityResolved.cleanSymbol,
        underlyingSymbol: equityResolved.cleanSymbol,
        assetType: "EQUITY",
        quantityOverride: effectiveQuantity,
      });
      if (built.mode === "trigger" || built.mode === "unsupported") return built;
      return snap;
    }

    const leg = legs[0];
    if (!leg) return snap;

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
    isEquityDraft,
    equityResolved,
    effectiveQuantity,
    legs,
    symbol,
    reviewLimitSnapped,
    draftDistinctLegCount,
  ]);

  const equityLegDisplay = useMemo((): EquitySheetDisplayLeg | null => {
    if (!isEquityDraft || !equityResolved) return null;
    const badgeMap: Record<SchwabEquityInstruction, string> = {
      BUY: "BUY",
      SELL: "SELL",
      SELL_SHORT: "SHORT",
      BUY_TO_COVER: "COVER",
    };
    const lastLabel =
      underlyingSpot != null && underlyingSpot > 0 ? fmt(underlyingSpot) : null;
    const bookLabel =
      eqBid != null && eqBid > 0 && eqAsk != null && eqAsk > 0
        ? `${fmt(eqBid)}/${fmt(eqAsk)}`
        : null;
    const quoteSummary =
      lastLabel && bookLabel
        ? `${lastLabel}  ${bookLabel}`
        : bookLabel ?? (lastLabel ? `$${lastLabel}` : null);
    return {
      symbol: equityResolved.cleanSymbol,
      badgeLabel: badgeMap[equityResolved.instruction],
      isBuy:
        equityResolved.instruction === "BUY" ||
        equityResolved.instruction === "BUY_TO_COVER",
      quantity: effectiveQuantity,
      isClosing: equityResolved.isClosing,
      quoteSummary,
    };
  }, [isEquityDraft, equityResolved, eqBid, eqAsk, underlyingSpot, effectiveQuantity]);

  if (!hasDraft) return null;

  const equityEntryLabel =
    isEquityDraft && equityResolved
      ? equityResolved.instruction === "SELL"
        ? "Closing proceeds"
        : equityResolved.instruction === "SELL_SHORT"
          ? "Short credit"
          : equityResolved.instruction === "BUY_TO_COVER"
            ? "Cover debit"
            : "Entry debit"
      : isCredit
        ? "Entry credit"
        : "Entry debit";

  const effectiveTifDisplay =
    effectiveAtBracketDraft?.prefs.entryDuration === "GOOD_TILL_CANCEL"
      ? "GTC"
      : effectiveAtBracketDraft?.prefs.entryDuration === "FILL_OR_KILL"
        ? "FOK"
        : timeInForce;

  if (atDocked) {
    const entryMultiplier = effectiveQuantity * 100;
    const entryDollars = isEquityDraft
      ? equityGrossDollars
      : summary?.grossNotional != null
        ? Math.abs(summary.grossNotional)
        : null;
    const legacyEntryAbs = isEquityDraft
      ? equityGrossDollars
      : summary?.grossNotional != null
        ? Math.abs(summary.grossNotional) * entryMultiplier
        : null;
    const exitAbs = bracketEconomics?.targetExitDollars ?? null;
    const dockedEstNetProfit = bracketEconomics?.estNetUnavailable
      ? null
      : bracketEconomics?.estNetProfit ?? null;
    const maxLossLabel = isEquityDraft
      ? isClosingOrder
        ? "— (closing)"
        : equityResolved?.instruction === "SELL_SHORT"
          ? "uncapped"
          : equityGrossDollars != null
            ? `$${Math.round(equityGrossDollars).toLocaleString("en-US")}`
            : "—"
      : summary?.maxLoss != null
        ? `$${Math.round(summary.maxLoss).toLocaleString("en-US")}`
        : summary?.maxLoss === null
          ? "uncapped"
          : "—";
    const mid = isEquityDraft
      ? eqMid != null
        ? fmt(eqMid)
        : null
      : summary?.spreadMid != null
        ? fmt(summary.spreadMid)
        : null;
    const limitInvalid = orderType !== "MARKET" && !(submittedLimit != null && submittedLimit > 0);
    const bracketMessage =
      bracketEconomics?.bracketConfirm.mode === "unsupported"
        ? bracketEconomics.bracketConfirm.message
        : null;
    const sendUnavailableReason =
      !hasDraft
        ? "Add a leg before sending."
        : limitInvalid
          ? "Invalid limit."
          : effectiveQuantity <= 0
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
            equityConfirm={
              isEquityDraft && equityResolved
                ? {
                    symbol: equityResolved.cleanSymbol,
                    instruction: equityResolved.instruction,
                    quantity: effectiveQuantity,
                    isClosing: equityResolved.isClosing,
                    grossDollars:
                      equityGrossDollars ??
                      roundMoney(Math.abs(reviewLimitSnapped ?? submittedLimit ?? eqMid ?? 0) * effectiveQuantity),
                  }
                : undefined
            }
            quantity={effectiveQuantity}
            timeInForce={effectiveTifDisplay}
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
      hasDraft &&
      (resolvedOrder.orderType === "MARKET" || (submittedLimit != null && submittedLimit > 0)) &&
      effectiveQuantity > 0 &&
      !bracketBlocksSend;

    return (
      <AtApprovedMobileOrderSheet
        legs={legs}
        equityLegDisplay={equityLegDisplay}
        collapsed={collapsed}
        sheetPeek={sheetPeek}
        docked={!!atDocked}
        onCollapsedChange={onCollapsedChange}
        onClearAll={handleClearAllClick}
        onRemoveLeg={onRemoveLeg}
        onFlipSides={onFlipSides}
        isCredit={isCredit}
        entryLabel={equityEntryLabel}
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
        spreadQuantity={effectiveQuantity}
        onSpreadQuantityChange={handleQuantityChange}
        quantityLabel={isEquityDraft ? "Shares" : "Spreads"}
        editableQuantity={isEquityDraft}
        limitPrice={limitPrice}
        onLimitPriceChange={(v) => {
          limitUserEditedRef.current = true;
          noteLimitReplaced();
          setLimitPrice(v);
          setPriceError("");
        }}
        limitLocked={limitLocked}
        onLimitLockedChange={(locked) => {
          // Lock freezes the working price. Unlock follows the live quote again.
          limitUserEditedRef.current = locked;
          setLimitLocked(locked);
        }}
        onNudgeLimit={nudgePrice}
        orderType={orderType}
        onOrderTypeChange={setOrderType}
        limitTickCtx={limitTickCtx}
        sendLabel={
          sendUnavailableReason
            ? "Send unavailable"
            : effectiveAtBracketDraft?.prefs.submission === "send"
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
          if (effectiveAtBracketDraft?.prefs.submission === "send") void handleSubmit();
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
          equityConfirm={
            isEquityDraft && equityResolved
              ? {
                  symbol: equityResolved.cleanSymbol,
                  instruction: equityResolved.instruction,
                  quantity: effectiveQuantity,
                  isClosing: equityResolved.isClosing,
                  grossDollars:
                    equityGrossDollars ??
                    roundMoney(Math.abs(reviewLimitSnapped ?? submittedLimit ?? eqMid ?? 0) * effectiveQuantity),
                }
              : undefined
          }
          quantity={effectiveQuantity}
          timeInForce={effectiveTifDisplay}
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
  equityConfirm,
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
  equityConfirm?: {
    symbol: string;
    instruction: SchwabEquityInstruction;
    quantity: number;
    isClosing: boolean;
    grossDollars: number;
  };
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
  const isEquity = equityConfirm != null;
  const totalContracts = isEquity ? 0 : legs.reduce((s, l) => s + l.quantity, 0) * quantity;
  const fees = isEquity ? { commission: 0, regulatoryEst: 0 } : estimateSchwabOptionFees(totalContracts);
  const gross = isEquity
    ? equityConfirm.grossDollars
    : summary?.grossNotional != null
      ? Math.abs(summary.grossNotional)
      : Math.abs(px) * quantity * 100;
  const cash = computeOrderNetCash(gross, isCredit, totalContracts, fees);
  const netCashAfterFees = feeAdjustedNetCash ?? (isCredit ? cash.net : -cash.net);
  const reviewEcon = isEquity
    ? computeOrderEconomics({
        underlyingSymbol: equityConfirm.symbol,
        isOption: false,
        limitPrice: px,
        quantity,
        isCredit,
        closesPosition: equityConfirm.isClosing,
      })
    : computeOrderEconomics({
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
  const maxLoss = isEquity
    ? equityConfirm.isClosing
      ? null
      : equityConfirm.instruction === "SELL_SHORT"
        ? null
        : gross
    : (reviewEcon?.maxRisk ?? summary?.maxLoss ?? null);
  const bpEffect = isEquity
    ? equityConfirm.isClosing
      ? null
      : -gross
    : (summary?.buyingPowerEffect ?? reviewEcon?.buyingPowerEffect ?? null);
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
            <ButtonRow label={isEquity ? "Shares" : "Template qty"} value={String(atBracketConfirm.quantity)} />
            <ButtonRow
              label="Limit price"
              value={orderTypeLabel === "Market" ? "Market" : `$${displaySubmittedLimit(limitTickCtx, px)}`}
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
            {isEquity ? (
              <ButtonRow
                label="Position effect"
                value={equityConfirm.isClosing ? "Closing position" : "Opening position"}
                valueColor={equityConfirm.isClosing ? GOLD : WHITE}
              />
            ) : null}
            <ButtonRow label="Order type" value={orderTypeLabel} />
            {isEquity ? (
              <p className="text-[13px] leading-snug" style={{ color: WHITE }}>
                {humanInstruction(equityConfirm.instruction)} · {equityConfirm.quantity} × {equityConfirm.symbol} Share{equityConfirm.quantity === 1 ? "" : "s"}
              </p>
            ) : (
              legs.map((leg, i) => (
                <p key={i} className="text-[13px] leading-snug" style={{ color: WHITE }}>
                  {formatLegLine(leg, symbol, quantity)}
                </p>
              ))
            )}
            <ButtonRow
              label={
                isEquity
                  ? equityConfirm.isClosing
                    ? isCredit
                      ? "Est. closing proceeds"
                      : "Est. cover debit"
                    : isCredit
                      ? "Est. short credit"
                      : "Est. cost"
                  : `Net ${isCredit ? "credit" : "debit"}`
              }
              value={fmtCurrency(gross)}
            />
            <ButtonRow
              label={isEquity ? "Est. commissions" : `Est. commissions (${totalContracts} × $0.65)`}
              value={fmtCurrency(fees.commission)}
            />
            {!isEquity ? (
              <ButtonRow label="Est. regulatory fees" value={fmtCurrency(fees.regulatoryEst)} />
            ) : null}
            <ButtonRow
              label={isCredit ? "Net credit (after est. fees)" : "Net debit (after est. fees)"}
              value={`${netCashAfterFees >= 0 ? "+" : "−"}${fmtCurrency(Math.abs(netCashAfterFees))}`}
              valueColor={netCashAfterFees >= 0 ? UP : DOWN}
              emphasize
            />
            <ButtonRow label="Time in force" value={timeInForce} />
            <ButtonRow
              label="Limit price"
              value={orderTypeLabel === "Market" ? "Market" : `$${displaySubmittedLimit(limitTickCtx, px)}`}
            />
            {maxLoss != null && (
              <ButtonRow label="Max loss" value={fmtCurrency(maxLoss)} valueColor={DOWN} />
            )}
            {isEquity && !equityConfirm.isClosing && equityConfirm.instruction === "SELL_SHORT" ? (
              <ButtonRow label="Max loss" value="Uncapped" valueColor={DOWN} />
            ) : null}
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
            {!isEquity && bpEffect == null && bpKind === "not_estimated" && (
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
      quoteTimeMs?: number;
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
      streamKey: l.contract.streamKey?.trim() || undefined,
      contractTs: l.contract.contractTs,
      quoteTimeMs: l.contract.quoteTimeMs,
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