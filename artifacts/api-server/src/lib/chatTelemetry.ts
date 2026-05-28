import { createTelemetryBatch, emitTelemetry, type TelemetrySeverity } from "./telemetryStore.js";

export type ChatTelemetryBatch = {
  batchId: string;
  threadId?: string;
  symbol?: string;
};

export function createChatTelemetryBatch(meta?: {
  threadId?: string;
  symbol?: string;
}): ChatTelemetryBatch {
  return {
    batchId: createTelemetryBatch("SYSTEM"),
    ...meta,
  };
}

export function emitChatTelemetry(
  severity: TelemetrySeverity,
  message: string,
  details?: Record<string, unknown>,
  batch?: ChatTelemetryBatch | null,
): void {
  emitTelemetry(
    "CHAT",
    severity,
    message,
    {
      ...details,
      ...(batch?.threadId ? { threadId: batch.threadId } : {}),
      ...(batch?.symbol ? { symbol: batch.symbol } : {}),
    },
    "SYSTEM",
    batch?.batchId,
  );
}
