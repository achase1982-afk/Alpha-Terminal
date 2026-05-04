/**
 * Single-provider TTS adapter (Gemini API native audio / TTS).
 * Uses the same API key as the rest of the app (GEMINI_API_KEY / Google AI).
 * Swap implementations here only; routes should call `generateSpeech`.
 */

import { createHash } from "node:crypto";
import { Readable, PassThrough } from "node:stream";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { getGeminiApiKey, getGeminiGenerateContentBaseUrl } from "./geminiClient.js";

/** Gemini 3.1 Flash TTS Preview (Gemini API generateContent + AUDIO modality). */
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

type GeminiTtsResponse = {
  error?: { message?: string; code?: number; status?: string };
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; data?: string };
        text?: string;
      }>;
    };
  }>;
};

function extractAudioBase64(json: GeminiTtsResponse): string {
  const parts = json.candidates?.[0]?.content?.parts;
  if (!parts?.length) {
    const block = json.promptFeedback?.blockReason;
    if (block) {
      throw new Error(`TTS blocked: ${block}`);
    }
    throw new Error("TTS response missing candidates[0].content.parts");
  }
  for (const p of parts) {
    const d = p.inlineData?.data;
    if (d && typeof d === "string") return d;
  }
  throw new Error("TTS response has no inlineData audio part");
}

/**
 * Returns MP3 bytes (mono, ~64 kbps) for the given plain text.
 * Calls Gemini `generateContent` with AUDIO modality (not Cloud Text-to-Speech).
 */
export async function generateSpeech(text: string, opts?: { voice?: string }): Promise<Buffer> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key not configured (set GEMINI_API_KEY, GOOGLE_API_KEY, or AI_INTEGRATIONS_GEMINI_API_KEY)");
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("TTS text is empty");
  }

  const voiceName = opts?.voice?.trim() || DEFAULT_VOICE_NAME;
  const base = getGeminiGenerateContentBaseUrl();
  const url = `${base}/v1beta/models/${encodeURIComponent(GEMINI_TTS_MODEL)}:generateContent`;

  const spokenPrompt =
    "Read the following financial desk report aloud in a clear, neutral, professional tone. " +
    "Speak only the transcript; do not add commentary or meta-talk.\n\n" +
    trimmed;

  const body = {
    contents: [{ role: "user", parts: [{ text: spokenPrompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName,
          },
        },
      },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const rawText = await res.text();
  let json: GeminiTtsResponse;
  try {
    json = JSON.parse(rawText) as GeminiTtsResponse;
  } catch {
    throw new Error(`TTS invalid JSON (HTTP ${res.status}): ${rawText.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = json.error?.message ?? rawText.slice(0, 400);
    throw new Error(`Gemini TTS HTTP ${res.status}: ${msg}`);
  }
  if (json.error?.message) {
    throw new Error(json.error.message);
  }

  const b64 = extractAudioBase64(json);
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
