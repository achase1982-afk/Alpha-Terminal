import { Router, type IRouter } from "express";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { generateSpeech, sha256Hex } from "../lib/tts.js";

const router: IRouter = Router();

const CACHE_DIR = process.env.TTS_CACHE_DIR ?? "/tmp/tts-cache";

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
  const cachePath = path.join(CACHE_DIR, `${hash}.mp3`);

  try {
    await mkdir(CACHE_DIR, { recursive: true });
    try {
      await access(cachePath, fsConstants.R_OK);
      const cached = await readFile(cachePath);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", String(cached.length));
      res.send(cached);
      return;
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
    res.status(502).json({ error: "Audio unavailable" });
  }
});

export default router;
