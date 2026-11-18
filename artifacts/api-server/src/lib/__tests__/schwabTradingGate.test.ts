import { describe, it, expect, afterEach } from "vitest";
import {
  isAutomatedSchwabTradingDisabled,
  isManualSchwabTradingDisabled,
} from "../schwabTradingGate.js";

describe("schwabTradingGate", () => {
  const prevAuth = process.env.AUTH_DISABLED;
  const prevAllow = process.env.ORDERS_ALLOW_WITHOUT_AUTH;

  afterEach(() => {
    if (prevAuth === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = prevAuth;
    if (prevAllow === undefined) delete process.env.ORDERS_ALLOW_WITHOUT_AUTH;
    else process.env.ORDERS_ALLOW_WITHOUT_AUTH = prevAllow;
  });

  it("manual trading blocked when AUTH_DISABLED without override", () => {
    process.env.AUTH_DISABLED = "true";
    delete process.env.ORDERS_ALLOW_WITHOUT_AUTH;
    expect(isManualSchwabTradingDisabled()).toBe(true);
  });

  it("manual trading allowed when ORDERS_ALLOW_WITHOUT_AUTH=1", () => {
    process.env.AUTH_DISABLED = "true";
    process.env.ORDERS_ALLOW_WITHOUT_AUTH = "true";
    expect(isManualSchwabTradingDisabled()).toBe(false);
  });

  it("automated trading stays blocked when auth disabled even with override", () => {
    process.env.AUTH_DISABLED = "true";
    process.env.ORDERS_ALLOW_WITHOUT_AUTH = "true";
    expect(isAutomatedSchwabTradingDisabled()).toBe(true);
  });

  it("allows trading when AUTH_DISABLED is unset", () => {
    delete process.env.AUTH_DISABLED;
    expect(isManualSchwabTradingDisabled()).toBe(false);
  });
});