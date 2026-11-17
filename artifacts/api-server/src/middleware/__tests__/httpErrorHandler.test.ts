import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { httpErrorHandler } from "../httpErrorHandler.js";

vi.mock("../../lib/telemetry.js", () => ({
  logFailure: vi.fn(() => Promise.resolve()),
}));

describe("httpErrorHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 500 without leaking internals", () => {
    const req = { method: "GET", path: "/api/test", id: "req-1" } as Request;
    const res = {
      headersSent: false,
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

    httpErrorHandler(new Error("db blew up"), req, res, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(res.body)).not.toContain("db blew up");
  });
});