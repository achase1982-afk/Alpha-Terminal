import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { deskBearerAuth, resetDeskAuthLogGuardForTests } from "../deskBearerAuth.js";

function mockReq(auth?: string): Request {
  return {
    headers: auth != null ? { authorization: auth } : {},
  } as Request;
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  } as Response & { statusCode: number; body: unknown };
  return res;
}

describe("deskBearerAuth", () => {
  const prev = process.env.DESK_API_KEY;

  beforeEach(() => {
    resetDeskAuthLogGuardForTests();
    process.env.DESK_API_KEY = "test-desk-secret";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.DESK_API_KEY;
    else process.env.DESK_API_KEY = prev;
  });

  it("returns 503 when DESK_API_KEY is unset", () => {
    delete process.env.DESK_API_KEY;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    deskBearerAuth(mockReq(), res, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for missing bearer token", () => {
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    deskBearerAuth(mockReq(), res, next);
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for wrong bearer token", () => {
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    deskBearerAuth(mockReq("Bearer wrong"), res, next);
    expect(res.statusCode).toBe(401);
  });

  it("calls next for valid bearer token", () => {
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    deskBearerAuth(mockReq("Bearer test-desk-secret"), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });
});