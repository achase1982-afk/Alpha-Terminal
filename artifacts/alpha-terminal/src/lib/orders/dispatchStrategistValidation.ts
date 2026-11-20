import { fetchWithAuth, humanizeFailedApiBody } from "@/lib/fetchWithAuth";
import { startStrategistPolling } from "@/lib/strategistPoller";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";
import { useTerminalStore, type StrategistValidationMeta } from "@/lib/store";
import type { StrategyLeg } from "@/components/StrategyBuilder";

export interface DispatchStrategistTicketInput {
  symbol: string;
  legs: StrategyLeg[];
  isEquityDraft: boolean;
  equitySide?: "BUY" | "SELL";
  equityInstruction?: string;
  isClosingOrder: boolean;
  orderType: string;
  duration: string;
  quantity: number;
  limitPrice: number | null;
  isCredit: boolean;
  underlyingPrice: number | null;
  underlyingChangePct?: number | null;
  estMaxRisk: number | null;
  estMaxProfit: number | null;
  breakeven: number | null;
  thesis?: string;
  rollingShort?: boolean;
}

export async function dispatchStrategistValidation(
  input: DispatchStrategistTicketInput,
): Promise<{ ok: true; ticker: string } | { ok: false; error: string }> {
  const upperTicker = input.symbol.replace(/^\$/, "").trim().toUpperCase();
  if (!upperTicker) {
    return { ok: false, error: "Select a symbol before sending to Strategist." };
  }

  const jobId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `val-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const mode: "opening" | "closing" = input.isClosingOrder ? "closing" : "opening";
  const isOption = !input.isEquityDraft && input.legs.length > 0;
  const isMultiLeg = isOption && input.legs.length > 1;

  const accountState = useSchwabAccountStore.getState();
  const tradingHash = accountState.tradingAccountHash();
  const activeAccount =
    accountState.accounts.find((a) => a.hashValue != null && a.hashValue === tradingHash) ??
    accountState.accounts[0];
  const equityPos = (activeAccount?.positions ?? []).find((p) => {
    const at = (p.assetType ?? "").toUpperCase();
    const sym = (p.symbol ?? "").trim().toUpperCase();
    return (at === "EQUITY" || sym === upperTicker) && sym === upperTicker;
  });

  let underlyingShares: NonNullable<StrategistValidationMeta["ticket"]["underlyingShares"]> | null = null;
  if (equityPos) {
    const longQ = Number(equityPos.longQuantity ?? 0);
    const shortQ = Number(equityPos.shortQuantity ?? 0);
    if (longQ > 0) {
      underlyingShares = {
        side: "long",
        quantity: longQ,
        averagePrice: Number.isFinite(equityPos.averagePrice) ? Number(equityPos.averagePrice) : null,
        marketValue: Number.isFinite(equityPos.marketValue) ? Number(equityPos.marketValue) : null,
      };
    } else if (shortQ > 0) {
      underlyingShares = {
        side: "short",
        quantity: shortQ,
        averagePrice: Number.isFinite(equityPos.averagePrice) ? Number(equityPos.averagePrice) : null,
        marketValue: Number.isFinite(equityPos.marketValue) ? Number(equityPos.marketValue) : null,
      };
    }
  }

  const mappedLegs: StrategistValidationMeta["ticket"]["legs"] = isOption
    ? input.legs.map((l) => ({
        instruction: l.direction,
        strike: l.strike,
        optionType: l.optionType,
        expiration: l.expiration.split(":")[0].trim(),
        quantity: l.quantity,
        bid: l.bid ?? null,
        ask: l.ask ?? null,
        delta: l.delta ?? null,
      }))
    : undefined;

  const side: "BUY" | "SELL" = input.isEquityDraft
    ? input.equitySide ?? (input.equityInstruction?.startsWith("SELL") ? "SELL" : "BUY")
    : input.isCredit
      ? "SELL"
      : "BUY";

  const firstLeg = input.legs[0];
  const ticket: StrategistValidationMeta["ticket"] = {
    ticker: upperTicker,
    isOption,
    isMultiLeg,
    mode,
    side,
    orderType: input.orderType,
    duration: input.duration,
    quantity: input.quantity,
    limitPrice: input.limitPrice,
    legs: mappedLegs,
    netPrice: isMultiLeg ? input.limitPrice : null,
    isCredit: isMultiLeg ? input.isCredit : null,
    underlyingPrice: input.underlyingPrice,
    underlyingChangePct: input.underlyingChangePct ?? null,
    estMaxRisk: input.estMaxRisk,
    estMaxProfit: input.estMaxProfit,
    breakeven: input.breakeven,
    underlyingShares,
    stockLeg: input.isEquityDraft
      ? {
          instruction: side,
          quantity: input.quantity,
          limitPrice: input.orderType === "LIMIT" ? input.limitPrice : null,
        }
      : null,
    optionSymbol: !isMultiLeg && isOption ? firstLeg?.schwabSymbol : undefined,
    optionInstruction: !isMultiLeg && isOption ? firstLeg?.direction : undefined,
  };

  const validationMeta: StrategistValidationMeta = {
    ticker: upperTicker,
    mode,
    ticket,
    thesis: input.thesis?.trim() || undefined,
    rollingShort: Boolean(input.rollingShort),
  };

  useTerminalStore.getState().startStrategistJob(jobId, upperTicker, {
    kind: "validation",
    validationMeta,
  });

  try {
    const res = await fetchWithAuth("/api/strategist/validate-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        ticket,
        thesis: validationMeta.thesis,
        rollingShort: validationMeta.rollingShort,
      }),
      keepalive: true,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "Failed to start validation");
      const friendly = humanizeFailedApiBody(res.status, errText);
      useTerminalStore.getState().errorStrategistJob(jobId, friendly);
      return { ok: false, error: `Strategist dispatch failed: ${friendly.slice(0, 200)}` };
    }
    startStrategistPolling(jobId);
    return { ok: true, ticker: upperTicker };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    useTerminalStore.getState().errorStrategistJob(jobId, msg);
    return { ok: false, error: `Strategist dispatch failed: ${msg.slice(0, 200)}` };
  }
}
