/**
 * Single-provider TTS adapter (OpenAI Speech API → MP3 bytes).
 * Swap implementations here only; routes should call `generateSpeech`.
 *
 * Auth matches aiLabAnalystClient: prefer user OPENAI_API_KEY to api.openai.com;
 * else Replit-style AI_INTEGRATIONS_OPENAI_* proxy when configured.
 */

import { createHash } from "node:crypto";
import OpenAI from "openai";

const OPENAI_SPEECH_MAX_CHARS = 4096;

const TTS_TRUNCATION_SUFFIX = "\n\n[truncated for TTS length limit]";

/** Default TTS model (OpenAI); override with OPENAI_TTS_MODEL. */
const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";

/**
 * Default voice: **alloy** — neutral; change via OPENAI_TTS_VOICE or opts.voice.
 * Other built-ins: ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar, …
 */
const DEFAULT_VOICE = "alloy";

function getOpenAIForSpeech(): OpenAI {
  const directKey = process.env.OPENAI_API_KEY?.trim();
  if (directKey) {
    return new OpenAI({ apiKey: directKey, timeout: 5 * 60 * 1000 });
  }
  const intKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();
  if (intKey && baseURL) {
    return new OpenAI({ apiKey: intKey, baseURL, timeout: 5 * 60 * 1000 });
  }
  throw new Error(
    "OpenAI not configured for speech (set OPENAI_API_KEY, or AI_INTEGRATIONS_OPENAI_API_KEY + AI_INTEGRATIONS_OPENAI_BASE_URL)",
  );
}

function clipSpeechInput(text: string): string {
  const t = text.trim();
  if (t.length <= OPENAI_SPEECH_MAX_CHARS) return t;
  return `${t.slice(0, OPENAI_SPEECH_MAX_CHARS - TTS_TRUNCATION_SUFFIX.length)}${TTS_TRUNCATION_SUFFIX}`;
}

/**
 * Returns MP3 bytes for the given plain text (mono, bitrate set by OpenAI for the chosen model).
 */
export async function generateSpeech(text: string, opts?: { voice?: string }): Promise<Buffer> {
  const client = getOpenAIForSpeech();
  const model = (process.env.OPENAI_TTS_MODEL ?? DEFAULT_TTS_MODEL).trim() || DEFAULT_TTS_MODEL;
  const voice = (opts?.voice?.trim() || process.env.OPENAI_TTS_VOICE?.trim() || DEFAULT_VOICE).toLowerCase();

  const input = clipSpeechInput(text);
  if (!input) {
    throw new Error("TTS text is empty");
  }

  const response = await client.audio.speech.create({
    model,
    voice,
    input,
    response_format: "mp3",
  });

  const buf = Buffer.from(await response.arrayBuffer());
  if (!buf.length) {
    throw new Error("OpenAI speech response was empty");
  }
  return buf;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
