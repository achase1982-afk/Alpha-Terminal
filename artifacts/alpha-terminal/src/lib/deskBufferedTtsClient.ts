import { fetchWithAuth } from "@/lib/fetchWithAuth";

export async function emitDeskTtsClientEvent(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetchWithAuth("/api/telemetry/client-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      clerkTokenTimeoutMs: 8000,
    });
  } catch {
    /* best-effort */
  }
}

function deskTtsChunkUrl(sessionId: string, chunkIndex: number): string {
  return `/api/tts/desk-audio?sessionId=${encodeURIComponent(sessionId)}&chunkIndex=${chunkIndex}`;
}

export async function fetchDeskTtsChunkBlob(sessionId: string, chunkIndex: number, signal: AbortSignal): Promise<Blob> {
  let lastError: Error | null = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchWithAuth(deskTtsChunkUrl(sessionId, chunkIndex), { signal, clerkTokenTimeoutMs: 8000 });
      if (!res.ok) {
        let httpStatus = res.status;
        try {
          const j = (await res.clone().json()) as { httpStatus?: number; stage?: string };
          if (typeof j.httpStatus === "number") httpStatus = j.httpStatus;
        } catch {
          /* ignore */
        }
        const err = new Error(`HTTP ${res.status}`) as Error & { httpStatus?: number };
        err.httpStatus = httpStatus;
        throw err;
      }
      return await res.blob();
    } catch (err) {
      lastError = err as Error;
      const httpStatus =
        err && typeof err === "object" && "httpStatus" in err && typeof (err as { httpStatus?: number }).httpStatus === "number"
          ? (err as { httpStatus: number }).httpStatus
          : undefined;
      const isLast = i === 2;
      const stage = isLast ? "tts_chunk_user_retry_prompt" : "tts_chunk_silent_retry";
      void emitDeskTtsClientEvent({
        stage,
        chunkIndex,
        attemptNumber: i + 1,
        httpStatus: httpStatus ?? null,
        detail: lastError.message,
      });
      if (isLast) break;
      await new Promise((r) => setTimeout(r, i === 0 ? 200 : 600));
    }
  }
  throw lastError;
}

/** Fetch chunks in small parallel batches to avoid slamming the API; concatenate MP3 bytes (valid for sequential MPEG frames). */
const MERGED_CHUNK_FETCH_CONCURRENCY = 4;

export async function fetchAllDeskTtsChunksMerged(
  sessionId: string,
  totalChunks: number,
  signal: AbortSignal,
): Promise<Blob> {
  if (!Number.isInteger(totalChunks) || totalChunks < 1) {
    throw new Error("invalid_total_chunks");
  }
  if (totalChunks === 1) {
    return fetchDeskTtsChunkBlob(sessionId, 0, signal);
  }
  const parts: Blob[] = [];
  for (let start = 0; start < totalChunks; start += MERGED_CHUNK_FETCH_CONCURRENCY) {
    const end = Math.min(start + MERGED_CHUNK_FETCH_CONCURRENCY, totalChunks);
    const batch: Blob[] = await Promise.all(
      Array.from({ length: end - start }, (_, k) => fetchDeskTtsChunkBlob(sessionId, start + k, signal)),
    );
    parts.push(...batch);
  }
  return new Blob(parts, { type: "audio/mpeg" });
}
