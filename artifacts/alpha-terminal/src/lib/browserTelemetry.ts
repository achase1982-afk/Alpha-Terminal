import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { browserTelemetryBaseDetails } from "@/lib/browserTelemetryMeta";

type BrowserLevel = "INFO" | "WARN" | "ERROR";

export interface BrowserTelemetryEvent {
  level: BrowserLevel;
  message: string;
  details?: Record<string, unknown>;
}

const queue: BrowserTelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

const FLUSH_MS = 7000;
const MAX_BATCH = 35;
const DEDUPE_MS = 25_000;
const recentByKey = new Map<string, number>();

function dedupeKey(ev: BrowserTelemetryEvent): string {
  const path = typeof ev.details?.path === "string" ? ev.details.path : "";
  return `${ev.level}:${ev.message}:${path}`;
}

function shouldRecord(ev: BrowserTelemetryEvent): boolean {
  const key = dedupeKey(ev);
  const now = Date.now();
  const prev = recentByKey.get(key);
  if (prev != null && now - prev < DEDUPE_MS) return false;
  recentByKey.set(key, now);
  if (recentByKey.size > 400) {
    const cutoff = now - DEDUPE_MS * 2;
    for (const [k, t] of recentByKey) {
      if (t < cutoff) recentByKey.delete(k);
    }
  }
  return true;
}

function scheduleFlush(): void {
  if (flushTimer != null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue();
  }, FLUSH_MS);
}

async function flushQueue(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue.splice(0, MAX_BATCH);
  try {
    const res = await fetchWithAuth("/api/telemetry/browser-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok && queue.length < 500) {
      queue.unshift(...batch);
    }
  } catch {
    if (queue.length < 500) queue.unshift(...batch);
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush();
  }
}

export function enqueueBrowserTelemetry(ev: BrowserTelemetryEvent): void {
  const merged: BrowserTelemetryEvent = {
    ...ev,
    details: { ...browserTelemetryBaseDetails(), ...(ev.details ?? {}) },
  };
  if (!shouldRecord(merged)) return;
  queue.push(merged);
  if (queue.length >= 12) void flushQueue();
  else scheduleFlush();
}

let captureInstalled = false;

/**
 * Captures window errors and unhandled promise rejections and POSTs them to
 * telemetry_events (service alpha-terminal). Idempotent per session.
 */
export function installBrowserTelemetryCapture(): () => void {
  if (typeof window === "undefined") return () => {};
  if (captureInstalled) return () => {};
  captureInstalled = true;

  const onError = (ev: ErrorEvent) => {
    enqueueBrowserTelemetry({
      level: "ERROR",
      message: ev.message || "window error",
      details: {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        stack: ev.error instanceof Error ? ev.error.stack : undefined,
      },
    });
  };

  const onRejection = (ev: PromiseRejectionEvent) => {
    const reason = ev.reason;
    const text = reason instanceof Error ? reason.message : String(reason);
    enqueueBrowserTelemetry({
      level: "ERROR",
      message: `unhandledrejection: ${text}`,
      details: {
        stack: reason instanceof Error ? reason.stack : undefined,
      },
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    captureInstalled = false;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    if (flushTimer != null) clearTimeout(flushTimer);
    flushTimer = null;
    void flushQueue();
  };
}
