import type { SchwabInstruction } from "@/lib/active-trader/atSchwabOrderBuilder";
import {
  computeOrderNetCash,
  formatCostBreakdownLine,
  formatMoneySigned,
  grossOptionPremiumDollars,
  isCreditInstruction,
  roundMoney,
  type OrderNetCashFlow,
} from "./schwabOrderFees";

export function positionEffectTag(instruction: SchwabInstruction | string): "[TO OPEN]" | "[TO CLOSE]" {
  if (instruction.includes("CLOSE") || instruction === "SELL" || instruction === "BUY_TO_COVER") {
    return "[TO CLOSE]";
  }
  return "[TO OPEN]";
}

export interface TriggerConfirmOrderInput {
  orderNumber: number;
  isTriggerParent?: boolean;
  triggeredByOrder?: number;
  instruction: SchwabInstruction | string;
  quantity: number;
  /** Human contract line, e.g. `SPX 7545 CALL` or `VERTICAL NVDA 157.5/155 PUT`. */
  contractLine: string;
  limitPrice: number;
  orderType: "LIMIT" | "STOP" | "MARKET";
  contractCountForFees: number;
  /** When set (golden tests), skips estimator. */
  feeOverride?: { commission: number; regulatoryEst: number };
}

export interface TriggerConfirmOrderBlock {
  orderNumber: number;
  header: string;
  instructionLine: string;
  costLine: string;
  cashFlow: OrderNetCashFlow;
  positionEffect: string;
}

export interface TriggerConfirmSummaryInput {
  orders: TriggerConfirmOrderInput[];
  /** OTO: single exit leg fills with entry. */
  combinedIfAllFill?: {
    netCredit?: number;
    netDebit?: number;
    feeOverride?: { commission: number; regulatoryEst: number };
  };
  /** OCO bracket: mutually exclusive exits. */
  ocoOutcomes?: Array<{
    label: string;
    exitOrderNumber: number;
  }>;
  breakevenLines?: string[];
}

export interface TriggerConfirmSummary {
  orders: TriggerConfirmOrderBlock[];
  netIfAllFillLine?: string;
  ocoOutcomeLines?: Array<{ label: string; line: string }>;
  breakevenLines: string[];
}

function legSideLabel(instruction: string): "BUY" | "SELL" {
  return instruction.startsWith("BUY") ? "BUY" : "SELL";
}

function qtySigned(instruction: string, qty: number): string {
  const sign = instruction.startsWith("BUY") ? "+" : "−";
  return `${sign}${qty}`;
}

function orderTypeSuffix(t: TriggerConfirmOrderInput["orderType"]): string {
  if (t === "STOP") return "STP";
  if (t === "MARKET") return "MKT";
  return "LMT";
}

function buildInstructionLine(o: TriggerConfirmOrderInput): string {
  const side = legSideLabel(o.instruction);
  const trig = o.triggeredByOrder != null ? ` · TRG BY #${o.triggeredByOrder}` : "";
  const px = o.orderType === "STOP" ? `STP ${o.limitPrice.toFixed(2)}` : `@${o.limitPrice.toFixed(2)} ${orderTypeSuffix(o.orderType)}`;
  return `${side} ${qtySigned(o.instruction, o.quantity)} ${o.contractLine} ${px}${trig} ${positionEffectTag(o.instruction)}`;
}

export function buildTriggerOrderConfirmSummary(input: TriggerConfirmSummaryInput): TriggerConfirmSummary {
  const blocks: TriggerConfirmOrderBlock[] = input.orders.map((o) => {
    const gross = grossOptionPremiumDollars(o.limitPrice, o.quantity);
    const isCredit = isCreditInstruction(o.instruction);
    const cashFlow = computeOrderNetCash(gross, isCredit, o.contractCountForFees, o.feeOverride);
    const header = o.isTriggerParent
      ? `Order #${o.orderNumber} (TRIGGER)`
      : `Order #${o.orderNumber}`;
    const costLine = formatCostBreakdownLine(cashFlow);
    return {
      orderNumber: o.orderNumber,
      header,
      instructionLine: buildInstructionLine(o),
      costLine,
      cashFlow,
      positionEffect: positionEffectTag(o.instruction),
    };
  });

  let netIfAllFillLine: string | undefined;
  if (input.combinedIfAllFill && blocks.length >= 2) {
    const entry = blocks[0].cashFlow;
    const exit = blocks[1].cashFlow;
    const entrySigned = entry.isCredit ? entry.net : -entry.net;
    const exitSigned = exit.isCredit ? exit.net : -exit.net;
    const combined = roundMoney(entrySigned + exitSigned);
    const feeOverride = input.combinedIfAllFill.feeOverride;
    if (feeOverride && input.combinedIfAllFill.netCredit != null) {
      netIfAllFillLine = `Net if all fill: ${formatMoneySigned(input.combinedIfAllFill.netCredit, true)} (est. comm $${feeOverride.commission.toFixed(2)} · est. reg $${feeOverride.regulatoryEst.toFixed(2)})`;
    } else {
      const isCredit = combined >= 0;
      netIfAllFillLine = `Net if all fill: ${formatMoneySigned(Math.abs(combined), isCredit)} (round-trip est. after both orders)`;
    }
  }

  const ocoOutcomeLines: Array<{ label: string; line: string }> = [];
  if (input.ocoOutcomes && blocks.length >= 2) {
    const entry = blocks[0].cashFlow;
    for (const oc of input.ocoOutcomes) {
      const exit = blocks.find((b) => b.orderNumber === oc.exitOrderNumber);
      if (!exit) continue;
      const entrySigned = entry.isCredit ? entry.net : -entry.net;
      const exitSigned = exit.cashFlow.isCredit ? exit.cashFlow.net : -exit.cashFlow.net;
      const pl = roundMoney(entrySigned + exitSigned);
      const isCredit = pl >= 0;
      ocoOutcomeLines.push({
        label: oc.label,
        line: `${oc.label}: ${formatMoneySigned(Math.abs(pl), isCredit)} realized est. (entry + exit, fees est.)`,
      });
    }
  }

  return {
    orders: blocks,
    netIfAllFillLine,
    ocoOutcomeLines: ocoOutcomeLines.length ? ocoOutcomeLines : undefined,
    breakevenLines: input.breakevenLines ?? [],
  };
}

export function parseOccOptionContractLine(symbol: string, underlyingFallback?: string): string {
  const s = symbol.trim();
  if (s.length >= 21) {
    const cp = s.charAt(12) === "P" ? "PUT" : "CALL";
    const strike = parseInt(s.slice(13), 10) / 1000;
    const root = s.slice(0, 6).trim() || underlyingFallback || "OPT";
    const strikeFmt = strike % 1 === 0 ? String(strike) : strike.toFixed(2);
    return `${root} ${strikeFmt} ${cp}`;
  }
  return underlyingFallback ?? symbol;
}