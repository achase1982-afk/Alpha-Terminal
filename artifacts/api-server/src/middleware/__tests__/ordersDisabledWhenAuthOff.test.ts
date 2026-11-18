import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { blockBrokerOrdersWhenAuthDisabled } from "../ordersDisabledWhenAuthOff.js";

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as Response & { statusCode: number; body: unknown };
  return res;
}

function mockReq(method: string, path: string, body?: unknown): Request {
  return { method, path, body } as Request;
}

describe("blockBrokerOrdersWhenAuthDisabled", () => {
  const prev = process.env.AUTH_DISABLED;
  const prevAllow = process.env.ORDERS_ALLOW_WITHOUT_AUTH;

  beforeEach(() => {
    process.env.AUTH_DISABLED = "true";
    delete process.env.ORDERS_ALLOW_WITHOUT_AUTH;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = prev;
    if (prevAllow === undefined) delete process.env.ORDERS_ALLOW_WITHOUT_AUTH;
    else process.env.ORDERS_ALLOW_WITHOUT_AUTH = prevAllow;
  });

  it("403 place-order when auth disabled", () => {
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    blockBrokerOrdersWhenAuthDisabled(mockReq("POST", "/portfolio/place-order"), res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "orders_disabled_no_auth" });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows reads when auth disabled", () => {
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    blockBrokerOrdersWhenAuthDisabled(mockReq("GET", "/portfolio/accounts"), res, next);
    expect(next).toHaveBeenCalled();
  });

  it("passes through when auth enabled", () => {
    process.env.AUTH_DISABLED = "false";
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    blockBrokerOrdersWhenAuthDisabled(mockReq("POST", "/portfolio/place-order"), res, next);
    expect(next).toHaveBeenCalled();
  });

  it("allows place-order when ORDERS_ALLOW_WITHOUT_AUTH", () => {
    process.env.ORDERS_ALLOW_WITHOUT_AUTH = "true";
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    blockBrokerOrdersWhenAuthDisabled(mockReq("POST", "/portfolio/place-order"), res, next);
    expect(next).toHaveBeenCalled();
  });

  it("still blocks auto-trade when ORDERS_ALLOW_WITHOUT_AUTH", () => {
    process.env.ORDERS_ALLOW_WITHOUT_AUTH = "true";
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    blockBrokerOrdersWhenAuthDisabled(mockReq("POST", "/auto-trade/start"), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});