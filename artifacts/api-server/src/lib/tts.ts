/**
 * Single-provider TTS adapter (Google Cloud Text-to-Speech, Gemini TTS model).
 * Swap implementations here only; routes should call `generateSpeech`.
 */

import { createHash } from "node:crypto";
import { Readable, PassThrough } from "node:stream";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { getGeminiApiKey } from "./geminiClient.js";

const TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";

/** Gemini 3.1 Flash TTS Preview on Cloud TTS (global region). */
const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";

/**
 * Default voice: **Charon** — neutral, informative (professional desk read).
 * Alternatives: Kore (firm), Leda (youthful). Change only in this file.
 */
const DEFAULT_VOICE_NAME = "Charon";

const PCM_SAMPLE_RATE = 24000;

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

function pcm16MonoToMp3(pcm: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const inputStream = Readable.from(pcm);
    const out = new PassThrough();
    out.on("data", (c: Buffer) => {
      chunks.push(c);
    });
    out.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    out.on("error", reject);
    ffmpeg(inputStream)
      .inputOptions(["-f", "s16le", `-ar`, String(PCM_SAMPLE_RATE), "-ac", "1"])
      .audioCodec("libmp3lame")
      .audioBitrate("64k")
      .audioChannels(1)
      .format("mp3")
      .on("error", reject)
      .pipe(out, { end: true });
  });
}

/**
 * Returns MP3 bytes (mono, ~64 kbps) for the given plain text.
 */
export async function generateSpeech(text: string, opts?: { voice?: string }): Promise<Buffer> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key not configured (set GEMINI_API_KEY, GOOGLE_API_KEY, or AI_INTEGRATIONS_GEMINI_API_KEY for Cloud TTS)");
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("TTS text is empty");
  }

  const voiceName = opts?.voice?.trim() || DEFAULT_VOICE_NAME;

  const body = {
    input: {
      prompt:
        "Read the following financial desk report aloud in a clear, neutral, professional tone. Speak only the report content; do not add commentary.",
      text: trimmed,
    },
    voice: {
      languageCode: "en-US",
      name: voiceName,
      modelName: GEMINI_TTS_MODEL,
    },
    audioConfig: {
      audioEncoding: "LINEAR16",
      sampleRateHertz: PCM_SAMPLE_RATE,
    },
  };

  const url = `${TTS_ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Cloud TTS HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }

  const json = (await res.json()) as { audioContent?: string; error?: { message?: string } };
  if (json.error?.message) {
    throw new Error(json.error.message);
  }
  const b64 = json.audioContent;
  if (!b64 || typeof b64 !== "string") {
    throw new Error("Cloud TTS response missing audioContent");
  }

  const pcm = Buffer.from(b64, "base64");
  const isWav = pcm.length >= 12 && pcm.toString("ascii", 0, 4) === "RIFF" && pcm.toString("ascii", 8, 12) === "WAVE";
  if (isWav) {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const inputStream = Readable.from(pcm);
      const out = new PassThrough();
      out.on("data", (c: Buffer) => chunks.push(c));
      out.on("end", () => resolve(Buffer.concat(chunks)));
      out.on("error", reject);
      ffmpeg(inputStream)
        .inputFormat("wav")
        .audioCodec("libmp3lame")
        .audioBitrate("64k")
        .audioChannels(1)
        .format("mp3")
        .on("error", reject)
        .pipe(out, { end: true });
    });
  }
  return pcm16MonoToMp3(pcm);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
