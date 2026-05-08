/**
 * TTS adapter for desk / legacy routes.
 *
 * Providers:
 * - **openai** — OpenAI Speech API (billed per character).
 * - **edge** — Microsoft Edge–compatible online neural TTS via `node-edge-tts` (no API key;
 *   subject to Microsoft service availability and their terms of use).
 *
 * **TTS_PROVIDER**
 * - `edge` — Always use Edge (free API spend).
 * - `openai` — Always use OpenAI (throws if not configured).
 * - Unset — **auto**: OpenAI when `OPENAI_API_KEY` or integrations proxy env is set, otherwise Edge.
 *
 * To keep `OPENAI_API_KEY` for chat/models but stop paying for speech, set **`TTS_PROVIDER=edge`**.
 *
 * Edge tuning (optional): `EDGE_TTS_VOICE`, `EDGE_TTS_LANG`, `EDGE_TTS_TIMEOUT_MS`.
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import { EdgeTTS } from "node-edge-tts";

const OPENAI_SPEECH_MAX_CHARS = 4096;
const EDGE_SPEECH_MAX_CHARS = 4096;

/** Default TTS model (OpenAI); override with OPENAI_TTS_MODEL. */
const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";

/** Default OpenAI voice; override with OPENAI_TTS_VOICE. */
const DEFAULT_OPENAI_VOICE = "alloy";

export type TtsProviderId = "openai" | "edge";

function hasOpenAiSpeechConfigured(): boolean {
  const directKey = process.env.OPENAI_API_KEY?.trim();
  if (directKey) return true;
  const intKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.trim();
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL?.trim();
  return !!(intKey && baseURL);
}

export function resolveTtsProvider(): TtsProviderId {
  const raw = process.env.TTS_PROVIDER?.trim().toLowerCase();
  if (raw === "edge") return "edge";
  if (raw === "openai") return "openai";
  return hasOpenAiSpeechConfigured() ? "openai" : "edge";
}

/** Disk cache segment so OpenAI vs Edge never reuse each other's MP3 bytes. */
export function getTtsDiskCacheProfile(): string {
  return resolveTtsProvider();
}

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

function clipSpeechInput(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 20)}\n\n[truncated for TTS length limit]`;
}

/** Map OpenAI built-in voice ids to Edge neural voices (English). */
const OPENAI_VOICE_TO_EDGE: Record<string, string> = {
  alloy: "en-US-AriaNeural",
  ash: "en-US-AndrewNeural",
  ballad: "en-US-JennyNeural",
  coral: "en-US-AvaNeural",
  echo: "en-US-GuyNeural",
  sage: "en-US-JaneNeural",
  shimmer: "en-US-JennyNeural",
  verse: "en-US-DavisNeural",
  marin: "en-US-JennyNeural",
  cedar: "en-US-EricNeural",
};

function edgeVoiceFromOpts(opts?: { voice?: string }): string {
  const raw = opts?.voice?.trim();
  if (!raw) {
    return process.env.EDGE_TTS_VOICE?.trim() || "en-US-AriaNeural";
  }
  const lower = raw.toLowerCase();
  if (raw.includes("-") && lower.includes("neural")) {
    return raw;
  }
  return OPENAI_VOICE_TO_EDGE[lower] ?? process.env.EDGE_TTS_VOICE?.trim() ?? "en-US-AriaNeural";
}

function langFromEdgeVoice(voice: string): string {
  const parts = voice.split("-");
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return process.env.EDGE_TTS_LANG?.trim() || "en-US";
}

async function generateSpeechEdge(text: string, opts?: { voice?: string }): Promise<Buffer> {
  const input = clipSpeechInput(text, EDGE_SPEECH_MAX_CHARS);
  if (!input) {
    throw new Error("TTS text is empty");
  }

  const voice = edgeVoiceFromOpts(opts);
  const lang = langFromEdgeVoice(voice);
  const timeoutMs = Number(process.env.EDGE_TTS_TIMEOUT_MS ?? "120000");
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000;

  const tts = new EdgeTTS({
    voice,
    lang,
    outputFormat: "audio-24khz-96kbitrate-mono-mp3",
    saveSubtitles: false,
    timeout,
  });

  const dir = await mkdtemp(join(tmpdir(), "desk-tts-"));
  const outPath = join(dir, "out.mp3");
  try {
    await tts.ttsPromise(input, outPath);
    const buf = await readFile(outPath);
    if (!buf.length) {
      throw new Error("Edge TTS response was empty");
    }
    return buf;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function generateSpeechOpenAI(text: string, opts?: { voice?: string }): Promise<Buffer> {
  const client = getOpenAIForSpeech();
  const model = (process.env.OPENAI_TTS_MODEL ?? DEFAULT_TTS_MODEL).trim() || DEFAULT_TTS_MODEL;
  const voice = (opts?.voice?.trim() || process.env.OPENAI_TTS_VOICE?.trim() || DEFAULT_OPENAI_VOICE).toLowerCase();

  const input = clipSpeechInput(text, OPENAI_SPEECH_MAX_CHARS);
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

/**
 * Returns MP3 bytes for the given plain text (mono MP3).
 */
export async function generateSpeech(text: string, opts?: { voice?: string }): Promise<Buffer> {
  const provider = resolveTtsProvider();
  if (provider === "edge") {
    return generateSpeechEdge(text, opts);
  }
  return generateSpeechOpenAI(text, opts);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
