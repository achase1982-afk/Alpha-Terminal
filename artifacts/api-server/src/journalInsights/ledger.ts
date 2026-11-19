import { formatMonthDay, zonedParts } from "./clock.js";
import { PAIR_WINDOW_MS } from "./types.js";
import type {
  ActivityKind,
  AssetClass,
  BuiltLot,
  BuiltPosition,
  NormalizedActivity,
  NormalizedLeg,
  NormalizedOrder,
  PositionStatus,
} from "./types.js";

interface WorkingLeg {
  instrumentKey: string;
  assetClass: AssetClass | "other";
  underlying: string;
  putCall: "put" | "call" | null;
  strike: number | null;
  expiration: string | null;
  side: "long" | "short";
  openedQty: number;
  remainingQty: number;
  openPrice: number;
  multiplier: number;
}

interface CloseEvent {
  at: string;
  kind: ActivityKind;
  openedEquity: boolean;
  lotSide: "long" | "short";
  orderRef: string | null;
}

interface WorkingPosition {
  id: string;
  accountRef: string;
  openedAt: string;
  closedAt: string | null;
  ticketAt: string;
  orderRef: string | null;
  underlying: string;
  legs: Map<string, WorkingLeg>;
  netPnl: number;
  grossPnl: number;
  fees: number;
  closeEvents: CloseEvent[];
  rolledFromId: string | null;
  absorbed: boolean;
}

interface Fill {
  activityId: string;
  orderRef: string | null;
  occurredAt: string;
  kind: ActivityKind;
  accountRef: string;
  instrumentKey: string;
  assetClass: AssetClass | "other";
  underlying: string;
  putCall: "put" | "call" | null;
  strike: number | null;
  expiration: string | null;
  quantityDelta: number;
  price: number;
  multiplier: number;
  fees: number;
  effect: "open" | "close" | null;
  opensEquitySibling: boolean;
}

const EPS = 1e-8;

function monthNames(): string[] {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
}

function strikeText(strike: number): string {
  return Number.isInteger(strike) ? String(strike) : String(strike);
}

function shortExpiry(expiration: string): string {
  const [, month, day] = expiration.split("-");
  return `${Number(day)} ${monthNames()[Number(month) - 1]}`;
}

export function rebuildBook(input: {
  activities: NormalizedActivity[];
  orders?: NormalizedOrder[];
  marks?: Record<string, number>;
}): { positions: BuiltPosition[]; lots: BuiltLot[] } {
  const orderTime = new Map<string, string>();
  for (const order of input.orders ?? []) orderTime.set(order.id, order.enteredAt);

  const fills = expandFills(input.activities);
  fills.sort((a, b) => {
    const time = a.occurredAt.localeCompare(b.occurredAt);
    if (time !== 0) return time;
    const rank = (fill: Fill) => (fill.effect === "close" || fill.quantityDelta === 0 ? 0 : 1);
    return rank(a) - rank(b) || a.activityId.localeCompare(b.activityId) || a.instrumentKey.localeCompare(b.instrumentKey);
  });

  const lots: BuiltLot[] = [];
  const positions = new Map<string, WorkingPosition>();
  const ticketPosition = new Map<string, string>();
  const tickets = new Map<string, Fill[]>();
  for (const fill of fills) {
    const key = ticketKey(fill);
    const group = tickets.get(key) ?? [];
    group.push(fill);
    tickets.set(key, group);
  }

  for (const fill of fills) {
    attachScaleIn(fill, tickets, positions, ticketPosition);
    const remaining = applyFill(fill, lots, positions, ticketPosition, orderTime);
    if (Math.abs(remaining) > EPS) {
      openQuantity(fill, remaining, lots, positions, ticketPosition, orderTime);
    }
  }

  mergeScaleIns(positions, lots);
  pairIronCondors(positions, lots);
  linkRolls(positions);

  const built = [...positions.values()]
    .filter((position) => !position.absorbed && position.legs.size > 0)
    .map((position) => toBuilt(position, lots, input.marks ?? {}));

  built.sort((a, b) => (b.closedAt ?? b.openedAt).localeCompare(a.closedAt ?? a.openedAt));
  return { positions: built, lots: lots.filter((lot) => built.some((position) => position.id === lot.positionId)) };
}

function expandFills(activities: NormalizedActivity[]): Fill[] {
  const fills: Fill[] = [];
  for (const activity of activities) {
    const opensEquity = activity.legs.some((leg) => leg.assetClass === "equity" && leg.quantityDelta > 0);
    const positionLegs = activity.legs.filter((leg) => leg.assetClass === "equity" || leg.assetClass === "option");
    for (const leg of positionLegs) {
      fills.push({
        activityId: activity.id,
        orderRef: activity.orderRef,
        occurredAt: activity.occurredAt,
        kind: activity.kind,
        accountRef: activity.accountRef,
        instrumentKey: leg.instrumentKey,
        assetClass: leg.assetClass,
        underlying: leg.underlying,
        putCall: leg.putCall,
        strike: leg.strike,
        expiration: leg.expiration,
        quantityDelta: leg.quantityDelta,
        price: leg.price,
        multiplier: leg.multiplier,
        fees: leg.fees,
        effect: leg.effect,
        opensEquitySibling: opensEquity && leg.assetClass === "option",
      });
    }
  }
  return fills;
}

function ticketKey(fill: Fill): string {
  return fill.orderRef ? `ord:${fill.accountRef}:${fill.orderRef}` : `act:${fill.activityId}`;
}

function ensurePosition(
  fill: Fill,
  positions: Map<string, WorkingPosition>,
  ticketPosition: Map<string, string>,
  orderTime: Map<string, string>,
): WorkingPosition {
  const key = ticketKey(fill);
  const existingId = ticketPosition.get(key);
  if (existingId) return positions.get(existingId)!;
  const id = fill.orderRef ? `pos_${fill.accountRef}_${fill.orderRef}` : `pos_${fill.accountRef}_${fill.activityId}`;
  const ticketAt = (fill.orderRef && orderTime.get(fill.orderRef)) || fill.occurredAt;
  const position: WorkingPosition = {
    id,
    accountRef: fill.accountRef,
    openedAt: fill.occurredAt,
    closedAt: null,
    ticketAt,
    orderRef: fill.orderRef,
    underlying: fill.underlying,
    legs: new Map(),
    netPnl: 0,
    grossPnl: 0,
    fees: 0,
    closeEvents: [],
    rolledFromId: null,
    absorbed: false,
  };
  positions.set(id, position);
  ticketPosition.set(key, id);
  return position;
}

function applyFill(
  fill: Fill,
  lots: BuiltLot[],
  positions: Map<string, WorkingPosition>,
  ticketPosition: Map<string, string>,
  orderTime: Map<string, string>,
): number {
  if (fill.effect === "open") return fill.quantityDelta;
  const closingSide: "long" | "short" | null =
    fill.quantityDelta < 0 ? "long" : fill.quantityDelta > 0 ? "short" : null;
  if (!closingSide) return 0;
  if (fill.effect === "close" || fill.effect == null) {
    return closeAgainst(fill, closingSide, lots, positions);
  }
  return fill.quantityDelta;
}

function closeAgainst(
  fill: Fill,
  side: "long" | "short",
  lots: BuiltLot[],
  positions: Map<string, WorkingPosition>,
): number {
  let left = Math.abs(fill.quantityDelta);
  const original = left;
  const queue = lots
    .filter((lot) => lot.instrumentKey === fill.instrumentKey && lot.accountRef === fill.accountRef && lot.side === side && lot.remainingQty > EPS)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id));
  if (queue.length === 0) {
    return side === "long" ? -left : left;
  }
  for (const lot of queue) {
    if (left <= EPS) break;
    const take = Math.min(lot.remainingQty, left);
    const gross = side === "long"
      ? (fill.price - lot.openPrice) * take * lot.multiplier
      : (lot.openPrice - fill.price) * take * lot.multiplier;
    const openFee = lot.openQty > 0 ? lot.fees * (take / lot.openQty) : 0;
    const closeFee = original > 0 ? fill.fees * (take / original) : 0;
    const fee = openFee + closeFee;
    lot.remainingQty -= take;
    lot.realizedPnl += gross - fee;
    if (lot.remainingQty <= EPS) {
      lot.remainingQty = 0;
      lot.closedAt = fill.occurredAt;
    }
    const position = positions.get(lot.positionId);
    if (position) {
      position.grossPnl += gross;
      position.fees += fee;
      position.netPnl += gross - fee;
      position.closeEvents.push({
        at: fill.occurredAt,
        kind: fill.kind,
        openedEquity: fill.opensEquitySibling,
        lotSide: side,
        orderRef: fill.orderRef,
      });
      const leg = position.legs.get(fill.instrumentKey);
      if (leg) leg.remainingQty = Math.max(0, leg.remainingQty - take);
    }
    left -= take;
  }
  if (left <= EPS) return 0;
  return side === "long" ? -left : left;
}

function openQuantity(
  fill: Fill,
  delta: number,
  lots: BuiltLot[],
  positions: Map<string, WorkingPosition>,
  ticketPosition: Map<string, string>,
  orderTime: Map<string, string>,
): void {
  if (Math.abs(delta) <= EPS) return;
  const position = ensurePosition(fill, positions, ticketPosition, orderTime);
  const side: "long" | "short" = delta > 0 ? "long" : "short";
  const qty = Math.abs(delta);
  const lot: BuiltLot = {
    id: `lot_${fill.activityId}_${fill.instrumentKey}_${lots.length}`,
    accountRef: fill.accountRef,
    positionId: position.id,
    instrumentKey: fill.instrumentKey,
    side,
    openedAt: fill.occurredAt,
    closedAt: null,
    openQty: qty,
    remainingQty: qty,
    openPrice: fill.price,
    multiplier: fill.multiplier,
    fees: fill.fees * (qty / Math.max(Math.abs(fill.quantityDelta), qty)),
    realizedPnl: 0,
  };
  lots.push(lot);
  const prior = position.legs.get(fill.instrumentKey);
  if (prior && prior.side === side) {
    const nextQty = prior.openedQty + qty;
    prior.openPrice = (prior.openPrice * prior.openedQty + fill.price * qty) / nextQty;
    prior.openedQty = nextQty;
    prior.remainingQty += qty;
  } else {
    position.legs.set(fill.instrumentKey, {
      instrumentKey: fill.instrumentKey,
      assetClass: fill.assetClass,
      underlying: fill.underlying,
      putCall: fill.putCall,
      strike: fill.strike,
      expiration: fill.expiration,
      side,
      openedQty: qty,
      remainingQty: qty,
      openPrice: fill.price,
      multiplier: fill.multiplier,
    });
  }
  if (fill.occurredAt < position.openedAt) position.openedAt = fill.occurredAt;
  if (!position.underlying) position.underlying = fill.underlying;
}

function attachScaleIn(
  fill: Fill,
  tickets: Map<string, Fill[]>,
  positions: Map<string, WorkingPosition>,
  ticketPosition: Map<string, string>,
): void {
  const key = ticketKey(fill);
  if (ticketPosition.has(key)) return;
  const group = tickets.get(key) ?? [];
  if (group.length === 0 || group.some((item) => item.effect === "close")) return;
  const incoming = group
    .map((item) => `${item.instrumentKey}:${item.quantityDelta >= 0 ? "long" : "short"}`)
    .sort()
    .join("|");
  const host = [...positions.values()].find((position) =>
    !position.absorbed &&
    position.accountRef === fill.accountRef &&
    signature(position) === incoming &&
    [...position.legs.values()].some((leg) => leg.remainingQty > EPS),
  );
  if (host) ticketPosition.set(key, host.id);
}

function signature(position: WorkingPosition): string {
  return [...position.legs.values()]
    .map((leg) => `${leg.instrumentKey}:${leg.side}`)
    .sort()
    .join("|");
}

function mergeScaleIns(positions: Map<string, WorkingPosition>, lots: BuiltLot[]): void {
  const ordered = [...positions.values()].filter((position) => !position.absorbed).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  for (const position of ordered) {
    if (position.absorbed || position.closeEvents.length > 0) continue;
    const sig = signature(position);
    const host = ordered.find((candidate) =>
      candidate !== position &&
      !candidate.absorbed &&
      candidate.accountRef === position.accountRef &&
      signature(candidate) === sig &&
      candidate.openedAt <= position.openedAt &&
      [...candidate.legs.values()].some((leg) => leg.remainingQty > EPS),
    );
    if (!host) continue;
    absorb(host, position, lots);
  }
}

interface VerticalShape {
  id: string;
  accountRef: string;
  right: "put" | "call";
  credit: boolean;
  underlying: string;
  expiration: string;
  qty: number;
  ticketAt: number;
}

function asVertical(position: WorkingPosition): VerticalShape | null {
  if (position.absorbed || position.legs.size !== 2) return null;
  const legs = [...position.legs.values()];
  if (legs.some((leg) => leg.assetClass !== "option" || !leg.putCall || leg.strike == null || !leg.expiration)) return null;
  const [a, b] = legs;
  if (!a || !b) return null;
  if (a.putCall !== b.putCall || a.expiration !== b.expiration || a.underlying !== b.underlying || a.side === b.side) return null;
  if (Math.abs(a.openedQty - b.openedQty) > EPS) return null;
  const short = a.side === "short" ? a : b;
  const long = a.side === "long" ? a : b;
  if (short.strike == null || long.strike == null || short.strike === long.strike) return null;
  const credit = short.putCall === "put" ? short.strike > long.strike : short.strike < long.strike;
  return {
    id: position.id,
    accountRef: position.accountRef,
    right: short.putCall!,
    credit,
    underlying: short.underlying,
    expiration: short.expiration!,
    qty: short.openedQty,
    ticketAt: Date.parse(position.ticketAt),
  };
}

function pairIronCondors(positions: Map<string, WorkingPosition>, lots: BuiltLot[]): void {
  const shapes = [...positions.values()].map(asVertical).filter((shape): shape is VerticalShape => shape != null);
  const used = new Set<string>();
  const puts = shapes.filter((shape) => shape.right === "put").sort((a, b) => a.ticketAt - b.ticketAt);
  const calls = shapes.filter((shape) => shape.right === "call").sort((a, b) => a.ticketAt - b.ticketAt);
  for (const put of puts) {
    if (used.has(put.id)) continue;
    let best: VerticalShape | null = null;
    let bestGap = Infinity;
    for (const call of calls) {
      if (used.has(call.id) || call.credit !== put.credit) continue;
      if (call.accountRef !== put.accountRef) continue;
      if (call.underlying !== put.underlying || call.expiration !== put.expiration) continue;
      if (Math.abs(call.qty - put.qty) > EPS) continue;
      const gap = Math.abs(call.ticketAt - put.ticketAt);
      if (gap <= PAIR_WINDOW_MS && gap < bestGap) {
        best = call;
        bestGap = gap;
      }
    }
    if (!best) continue;
    used.add(put.id);
    used.add(best.id);
    const keep = positions.get(put.ticketAt <= best.ticketAt ? put.id : best.id)!;
    const drop = positions.get(put.ticketAt <= best.ticketAt ? best.id : put.id)!;
    absorb(keep, drop, lots);
  }
}

function absorb(keep: WorkingPosition, drop: WorkingPosition, lots: BuiltLot[]): void {
  if (keep.id === drop.id || drop.absorbed) return;
  if (keep.accountRef !== drop.accountRef) return;
  drop.absorbed = true;
  keep.netPnl += drop.netPnl;
  keep.grossPnl += drop.grossPnl;
  keep.fees += drop.fees;
  keep.closeEvents.push(...drop.closeEvents);
  if (drop.rolledFromId && !keep.rolledFromId) keep.rolledFromId = drop.rolledFromId;
  if (drop.openedAt < keep.openedAt) keep.openedAt = drop.openedAt;
  if (drop.ticketAt < keep.ticketAt) keep.ticketAt = drop.ticketAt;
  for (const [key, leg] of drop.legs) {
    const prior = keep.legs.get(key);
    if (prior && prior.side === leg.side) {
      const next = prior.openedQty + leg.openedQty;
      prior.openPrice = next > 0 ? (prior.openPrice * prior.openedQty + leg.openPrice * leg.openedQty) / next : prior.openPrice;
      prior.openedQty = next;
      prior.remainingQty += leg.remainingQty;
    } else {
      keep.legs.set(key, { ...leg });
    }
  }
  for (const lot of lots) {
    if (lot.positionId === drop.id) lot.positionId = keep.id;
  }
}

function linkRolls(positions: Map<string, WorkingPosition>): void {
  const live = [...positions.values()].filter((position) => !position.absorbed);
  for (const opened of live) {
    if (opened.closeEvents.length > 0 || !opened.orderRef) continue;
    const closed = live.find((candidate) =>
      candidate.id !== opened.id &&
      candidate.accountRef === opened.accountRef &&
      candidate.closeEvents.some((event) => event.orderRef === opened.orderRef),
    );
    if (closed) opened.rolledFromId = closed.id;
  }
}

function statusOf(position: WorkingPosition, flat: boolean, partial: boolean): PositionStatus {
  if (!flat && partial) return "partial";
  if (!flat) return "open";
  const last = [...position.closeEvents].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  if (!last) return "closed";
  if (last.kind === "expiration") return "expired";
  if (last.kind === "cash_settlement") return "settled";
  if (last.kind === "assignment") return "assigned";
  if (last.kind === "exercise") return "exercised";
  if (last.openedEquity && last.lotSide === "short") return "assigned";
  if (last.openedEquity && last.lotSide === "long") return "exercised";
  return "closed";
}

function classify(position: WorkingPosition): { strategy: string; assetClass: AssetClass; label: string } {
  const legs = [...position.legs.values()];
  const options = legs.filter((leg) => leg.assetClass === "option");
  const equities = legs.filter((leg) => leg.assetClass === "equity");
  const underlying = position.underlying || legs[0]?.underlying || "";
  if (options.length === 0) {
    return { strategy: "Equities", assetClass: "equity", label: underlying };
  }
  const verticals = splitVerticals(options);
  if (options.length === 4 && verticals.put && verticals.call) {
    const credit = verticals.put.credit && verticals.call.credit;
    const debit = !verticals.put.credit && !verticals.call.credit;
    const bodyPut = verticals.put.credit ? verticals.put.short : verticals.put.long;
    const bodyCall = verticals.call.credit ? verticals.call.short : verticals.call.long;
    const family = bodyPut === bodyCall ? "Iron butterflies" : "Iron condors";
    const strategy = credit ? `${family} (credit)` : debit ? `${family} (debit)` : "Other";
    const expiry = shortExpiry(verticals.put.expiration);
    const label = `${underlying} ${expiry} ${strikeText(verticals.put.short)}/${strikeText(verticals.put.long)}P · ${strikeText(verticals.call.short)}/${strikeText(verticals.call.long)}C`;
    return { strategy, assetClass: "option", label };
  }
  if (options.length === 2 && verticals.put && !verticals.call) {
    return verticalLabel(underlying, verticals.put, "put");
  }
  if (options.length === 2 && verticals.call && !verticals.put) {
    return verticalLabel(underlying, verticals.call, "call");
  }
  if (options.length === 1 && equities.length === 1 && options[0]?.putCall === "call" && options[0].side === "short" && equities[0]?.side === "long") {
    return { strategy: "Covered calls", assetClass: "option", label: `${underlying} covered call` };
  }
  if (options.length === 1 && equities.length === 0) {
    const leg = options[0]!;
    const expiry = leg.expiration ? shortExpiry(leg.expiration) : formatMonthDay(zonedParts(position.openedAt));
    const right = leg.putCall === "call" ? "C" : "P";
    const strike = leg.strike != null ? strikeText(leg.strike) : "";
    return { strategy: "Single options", assetClass: "option", label: `${underlying} ${expiry} ${strike}${right}`.replace("  ", " ") };
  }
  return { strategy: "Other", assetClass: "option", label: underlying || "Option" };
}

interface VerticalSide {
  credit: boolean;
  short: number;
  long: number;
  expiration: string;
}

function splitVerticals(options: WorkingLeg[]): { put: VerticalSide | null; call: VerticalSide | null } {
  const build = (right: "put" | "call"): VerticalSide | null => {
    const legs = options.filter((leg) => leg.putCall === right);
    if (legs.length !== 2) return null;
    const [a, b] = legs;
    if (!a || !b || a.side === b.side || a.expiration !== b.expiration || a.strike == null || b.strike == null) return null;
    const short = a.side === "short" ? a : b;
    const long = a.side === "long" ? a : b;
    if (short.strike == null || long.strike == null || !short.expiration) return null;
    const credit = right === "put" ? short.strike > long.strike : short.strike < long.strike;
    return { credit, short: short.strike, long: long.strike, expiration: short.expiration };
  };
  return { put: build("put"), call: build("call") };
}

function verticalLabel(underlying: string, side: VerticalSide, right: "put" | "call"): { strategy: string; assetClass: AssetClass; label: string } {
  const strategy = side.credit
    ? right === "put" ? "Credit spreads (puts)" : "Credit spreads (calls)"
    : "Debit spreads";
  const [hi, lo] = side.short >= side.long ? [side.short, side.long] : [side.long, side.short];
  const shown = right === "put" ? `${strikeText(hi)}/${strikeText(lo)}P` : `${strikeText(Math.min(side.short, side.long))}/${strikeText(Math.max(side.short, side.long))}C`;
  return { strategy, assetClass: "option", label: `${underlying} ${shortExpiry(side.expiration)} ${shown}` };
}

function toBuilt(position: WorkingPosition, lots: BuiltLot[], marks: Record<string, number>): BuiltPosition {
  const mine = lots.filter((lot) => lot.positionId === position.id);
  const anyRemaining = mine.some((lot) => lot.remainingQty > EPS);
  const anyClosed = mine.some((lot) => lot.openQty - lot.remainingQty > EPS);
  const status = statusOf(position, !anyRemaining, anyClosed);
  const closedAt = anyRemaining ? null : ([...position.closeEvents].sort((a, b) => a.at.localeCompare(b.at)).at(-1)?.at ?? null);
  const classified = classify(position);
  const quantity = structureQty(position);
  let unrealized: number | null = 0;
  if (!anyRemaining) unrealized = null;
  else {
    for (const lot of mine) {
      if (lot.remainingQty <= EPS) continue;
      const mid = marks[lot.instrumentKey];
      if (mid == null || Number.isNaN(mid)) {
        unrealized = null;
        break;
      }
      const gross = lot.side === "long"
        ? (mid - lot.openPrice) * lot.remainingQty * lot.multiplier
        : (lot.openPrice - mid) * lot.remainingQty * lot.multiplier;
      const feeLeft = lot.openQty > 0 ? lot.fees * (lot.remainingQty / lot.openQty) : 0;
      unrealized += gross - feeLeft;
    }
  }
  const legs: NormalizedLeg[] = [...position.legs.values()].map((leg) => ({
    instrumentKey: leg.instrumentKey,
    assetClass: leg.assetClass,
    underlying: leg.underlying,
    putCall: leg.putCall,
    strike: leg.strike,
    expiration: leg.expiration,
    quantityDelta: leg.side === "long" ? leg.openedQty : -leg.openedQty,
    price: leg.openPrice,
    multiplier: leg.multiplier,
    fees: 0,
    effect: "open",
  }));
  return {
    id: position.id,
    accountRef: position.accountRef,
    strategy: classified.strategy,
    assetClass: classified.assetClass,
    underlying: classified.label.startsWith(position.underlying) ? position.underlying : (position.underlying || classified.label),
    label: classified.label,
    status,
    openedAt: position.openedAt,
    closedAt,
    ticketAt: position.ticketAt,
    quantity,
    remainingQty: anyRemaining ? remainingQty(position) : 0,
    netPnl: roundMoney(position.netPnl),
    grossPnl: roundMoney(position.grossPnl),
    fees: roundMoney(position.fees),
    unrealizedPnl: unrealized == null ? null : roundMoney(unrealized),
    rolledFromId: position.rolledFromId,
    legs,
  };
}

function structureQty(position: WorkingPosition): number {
  const legs = [...position.legs.values()];
  if (legs.length === 0) return 0;
  return Math.max(...legs.map((leg) => leg.openedQty));
}

function remainingQty(position: WorkingPosition): number {
  const legs = [...position.legs.values()];
  if (legs.length === 0) return 0;
  return Math.max(...legs.map((leg) => leg.remainingQty));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function flatStatuses(): PositionStatus[] {
  return ["closed", "expired", "assigned", "exercised", "settled"];
}

export function isFlat(status: PositionStatus): boolean {
  return status !== "open" && status !== "partial";
}
