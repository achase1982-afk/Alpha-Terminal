import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { fetchDeskTtsChunkBlob } from "@/lib/deskAudioApi";

export type DeskAudioSessionMeta = {
  sessionId: string;
  totalChunks: number;
};

export function parseDeskAudioStartResponse(payload: unknown, fallbackChunks: number): DeskAudioSessionMeta | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as { sessionId?: unknown; totalChunks?: unknown };
  if (typeof rec.sessionId !== "string" || !rec.sessionId.trim()) return null;
  const totalChunks =
    typeof rec.totalChunks === "number" && Number.isInteger(rec.totalChunks) && rec.totalChunks >= 1
      ? rec.totalChunks
      : Math.max(1, fallbackChunks);
  return { sessionId: rec.sessionId.trim(), totalChunks };
}

/** Start (or reuse) a desk-audio session without waiting for MP3 bytes. */
export async function startDeskAudioSession(
  text: string,
  voiceConfig: Record<string, unknown>,
  signal: AbortSignal,
  fallbackChunks: number,
): Promise<DeskAudioSessionMeta> {
  const res = await fetchWithAuth("/api/tts/desk-audio/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.trim(), voiceConfig }),
    signal,
    clerkTokenTimeoutMs: 8000,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const meta = parseDeskAudioStartResponse((await res.json()) as unknown, fallbackChunks);
  if (!meta) {
    throw new Error("invalid_start_response");
  }
  return meta;
}

/** Loads desk TTS chunks with optional prefetch of the next index. */
export class DeskAudioChunkLoader {
  private prefetch: { index: number; promise: Promise<Blob> } | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly signal: AbortSignal,
  ) {}

  prefetchChunk(index: number): void {
    if (index < 0) return;
    if (this.prefetch?.index === index) return;
    this.prefetch = { index, promise: fetchDeskTtsChunkBlob(this.sessionId, index, this.signal) };
  }

  async loadChunk(index: number): Promise<Blob> {
    if (this.prefetch?.index === index) {
      const promise = this.prefetch.promise;
      this.prefetch = null;
      return promise;
    }
    return fetchDeskTtsChunkBlob(this.sessionId, index, this.signal);
  }

  clearPrefetch(): void {
    this.prefetch = null;
  }
}

export function attachDeskAudioBlob(
  audio: HTMLAudioElement,
  blob: Blob,
  playbackRate: number,
): string {
  const url = URL.createObjectURL(blob);
  audio.src = url;
  audio.playbackRate = playbackRate;
  return url;
}
