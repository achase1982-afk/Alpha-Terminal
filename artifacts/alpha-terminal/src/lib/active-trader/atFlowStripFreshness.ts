const STALE_MS = 60_000;

export type FlowFreshness =
  | { kind: "live" }
  | { kind: "stale"; atMs: number }
  | { kind: "unavailable" };

export function resolveFlowFreshness(rxMs: number | null | undefined, nowMs = Date.now()): FlowFreshness {
  if (rxMs == null || !Number.isFinite(rxMs)) return { kind: "unavailable" };
  const age = nowMs - rxMs;
  if (age <= STALE_MS) return { kind: "live" };
  return { kind: "stale", atMs: rxMs };
}

export function formatFlowFreshnessBadge(fresh: FlowFreshness): string | null {
  if (fresh.kind === "live") return null;
  if (fresh.kind === "unavailable") return "Unavailable";
  const t = new Date(fresh.atMs).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `STALE · ${t} ET`;
}