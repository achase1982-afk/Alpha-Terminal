export type StrategistPushMessageType = "STRATEGIST_PUSH_NAV" | "STRATEGIST_PUSH_READY";

export type StrategistPushMessage = {
  type: StrategistPushMessageType;
  jobId: string;
  ticker?: string;
};

export function parseStrategistPushMessage(data: unknown): StrategistPushMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { type?: string; jobId?: string; ticker?: string };
  if (d.type !== "STRATEGIST_PUSH_NAV" && d.type !== "STRATEGIST_PUSH_READY") return null;
  const jobId = typeof d.jobId === "string" ? d.jobId.trim() : "";
  if (!jobId) return null;
  return {
    type: d.type,
    jobId,
    ticker: typeof d.ticker === "string" ? d.ticker : undefined,
  };
}

/** Listen for SW postMessage when a strategist completion push arrives or is tapped. */
export function installStrategistPushMessageListener(
  onPush: (msg: StrategistPushMessage) => void,
): () => void {
  const onMsg = (ev: MessageEvent) => {
    const parsed = parseStrategistPushMessage(ev.data);
    if (parsed) onPush(parsed);
  };
  navigator.serviceWorker?.addEventListener("message", onMsg);
  return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
}
