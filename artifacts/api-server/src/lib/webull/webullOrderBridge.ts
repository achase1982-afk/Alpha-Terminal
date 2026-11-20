import crypto from "node:crypto";
import { webullSignedFetch } from "./webullClient.js";

type SchwabLeg = {
  instruction?: string;
  quantity?: number;
  instrument?: { symbol?: string; assetType?: string; underlyingSymbol?: string };
};

type SchwabOrder = Record<string, unknown> & {
  orderType?: string;
  session?: string;
  duration?: string;
  price?: number;
  stopPrice?: number;
  orderLegCollection?: SchwabLeg[];
  childOrderStrategies?: SchwabOrder[];
  orderStrategyType?: string;
};

function clientOrderId(): string {
  return crypto.randomBytes(16).toString("hex").slice(0, 32);
}

function mapTif(duration: string | undefined): string {
  const d = (duration ?? "DAY").toUpperCase();
  if (d === "GOOD_TILL_CANCEL" || d === "GTC") return "GTC";
  return "DAY";
}

function mapOrderType(orderType: string | undefined): string {
  const t = (orderType ?? "LIMIT").toUpperCase();
  switch (t) {
    case "MARKET":
    case "MKT":
      return "MARKET";
    case "STOP":
      return "STOP_LOSS";
    case "STOP_LIMIT":
      return "STOP_LOSS_LIMIT";
    case "TRAILING_STOP":
      return "TRAILING_STOP_LOSS";
    default:
      return "LIMIT";
  }
}

function sessionFromSchwab(session: string | undefined, orderType: string): string | undefined {
  if (mapOrderType(orderType) === "MARKET") {
    return session === "NORMAL" || !session ? "CORE" : "ALL";
  }
  return undefined;
}

function instructionToSide(instr: string): { side: string; positionIntent?: string } {
  switch (instr) {
    case "BUY_TO_OPEN":
      return { side: "BUY", positionIntent: "BUY_TO_OPEN" };
    case "SELL_TO_OPEN":
      return { side: "SELL", positionIntent: "SELL_TO_OPEN" };
    case "BUY_TO_CLOSE":
      return { side: "BUY", positionIntent: "BUY_TO_CLOSE" };
    case "SELL_TO_CLOSE":
      return { side: "SELL", positionIntent: "SELL_TO_CLOSE" };
    case "SELL_SHORT":
      return { side: "SHORT" };
    case "BUY_TO_COVER":
      return { side: "BUY" };
    case "SELL":
      return { side: "SELL" };
    default:
      return { side: "BUY" };
  }
}

function baseWebullOrder(params: {
  accountId: string;
  leg: SchwabLeg;
  orderType: string;
  duration?: string;
  session?: string;
  price?: number;
  stopPrice?: number;
  comboType?: string;
  clientOrderId: string;
}): Record<string, unknown> {
  const instr = params.leg.instruction ?? "BUY";
  const { side, positionIntent } = instructionToSide(instr);
  const assetType = params.leg.instrument?.assetType ?? "EQUITY";
  const isOption = assetType === "OPTION" || assetType === "INDEX_OPTION";
  const webullType = mapOrderType(params.orderType);
  const row: Record<string, unknown> = {
    client_order_id: params.clientOrderId,
    combo_type: params.comboType ?? "NORMAL",
    entrust_type: "QTY",
    instrument_type: isOption ? "OPTION" : "EQUITY",
    market: "US",
    side,
    symbol: String(params.leg.instrument?.symbol ?? ""),
    order_type: webullType,
    time_in_force: mapTif(params.duration),
    quantity: String(params.leg.quantity ?? 1),
    option_strategy: "SINGLE",
  };
  const support = sessionFromSchwab(params.session, params.orderType);
  if (support) row.support_trading_session = support;
  if (positionIntent) row.position_intent = positionIntent;
  if (webullType === "LIMIT" || webullType === "STOP_LOSS_LIMIT") {
    if (params.price != null && params.price > 0) row.limit_price = String(params.price);
  }
  if (webullType === "STOP_LOSS" || webullType === "STOP_LOSS_LIMIT") {
    if (params.stopPrice != null && params.stopPrice > 0) row.stop_price = String(params.stopPrice);
  }
  if (isOption) {
    row.legs = [
      {
        symbol: row.symbol,
        quantity: row.quantity,
      },
    ];
  }
  return row;
}

export function schwabOrderToWebullPlaceBody(
  accountId: string,
  schwabOrder: SchwabOrder,
): Record<string, unknown> {
  const legs = schwabOrder.orderLegCollection ?? [];
  const primary = legs[0];
  if (!primary) throw new Error("Missing order legs");

  const children = schwabOrder.childOrderStrategies ?? [];
  const comboId = clientOrderId();
  const masterId = clientOrderId();
  const newOrders: Record<string, unknown>[] = [];

  if (children.length > 0 && schwabOrder.orderStrategyType === "TRIGGER") {
    newOrders.push(
      baseWebullOrder({
        accountId,
        leg: primary,
        orderType: String(schwabOrder.orderType ?? "LIMIT"),
        duration: String(schwabOrder.duration ?? "DAY"),
        session: String(schwabOrder.session ?? "NORMAL"),
        price: typeof schwabOrder.price === "number" ? schwabOrder.price : undefined,
        stopPrice: typeof schwabOrder.stopPrice === "number" ? schwabOrder.stopPrice : undefined,
        comboType: "MASTER",
        clientOrderId: masterId,
      }),
    );
    for (const child of children) {
      const childLeg = child.orderLegCollection?.[0] ?? primary;
      const childType = mapOrderType(String(child.orderType ?? "LIMIT"));
      const comboType = childType === "STOP_LOSS" || childType === "STOP_LOSS_LIMIT" ? "STOP_LOSS" : "STOP_PROFIT";
      newOrders.push(
        baseWebullOrder({
          accountId,
          leg: childLeg,
          orderType: String(child.orderType ?? "LIMIT"),
          duration: String(child.duration ?? schwabOrder.duration ?? "GTC"),
          price: typeof child.price === "number" ? child.price : undefined,
          stopPrice: typeof child.stopPrice === "number" ? child.stopPrice : undefined,
          comboType,
          clientOrderId: clientOrderId(),
        }),
      );
    }
    return {
      account_id: accountId,
      client_combo_order_id: comboId,
      new_orders: newOrders,
    };
  }

  if (legs.length > 1) {
    const instr0 = legs[0]?.instruction ?? "BUY_TO_OPEN";
    const { side } = instructionToSide(instr0);
    const limit =
      typeof schwabOrder.price === "number" && schwabOrder.price > 0
        ? String(schwabOrder.price)
        : undefined;
    return {
      account_id: accountId,
      new_orders: [
        {
          client_order_id: masterId,
          combo_type: "NORMAL",
          entrust_type: "QTY",
          instrument_type: "OPTION",
          market: "US",
          side,
          symbol: String(primary.instrument?.underlyingSymbol ?? primary.instrument?.symbol ?? ""),
          order_type: mapOrderType(String(schwabOrder.orderType ?? "LIMIT")),
          time_in_force: mapTif(String(schwabOrder.duration ?? "DAY")),
          quantity: String(primary.quantity ?? 1),
          option_strategy: "VERTICAL",
          position_intent: instructionToSide(instr0).positionIntent,
          ...(limit ? { limit_price: limit } : {}),
          legs: legs.map((leg, idx) => ({
            id: idx + 1,
            symbol: String(leg.instrument?.symbol ?? ""),
            quantity: String(leg.quantity ?? 1),
          })),
        },
      ],
    };
  }

  return {
    account_id: accountId,
    new_orders: [
      baseWebullOrder({
        accountId,
        leg: primary,
        orderType: String(schwabOrder.orderType ?? "LIMIT"),
        duration: String(schwabOrder.duration ?? "DAY"),
        session: String(schwabOrder.session ?? "NORMAL"),
        price: typeof schwabOrder.price === "number" ? schwabOrder.price : undefined,
        stopPrice: typeof schwabOrder.stopPrice === "number" ? schwabOrder.stopPrice : undefined,
        clientOrderId: masterId,
      }),
    ],
  };
}

export async function webullPlaceOrder(accountId: string, schwabOrder: SchwabOrder) {
  const body = schwabOrderToWebullPlaceBody(accountId, schwabOrder);
  return webullSignedFetch<Record<string, unknown>>({
    method: "POST",
    path: "/trading/orders/place",
    body,
    withAccessToken: true,
  });
}

export async function webullCancelOrder(accountId: string, clientOrderId: string) {
  return webullSignedFetch({
    method: "POST",
    path: "/trading/orders/cancel",
    body: { account_id: accountId, client_order_id: clientOrderId },
    withAccessToken: true,
  });
}

export async function webullReplaceOrder(
  accountId: string,
  clientOrderId: string,
  patch: Record<string, unknown>,
) {
  return webullSignedFetch({
    method: "POST",
    path: "/trading/orders/replace",
    body: { account_id: accountId, client_order_id: clientOrderId, ...patch },
    withAccessToken: true,
  });
}

export function mapWebullOrderRow(o: Record<string, unknown>) {
  const side = String(o.side ?? "");
  const symbol = String(o.symbol ?? "");
  const qty = Number(o.quantity ?? o.filled_quantity ?? 0);
  const status = String(o.status ?? o.order_status ?? "");
  return {
    orderId: String(o.client_order_id ?? o.order_id ?? ""),
    orderType: String(o.order_type ?? ""),
    session: "NORMAL",
    duration: String(o.time_in_force ?? "DAY"),
    status,
    filledQuantity: Number(o.filled_quantity ?? 0),
    remainingQuantity: Math.max(0, qty - Number(o.filled_quantity ?? 0)),
    price: o.limit_price != null ? Number(o.limit_price) : o.stop_price != null ? Number(o.stop_price) : null,
    complexStrategy: "NONE",
    enteredTime: String(o.place_time ?? o.create_time ?? new Date().toISOString()),
    closeTime: null,
    legs: [
      {
        instruction: side,
        quantity: qty,
        symbol,
        underlyingSymbol: symbol,
        assetType: String(o.instrument_type ?? "EQUITY"),
        putCall: null,
        description: symbol,
      },
    ],
    fills: [],
    tag: null,
  };
}

export async function webullFetchHistoricalOrders(
  accountId: string,
  startTime: string,
  endTime: string,
  paginationKey?: string,
) {
  const query: Record<string, string> = {
    account_id: accountId,
    start_time: startTime,
    end_time: endTime,
  };
  if (paginationKey) query.pagination_key = paginationKey;
  return webullSignedFetch<{ data?: Record<string, unknown>[]; pagination_key?: string }>({
    method: "GET",
    path: "/trading/orders/historical-orders/list",
    query,
    withAccessToken: true,
  });
}