import type { ActivityKind, NormalizedActivity, NormalizedLeg, NormalizedOrder } from "./types.js";

interface RawInstrument {
  assetType?: string;
  symbol?: string;
  underlyingSymbol?: string;
  putCall?: string;
  expirationDate?: string;
  description?: string;
}

interface RawTransfer {
  instrument?: RawInstrument;
  amount?: number;
  price?: number;
  cost?: number;
  positionEffect?: string;
  feeType?: string | null;
  instruction?: string;
}

export interface RawHistoryActivity {
  activityId?: string | number;
  transactionId?: string | number;
  time?: string;
  tradeDate?: string;
  type?: string;
  description?: string;
  netAmount?: number;
  orderId?: string | number;
  transferItems?: RawTransfer[];
  transactionItem?: RawTransfer | null;
}

export interface RawHistoryOrder {
  orderId?: string | number;
  status?: string;
  enteredTime?: string;
  closeTime?: string | null;
  orderLegCollection?: {
    instruction?: string;
    quantity?: number;
    instrument?: RawInstrument;
  }[];
  orderActivityCollection?: {
    executionLegs?: { price?: number; quantity?: number; time?: string; legId?: number }[];
  }[];
}

const OCC_TAIL = /^(\d{2})(\d{2})(\d{2})([PC])(\d{8})$/;

export function parseOptionSymbol(symbol: string): {
  underlying: string;
  expiration: string;
  putCall: "put" | "call";
  strike: number;
  instrumentKey: string;
} | null {
  const compact = symbol.replace(/\s+/g, "").toUpperCase();
  if (compact.length < 16) return null;
  const tail = compact.slice(-15);
  const underlying = compact.slice(0, -15);
  const match = tail.match(OCC_TAIL);
  if (!match || !underlying) return null;
  const year = 2000 + Number(match[1]);
  const expiration = `${year}-${match[2]}-${match[3]}`;
  const putCall = match[4] === "P" ? "put" : "call";
  const strike = Number(match[5]) / 1000;
  return {
    underlying,
    expiration,
    putCall,
    strike,
    instrumentKey: `${underlying}${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}`,
  };
}

function dateOnly(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function legFromInstrument(
  instrument: RawInstrument | undefined,
  amount: number,
  price: number,
  fees: number,
  effect: "open" | "close" | null,
): NormalizedLeg | null {
  if (!instrument?.symbol) return null;
  const asset = (instrument.assetType ?? "").toUpperCase();
  if (asset === "CURRENCY" || asset === "CASH") return null;
  const parsed = parseOptionSymbol(instrument.symbol);
  const explicitEquity = asset === "EQUITY" || asset === "COLLECTIVE_INVESTMENT" || asset.includes("STOCK");
  const asOption = explicitEquity ? null : asset.includes("OPTION") || asset === "" ? parsed : parsed;
  if (asOption && (asset.includes("OPTION") || asset === "" || parsed)) {
    return {
      instrumentKey: asOption.instrumentKey,
      assetClass: "option",
      underlying: instrument.underlyingSymbol?.toUpperCase() || asOption.underlying,
      putCall: instrument.putCall?.toLowerCase().startsWith("c") ? "call" : instrument.putCall?.toLowerCase().startsWith("p") ? "put" : asOption.putCall,
      strike: asOption.strike,
      expiration: dateOnly(instrument.expirationDate) ?? asOption.expiration,
      quantityDelta: amount,
      price,
      multiplier: 100,
      fees,
      effect,
    };
  }
  if (asset && asset !== "EQUITY" && asset !== "COLLECTIVE_INVESTMENT" && !asset.includes("STOCK")) {
    return null;
  }
  const symbol = instrument.symbol.toUpperCase();
  return {
    instrumentKey: symbol,
    assetClass: "equity",
    underlying: (instrument.underlyingSymbol ?? symbol).toUpperCase(),
    putCall: null,
    strike: null,
    expiration: null,
    quantityDelta: amount,
    price,
    multiplier: 1,
    fees,
    effect,
  };
}

function effectOf(raw: string | undefined, instruction: string | undefined): "open" | "close" | null {
  const value = `${raw ?? ""} ${instruction ?? ""}`.toUpperCase();
  if (value.includes("CLOSE") || value.includes("TO_CLOSE")) return "close";
  if (value.includes("OPEN") || value.includes("TO_OPEN")) return "open";
  if (value === " BUY" || value.endsWith("BUY") || value.endsWith("SELL")) {
    return null;
  }
  return null;
}

function kindOf(type: string, description: string, netAmount: number): ActivityKind {
  const text = description.toLowerCase();
  const code = type.toUpperCase();
  if (text.includes("assign")) return "assignment";
  if (text.includes("exercis")) return "exercise";
  if (text.includes("cash set")) return "cash_settlement";
  if (text.includes("expir")) return "expiration";
  if (code.includes("DIVIDEND") || (code.includes("INTEREST") && text.includes("dividend"))) return "dividend";
  if (code.includes("INTEREST") || text.includes("interest")) return "interest";
  if (code.includes("DISBURSEMENT") || code.includes("WIRE_OUT")) return "withdrawal";
  if (code.includes("RECEIPT") || code.includes("WIRE_IN")) return netAmount < 0 ? "withdrawal" : "deposit";
  if (code.includes("ELECTRONIC_FUND") || code === "JOURNAL") {
    if (!text && code === "JOURNAL") return "other";
    return netAmount < 0 ? "withdrawal" : netAmount > 0 ? "deposit" : "other";
  }
  if (code === "TRADE" || code === "RECEIVE_AND_DELIVER") return "trade";
  return "other";
}

export function normalizeActivity(raw: RawHistoryActivity, accountRef: string): NormalizedActivity | null {
  const id = String(raw.activityId ?? raw.transactionId ?? "");
  if (!id) return null;
  const occurredAt = raw.time ?? raw.tradeDate;
  if (!occurredAt) return null;
  const items = raw.transferItems && raw.transferItems.length > 0
    ? raw.transferItems
    : raw.transactionItem
      ? [raw.transactionItem]
      : [];
  let fees = 0;
  const legs: NormalizedLeg[] = [];
  for (const item of items) {
    const asset = (item.instrument?.assetType ?? "").toUpperCase();
    const feeType = item.feeType ?? "";
    if (feeType || asset === "CURRENCY") {
      const magnitude = Math.abs(item.amount ?? item.cost ?? 0);
      if (feeType) fees += magnitude;
      continue;
    }
    const amount = typeof item.amount === "number" ? item.amount : 0;
    if (!amount) continue;
    const price = typeof item.price === "number" ? item.price : 0;
    const effect = effectOf(item.positionEffect, item.instruction);
    const leg = legFromInstrument(item.instrument, amount, price, 0, effect);
    if (leg) legs.push(leg);
  }
  if (legs.length > 0 && fees > 0) {
    const share = fees / legs.length;
    for (const leg of legs) leg.fees += share;
  }
  const description = raw.description ?? "";
  const netAmount = raw.netAmount ?? 0;
  return {
    id,
    accountRef,
    occurredAt: new Date(occurredAt).toISOString(),
    kind: kindOf(raw.type ?? "", description, netAmount),
    netAmount,
    fees,
    orderRef: raw.orderId != null ? String(raw.orderId) : null,
    description,
    legs,
  };
}

function instructionEffect(instruction: string | undefined): "open" | "close" | null {
  const value = (instruction ?? "").toUpperCase();
  if (value.includes("CLOSE")) return "close";
  if (value.includes("OPEN")) return "open";
  return null;
}

function instructionSign(instruction: string | undefined): number {
  const value = (instruction ?? "").toUpperCase();
  if (value.startsWith("SELL") || value === "S") return -1;
  if (value.startsWith("BUY") || value === "B") return 1;
  return 1;
}

export function normalizeOrder(raw: RawHistoryOrder, accountRef: string): NormalizedOrder | null {
  const id = raw.orderId != null ? String(raw.orderId) : "";
  if (!id || !raw.enteredTime) return null;
  const fillPrice = new Map<number, number>();
  for (const activity of raw.orderActivityCollection ?? []) {
    for (const leg of activity.executionLegs ?? []) {
      if (leg.legId != null && typeof leg.price === "number") fillPrice.set(leg.legId, leg.price);
    }
  }
  const legs: NormalizedLeg[] = [];
  (raw.orderLegCollection ?? []).forEach((leg, index) => {
    const qty = Math.abs(leg.quantity ?? 0);
    if (!qty || !leg.instrument) return;
    const sign = instructionSign(leg.instruction);
    const effect = instructionEffect(leg.instruction);
    const built = legFromInstrument(leg.instrument, sign * qty, fillPrice.get(index + 1) ?? 0, 0, effect);
    if (built) legs.push(built);
  });
  return {
    id,
    accountRef,
    enteredAt: new Date(raw.enteredTime).toISOString(),
    closedAt: raw.closeTime ? new Date(raw.closeTime).toISOString() : null,
    status: (raw.status ?? "unknown").toLowerCase(),
    legs,
  };
}
