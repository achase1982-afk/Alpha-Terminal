import { randomUUID } from "node:crypto";
import pLimit from "p-limit";
import { generateSpeech, resolveTtsProvider, sha256Hex } from "./tts.js";
import { splitDeskAudioTextIntoChunks } from "./deskAudioChunking.js";
import { logFailure } from "./telemetry.js";

export type DeskVoiceConfig = { voice?: string };

type ChunkStatus = "pending" | "ready" | "failed";

type ChunkEntry = {
  status: ChunkStatus;
  buffer?: Buffer;
  error?: string;
  settled: Promise<void>;
  resolveSettled: () => void;
  /** One extra on-demand generation from `getDeskAudioChunkBuffer` after worker failure. */
  getRetryUsed: boolean;
};

type Session = {
  sessionId: string;
  chunks: Map<number, ChunkEntry>;
  chunkTexts: string[];
  totalChunks: number;
  createdAt: number;
  lastAccessedAt: number;
  textHash: string;
  voiceConfig: DeskVoiceConfig;
};

const SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 50;
const CHUNK_GEN_CONCURRENCY = 3;
const GET_CHUNK_WAIT_MS = 8000;
const SPEECH_RETRY_DELAYS_MS = [500, 1500, 4000] as const;

const sessions = new Map<string, Session>();
const hashToSessionId = new Map<string, string>();

function clock(): number {
  return Date.now();
}

function touchSession(s: Session): void {
  s.lastAccessedAt = clock();
}

function isExpired(s: Session): boolean {
  return clock() - s.lastAccessedAt > SESSION_TTL_MS;
}

function evictSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.delete(sessionId);
  if (hashToSessionId.get(s.textHash) === sessionId) {
    hashToSessionId.delete(s.textHash);
  }
}

function pruneExpired(): void {
  for (const id of [...sessions.keys()]) {
    const s = sessions.get(id);
    if (s && isExpired(s)) {
      evictSession(id);
    }
  }
}

function evictLruOne(): void {
  let oldest: Session | null = null;
  for (const s of sessions.values()) {
    if (!oldest || s.lastAccessedAt < oldest.lastAccessedAt) {
      oldest = s;
    }
  }
  if (oldest) {
    evictSession(oldest.sessionId);
  }
}

function makeChunkEntry(): ChunkEntry {
  let resolveSettled!: () => void;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  return {
    status: "pending",
    settled,
    resolveSettled,
    getRetryUsed: false,
  };
}

function getHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const st = (err as { status?: number }).status;
    if (typeof st === "number" && Number.isFinite(st)) return st;
  }
  return undefined;
}

function isRetryableSpeechError(err: unknown): boolean {
  const status = getHttpStatus(err);
  if (status === 429) return true;
  if (status !== undefined && status >= 500 && status < 600) return true;
  if (err instanceof TypeError) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("socket") ||
    msg.includes("enotfound")
  ) {
    return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** 3 attempts with backoff 500 / 1500 / 4000 ms between failures (429/5xx/network). */
export async function generateSpeechWithBackoff(text: string, voiceConfig: DeskVoiceConfig): Promise<Buffer> {
  const maxAttempts = 1 + SPEECH_RETRY_DELAYS_MS.length;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await generateSpeech(text, { voice: voiceConfig.voice });
    } catch (err) {
      lastErr = err;
      const isLast = attempt === maxAttempts - 1;
      if (isLast || !isRetryableSpeechError(err)) {
        throw err;
      }
      const delay = SPEECH_RETRY_DELAYS_MS[attempt] ?? 4000;
      await sleep(delay);
    }
  }
  throw lastErr;
}

function deskAudioTextHash(text: string, voiceConfig: DeskVoiceConfig): string {
  return sha256Hex(`${resolveTtsProvider()}::${text}::${JSON.stringify(voiceConfig)}`);
}

async function runChunkWorker(sessionId: string, chunkIndex: number, chunkText: string, voiceConfig: DeskVoiceConfig): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  const entry = session.chunks.get(chunkIndex);
  if (!entry || entry.status !== "pending") return;

  try {
    const buf = await generateSpeechWithBackoff(chunkText, voiceConfig);
    entry.buffer = buf;
    entry.status = "ready";
    entry.error = undefined;
    entry.resolveSettled();
  } catch (err) {
    entry.status = "failed";
    entry.error = err instanceof Error ? err.message : String(err);
    entry.resolveSettled();

    void logFailure("STRATEGIST", "WARN", "Desk TTS chunk generation failed after retries", {
      stage: "tts_chunk_generation_failed",
      sessionId,
      chunkIndex,
      httpStatus: getHttpStatus(err) ?? null,
      attemptCount: 1 + SPEECH_RETRY_DELAYS_MS.length,
      error: entry.error,
    });
  }
}

/**
 * Starts (or reuses) a buffered desk-audio session. Does not wait for chunk bytes.
 */
export function startDeskAudioSession(text: string, voiceConfig: DeskVoiceConfig): {
  sessionId: string;
  totalChunks: number;
  firstChunkUrl: string;
} {
  pruneExpired();

  const trimmed = text.trim();
  const textHash = deskAudioTextHash(trimmed, voiceConfig);
  const existingId = hashToSessionId.get(textHash);
  if (existingId) {
    const existing = sessions.get(existingId);
    if (existing && !isExpired(existing)) {
      touchSession(existing);
      return {
        sessionId: existing.sessionId,
        totalChunks: existing.totalChunks,
        firstChunkUrl: `/api/tts/desk-audio?sessionId=${encodeURIComponent(existing.sessionId)}&chunkIndex=0`,
      };
    }
    hashToSessionId.delete(textHash);
  }

  while (sessions.size >= MAX_SESSIONS) {
    evictLruOne();
  }

  let chunkTexts = splitDeskAudioTextIntoChunks(trimmed);
  if (chunkTexts.length === 0 && trimmed) {
    chunkTexts = [trimmed];
  }
  if (chunkTexts.length === 0) {
    chunkTexts = [""];
  }

  const sessionId = randomUUID();
  const t = clock();
  const chunks = new Map<number, ChunkEntry>();
  for (let i = 0; i < chunkTexts.length; i++) {
    chunks.set(i, makeChunkEntry());
  }

  const session: Session = {
    sessionId,
    chunks,
    chunkTexts,
    totalChunks: chunkTexts.length,
    createdAt: t,
    lastAccessedAt: t,
    textHash,
    voiceConfig: { ...voiceConfig },
  };
  sessions.set(sessionId, session);
  hashToSessionId.set(textHash, sessionId);

  const limit = pLimit(CHUNK_GEN_CONCURRENCY);
  for (let i = 0; i < chunkTexts.length; i++) {
    const idx = i;
    const chunkText = chunkTexts[i] ?? "";
    void limit(() => runChunkWorker(sessionId, idx, chunkText, session.voiceConfig));
  }

  return {
    sessionId,
    totalChunks: session.totalChunks,
    firstChunkUrl: `/api/tts/desk-audio?sessionId=${encodeURIComponent(sessionId)}&chunkIndex=0`,
  };
}

async function awaitChunkSettled(entry: ChunkEntry, ms: number): Promise<void> {
  await Promise.race([
    entry.settled,
    sleep(ms).then(() => {
      throw new Error("desk_audio_chunk_timeout");
    }),
  ]);
}

function resetChunkToPending(entry: ChunkEntry): void {
  entry.status = "pending";
  entry.buffer = undefined;
  entry.error = undefined;
  let resolveSettled!: () => void;
  entry.settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  entry.resolveSettled = resolveSettled;
}

/**
 * Returns MP3 bytes for a buffered chunk; may wait up to `GET_CHUNK_WAIT_MS` while pending.
 * If the worker marked the chunk failed, performs one on-demand retry (same backoff policy) before erroring.
 */
export async function getDeskAudioChunkBuffer(sessionId: string, chunkIndex: number): Promise<Buffer> {
  pruneExpired();
  const session = sessions.get(sessionId);
  if (!session) {
    throw Object.assign(new Error("session_not_found"), { code: "NOT_FOUND" as const });
  }
  touchSession(session);

  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    throw Object.assign(new Error("chunk_index_out_of_range"), { code: "NOT_FOUND" as const });
  }

  const entry = session.chunks.get(chunkIndex);
  if (!entry) {
    throw Object.assign(new Error("chunk_missing"), { code: "NOT_FOUND" as const });
  }

  const chunkText = session.chunkTexts[chunkIndex] ?? "";

  if (entry.status === "pending") {
    try {
      await awaitChunkSettled(entry, GET_CHUNK_WAIT_MS);
    } catch {
      throw Object.assign(new Error("desk_audio_chunk_wait_timeout"), { code: "TIMEOUT" as const });
    }
  }

  if (entry.status === "ready" && entry.buffer) {
    return entry.buffer;
  }

  if (entry.status === "failed" && !entry.getRetryUsed) {
    entry.getRetryUsed = true;
    resetChunkToPending(entry);
    try {
      const buf = await generateSpeechWithBackoff(chunkText, session.voiceConfig);
      entry.buffer = buf;
      entry.status = "ready";
      entry.error = undefined;
      entry.resolveSettled();
      return buf;
    } catch (err) {
      entry.status = "failed";
      entry.error = err instanceof Error ? err.message : String(err);
      entry.resolveSettled();
      void logFailure("STRATEGIST", "WARN", "Desk TTS chunk getChunk on-demand retry failed", {
        stage: "tts_chunk_generation_failed",
        sessionId,
        chunkIndex,
        httpStatus: getHttpStatus(err) ?? null,
        attemptCount: 1 + SPEECH_RETRY_DELAYS_MS.length,
        error: entry.error,
        source: "getChunk_retry",
      });
      throw Object.assign(new Error(entry.error ?? "chunk_failed"), {
        code: "CHUNK_FAILED" as const,
        httpStatus: getHttpStatus(err),
      });
    }
  }

  throw Object.assign(new Error(entry.error ?? "chunk_failed"), {
    code: "CHUNK_FAILED" as const,
  });
}

export function releaseSession(sessionId: string): void {
  evictSession(sessionId);
}
