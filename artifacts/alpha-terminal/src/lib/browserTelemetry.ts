import { fetchWithAuth } from "@/lib/fetchWithAuth";

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
  queue.push(ev);
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
