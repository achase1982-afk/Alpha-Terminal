import { describe, expect, it } from "vitest";
import { splitDeskAudioTextIntoChunks, DESK_AUDIO_CHUNK_MAX_CHARS } from "../deskAudioChunking.js";

describe("splitDeskAudioTextIntoChunks", () => {
  it("returns empty for blank", () => {
    expect(splitDeskAudioTextIntoChunks("   ")).toEqual([]);
  });

  it("keeps short text as one chunk", () => {
    expect(splitDeskAudioTextIntoChunks("Hello world.")).toEqual(["Hello world."]);
  });

  it("splits very long text into multiple chunks under max size", () => {
    const para = "Hello world. ".repeat(200);
    const chunks = splitDeskAudioTextIntoChunks(para);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(DESK_AUDIO_CHUNK_MAX_CHARS);
    }
  });

  it("splits when second sentence is far after padding", () => {
    const s1 = "First sentence here. ";
    const s2 = "Second sentence is longer and should flow. ";
    const pad = "word ".repeat(80);
    const t = (s1 + pad + s2).trim();
    const chunks = splitDeskAudioTextIntoChunks(t);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain("First sentence");
  });
});
