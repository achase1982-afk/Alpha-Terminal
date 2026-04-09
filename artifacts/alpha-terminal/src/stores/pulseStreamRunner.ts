import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useMarketPulseStore } from "./marketPulseStore";

const API_BASE = "/api";

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
    const elapsed = Date.now() - (activeAbort as any).__startedAt;
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
  (abort as any).__startedAt = Date.now();
  activeAbort = abort;

  console.log("[pulse] Starting generation (epoch", currentEpoch, ")");

  try {
    const postTimeout = AbortSignal.timeout(8000);
    const combined = AbortSignal.any([abort.signal, postTimeout]);

    const response = await fetchWithAuth(`${API_BASE}/ai/market-pulse/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: combined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    console.log("[pulse] POST accepted (status", response.status, ") — starting result polling");

  } catch (err: any) {
    if (abort.signal.aborted) {
      console.log("[pulse] Aborted");
      return;
    }
    console.warn("[pulse] POST finished/timed out:", err.message, "— will poll for result");
  }

  if (currentEpoch !== runEpoch) return;

  store.appendStatus("Generating AI analysis...");
  startResultPolling(currentEpoch);
}

function startResultPolling(epoch: number) {
  if (pollTimer) return;

  let attempts = 0;
  const maxAttempts = 60;
  const intervalMs = 2000;
  let lastThinkingLen = 0;

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
        s.setError(data.error || "Generation failed. Please try again.");
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

      if (data.statusText) {
        useMarketPulseStore.getState().appendStatus(data.statusText);
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
