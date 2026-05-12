/**
 * Desk / legacy TTS: Microsoft Edge–compatible online neural speech via `node-edge-tts`
 * (no API key; subject to Microsoft service availability and their terms of use).
 *
 * Optional env: `EDGE_TTS_VOICE`, `EDGE_TTS_LANG`, `EDGE_TTS_TIMEOUT_MS`.
 * Short strategist voice ids (e.g. alloy, verse) map to English neural voices below.
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EdgeTTS } from "node-edge-tts";

const SPEECH_MAX_CHARS = 4096;

function clipSpeechInput(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 20)}\n\n[truncated for TTS length limit]`;
}

/** Map short strategist voice ids to Edge neural voices (English). */
const SHORT_VOICE_TO_EDGE: Record<string, string> = {
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
  return SHORT_VOICE_TO_EDGE[lower] ?? process.env.EDGE_TTS_VOICE?.trim() ?? "en-US-AriaNeural";
}

function langFromEdgeVoice(voice: string): string {
  const parts = voice.split("-");
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return process.env.EDGE_TTS_LANG?.trim() || "en-US";
}

/**
 * Returns MP3 bytes for the given plain text (mono MP3).
 */
export async function generateSpeech(text: string, opts?: { voice?: string }): Promise<Buffer> {
  const input = clipSpeechInput(text, SPEECH_MAX_CHARS);
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

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}
