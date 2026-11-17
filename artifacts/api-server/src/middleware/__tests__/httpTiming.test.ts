import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { httpTimingMiddleware } from "../httpTiming.js";

const { emitTelemetry } = vi.hoisted(() => ({
  emitTelemetry: vi.fn(),
}));

vi.mock("../../lib/telemetryStore.js", () => ({
  emitTelemetry,
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: null }),
}));

describe("httpTimingMiddleware", () => {
  beforeEach(() => {
    emitTelemetry.mockClear();
  });

  it("does not emit durable telemetry for 2xx responses", () => {
    const handlers: Record<string, () => void> = {};
    const res = {
      statusCode: 200,
      on(evt: string, fn: () => void) {
        handlers[evt] = fn;
        return res;
      },
    } as unknown as Response;
    const req = { method: "GET", path: "/api/foo", route: undefined, baseUrl: "" } as Request;
    const next = vi.fn();

    httpTimingMiddleware(req, res, next);
    handlers.finish?.();

    expect(emitTelemetry).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("emits durable telemetry for 4xx responses", () => {
    const handlers: Record<string, () => void> = {};
    const res = {
      statusCode: 404,
      on(evt: string, fn: () => void) {
        handlers[evt] = fn;
        return res;
      },
    } as unknown as Response;
    const req = { method: "GET", path: "/api/foo", route: undefined, baseUrl: "" } as Request;

    httpTimingMiddleware(req, res, vi.fn());
    handlers.finish?.();

    expect(emitTelemetry).toHaveBeenCalledWith(
      "HTTP",
      "WARN",
      "http_request_completed",
      expect.objectContaining({ status: 404 }),
      "HTTP",
    );
  });
});