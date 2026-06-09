import { describe, expect, it } from "vitest";
import { chatLongWaitHint, chatModelShortLabel, formatChatModelListShort } from "./chatModelUi";

describe("chatModelShortLabel", () => {
  it("shortens catalog models for status copy", () => {
    expect(chatModelShortLabel("claude-fable-5")).toBe("Fable 5");
    expect(chatModelShortLabel("claude-opus-4-8")).toBe("Opus 4.8");
    expect(chatModelShortLabel("gemini-3.5-flash")).toBe("Gemini 3.5 Flash");
    expect(chatModelShortLabel("gpt-5.5")).toBe("ChatGPT 5.5");
  });
});

describe("chatLongWaitHint", () => {
  it("names the active single model", () => {
    const hint = chatLongWaitHint({ elapsedSec: 30, modelId: "claude-fable-5" });
    expect(hint).toContain("Fable 5");
    expect(hint).not.toContain("Opus");
  });

  it("lists all multi-agent models", () => {
    const hint = chatLongWaitHint({
      elapsedSec: 45,
      multiAgentModels: ["claude-fable-5", "gemini-3.5-flash", "gpt-5.5"],
    });
    expect(hint).toContain("Fable 5, Gemini 3.5 Flash, and ChatGPT 5.5");
  });
});

describe("formatChatModelListShort", () => {
  it("joins two models with and", () => {
    expect(formatChatModelListShort(["gemini-3.5-flash", "gpt-5.5"])).toBe(
      "Gemini 3.5 Flash and ChatGPT 5.5",
    );
  });
});
