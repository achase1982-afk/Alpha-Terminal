import type { OptionsContract } from "@/components/OptionsTab";
import type { OptionTick } from "@/lib/options-stream-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { enqueueBrowserTelemetry } from "@/lib/browserTelemetry";
import type { ActiveTraderTemplatePrefs } from "./activeTraderPrefs";
import {
  buildAtSchwabOrderJson,
  planAtOrderLegs,
  type SchwabInstruction,
} from "./atSchwabOrderBuilder";

export function atOptionSchwabSymbol(contract: OptionsContract): string {
  const stream = contract.streamKey;
  if (typeof stream === "string" && stream.length > 0) return stream;
  const schwab = contract.schwabSymbol;
  return typeof schwab === "string" ? schwab : "";
}

export function atPrimaryInstruction(side: "BUY" | "SELL"): SchwabInstruction {
  return side === "BUY" ? "BUY_TO_OPEN" : "SELL_TO_OPEN";
}

export function resolveAtEntryPrice(
  tick: OptionTick | null | undefined,
  prefs: ActiveTraderTemplatePrefs,
  side: "BUY" | "SELL",
): number | null {
  if (!tick) return null;
  const mid =
    tick.bid != null && tick.ask != null ? (tick.bid + tick.ask) / 2 : (tick.mark ?? tick.last ?? null);
  if (mid == null || mid <= 0) return null;
  if (prefs.orderType === "MKT") return mid;
  switch (prefs.limitAnchor) {
    case "Mid":
      return mid;
    case "Bid":
      return tick.bid ?? mid;
    case "Ask":
      return tick.ask ?? mid;
    default:
      return mid;
  }
}

export function buildAtOrderPayload(
  contract: OptionsContract,
  side: "BUY" | "SELL",
  prefs: ActiveTraderTemplatePrefs,
  limitPrice: number,
  underlyingSymbol: string,
  entryDuration = "DAY",
): Record<string, unknown> {
  const primaryInstruction = atPrimaryInstruction(side);
  const symbol = atOptionSchwabSymbol(contract);
  const shared = {
    template: prefs.template,
    assetType: "OPTION" as const,
    symbol,
    underlyingSymbol,
    primaryInstruction,
    quantity: prefs.qty,
    limitPrice,
    takeProfit: prefs.takeProfit,
    stopLoss: prefs.stopLoss,
    entryOrderType: prefs.orderType,
    entryDuration: prefs.entryDuration ?? entryDuration,
    exitDuration: prefs.exitDuration,
    stopLossOrderType: prefs.stopLossOrderType,
    stopLimitOffset: prefs.stopLimitOffset,
    session: prefs.session,
    advancedRoute: prefs.advancedRoute,
    schwabEntryType: prefs.schwabEntryType,
    routing: prefs.routing,
    trailOffset: prefs.trailOffset,
    trailLinkType: prefs.trailLinkType,
  };
  const { validationError } = planAtOrderLegs(shared);
  if (validationError) return { error: validationError };
  return buildAtSchwabOrderJson(shared);
}

export type AtPlaceOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; message: string };

/** Shared Schwab place-order path (same route as OrderTicket). */
export async function submitAtSchwabOrder(params: {
  accountHash: string;
  order: Record<string, unknown>;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  limitPrice: number | null;
  dryRun?: boolean;
}): Promise<AtPlaceOrderResult> {
  if (params.dryRun) return { ok: true, orderId: "dry-run" };
  if ("error" in params.order && params.order.error) {
    return { ok: false, message: String(params.order.error) };
  }
  const journalContext: Record<string, unknown> = {
    symbol: params.symbol,
    strategyType: "ACTIVE_TRADER",
    direction: params.side,
    entryPrice: params.limitPrice,
    quantity: params.quantity,
    source: "active_trader_auto_send",
  };
  try {
    const res = await fetchWithAuth("/api/portfolio/place-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountHash: params.accountHash, order: params.order, journalContext }),
    });
    const data = (await res.json()) as { error?: string; message?: string; orderId?: string };
    if (!res.ok || data.error) {
      const message = data.message || data.error || "Order rejected";
      enqueueBrowserTelemetry({
        level: "ERROR",
        message: "active_trader_place_order_failed",
        details: { status: res.status, body: data, symbol: params.symbol },
      });
      return { ok: false, message };
    }
    return { ok: true, orderId: data.orderId ?? "—" };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Network error";
    enqueueBrowserTelemetry({
      level: "ERROR",
      message: "active_trader_place_order_network",
      details: { symbol: params.symbol, error: message },
    });
    return { ok: false, message };
  }
}