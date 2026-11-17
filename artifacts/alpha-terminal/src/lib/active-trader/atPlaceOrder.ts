import type { OptionsContract } from "@/components/OptionsTab";
import type { OptionTick } from "@/lib/options-stream-store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
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
): Record<string, unknown> {
  const primaryInstruction = atPrimaryInstruction(side);
  const symbol = atOptionSchwabSymbol(contract);
  const { validationError } = planAtOrderLegs({
    template: prefs.template,
    assetType: "OPTION",
    symbol,
    primaryInstruction,
    quantity: prefs.qty,
    limitPrice,
    takeProfit: prefs.takeProfit,
    stopLoss: prefs.stopLoss,
    entryOrderType: prefs.orderType,
  });
  if (validationError) return { error: validationError };
  return buildAtSchwabOrderJson({
    template: prefs.template,
    assetType: "OPTION",
    symbol,
    primaryInstruction,
    quantity: prefs.qty,
    limitPrice,
    takeProfit: prefs.takeProfit,
    stopLoss: prefs.stopLoss,
    entryOrderType: prefs.orderType,
  });
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
      return { ok: false, message: data.message || data.error || "Order rejected" };
    }
    return { ok: true, orderId: data.orderId ?? "—" };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Network error";
    return { ok: false, message };
  }
}