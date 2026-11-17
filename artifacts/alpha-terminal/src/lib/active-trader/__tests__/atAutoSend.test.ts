import { describe, expect, it } from "vitest";
import { loadActiveTraderPrefs, type ActiveTraderTemplatePrefs } from "../activeTraderPrefs";
import {
  canArmAutoSend,
  isAutoSendLiveReady,
  patchAutoSendArmed,
  patchAutoSendEnabled,
} from "../atAutoSend";
import { submitAtSchwabOrder } from "../atPlaceOrder";

const basePrefs: ActiveTraderTemplatePrefs = loadActiveTraderPrefs("index");

describe("auto send safeguards", () => {
  it("defaults off and disarmed", () => {
    expect(basePrefs.autoSend).toEqual({ enabled: false, armed: false });
  });

  it("requires enabled + armed + account + quote", () => {
    const armed = patchAutoSendArmed(patchAutoSendEnabled(basePrefs, true), true);
    expect(
      isAutoSendLiveReady(armed, {
        accountHash: "abc",
        blockLiveSend: false,
        orderValidationError: null,
        entryPrice: 3.6,
      }),
    ).toBe(true);
    expect(
      isAutoSendLiveReady(armed, {
        accountHash: null,
        blockLiveSend: false,
        orderValidationError: null,
        entryPrice: 3.6,
      }),
    ).toBe(false);
    expect(
      isAutoSendLiveReady(armed, {
        accountHash: "abc",
        blockLiveSend: true,
        orderValidationError: null,
        entryPrice: 3.6,
      }),
    ).toBe(false);
  });

  it("disarms when disabling auto send", () => {
    const on = patchAutoSendArmed(patchAutoSendEnabled(basePrefs, true), true);
    const off = patchAutoSendEnabled(on, false);
    expect(off.autoSend).toEqual({ enabled: false, armed: false });
  });

  it("blocks arm in fixture mode", () => {
    const reason = canArmAutoSend({
      accountHash: "hash",
      blockLiveSend: true,
      orderValidationError: null,
      entryPrice: 3,
    });
    expect(reason).toMatch(/fixture|preview/i);
  });
});

describe("submitAtSchwabOrder", () => {
  it("dry-run never calls the network", async () => {
    const result = await submitAtSchwabOrder({
      accountHash: "x",
      order: { orderStrategyType: "SINGLE" },
      symbol: "SPX",
      side: "BUY",
      quantity: 1,
      limitPrice: 3,
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    expect(result.orderId).toBe("dry-run");
  });
});