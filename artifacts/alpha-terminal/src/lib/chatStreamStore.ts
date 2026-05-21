import { create } from "zustand";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { consumeChatSse, type ChatSseEvent } from "@/lib/chatSse";

const RETRYABLE_CHAT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const CHAT_CLERK_TOKEN_TIMEOUT_MS = 12_000;
const CHAT_REQUEST_TIMEOUT_MS = 120_000;

function formatChatNetworkError(raw: string): string {
  if (/load failed|failed to fetch|networkerror/i.test(raw)) {
    return "Connection lost — check network and tap Retry.";
  }
  return raw;
}

export type ChatToolPill = {
  toolCallId: string;
  toolName: string;
  status: "running" | "done";
  input?: unknown;
};

export type ChatUiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  retryable?: boolean;
};

export type ChatInFlightAssistant = {
  id: string;
  content: string;
  retryable?: boolean;
  /** Stream finished; kept until server transcript includes this id. */
  complete: boolean;
};

export type ChatThreadStreamState = {
  threadId: string;
  symbol: string;
  abortController: AbortController | null;
  /** Monotonic id for the active send; errors from other ids are dropped. */
  activeSendId: string | null;
  isStreaming: boolean;
  inFlightAssistant: ChatInFlightAssistant | null;
  /** Optimistic user lines for this in-flight turn (not yet in server reload). */
  pendingUserMessages: ChatUiMessage[];
  /** While regenerating, slice persisted transcript for display merge. */
  displayTruncateToIndex?: number;
  toolPills: ChatToolPill[];
  activeMultiAgentCount: number;
  lastFailedMessage: string | null;
};

export type SendChatMessageParams = {
  text: string;
  symbol: string;
  threadId: string | null;
  model: string;
  useMultiAgent: boolean;
  multiAgentModels: string[];
  synthesizerModel: string;
  truncateToIndex?: number;
  onThreadActivated: (threadId: string) => void;
  onRefreshThreads: () => void | Promise<void>;
};

function pendingStreamKey(symbol: string): string {
  return `__pending__:${symbol.toUpperCase()}`;
}

let sendCounter = 0;
function nextSendId(): string {
  return `send-${Date.now()}-${++sendCounter}`;
}

let msgCounter = 0;
export function nextChatMsgId(): string {
  return `mnc-${Date.now()}-${++msgCounter}`;
}

function emptyThreadState(threadId: string, symbol: string): ChatThreadStreamState {
  return {
    threadId,
    symbol: symbol.toUpperCase(),
    abortController: null,
    activeSendId: null,
    isStreaming: false,
    inFlightAssistant: null,
    pendingUserMessages: [],
    toolPills: [],
    activeMultiAgentCount: 0,
    lastFailedMessage: null,
  };
}

function isSupersededSend(
  state: ChatThreadStreamState,
  sendId: string,
  controller: AbortController,
): boolean {
  return state.activeSendId !== sendId || state.abortController !== controller;
}

type ChatStreamStore = {
  streamsByThreadId: Record<string, ChatThreadStreamState>;

  getThreadStream: (threadId: string | null, symbol: string) => ChatThreadStreamState | null;
  isStreamingForThread: (threadId: string | null, symbol: string) => boolean;

  abortStreamForThread: (threadId: string | null, symbol: string) => void;
  /** Abort fetch/SSE without clearing isStreaming (supersede in-flight send). */
  abortInFlightFetchForThread: (threadId: string | null, symbol: string) => void;

  reconcileThreadFromServer: (threadId: string, serverMessageIds: string[]) => void;
  clearLastFailedForThread: (threadId: string | null, symbol: string) => void;

  sendMessage: (params: SendChatMessageParams) => Promise<void>;
};

export const useChatStreamStore = create<ChatStreamStore>((set, get) => ({
  streamsByThreadId: {},

  getThreadStream: (threadId, symbol) => {
    const symU = symbol.toUpperCase();
    const key = threadId ?? pendingStreamKey(symU);
    return get().streamsByThreadId[key] ?? null;
  },

  isStreamingForThread: (threadId, symbol) => {
    const s = get().getThreadStream(threadId, symbol);
    return s?.isStreaming ?? false;
  },

  abortInFlightFetchForThread: (threadId, symbol) => {
    const symU = symbol.toUpperCase();
    const keys = threadId ? [threadId, pendingStreamKey(symU)] : [pendingStreamKey(symU)];
    for (const key of keys) {
      const stream = get().streamsByThreadId[key];
      if (!stream) continue;
      stream.abortController?.abort();
      set((st) => {
        const cur = st.streamsByThreadId[key];
        if (!cur) return st;
        return {
          streamsByThreadId: {
            ...st.streamsByThreadId,
            [key]: {
              ...cur,
              abortController: null,
              activeSendId: null,
              toolPills: [],
              activeMultiAgentCount: 0,
            },
          },
        };
      });
    }
  },

  abortStreamForThread: (threadId, symbol) => {
    get().abortInFlightFetchForThread(threadId, symbol);
    const symU = symbol.toUpperCase();
    const keys = threadId ? [threadId, pendingStreamKey(symU)] : [pendingStreamKey(symU)];
    for (const key of keys) {
      set((st) => {
        const cur = st.streamsByThreadId[key];
        if (!cur) return st;
        return {
          streamsByThreadId: {
            ...st.streamsByThreadId,
            [key]: { ...cur, isStreaming: false },
          },
        };
      });
    }
  },

  reconcileThreadFromServer: (threadId, serverMessageIds) => {
    const stream = get().streamsByThreadId[threadId];
    if (!stream?.inFlightAssistant?.complete) return;
    const flightId = stream.inFlightAssistant.id;
    if (!serverMessageIds.includes(flightId)) return;
    set((st) => {
      const cur = st.streamsByThreadId[threadId];
      if (!cur) return st;
      return {
        streamsByThreadId: {
          ...st.streamsByThreadId,
          [threadId]: {
            ...cur,
            inFlightAssistant: null,
            pendingUserMessages: [],
            displayTruncateToIndex: undefined,
            toolPills: [],
            isStreaming: false,
          },
        },
      };
    });
  },

  clearLastFailedForThread: (threadId, symbol) => {
    const key = threadId ?? pendingStreamKey(symbol);
    set((st) => {
      const cur = st.streamsByThreadId[key];
      if (!cur) return st;
      return {
        streamsByThreadId: {
          ...st.streamsByThreadId,
          [key]: { ...cur, lastFailedMessage: null },
        },
      };
    });
  },

  sendMessage: async (params) => {
    const text = params.text.trim();
    if (!text) return;

    const symU = params.symbol.toUpperCase();
    let streamKey = params.threadId ?? pendingStreamKey(symU);

    get().abortInFlightFetchForThread(params.threadId, symU);

    const useServerMultiAgent = params.useMultiAgent && params.multiAgentModels.length >= 2;
    if (params.useMultiAgent && params.multiAgentModels.length < 2) {
      const assistantId = nextChatMsgId();
      set((st) => ({
        streamsByThreadId: {
          ...st.streamsByThreadId,
          [streamKey]: {
            ...emptyThreadState(streamKey, symU),
            pendingUserMessages: [
              { id: nextChatMsgId(), role: "user", content: text },
            ],
            inFlightAssistant: {
              id: assistantId,
              content: "**Error:** Select at least two models for multi-agent.",
              complete: true,
            },
          },
        },
      }));
      return;
    }

    const sendId = nextSendId();
    const userMsg: ChatUiMessage = { id: nextChatMsgId(), role: "user", content: text };
    const assistantId = nextChatMsgId();
    const controller = new AbortController();
    const { signal } = controller;

    set((st) => {
      const base = st.streamsByThreadId[streamKey] ?? emptyThreadState(streamKey, symU);
      let pendingUser: ChatUiMessage[];
      if (params.truncateToIndex !== undefined) {
        pendingUser = [userMsg];
      } else {
        const lastPending = base.pendingUserMessages[base.pendingUserMessages.length - 1];
        const staleAssistant =
          base.inFlightAssistant &&
          !base.inFlightAssistant.complete &&
          !base.inFlightAssistant.content.trim();
        if (
          staleAssistant &&
          lastPending?.role === "user" &&
          lastPending.content === text
        ) {
          pendingUser = [...base.pendingUserMessages.slice(0, -1), userMsg];
        } else {
          pendingUser = [...base.pendingUserMessages, userMsg];
        }
      }
      return {
        streamsByThreadId: {
          ...st.streamsByThreadId,
          [streamKey]: {
            ...base,
            threadId: streamKey,
            symbol: symU,
            abortController: controller,
            activeSendId: sendId,
            isStreaming: true,
            lastFailedMessage: null,
            toolPills: [],
            activeMultiAgentCount: useServerMultiAgent ? params.multiAgentModels.length : 0,
            pendingUserMessages: pendingUser,
            inFlightAssistant: { id: assistantId, content: "", complete: false },
            displayTruncateToIndex: params.truncateToIndex,
          },
        },
      };
    });

    let threadId = params.threadId;

    const requestBody: Record<string, unknown> = {
      thread_id: threadId ?? undefined,
      message: text,
      symbol: symU,
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    if (useServerMultiAgent) {
      requestBody.multi_agent = {
        models: params.multiAgentModels,
        synthesizer_model: params.synthesizerModel,
      };
    } else {
      requestBody.model = params.model;
    }

    const patchStream = (
      key: string,
      patch: Partial<ChatThreadStreamState>,
    ) => {
      set((st) => {
        const cur = st.streamsByThreadId[key];
        if (!cur) return st;
        return {
          streamsByThreadId: {
            ...st.streamsByThreadId,
            [key]: { ...cur, ...patch },
          },
        };
      });
    };

    const migrateStreamKey = (newThreadId: string) => {
      if (streamKey === newThreadId) return;
      set((st) => {
        const old = st.streamsByThreadId[streamKey];
        if (!old) return st;
        const next = { ...st.streamsByThreadId };
        delete next[streamKey];
        next[newThreadId] = { ...old, threadId: newThreadId };
        return { streamsByThreadId: next };
      });
      streamKey = newThreadId;
    };

    const requestTimeoutId =
      typeof window !== "undefined"
        ? window.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS)
        : undefined;

    try {
      const res = await fetchWithAuth("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(requestBody),
        signal,
        clerkTokenTimeoutMs: CHAT_CLERK_TOKEN_TIMEOUT_MS,
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || contentType.includes("text/html")) {
        const retryable = RETRYABLE_CHAT_STATUS.has(res.status) || contentType.includes("text/html");
        const label = !res.ok ? `Server returned ${res.status}` : "Unexpected HTML response";
        const cur = get().streamsByThreadId[streamKey];
        if (!cur || isSupersededSend(cur, sendId, controller)) return;
        patchStream(streamKey, {
          inFlightAssistant: {
            id: assistantId,
            content: `**Error:** ${label}`,
            retryable,
            complete: true,
          },
          isStreaming: false,
          abortController: null,
          activeSendId: null,
          toolPills: [],
          activeMultiAgentCount: 0,
          lastFailedMessage: retryable ? text : cur.lastFailedMessage,
        });
        return;
      }

      await consumeChatSse(res, (ev: ChatSseEvent) => {
        const cur = get().streamsByThreadId[streamKey];
        if (!cur || isSupersededSend(cur, sendId, controller)) return;

        if (ev.type === "thread" && ev.thread_id) {
          threadId = ev.thread_id;
          migrateStreamKey(ev.thread_id);
          params.onThreadActivated(ev.thread_id);
        } else if (ev.type === "status" && ev.phase === "multi_agent_drafting") {
          patchStream(streamKey, {
            activeMultiAgentCount: ev.model_count ?? params.multiAgentModels.length,
          });
        } else if (ev.type === "text") {
          const latest = get().streamsByThreadId[streamKey];
          const flight = latest?.inFlightAssistant;
          if (!flight || flight.id !== assistantId) return;
          patchStream(streamKey, {
            activeMultiAgentCount: 0,
            inFlightAssistant: {
              ...flight,
              content: flight.content + ev.delta,
            },
          });
        } else if (ev.type === "tool_call_start") {
          const latest = get().streamsByThreadId[streamKey];
          if (!latest) return;
          patchStream(streamKey, {
            toolPills: [
              ...latest.toolPills.filter((p) => p.toolCallId !== ev.toolCallId),
              {
                toolCallId: ev.toolCallId,
                toolName: ev.toolName,
                status: "running",
                input: ev.input,
              },
            ],
          });
        } else if (ev.type === "tool_call_end") {
          const latest = get().streamsByThreadId[streamKey];
          if (!latest) return;
          patchStream(streamKey, {
            toolPills: latest.toolPills.map((p) =>
              p.toolCallId === ev.toolCallId ? { ...p, status: "done" } : p,
            ),
          });
        } else if (ev.type === "error") {
          patchStream(streamKey, {
            inFlightAssistant: {
              id: assistantId,
              content: `**Error:** ${ev.message}`,
              complete: true,
            },
            isStreaming: false,
            abortController: null,
            activeSendId: null,
            toolPills: [],
            activeMultiAgentCount: 0,
          });
        } else if (ev.type === "done") {
          const persistedId = ev.assistant_message_id?.trim() || assistantId;
          patchStream(streamKey, {
            inFlightAssistant: {
              id: persistedId,
              content:
                get().streamsByThreadId[streamKey]?.inFlightAssistant?.content ?? "",
              complete: true,
            },
            isStreaming: false,
            abortController: null,
            activeSendId: null,
            toolPills: [],
            activeMultiAgentCount: 0,
          });
        }
      }, signal);

      void params.onRefreshThreads();
    } catch (err: unknown) {
      const cur = get().streamsByThreadId[streamKey];
      if (!cur || isSupersededSend(cur, sendId, controller)) return;
      if (signal.aborted || (err as Error).name === "AbortError") {
        const flight = cur.inFlightAssistant;
        patchStream(streamKey, {
          inFlightAssistant: {
            id: assistantId,
            content:
              flight?.id === assistantId && !flight.content.trim()
                ? "**Stopped.**"
                : (flight?.content ?? "**Stopped.**"),
            complete: true,
          },
          isStreaming: false,
          abortController: null,
          activeSendId: null,
          toolPills: [],
          activeMultiAgentCount: 0,
        });
        return;
      }
      const errMsg = formatChatNetworkError((err as Error).message || "Connection failed");
      patchStream(streamKey, {
        inFlightAssistant: {
          id: assistantId,
          content: `**Error:** ${errMsg}`,
          retryable: true,
          complete: true,
        },
        isStreaming: false,
        abortController: null,
        activeSendId: null,
        toolPills: [],
        activeMultiAgentCount: 0,
        lastFailedMessage: text,
      });
    } finally {
      if (requestTimeoutId != null) window.clearTimeout(requestTimeoutId);
      const cur = get().streamsByThreadId[streamKey];
      if (!cur || isSupersededSend(cur, sendId, controller)) return;
      if (cur.isStreaming) {
        patchStream(streamKey, {
          isStreaming: false,
          abortController: null,
          activeSendId: null,
          toolPills: [],
          activeMultiAgentCount: 0,
        });
      }
    }
  },
}));

/** Merge persisted transcript with store in-flight state for display. */
export function mergeChatDisplayMessages(
  persisted: ChatUiMessage[],
  stream: ChatThreadStreamState | null,
): ChatUiMessage[] {
  if (!stream) return persisted;

  let base = persisted;
  if (stream.displayTruncateToIndex !== undefined) {
    base = persisted.slice(0, stream.displayTruncateToIndex);
  }

  const ids = new Set(base.map((m) => m.id));
  const out = [...base];

  for (const u of stream.pendingUserMessages) {
    if (!ids.has(u.id)) {
      out.push(u);
      ids.add(u.id);
    }
  }

  if (stream.inFlightAssistant) {
    const fid = stream.inFlightAssistant.id;
    if (!ids.has(fid)) {
      out.push({
        id: fid,
        role: "assistant",
        content: stream.inFlightAssistant.content,
        retryable: stream.inFlightAssistant.retryable,
      });
    }
  }

  return out;
}
