import { afterEach, describe, expect, it, vi } from "vitest";

describe("atOrderSend", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is disabled unless VITE_AT_ORDER_SEND=1", async () => {
    vi.stubEnv("VITE_AT_ORDER_SEND", "");
    const mod = await import("../atOrderSend");
    expect(mod.AT_ORDER_SEND_ENABLED).toBe(false);
    expect(mod.atOrderSendAllowed()).toBe(false);

    vi.stubEnv("VITE_AT_ORDER_SEND", "0");
    vi.resetModules();
    const off = await import("../atOrderSend");
    expect(off.AT_ORDER_SEND_ENABLED).toBe(false);

    vi.stubEnv("VITE_AT_ORDER_SEND", "1");
    vi.resetModules();
    const on = await import("../atOrderSend");
    expect(on.AT_ORDER_SEND_ENABLED).toBe(true);
    expect(on.atOrderSendAllowed()).toBe(true);
  });

  it("atOrderSendAllowed is false when auth is disabled", async () => {
    vi.stubEnv("VITE_AT_ORDER_SEND", "1");
    vi.stubEnv("VITE_AUTH_DISABLED", "1");
    vi.resetModules();
    const mod = await import("../atOrderSend");
    expect(mod.atOrderSendAllowed()).toBe(false);
  });

  it("allows send when auth disabled and VITE_ORDERS_ALLOW_WITHOUT_AUTH=1", async () => {
    vi.stubEnv("VITE_AT_ORDER_SEND", "1");
    vi.stubEnv("VITE_AUTH_DISABLED", "1");
    vi.stubEnv("VITE_ORDERS_ALLOW_WITHOUT_AUTH", "1");
    vi.resetModules();
    const mod = await import("../atOrderSend");
    expect(mod.atOrderSendAllowed()).toBe(true);
  });
});