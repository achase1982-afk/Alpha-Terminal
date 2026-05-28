import { db, telemetryEventsTable } from "@workspace/db";
import { logger } from "./logger.js";

export type TelemetrySystem =
  | "SCHWAB_API"
  | "SCHWAB_STREAM"
  | "IBKR"
  | "YAHOO"
  | "SEC_EDGAR"
  | "SCANNER"
  | "STRATEGIST"
  | "CHAT"
  | "RISK_GATE"
  | "EXIT_STAGING"
  | "PUSH_NOTIFICATION"
  | "MARKET_PULSE"
  | "FMP_SCREENER"
  | "POLYGON_OPTIONS_WS"
  | "POLYGON_API"
  | "DATABASE"
  | "API"
  | "HTTP";

export type TelemetryFeature =
  | "MARKET_PULSE"
  | "SCANNER"
  | "STRATEGIST"
  | "STREAMER"
  | "SNAPSHOT"
  | "ORDER"
  | "SYSTEM"
  | "AI_LAB"
  | "HTTP";

export type TelemetrySeverity = "INFO" | "WARN" | "ERROR";

export interface TelemetryEvent {
  id: number;
  timestamp: string;
  system: TelemetrySystem;
  severity: TelemetrySeverity;
  message: string;
  details: Record<string, unknown> | null;
  resolved: boolean;
  feature: TelemetryFeature | null;
  batchId: string | null;
}

const MAX_ENTRIES = 2000;
let nextId = 1;
let nextBatchNum = 1;
const events: TelemetryEvent[] = [];
const unreadCounts: Record<string, number> = {};

export function createTelemetryBatch(feature: TelemetryFeature): string {
  const id = `${feature}-${nextBatchNum++}-${Date.now()}`;
  return id;
}

export function emitTelemetry(
  system: TelemetrySystem,
  severity: TelemetrySeverity,
  message: string,
  details?: Record<string, unknown>,
  feature?: TelemetryFeature,
  batchId?: string,
): void {
  const entry: TelemetryEvent = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    system,
    severity,
    message,
    details: details ?? null,
    resolved: false,
    feature: feature ?? inferFeature(system, message),
    batchId: batchId ?? null,
  };
  events.push(entry);
  unreadCounts[system] = (unreadCounts[system] ?? 0) + 1;
  if (events.length > MAX_ENTRIES) {
    events.splice(0, events.length - MAX_ENTRIES);
  }

  void db
    .insert(telemetryEventsTable)
    .values({
      service: "server",
      system,
      level: severity,
      message,
      subsystem: feature ?? null,
      details: details ?? {},
      requestId: null,
    })
    .catch((err: unknown) => {
      logger.error(
        { err, system, severity, message, feature, batchId },
        "emitTelemetry: telemetry_events insert failed",
      );
    });
}

function inferFeature(system: TelemetrySystem, message: string): TelemetryFeature | null {
  const msgLower = message.toLowerCase();
  if (system === "MARKET_PULSE" || msgLower.includes("pulse")) return "MARKET_PULSE";
  if (system === "SCANNER" || msgLower.includes("scanner") || msgLower.includes("scan ") || msgLower.includes("discovery scan")) return "SCANNER";
  if (system === "STRATEGIST" || msgLower.includes("strategist") || msgLower.includes("analysis initiated")) return "STRATEGIST";
  if (system === "CHAT" || msgLower.includes("chat stream") || msgLower.includes("chat send")) return "SYSTEM";
  if (system === "SCHWAB_STREAM" || system === "IBKR") return "STREAMER";
  if (system === "HTTP" || msgLower.includes("http_request")) return "HTTP";
  if (msgLower.includes("snapshot") || msgLower.includes("backfill")) return "SNAPSHOT";
  return "SYSTEM";
}

export function getEvents(opts?: {
  system?: string;
  severity?: string;
  showResolved?: boolean;
  limit?: number;
}): TelemetryEvent[] {
  let result = events;
  if (opts?.system) {
    result = result.filter(e => e.system === opts.system);
  }
  if (opts?.severity) {
    result = result.filter(e => e.severity === opts.severity);
  }
  if (!opts?.showResolved) {
    result = result.filter(e => !e.resolved);
  }
  const limit = opts?.limit ?? 500;
  return result.slice(-limit).reverse();
}

export function getGroupedEvents(opts?: {
  system?: string;
  severity?: string;
  showResolved?: boolean;
  limit?: number;
}): { groups: Array<{ batchId: string; feature: string; timestamp: string; entries: TelemetryEvent[]; systemSummary: string[] }>, ungrouped: TelemetryEvent[] } {
  let filtered = events.slice();
  if (opts?.system) {
    filtered = filtered.filter(e => e.system === opts.system);
  }
  if (opts?.severity) {
    filtered = filtered.filter(e => e.severity === opts.severity);
  }
  if (!opts?.showResolved) {
    filtered = filtered.filter(e => !e.resolved);
  }

  const batchMap = new Map<string, TelemetryEvent[]>();
  const ungrouped: TelemetryEvent[] = [];

  for (const e of filtered) {
    if (e.batchId) {
      const arr = batchMap.get(e.batchId) ?? [];
      arr.push(e);
      batchMap.set(e.batchId, arr);
    } else {
      ungrouped.push(e);
    }
  }

  const groups = Array.from(batchMap.entries()).map(([batchId, entries]) => {
    const sorted = entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const systems = [...new Set(sorted.map(e => e.system))];
    return {
      batchId,
      feature: sorted[0].feature ?? "SYSTEM",
      timestamp: sorted[sorted.length - 1].timestamp,
      entries: sorted,
      systemSummary: systems,
    };
  });

  groups.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const limit = opts?.limit ?? 200;
  return { groups: groups.slice(0, limit), ungrouped: ungrouped.slice(-limit).reverse() };
}

export function getSystemCounts(): Record<string, number> {
  return { ...unreadCounts };
}

export function resetSystemCount(system: string): void {
  unreadCounts[system] = 0;
}

export function resolveEvent(id: number): boolean {
  const ev = events.find(e => e.id === id);
  if (!ev) return false;
  ev.resolved = true;
  return true;
}

export function clearAllEvents(): void {
  events.length = 0;
  for (const k of Object.keys(unreadCounts)) {
    unreadCounts[k] = 0;
  }
}

export function getTotalCount(): { total: number; errors: number; warns: number } {
  let errors = 0;
  let warns = 0;
  for (const e of events) {
    if (e.resolved) continue;
    if (e.severity === "ERROR") errors++;
    if (e.severity === "WARN") warns++;
  }
  return { total: events.filter(e => !e.resolved).length, errors, warns };
}
