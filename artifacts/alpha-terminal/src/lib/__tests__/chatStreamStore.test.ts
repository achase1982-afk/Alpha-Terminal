import { describe, expect, it } from "vitest";
import {
  mergeChatDisplayMessages,
  type ChatThreadStreamState,
  type ChatUiMessage,
} from "../chatStreamStore";

function stream(partial: Partial<ChatThreadStreamState>): ChatThreadStreamState {
  return {
    threadId: "t1",
    symbol: "GS",
    abortController: null,
    activeSendId: "send-1",
    isStreaming: true,
    inFlightAssistant: { id: "a1", content: "", complete: false },
    pendingUserMessages: [],
    toolPills: [],
    activeMultiAgentCount: 0,
    lastFailedMessage: null,
    ...partial,
  };
}

describe("mergeChatDisplayMessages", () => {
  it("does not duplicate the first user turn when server transcript arrives", () => {
    const persisted: ChatUiMessage[] = [
      { id: "server-user-1", role: "user", content: "What's going on with Goldman" },
    ];
    const merged = mergeChatDisplayMessages(persisted, stream({
      pendingUserMessages: [
        { id: "client-user-1", role: "user", content: "What's going on with Goldman" },
      ],
    }));
    expect(merged.filter((m) => m.role === "user")).toHaveLength(1);
    expect(merged[0]?.id).toBe("server-user-1");
  });

  it("still shows a new user message when the last persisted line is not that user turn", () => {
    const persisted: ChatUiMessage[] = [
      { id: "u1", role: "user", content: "hello" },
      { id: "a1", role: "assistant", content: "hi" },
    ];
    const merged = mergeChatDisplayMessages(persisted, stream({
      pendingUserMessages: [{ id: "u2", role: "user", content: "hello" }],
    }));
    expect(merged).toHaveLength(3);
    expect(merged[2]?.id).toBe("u2");
  });
});
