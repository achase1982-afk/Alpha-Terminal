import { describe, expect, it } from "vitest";
import {
  findAssistantReplyForUserTurn,
  isTransientChatNetworkError,
} from "../chatThreadRecovery";

describe("isTransientChatNetworkError", () => {
  it("detects WebKit load failed", () => {
    expect(isTransientChatNetworkError(new TypeError("Load failed"))).toBe(true);
  });

  it("ignores AbortError", () => {
    expect(isTransientChatNetworkError(new DOMException("aborted", "AbortError"))).toBe(false);
  });
});

describe("findAssistantReplyForUserTurn", () => {
  it("returns assistant after matching user turn", () => {
    const reply = findAssistantReplyForUserTurn(
      [
        { id: "u1", role: "user", content: "Hello" },
        { id: "a1", role: "assistant", content: "Hi there" },
        { id: "u2", role: "user", content: "Options flow?" },
        { id: "a2", role: "assistant", content: "Heavy call buying." },
      ],
      "Options flow?",
    );
    expect(reply?.id).toBe("a2");
    expect(reply?.content).toContain("call");
  });

  it("skips error and empty assistant rows", () => {
    const reply = findAssistantReplyForUserTurn(
      [
        { id: "u1", role: "user", content: "Q" },
        { id: "a1", role: "assistant", content: "**Error:** Connection lost" },
        { id: "a2", role: "assistant", content: "(No response generated)" },
      ],
      "Q",
    );
    expect(reply).toBeNull();
  });
});
