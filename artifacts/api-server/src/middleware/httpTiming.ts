import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { emitTelemetry } from "../lib/telemetryStore.js";

/**
 * Skip paths where `res.on("finish")` reflects connection lifetime, not handler latency:
 * - Server-Sent Events (quotes stream, AI token stream, flow timesales stream).
 * Long-lived streams would inflate duration_ms incorrectly.
 */
const SKIP_PATHS = new Set<string>([
  "/api/health",
  "/api/healthz",
  "/api/ping",
  "/api/stream/quotes",
  "/api/ai/technical-analysis/stream",
]);

function shouldSkipTiming(path: string): boolean {
  if (SKIP_PATHS.has(path)) return true;
  if (path.startsWith("/api/flow/timesales/") && path.endsWith("/stream")) return true;
  return false;
}

export function httpTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (shouldSkipTiming(req.path)) {
    next();
    return;
  }

  const started = Date.now();

  res.on("finish", () => {
    const duration_ms = Date.now() - started;

    const pathPattern =
      req.route?.path != null
        ? `${req.baseUrl ?? ""}${req.route.path}`
        : req.path;

    let user_id: string | null = null;
    try {
      user_id = getAuth(req).userId ?? null;
    } catch {
      user_id = null;
    }

    const status = res.statusCode;
    const level = status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO";

    try {
      emitTelemetry(
        "HTTP",
        level,
        "http_request_completed",
        { method: req.method, path: pathPattern, status, duration_ms, user_id },
        "HTTP",
      );
    } catch (err) {
      console.error("[httpTiming] emit failed", err);
    }
  });

  next();
}
