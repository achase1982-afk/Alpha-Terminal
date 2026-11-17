import type { NextFunction, Request, Response } from "express";
import { logFailure } from "../lib/telemetry.js";

export function httpErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    return;
  }
  const message = err instanceof Error ? err.message : "Unhandled HTTP error";
  const stack = err instanceof Error ? err.stack : undefined;
  const requestId = typeof req.id === "string" ? req.id : undefined;
  void logFailure("HTTP", "ERROR", message, {
    method: req.method,
    path: req.path,
    requestId,
    stack,
  });
  res.status(500).json({ error: "Internal server error" });
}