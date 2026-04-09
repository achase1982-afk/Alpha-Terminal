import { db } from "@workspace/db";
import { failureLogTable } from "@workspace/db/schema";
import { lt } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendPushToAll } from "./pushService.js";
import { emitTelemetry, type TelemetrySystem as StoreSystem, type TelemetrySeverity as StoreSeverity } from "./telemetryStore.js";

export type TelemetrySystem =
  | "SCHWAB_API"
  | "SCHWAB_STREAM"
  | "IBKR"
  | "YAHOO"
  | "SEC_EDGAR"
  | "SCANNER"
  | "STRATEGIST"
  | "RISK_GATE"
  | "EXIT_STAGING"
  | "PUSH_NOTIFICATION"
  | "MARKET_PULSE"
  | "POLYGON_API";

export type TelemetrySeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export async function logFailure(
  system: TelemetrySystem,
  severity: TelemetrySeverity,
  message: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const pinoLevel = severity === "CRITICAL" ? "error" : severity.toLowerCase() as "info" | "warn" | "error";
  logger[pinoLevel]({ system, severity, ...details }, `[TELEMETRY] ${message}`);

  const storeSev: StoreSeverity = severity === "CRITICAL" ? "ERROR" : severity as StoreSeverity;
  emitTelemetry(system as StoreSystem, storeSev, severity === "CRITICAL" ? `[CRITICAL] ${message}` : message, details);

  try {
    await db.insert(failureLogTable).values({
      system,
      severity,
      message,
      details: details ?? null,
    });
  } catch (err) {
    logger.error({ err, system, severity, message }, "Failed to write telemetry to DB");
  }

  if (severity === "CRITICAL") {
    void sendPushToAll({
      title: "ALPHA TERMINAL — CRITICAL",
      body: `[${system}] ${message}`,
      tag: `critical-${system}`,
      data: { system, severity, message },
    });
  }
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startTelemetryCleanup() {
  if (cleanupInterval) return;
  runCleanup();
  cleanupInterval = setInterval(runCleanup, 24 * 60 * 60 * 1000);
  logger.info("Telemetry cleanup scheduled (daily, 30-day TTL)");
}

async function runCleanup() {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await db.delete(failureLogTable).where(lt(failureLogTable.timestamp, cutoff));
    logger.info({ cutoff: cutoff.toISOString() }, "Telemetry cleanup complete");
  } catch (err) {
    logger.error({ err }, "Telemetry cleanup failed");
  }
}
