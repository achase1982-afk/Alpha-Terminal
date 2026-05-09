import { Router, type IRouter, type Request, type Response } from "express";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { generateSpeech, sha256Hex } from "../lib/tts.js";
import {
  getDeskAudioChunkBuffer,
  startDeskAudioSession,
} from "../lib/deskAudioBuffer.js";

const router: IRouter = Router();

const CACHE_DIR = process.env.TTS_CACHE_DIR ?? "/tmp/tts-cache";

/** Bump when audio bytes format or TTS engine changes (invalidates on-disk MP3 cache). */
const CACHE_FILE_VERSION = "v5-edge";

function looksLikeMp3(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
  return buf.subarray(0, 3).toString("ascii") === "ID3";
}

function sanitizeClientTtsDetail(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const noKey = raw
    .replace(/\bAIza[0-9A-Za-z_-]{25,}\b/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, "[redacted]");
  const oneLine = noKey.replace(/\s+/g, " ").trim();
  if (!oneLine) return "Unknown error";
  return oneLine.length > 420 ? `${oneLine.slice(0, 417)}...` : oneLine;
}

type DeskVoiceConfigBody = { voice?: string };

function parseVoiceConfig(body: unknown): DeskVoiceConfigBody {
  const vc = body && typeof body === "object" && body !== null && "voiceConfig" in body ? (body as { voiceConfig?: unknown }).voiceConfig : undefined;
  if (!vc || typeof vc !== "object" || vc === null) {
    return {};
  }
  const voice = "voice" in vc && typeof (vc as { voice?: unknown }).voice === "string" ? (vc as { voice: string }).voice : undefined;
  return { voice };
}

async function sendBufferedChunk(req: Request, res: Response, sessionId: string, chunkIndex: number): Promise<void> {
  res.setHeader("Cache-Control", "private, max-age=600");
  try {
    const mp3 = await getDeskAudioChunkBuffer(sessionId, chunkIndex);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(mp3.length));
    res.send(mp3);
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    const httpStatus =
      err && typeof err === "object" && "httpStatus" in err && typeof (err as { httpStatus?: number }).httpStatus === "number"
        ? (err as { httpStatus: number }).httpStatus
        : undefined;
    if (code === "NOT_FOUND") {
      res.status(404).json({ error: "Desk audio session or chunk not found" });
      return;
    }
    if (code === "TIMEOUT") {
      res.status(504).json({
        error: "Desk audio chunk not ready in time",
        stage: "tts_chunk_buffer_wait_timeout",
        sessionId,
        chunkIndex,
      });
      return;
    }
    req.log?.error({ err, sessionId, chunkIndex }, "desk-audio buffered chunk failed");
    res.status(500).json({
      error: "Audio unavailable",
      stage: "tts_chunk_buffer_failed",
      sessionId,
      chunkIndex,
      httpStatus: httpStatus ?? null,
      detail: sanitizeClientTtsDetail(err),
    });
  }
}

router.get("/desk-audio", async (req, res): Promise<void> => {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
  const chunkRaw = req.query.chunkIndex;
  const chunkIndex =
    typeof chunkRaw === "string" && chunkRaw.trim() !== ""
      ? parseInt(chunkRaw, 10)
      : Array.isArray(chunkRaw) && typeof chunkRaw[0] === "string"
        ? parseInt(chunkRaw[0], 10)
        : NaN;

  if (!sessionId.trim()) {
    res.status(400).json({ error: "sessionId is required for GET /desk-audio" });
    return;
  }
  if (!Number.isFinite(chunkIndex)) {
    res.status(400).json({ error: "chunkIndex is required" });
    return;
  }

  await sendBufferedChunk(req, res, sessionId.trim(), chunkIndex);
});

router.post("/desk-audio/start", async (req, res): Promise<void> => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  const voiceConfig = parseVoiceConfig(req.body);
  try {
    const out = startDeskAudioSession(text, voiceConfig);
    res.json(out);
  } catch (err) {
    req.log?.error({ err }, "desk-audio start failed");
    res.status(500).json({ error: "Failed to start desk audio session" });
  }
});

router.post("/desk-audio", async (req, res): Promise<void> => {
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
  const chunkIndexRaw = req.body?.chunkIndex;
  const hasSession = sessionId.trim().length > 0;
  const hasChunk =
    typeof chunkIndexRaw === "number"
      ? true
      : typeof chunkIndexRaw === "string" && chunkIndexRaw.trim() !== "";

  if (hasSession || hasChunk) {
    if (!sessionId.trim() || !hasChunk) {
      res.status(400).json({ error: "sessionId and chunkIndex are both required for buffered chunk fetch" });
      return;
    }
    const chunkIndex = typeof chunkIndexRaw === "number" ? chunkIndexRaw : parseInt(String(chunkIndexRaw), 10);
    if (!Number.isFinite(chunkIndex)) {
      res.status(400).json({ error: "chunkIndex must be a number" });
      return;
    }
    await sendBufferedChunk(req, res, sessionId.trim(), chunkIndex);
    return;
  }

  const text = typeof req.body?.text === "string" ? req.body.text : "";
  const deskResultId = typeof req.body?.deskResultId === "string" ? req.body.deskResultId : "";
  if (!text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  if (!deskResultId.trim()) {
    res.status(400).json({ error: "deskResultId is required" });
    return;
  }

  const hash = sha256Hex(text);
  const cachePath = path.join(CACHE_DIR, `${CACHE_FILE_VERSION}-${hash}.mp3`);

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    try {
      await access(cachePath, fsConstants.R_OK);
      const cached = await readFile(cachePath);
      if (looksLikeMp3(cached)) {
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", String(cached.length));
        res.send(cached);
        return;
      }
      req.log?.warn({ cachePath, size: cached.length }, "tts cache file invalid, regenerating");
    } catch {
      /* cache miss */
    }

    const mp3 = await generateSpeech(text);
    try {
      await writeFile(cachePath, mp3);
    } catch (err) {
      req.log?.warn({ err }, "tts disk cache write failed");
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(mp3.length));
    res.send(mp3);
  } catch (err) {
    req.log?.error({ err }, "desk-audio TTS failed");
    res.status(502).json({
      error: "Audio unavailable",
      detail: sanitizeClientTtsDetail(err),
    });
  }
});

export default router;
