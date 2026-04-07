import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useMarketPulseStore } from "./marketPulseStore";

const API_BASE = "/api";

let activeAbort: AbortController | null = null;
let streamStartedAt = 0;
let recoveryPollTimer: ReturnType<typeof setTimeout> | null = null;
let runEpoch = 0;

export function isPulseStreamActive(): boolean {
  return activeAbort !== null || recoveryPollTimer !== null;
}

export function abortPulseStream() {
  runEpoch++;
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
  if (recoveryPollTimer) {
    clearTimeout(recoveryPollTimer);
    recoveryPollTimer = null;
  }
  const s = useMarketPulseStore.getState();
  s.setStreaming(false);
  s.setLoading(false);
}

async function tryRecoverFromCache(): Promise<boolean> {
  try {
    console.log("[pulseStreamRunner] Attempting recovery from server cache...");
    const resp = await fetchWithAuth(`${API_BASE}/ai/market-pulse/latest`);
    if (!resp.ok) return false;
    const data = await resp.json();

    const store = useMarketPulseStore.getState();
    if (data.thinkingTokens && Array.isArray(data.thinkingTokens) && data.thinkingTokens.length > 0) {
      store.replaceThinking(data.thinkingTokens.join(""));
    }

    if (data.status === "ready" && data.pulse) {
      console.log("[pulseStreamRunner] Recovery successful — got cached result with", data.thinkingTokens?.length ?? 0, "thinking chunks");
      const enriched = { ...data.pulse, generatedAt: Date.now() };
      store.setPulseData(enriched);
      return true;
    }

    if (data.status === "in_flight") {
      console.log("[pulseStreamRunner] Generation still in flight — will poll again");
      return false;
    }

    return false;
  } catch (err) {
    console.warn("[pulseStreamRunner] Recovery fetch failed:", err);
    return false;
  }
}

function startRecoveryPolling(epoch: number) {
  if (recoveryPollTimer) return;

  const store = useMarketPulseStore.getState();
  store.appendStatus("Connection interrupted — waiting for server to finish...");

  let attempts = 0;
  const maxAttempts = 30;
  const intervalMs = 2000;

  const poll = async () => {
    if (epoch !== runEpoch) {
      console.log("[pulseStreamRunner] Recovery polling cancelled — epoch mismatch");
      return;
    }

    attempts++;
    if (attempts > maxAttempts) {
      console.log("[pulseStreamRunner] Recovery polling timed out after", maxAttempts, "attempts");
      recoveryPollTimer = null;
      const s = useMarketPulseStore.getState();
      if (!s.pulseData) {
        s.setError("Generation timed out. Please try again.");
      }
      s.setStreaming(false);
      s.setLoading(false);
      return;
    }

    const recovered = await tryRecoverFromCache();

    if (epoch !== runEpoch) {
      console.log("[pulseStreamRunner] Recovery polling cancelled after fetch — epoch mismatch");
      return;
    }

    if (recovered) {
      recoveryPollTimer = null;
      const s = useMarketPulseStore.getState();
      s.setStreaming(false);
      s.setLoading(false);
      return;
    }

    recoveryPollTimer = setTimeout(poll, intervalMs);
  };

  recoveryPollTimer = setTimeout(poll, intervalMs);
}

export async function runPulseStream(payload: Record<string, unknown>) {
  if (activeAbort) {
    const elapsed = Date.now() - streamStartedAt;
    if (elapsed < 60_000) {
      console.log("[pulseStreamRunner] Ignoring duplicate call — stream already active for", elapsed, "ms");
      return;
    }
    console.log("[pulseStreamRunner] Stream has been running >60s, allowing restart");
  }

  abortPulseStream();

  const currentEpoch = ++runEpoch;

  const store = useMarketPulseStore.getState();
  store.clearPulse();
  store.setLoading(true);
  store.setStreaming(true);
  store.setError(null);
  store.clearThinking();
  streamStartedAt = Date.now();

  const abort = new AbortController();
  activeAbort = abort;

  console.log("[pulseStreamRunner] Starting stream request... (epoch", currentEpoch, ")");

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
    let gotResult = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (currentEpoch !== runEpoch) return;

      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      interface ParsedEvent { eventType: string; parsed: Record<string, unknown> }
      const parsedEvents: ParsedEvent[] = [];

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
          parsedEvents.push({ eventType, parsed });
        } catch {
          console.warn("[pulseStreamRunner] Failed to parse SSE data:", eventData);
        }
      }

      const hasThinking = parsedEvents.some(e => e.eventType === "thinking");
      const hasResult = parsedEvents.some(e => e.eventType === "result");

      for (const { eventType, parsed } of parsedEvents) {
        if (eventType === "result" && hasThinking && hasResult) continue;

        if (eventType === "thinking") {
          const text = (parsed.text || parsed.content || "") as string;
          if (text) {
            useMarketPulseStore.getState().appendThinking(text);
          }
        } else if (eventType === "status") {
          const text = (parsed.text || "") as string;
          if (text) {
            useMarketPulseStore.getState().appendStatus(text);
          }
        } else if (eventType === "result") {
          gotResult = true;
          const resultData = parsed.pulse || parsed.data || parsed;
          const enriched = { ...(resultData as Record<string, unknown>), generatedAt: Date.now() };
          useMarketPulseStore.getState().setPulseData(enriched as any);
        } else if (eventType === "error") {
          const msg = (parsed.message || "An error occurred") as string;
          useMarketPulseStore.getState().setError(msg);
        }
      }

      if (hasThinking && hasResult) {
        await new Promise(r => setTimeout(r, 50));
        const deferred = parsedEvents.filter(e => e.eventType === "result");
        for (const { parsed } of deferred) {
          gotResult = true;
          const resultData = parsed.pulse || parsed.data || parsed;
          const enriched = { ...(resultData as Record<string, unknown>), generatedAt: Date.now() };
          useMarketPulseStore.getState().setPulseData(enriched as any);
        }
      }
    }

    if (!gotResult && currentEpoch === runEpoch) {
      console.log("[pulseStreamRunner] Stream ended without result — starting recovery polling");
      startRecoveryPolling(currentEpoch);
      return;
    }

  } catch (err: any) {
    if (err.name === "AbortError") {
      console.log("[pulseStreamRunner] Stream aborted");
      return;
    }
    console.error("[pulseStreamRunner] Stream error:", err);

    if (currentEpoch !== runEpoch) return;

    const elapsed = Date.now() - streamStartedAt;
    if (elapsed > 3000) {
      console.log("[pulseStreamRunner] Stream broke after", elapsed, "ms — trying recovery");
      startRecoveryPolling(currentEpoch);
      return;
    }

    const msg = err.message || "Generation failed. Please try again.";
    useMarketPulseStore.getState().setError(msg);
  } finally {
    if (activeAbort === abort) {
      activeAbort = null;
    }
    if (!recoveryPollTimer && currentEpoch === runEpoch) {
      const s = useMarketPulseStore.getState();
      s.setStreaming(false);
      s.setLoading(false);
    }
  }
}
