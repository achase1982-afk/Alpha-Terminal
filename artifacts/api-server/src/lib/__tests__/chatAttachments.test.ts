import { describe, expect, it } from "vitest";
import { buildUserModelContent, sanitizeChatAttachments } from "../chatAttachments.js";

describe("sanitizeChatAttachments", () => {
  it("keeps valid image attachment", () => {
    const out = sanitizeChatAttachments([
      { id: "a1", name: "x.png", mimeType: "image/png", kind: "image", data: "abc" },
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("buildUserModelContent", () => {
  it("returns plain string for text-only", () => {
    expect(buildUserModelContent("hello", [])).toBe("hello");
  });

  it("returns parts for images", () => {
    const content = buildUserModelContent("see", [
      { id: "1", name: "a.png", mimeType: "image/png", kind: "image", data: "abc" },
    ]);
    expect(Array.isArray(content)).toBe(true);
  });
});
