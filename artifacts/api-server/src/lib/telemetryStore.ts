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
  | "POLYGON_API"
  | "DATABASE";

export type TelemetrySeverity = "INFO" | "WARN" | "ERROR";

export interface TelemetryEvent {
  id: number;
  timestamp: string;
  system: TelemetrySystem;
  severity: TelemetrySeverity;
  message: string;
  details: Record<string, unknown> | null;
  resolved: boolean;
}

const MAX_ENTRIES = 1000;
let nextId = 1;
const events: TelemetryEvent[] = [];
const unreadCounts: Record<string, number> = {};

export function emitTelemetry(
  system: TelemetrySystem,
  severity: TelemetrySeverity,
  message: string,
  details?: Record<string, unknown>,
): void {
  const entry: TelemetryEvent = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    system,
    severity,
    message,
    details: details ?? null,
    resolved: false,
  };
  events.push(entry);
  unreadCounts[system] = (unreadCounts[system] ?? 0) + 1;
  if (events.length > MAX_ENTRIES) {
    events.splice(0, events.length - MAX_ENTRIES);
  }
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
