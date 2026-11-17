import { logFailure, type TelemetrySystem } from "./telemetry.js";

function safeUpstreamPath(pathOrUrl: string): string {
  if (!pathOrUrl.includes("?")) return pathOrUrl;
  try {
    const absolute = pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://");
    const u = new URL(pathOrUrl, absolute ? undefined : "http://local.invalid");
    u.searchParams.delete("token");
    const q = u.searchParams.toString();
    const base = absolute ? u.pathname : pathOrUrl.split("?")[0] ?? u.pathname;
    return q ? `${base}?${q}` : base;
  } catch {
    return pathOrUrl.replace(/([?&])token=[^&]+/gi, "$1token=[REDACTED]");
  }
}

export function logUpstreamFailure(
  system: Extract<TelemetrySystem, "ALPACA" | "FINNHUB" | "UNUSUAL_WHALES">,
  path: string,
  status: number,
): void {
  const safePath = safeUpstreamPath(path);
  const severity = status >= 500 || status === 0 ? "ERROR" : "WARN";
  void logFailure(
    system,
    severity,
    `Upstream request failed (${status || "network"})`,
    { path: safePath, status },
  );
}