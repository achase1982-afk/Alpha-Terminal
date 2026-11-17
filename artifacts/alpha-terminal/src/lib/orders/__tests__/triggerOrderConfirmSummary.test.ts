import { describe, expect, it } from "vitest";
import { buildTriggerOrderConfirmSummary } from "../triggerOrderConfirmSummary";
import { computeOrderNetCash } from "../schwabOrderFees";

describe("NVDA trigger example (Anthony)", () => {
  it("reproduces Schwab cost lines with TO CLOSE on child leg", () => {
    const summary = buildTriggerOrderConfirmSummary({
      orders: [
        {
          orderNumber: 1,
          isTriggerParent: true,
          instruction: "SELL_TO_OPEN",
          quantity: 1,
          contractLine: "VERTICAL NVDA 157.5/155 PUT",
          limitPrice: 1.47,
          orderType: "LIMIT",
          contractCountForFees: 1,
          feeOverride: { commission: 1.0, regulatoryEst: 0.04 },
        },
        {
          orderNumber: 2,
          triggeredByOrder: 1,
          instruction: "BUY_TO_CLOSE",
          quantity: 1,
          contractLine: "NVDA 155 PUT",
          limitPrice: 0.47,
          orderType: "LIMIT",
          contractCountForFees: 1,
          feeOverride: { commission: 1.0, regulatoryEst: 0.04 },
        },
      ],
      combinedIfAllFill: {
        netCredit: 97.92,
        feeOverride: { commission: 2.0, regulatoryEst: 0.08 },
      },
    });

    const o1 = summary.orders[0];
    const o2 = summary.orders[1];
    expect(o1.cashFlow.net).toBe(145.96);
    expect(o1.cashFlow.netIsCredit).toBe(true);
    expect(o2.instructionLine).toContain("[TO CLOSE]");
    expect(o2.instructionLine).not.toContain("[TO OPEN]");
    expect(o2.cashFlow.net).toBe(48.04);
    expect(o2.instructionLine).toContain("TRG BY #1");
    expect(summary.netIfAllFillLine).toContain("97.92");
  });

  it("fee config uses $0.65 per contract + est. regulatory", () => {
    const flow = computeOrderNetCash(147, true, 1);
    expect(flow.commission).toBe(0.65);
    expect(flow.regulatoryEst).toBe(0.02);
    expect(flow.net).toBe(146.33);
  });
});

describe("Active Trader single-leg bracket", () => {
  it("marks child STC with TO CLOSE", () => {
    const summary = buildTriggerOrderConfirmSummary({
      orders: [
        {
          orderNumber: 1,
          isTriggerParent: true,
          instruction: "BUY_TO_OPEN",
          quantity: 1,
          contractLine: "SPX 7545 CALL",
          limitPrice: 3.6,
          orderType: "LIMIT",
          contractCountForFees: 1,
        },
        {
          orderNumber: 2,
          triggeredByOrder: 1,
          instruction: "SELL_TO_CLOSE",
          quantity: 1,
          contractLine: "SPX 7545 CALL",
          limitPrice: 4.0,
          orderType: "LIMIT",
          contractCountForFees: 1,
        },
      ],
    });
    expect(summary.orders[1].positionEffect).toBe("[TO CLOSE]");
    expect(summary.orders[1].instructionLine).toContain("SELL −1");
  });
});