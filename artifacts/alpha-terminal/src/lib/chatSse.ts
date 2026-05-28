export type ChatSseEvent =
  | { type: "thread"; thread_id: string }
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | {
      type: "tool_call_start";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: "tool_call_end";
      toolCallId: string;
      toolName: string;
      output: unknown;
    }
  | { type: "done"; thread_id: string; assistant_message_id: string }
  | { type: "error"; message: string }
  | {
      type: "status";
      note?: string;
      phase?: string;
      model_count?: number;
      synthesizer_model?: string;
    };

function parseSseBlock(block: string): ChatSseEvent | null {
  let event = "message";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    const payload = JSON.parse(data) as Record<string, unknown>;
    switch (event) {
      case "thread":
        return { type: "thread", thread_id: String(payload.thread_id ?? "") };
      case "reasoning":
        return { type: "reasoning", delta: String(payload.delta ?? "") };
      case "text":
        return { type: "text", delta: String(payload.delta ?? "") };
      case "tool_call_start":
        return {
          type: "tool_call_start",
          toolCallId: String(payload.toolCallId ?? ""),
          toolName: String(payload.toolName ?? ""),
          input: payload.input,
        };
      case "tool_call_end":
        return {
          type: "tool_call_end",
          toolCallId: String(payload.toolCallId ?? ""),
          toolName: String(payload.toolName ?? ""),
          output: payload.output,
        };
      case "done":
        return {
          type: "done",
          thread_id: String(payload.thread_id ?? ""),
          assistant_message_id: String(payload.assistant_message_id ?? ""),
        };
      case "error":
        return { type: "error", message: String(payload.message ?? "Error") };
      case "status":
        return {
          type: "status",
          ...(typeof payload.note === "string" ? { note: payload.note } : {}),
          ...(typeof payload.phase === "string" ? { phase: payload.phase } : {}),
          ...(typeof payload.model_count === "number" ? { model_count: payload.model_count } : {}),
          ...(typeof payload.synthesizer_model === "string"
            ? { synthesizer_model: payload.synthesizer_model }
            : {}),
        };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function abortChatSseError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** Consume POST `/api/ai/chat` SSE response body. */
export async function consumeChatSse(
  response: Response,
  onEvent: (ev: ChatSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response stream");

  const throwIfAborted = () => {
    if (signal?.aborted) throw abortChatSseError();
  };

  throwIfAborted();

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort);

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        throwIfAborted();
        const trimmed = part.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        const ev = parseSseBlock(trimmed);
        if (ev) onEvent(ev);
      }
    }
    throwIfAborted();
    if (buffer.trim()) {
      const ev = parseSseBlock(buffer.trim());
      if (ev) onEvent(ev);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}
