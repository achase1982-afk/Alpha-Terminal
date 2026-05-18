import { describe, expect, it } from "vitest";
import { resolveAiChatContextSymbol } from "../aiChatContextPack.js";

describe("resolveAiChatContextSymbol tape jargon", () => {
  it("keeps page symbol when the user asks about the tape (not ticker TAPE)", () => {
    expect(resolveAiChatContextSymbol("NOW", "What's the tape looking like?")).toBe("NOW");
  });
});
