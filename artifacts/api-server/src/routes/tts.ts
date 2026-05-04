import { Router, type IRouter } from "express";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { generateSpeech, sha256Hex } from "../lib/tts.js";
import { logFailure } from "../lib/telemetry.js";

const router: IRouter = Router();

const CACHE_DIR = process.env.TTS_CACHE_DIR ?? "/tmp/tts-cache";

/** Bump when audio bytes format or provider changes so stale cache files are ignored. */
const CACHE_FILE_VERSION = "v3-openai";

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

router.post("/desk-audio", async (req, res): Promise<void> => {
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
    const detail = sanitizeClientTtsDetail(err);
    void logFailure("STRATEGIST", "ERROR", "Desk audio TTS: server synthesis failed", {
      route: "POST /api/tts/desk-audio",
      deskResultId: deskResultId.trim(),
      textChars: text.length,
      detail,
    });
    res.status(502).json({
      error: "Audio unavailable",
      detail,
    });
  }
});

export default router;
