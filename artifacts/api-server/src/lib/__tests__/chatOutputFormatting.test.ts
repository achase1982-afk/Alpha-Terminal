import { describe, expect, it } from "vitest";
import {
  createChatOutputFormattingStream,
  formatChatOutputText,
  transformChatOutputLine,
} from "../chatOutputFormatting.js";

describe("transformChatOutputLine", () => {
  it("replaces an em dash with a comma and correct spacing", () => {
    expect(transformChatOutputLine("Risk is elevated — trim size")).toBe(
      "Risk is elevated, trim size",
    );
    expect(transformChatOutputLine("one—two")).toBe("one, two");
  });

  it("replaces an en dash in a numeric range with a hyphen", () => {
    expect(transformChatOutputLine("Target 5–10% move")).toBe("Target 5-10% move");
  });

  it("removes a line of only dashes", () => {
    const stream = createChatOutputFormattingStream();
    expect(stream.push("intro\n---\noutro\n")).toBe("intro\n\noutro\n");
    expect(stream.flush()).toBe("");
  });

  it("leaves hyphens inside short-dated and vol/OI intact", () => {
    expect(transformChatOutputLine("Prefer short-dated calls; watch vol/OI.")).toBe(
      "Prefer short-dated calls; watch vol/OI.",
    );
  });

  it("strips emoji", () => {
    expect(transformChatOutputLine("Headline ✅ and 🚀 momentum")).toBe(
      "Headline  and  momentum",
    );
  });
});

describe("formatChatOutputText", () => {
  it("leaves fenced code blocks untouched", () => {
    const input = "Summary line\n\n```python\nx = 1  # 🎉\nprint('5–10')\n```\n\nAfter.";
    expect(formatChatOutputText(input)).toBe(
      "Summary line\n\n```python\nx = 1  # 🎉\nprint('5–10')\n```\n\nAfter.",
    );
  });
});

describe("createChatOutputFormattingStream", () => {
  it("catches a dash divider split across chunks", () => {
    const stream = createChatOutputFormattingStream();
    expect(stream.push("--")).toBe("");
    expect(stream.push("-")).toBe("");
    expect(stream.flush()).toBe("");
  });

  it("streams prose incrementally", () => {
    const stream = createChatOutputFormattingStream();
    expect(stream.push("Hel")).toBe("Hel");
    expect(stream.push("lo")).toBe("lo");
    expect(stream.flush()).toBe("");
  });
});
