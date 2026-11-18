import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults off and disarmed", () => {
    expect(basePrefs.autoSend).toEqual({ enabled: false, armed: false });
  });

  it("is not live-ready when order send is off by default", async () => {
    vi.stubEnv("VITE_AT_ORDER_SEND", "");
    const { isAutoSendLiveReady: ready } = await import("../atAutoSend");
    const armed = patchAutoSendArmed(patchAutoSendEnabled(basePrefs, true), true);
    expect(
      ready(armed, {
        accountHash: "abc",
        blockLiveSend: false,
        orderValidationError: null,
        entryPrice: 3.6,
      }),
    ).toBe(false);
  });

  it("requires enabled + armed + account + quote when VITE_AT_ORDER_SEND=1", async () => {
    vi.stubEnv("VITE_AT_ORDER_SEND", "1");
    const { isAutoSendLiveReady: ready } = await import("../atAutoSend");
    const armed = patchAutoSendArmed(patchAutoSendEnabled(basePrefs, true), true);
    expect(
      ready(armed, {
        accountHash: "abc",
        blockLiveSend: false,
        orderValidationError: null,
        entryPrice: 3.6,
      }),
    ).toBe(true);
    expect(
      ready(armed, {
        accountHash: null,
        blockLiveSend: false,
        orderValidationError: null,
        entryPrice: 3.6,
      }),
    ).toBe(false);
    expect(
      ready(armed, {
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