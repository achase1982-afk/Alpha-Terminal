import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { consumeChatSse, type ChatSseEvent } from "@/lib/chatSse";
import { Send, Square, RotateCcw, Plus } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AssistantListenButton, cancelAssistantSpeech } from "@/components/AssistantListenButton";
import { useVisualViewportComposerMetrics } from "@/hooks/useVisualViewportKeyboardInset";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const RETRYABLE_CHAT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const ALL_CHAT_MODELS = [
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5-mini",
  "grok-4-1-fast-reasoning",
  "grok-4",
];

type ServerThread = {
  id: string;
  symbol: string | null;
  title: string;
  updatedAt: string;
};

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  retryable?: boolean;
};

type ToolPill = {
  toolCallId: string;
  toolName: string;
  status: "running" | "done";
  input?: unknown;
};

let msgCounter = 0;
function nextMsgId(): string {
  return `mnc-${Date.now()}-${++msgCounter}`;
}

function toolLabel(name: string, input: unknown): string {
  const sym =
    input && typeof input === "object" && "symbol" in input
      ? String((input as { symbol?: string }).symbol ?? "")
      : "";
  return sym ? `${name} (${sym})` : name;
}

export function MarketNewsChatPanel() {
  const symbol = useTerminalStore((s) => s.symbol);
  const aiModel = useTerminalStore((s) => s.aiFeatureSettings.chat.model);
  const setAiFeatureSetting = useTerminalStore((s) => s.setAiFeatureSetting);

  const symU = symbol.toUpperCase();
  const modelSend = ALL_CHAT_MODELS.includes(aiModel) ? aiModel : ALL_CHAT_MODELS[0]!;

  const [threads, setThreads] = useState<ServerThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [toolPills, setToolPills] = useState<ToolPill[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const narrowMobile = useMediaQuery("(max-width: 767px)");
  const dockReservePx = narrowMobile ? (composerFocused ? 0 : 78) : 12;
  const { dockBottomPx, remeasure } = useVisualViewportComposerMetrics(dockReservePx, {
    composerFocused,
  });

  const refreshThreads = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/chat/threads?symbol=${encodeURIComponent(symU)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { threads?: ServerThread[] };
      setThreads(data.threads ?? []);
    } catch {
      /* ignore */
    }
  }, [symU]);

  const loadThreadMessages = useCallback(async (threadId: string) => {
    try {
      const res = await fetchWithAuth(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        messages?: Array<{ id: string; role: string; content: string }>;
      };
      setMessages(
        (data.messages ?? []).map((m) => ({
          id: m.id,
          role: m.role === "user" ? "user" : "assistant",
          content: m.content,
        })),
      );
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    void refreshThreads();
    setActiveThreadId(null);
    setMessages([]);
  }, [symU, refreshThreads]);

  useEffect(() => {
    if (activeThreadId) void loadThreadMessages(activeThreadId);
    else setMessages([]);
  }, [activeThreadId, loadThreadMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming, toolPills]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      const userMsg: UiMessage = { id: nextMsgId(), role: "user", content: text.trim() };
      const assistantId = nextMsgId();
      setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
      setInput("");
      setToolPills([]);
      setIsStreaming(true);
      setLastFailedMessage(null);

      const controller = new AbortController();
      abortRef.current = controller;

      let threadId = activeThreadId;

      try {
        const res = await fetchWithAuth("/api/ai/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            thread_id: threadId ?? undefined,
            message: text.trim(),
            model: modelSend,
            symbol: symU,
          }),
          signal: controller.signal,
        });

        const contentType = res.headers.get("content-type") || "";
        if (!res.ok || contentType.includes("text/html")) {
          const retryable = RETRYABLE_CHAT_STATUS.has(res.status) || contentType.includes("text/html");
          const label = !res.ok ? `Server returned ${res.status}` : "Unexpected HTML response";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: `**Error:** ${label}`, retryable }
                : m,
            ),
          );
          if (retryable) setLastFailedMessage(text.trim());
          return;
        }

        await consumeChatSse(res, (ev: ChatSseEvent) => {
          if (ev.type === "thread" && ev.thread_id) {
            threadId = ev.thread_id;
            setActiveThreadId(ev.thread_id);
          } else if (ev.type === "text") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + ev.delta } : m,
              ),
            );
          } else if (ev.type === "tool_call_start") {
            setToolPills((prev) => [
              ...prev.filter((p) => p.toolCallId !== ev.toolCallId),
              {
                toolCallId: ev.toolCallId,
                toolName: ev.toolName,
                status: "running",
                input: ev.input,
              },
            ]);
          } else if (ev.type === "tool_call_end") {
            setToolPills((prev) =>
              prev.map((p) =>
                p.toolCallId === ev.toolCallId ? { ...p, status: "done" } : p,
              ),
            );
          } else if (ev.type === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: `**Error:** ${ev.message}` } : m,
              ),
            );
          }
        });

        void refreshThreads();
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        const errMsg = (err as Error).message || "Connection failed";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: `**Error:** ${errMsg}`, retryable: true } : m,
          ),
        );
        setLastFailedMessage(text.trim());
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
        setToolPills([]);
      }
    },
    [activeThreadId, isStreaming, modelSend, refreshThreads, symU],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setToolPills([]);
  }, []);

  const handleNewThread = useCallback(() => {
    handleStop();
    cancelAssistantSpeech();
    setActiveThreadId(null);
    setMessages([]);
    setLastFailedMessage(null);
  }, [handleStop]);

  const handleClear = handleNewThread;

  const handleRetry = useCallback(() => {
    if (!lastFailedMessage || isStreaming) return;
    setMessages((prev) => prev.filter((m) => !m.retryable));
    setLastFailedMessage(null);
    void sendMessage(lastFailedMessage);
  }, [isStreaming, lastFailedMessage, sendMessage]);

  const renderComposer = () => (
    <form
      className={[
        "flex gap-2 border-t border-card-border/50 bg-[#0a0a0a] p-2 items-end",
        narrowMobile
          ? "fixed left-0 right-0 z-[10050] shadow-[0_-10px_30px_rgba(0,0,0,0.45)]"
          : "relative z-[60] shrink-0",
      ].join(" ")}
      style={
        narrowMobile
          ? {
              bottom: dockBottomPx,
              paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))",
            }
          : { paddingBottom: "max(10px, env(safe-area-inset-bottom, 0px))" }
      }
      onSubmit={(e) => {
        e.preventDefault();
        if (input.trim() && !isStreaming) void sendMessage(input);
      }}
    >
      <textarea
        ref={textareaRef}
        rows={2}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onFocus={() => {
          setComposerFocused(true);
          remeasure();
        }}
        onBlur={() => {
          setComposerFocused(false);
          remeasure();
        }}
        placeholder={`Ask about ${symU}…`}
        className="flex-1 resize-none bg-[#111] border border-card-border rounded-md px-3 py-2 font-mono text-[14px] text-white placeholder:text-white/55 outline-none focus:border-white/40 min-h-[48px]"
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={handleStop}
          className="shrink-0 p-2.5 rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10"
          aria-label="Stop"
        >
          <Square className="w-4 h-4 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          disabled={!input.trim()}
          onClick={() => {
            if (input.trim()) void sendMessage(input);
          }}
          className="shrink-0 p-2.5 text-white disabled:opacity-30"
          aria-label="Send"
        >
          <Send className="w-5 h-5" />
        </button>
      )}
    </form>
  );

  return (
    <div className="relative flex flex-col flex-1 min-h-0 max-h-[calc(100dvh-9.5rem)] md:max-h-none md:min-h-[280px] bg-[#0a0a0a] border-t border-card-border/40">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-card-border/50 shrink-0 flex-wrap">
        <span className="font-mono text-[14px] font-semibold text-white tracking-wide uppercase truncate">
          {symU}
        </span>
        <select
          value={modelSend}
          onChange={(e) => setAiFeatureSetting("chat", "model", e.target.value)}
          className="bg-black/60 border border-card-border rounded px-2 py-1.5 font-mono text-[12px] text-white max-w-[200px]"
          aria-label="Chat model"
        >
          {ALL_CHAT_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-card-border/30 overflow-x-auto shrink-0">
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveThreadId(t.id)}
            className={[
              "font-mono text-[12px] px-2 py-1 rounded border max-w-[140px] truncate shrink-0",
              t.id === activeThreadId
                ? "border-white/35 text-white bg-white/10"
                : "border-transparent text-white/65 hover:text-white",
            ].join(" ")}
          >
            {t.title}
          </button>
        ))}
        <button
          type="button"
          onClick={handleNewThread}
          className="flex items-center gap-1 font-mono text-[12px] text-white/80 hover:text-white px-1.5 shrink-0"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="ml-auto flex items-center gap-1 font-mono text-[12px] text-white/65 hover:text-white px-1.5 shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            Clear
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2"
        style={
          narrowMobile
            ? { paddingBottom: `calc(44px + ${dockBottomPx}px + env(safe-area-inset-bottom, 0px))` }
            : undefined
        }
      >
        {messages.length === 0 && (
          <p className="font-mono text-[14px] text-white/70 leading-relaxed">
            Ask about {symU} — the assistant calls tools for live quotes, flow, news, and technicals.
            Conversations are saved to your account.
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
            {msg.role === "user" ? (
              <span className="inline-block font-mono text-[14px] text-[#f5f5f5] bg-[#1a1a1a] border border-card-border rounded px-3 py-2 max-w-[95%] text-left">
                {msg.content}
              </span>
            ) : (
              <div>
                {toolPills.length > 0 && msg.id === messages[messages.length - 1]?.id && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {toolPills.map((p) => (
                      <span
                        key={p.toolCallId}
                        className={[
                          "font-mono text-[10px] px-2 py-0.5 rounded-full border",
                          p.status === "running"
                            ? "border-amber-500/50 text-amber-200/90 animate-pulse"
                            : "border-emerald-500/40 text-emerald-200/80",
                        ].join(" ")}
                      >
                        {p.status === "running" ? "calling" : "done"} {toolLabel(p.toolName, p.input)}
                      </span>
                    ))}
                  </div>
                )}
                <div className="font-mono text-[14px] text-[#f5f5f5] prose prose-invert prose-sm max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                <AssistantListenButton messageId={msg.id} markdownText={msg.content} size="sm" />
                {msg.retryable && !isStreaming && (
                  <button type="button" onClick={handleRetry} className="mt-1 text-[12px] text-white/70">
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {narrowMobile && typeof document !== "undefined"
        ? createPortal(renderComposer(), document.body)
        : renderComposer()}
    </div>
  );
}