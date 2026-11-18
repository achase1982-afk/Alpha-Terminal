import { describe, it, expect, afterEach } from "vitest";
import { isSchwabTradingDisabled } from "../schwabTradingGate.js";

describe("schwabTradingGate", () => {
  const prev = process.env.AUTH_DISABLED;

  afterEach(() => {
    if (prev === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = prev;
    delete process.env.VITE_AT_ORDER_SEND;
  });

  it("fail closed when AUTH_DISABLED=true regardless of VITE_AT_ORDER_SEND", () => {
    process.env.AUTH_DISABLED = "true";
    process.env.VITE_AT_ORDER_SEND = "1";
    expect(isSchwabTradingDisabled()).toBe(true);
  });

  it("allows trading when AUTH_DISABLED is unset", () => {
    delete process.env.AUTH_DISABLED;
    expect(isSchwabTradingDisabled()).toBe(false);
  });
});