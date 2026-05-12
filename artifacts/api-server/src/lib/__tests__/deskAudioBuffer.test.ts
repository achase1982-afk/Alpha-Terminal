import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mp3ish = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

vi.mock("../tts.js", () => ({
  generateSpeech: vi.fn().mockImplementation(async () => mp3ish),
  sha256Hex: (input: string) => createHash("sha256").update(input, "utf8").digest("hex"),
}));

import { generateSpeech } from "../tts.js";
import { startDeskAudioSession, releaseSession } from "../deskAudioBuffer.js";

describe("deskAudioBuffer", () => {
  beforeEach(() => {
    vi.mocked(generateSpeech).mockClear();
  });

  it("reuses session id for same text+voice hash", () => {
    const text = "Alpha. Beta. Gamma.";
    const a = startDeskAudioSession(text, {});
    const b = startDeskAudioSession(text, {});
    expect(b.sessionId).toBe(a.sessionId);
    releaseSession(a.sessionId);
  });

  it("mints new session when voice changes", () => {
    const text = "Same script.";
    const a = startDeskAudioSession(text, {});
    const b = startDeskAudioSession(text, { voice: "verse" });
    expect(b.sessionId).not.toBe(a.sessionId);
    releaseSession(a.sessionId);
    releaseSession(b.sessionId);
  });
});
