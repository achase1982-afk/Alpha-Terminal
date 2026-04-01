import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useMarketPulseStore } from "./marketPulseStore";

const API_BASE = "/api";

let activeAbort: AbortController | null = null;

export function isPulseStreamActive(): boolean {
  return activeAbort !== null;
}

export function abortPulseStream() {
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
}

export async function runPulseStream(payload: Record<string, unknown>) {
  abortPulseStream();

  const store = useMarketPulseStore.getState();
  store.setLoading(true);
  store.setStreaming(true);
  store.setError(null);
  store.clearThinking();

  const abort = new AbortController();
  activeAbort = abort;

  try {
    const response = await fetchWithAuth(`${API_BASE}/ai/market-pulse/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: abort.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        if (!event.trim()) continue;

        const lines = event.split("\n");
        let eventType = "";
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventType = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            eventData = line.slice(5).trim();
          }
        }

        if (!eventType || !eventData) continue;

        try {
          const parsed = JSON.parse(eventData);

          if (eventType === "thinking") {
            const text = parsed.text || parsed.content || "";
            if (text) {
              useMarketPulseStore.getState().appendThinking(text);
            }
          } else if (eventType === "result") {
            const resultData = parsed.pulse || parsed.data || parsed;
            const enriched = { ...resultData, generatedAt: Date.now() };
            useMarketPulseStore.getState().setPulseData(enriched);
          } else if (eventType === "error") {
            const msg = parsed.message || "An error occurred";
            useMarketPulseStore.getState().setError(msg);
          }
        } catch {
          console.warn("[pulseStreamRunner] Failed to parse SSE data:", eventData);
        }
      }
    }

  } catch (err: any) {
    if (err.name === "AbortError") return;
    console.error("[pulseStreamRunner] Stream error:", err);
    const msg = err.message || "Generation failed. Please try again.";
    useMarketPulseStore.getState().setError(msg);
  } finally {
    if (activeAbort === abort) {
      activeAbort = null;
    }
    const s = useMarketPulseStore.getState();
    s.setStreaming(false);
    s.setLoading(false);
  }
}
