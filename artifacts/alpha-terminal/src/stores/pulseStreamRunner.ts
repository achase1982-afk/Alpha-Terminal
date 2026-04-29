import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useMarketPulseStore } from "./marketPulseStore";

const API_BASE = "/api";

type AbortWithStartedAt = AbortController & { __startedAt: number };

function asAbortWithStartedAt(abort: AbortController): AbortWithStartedAt {
  return abort as AbortWithStartedAt;
}

let activeAbort: AbortController | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let runEpoch = 0;

export function isPulseStreamActive(): boolean {
  return activeAbort !== null || pollTimer !== null;
}

export function abortPulseStream() {
  runEpoch++;
  if (activeAbort) {
    activeAbort.abort();
    activeAbort = null;
  }
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  const s = useMarketPulseStore.getState();
  s.setStreaming(false);
  s.setLoading(false);
}

export async function runPulseStream(payload: Record<string, unknown>) {
  if (activeAbort) {
    const elapsed = Date.now() - asAbortWithStartedAt(activeAbort).__startedAt;
    if (elapsed < 90_000) {
      console.log("[pulse] Ignoring duplicate call — already active for", elapsed, "ms");
      return;
    }
    console.log("[pulse] Active >90s, allowing restart");
  }

  abortPulseStream();

  const currentEpoch = ++runEpoch;

  const store = useMarketPulseStore.getState();
  store.clearPulse();
  store.setLoading(true);
  store.setStreaming(true);
  store.setError(null);
  store.clearThinking();

  const abort = new AbortController();
  asAbortWithStartedAt(abort).__startedAt = Date.now();
  activeAbort = abort;

  console.log("[pulse] Starting generation (epoch", currentEpoch, ")");

  // Fire the POST without awaiting — proxy buffering can delay header delivery by 10-15s
  // which would freeze the UI at step 0. Polling starts immediately instead.
  fetchWithAuth(`${API_BASE}/ai/market-pulse/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: abort.signal,
  }).then(response => {
    if (!response.ok) {
      console.warn("[pulse] POST returned non-OK:", response.status, response.statusText);
    } else {
      console.log("[pulse] POST accepted (status", response.status, ")");
    }
  }).catch(err => {
    if (!abort.signal.aborted) {
      console.warn("[pulse] POST error:", err.message);
    }
  });

  // Start polling immediately — don't wait for SSE headers
  if (currentEpoch === runEpoch) {
    startResultPolling(currentEpoch);
  }
}

function startResultPolling(epoch: number) {
  if (pollTimer) return;

  let attempts = 0;
  const maxAttempts = 60;
  const intervalMs = 2000;
  let lastThinkingLen = 0;
  let consecutiveNone = 0;

  const poll = async () => {
    if (epoch !== runEpoch) {
      console.log("[pulse] Polling cancelled — epoch mismatch");
      return;
    }

    attempts++;
    if (attempts > maxAttempts) {
      console.log("[pulse] Polling timed out after", maxAttempts, "attempts");
      pollTimer = null;
      const s = useMarketPulseStore.getState();
      if (!s.pulseData) {
        s.setError("Generation timed out. Please try again.");
      }
      s.setStreaming(false);
      s.setLoading(false);
      activeAbort = null;
      return;
    }

    try {
      const resp = await fetchWithAuth(`${API_BASE}/ai/market-pulse/latest`);
      if (!resp.ok) {
        pollTimer = setTimeout(poll, intervalMs);
        return;
      }
      const data = await resp.json();

      if (epoch !== runEpoch) return;

      if (data.thinkingTokens && Array.isArray(data.thinkingTokens) && data.thinkingTokens.length > 0) {
        const joined = data.thinkingTokens.join("");
        if (joined.length > lastThinkingLen) {
          lastThinkingLen = joined.length;
          useMarketPulseStore.getState().replaceThinking(joined);
        }
      }

      if (data.status === "error") {
        console.warn("[pulse] Server reported generation error:", data.error);
        pollTimer = null;
        activeAbort = null;
        const s = useMarketPulseStore.getState();
        let errMsg = "Generation failed. Please try again.";
        if (typeof data.error === "string") {
          errMsg = data.error;
        } else if (data.error && typeof data.error === "object") {
          const e = data.error as Record<string, unknown>;
          const inner = e.error as Record<string, unknown> | undefined;
          errMsg = (inner?.message as string) || (e.message as string) || "Generation failed — AI service temporarily unavailable. Please retry.";
        }
        s.setError(errMsg);
        s.setStreaming(false);
        s.setLoading(false);
        return;
      }

      if (data.status === "ready" && data.pulse) {
        console.log("[pulse] Got result — thinking chunks:", data.thinkingTokens?.length ?? 0);
        pollTimer = null;
        const s = useMarketPulseStore.getState();
        const enriched = { ...data.pulse, generatedAt: Date.now() };
        s.setPulseData(enriched);
        s.setStreaming(false);
        s.setLoading(false);
        activeAbort = null;
        return;
      }

      if (data.status === "none") {
        consecutiveNone++;
        // If server hasn't received the POST after 10 polls (20s), the request was lost
        if (consecutiveNone >= 10) {
          console.warn("[pulse] Server has no active generation after 20s — request may have been lost");
          pollTimer = null;
          activeAbort = null;
          const s = useMarketPulseStore.getState();
          s.setError("Request did not reach the server. Please try again.");
          s.setStreaming(false);
          s.setLoading(false);
          return;
        }
        // Show early connecting status so user sees something is happening
        if (consecutiveNone === 1) {
          useMarketPulseStore.getState().appendStatus("Connecting to AI engine...");
        }
      } else {
        consecutiveNone = 0;
      }

      if (data.status === "in_flight") {
        if (data.statusText) {
          useMarketPulseStore.getState().appendStatus(data.statusText);
        }
      }

    } catch (err) {
      console.warn("[pulse] Poll fetch failed:", err);
    }

    if (epoch === runEpoch) {
      pollTimer = setTimeout(poll, intervalMs);
    }
  };

  pollTimer = setTimeout(poll, 1000);
}
