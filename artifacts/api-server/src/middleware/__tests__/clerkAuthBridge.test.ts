import { describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { clerkAuthBridge } from "../clerkAuthBridge";

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    query: {},
    ...overrides,
  } as Request;
}

describe("clerkAuthBridge", () => {
  it("preserves an existing Authorization header", () => {
    const req = mockReq({ headers: { authorization: "Bearer existing" } });
    const next = vi.fn() as NextFunction;
    clerkAuthBridge(req, {} as Response, next);
    expect(req.headers.authorization).toBe("Bearer existing");
    expect(next).toHaveBeenCalledOnce();
  });

  it("promotes accessToken query param to Authorization Bearer", () => {
    const req = mockReq({ query: { accessToken: "jwt-from-query" } });
    const next = vi.fn() as NextFunction;
    clerkAuthBridge(req, {} as Response, next);
    expect(req.headers.authorization).toBe("Bearer jwt-from-query");
    expect(next).toHaveBeenCalledOnce();
  });

  it("ignores empty accessToken query param", () => {
    const req = mockReq({ query: { accessToken: "" } });
    const next = vi.fn() as NextFunction;
    clerkAuthBridge(req, {} as Response, next);
    expect(req.headers.authorization).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});
