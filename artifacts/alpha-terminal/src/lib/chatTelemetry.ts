import { enqueueBrowserTelemetry, type BrowserTelemetryEvent } from "@/lib/browserTelemetry";

export function logChatTelemetry(
  level: BrowserTelemetryEvent["level"],
  message: string,
  details?: Record<string, unknown>,
): void {
  enqueueBrowserTelemetry({
    level,
    message,
    details: { ...details, telemetrySystem: "CHAT" },
  });
}
