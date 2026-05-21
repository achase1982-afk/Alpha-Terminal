import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { consumeChatSse, type ChatSseEvent } from "@/lib/chatSse";
import { Send, Square, RotateCcw, Plus, Bot, Menu, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AssistantListenButton, cancelAssistantSpeech } from "@/components/AssistantListenButton";
import { useVisualViewportComposerMetrics } from "@/hooks/useVisualViewportKeyboardInset";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  AI_MODEL_IDS,
  aiModelSelectLabel,
  DEFAULT_AI_MODEL_ID,
  isAiModelId,
  migrateLegacyModelIdToCatalog,
  type AiModelId,
} from "@workspace/ai-models";

const RETRYABLE_CHAT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MULTI_AGENT_MODEL = "__multi_agent__";
const MULTI_AGENT_STORAGE_KEY = "marketNewsChatMultiModels";
const MULTI_AGENT_SYNTH_STORAGE_KEY = "marketNewsChatSynthesizerModel";

const ALL_CHAT_MODELS: readonly AiModelId[] = AI_MODEL_IDS;

const MULTI_AGENT_ORBIT_COLORS = ["#22d3ee", "#a78bfa", "#fbbf24", "#fb7185", "#4ade80", "#38bdf8"] as const;

function MultiAgentOrbit({ count }: { count: number }) {
  const n = Math.min(Math.max(count, 2), 6);
  return (
    <div
      className="relative h-6 w-6 shrink-0"
      title={`${count} research models run in parallel; when all finish, one synthesizer merges drafts.`}
    >
      <span className="pointer-events-none absolute inset-0 rounded-full border border-white/25" aria-hidden />
      <span className="pointer-events-none absolute inset-[5px] rounded-full border border-white/10" aria-hidden />
      <div
        className="absolute inset-0 animate-spin"
        style={{ animationDuration: "2.6s", animationTimingFunction: "linear" }}
        aria-hidden
      >
        {Array.from({ length: n }).map((_, i) => (
          <div
            key={i}
            className="absolute inset-0"
            style={{ transform: `rotate(${(360 / n) * i}deg)` }}
          >
            <div
              className="absolute left-1/2 top-0 -translate-x-1/2 animate-spin"
              style={{
                animationDuration: "2.6s",
                animationTimingFunction: "linear",
                animationDirection: "reverse",
              }}
            >
              <Bot
                className="h-2.5 w-2.5 drop-shadow-[0_0_4px_rgba(0,0,0,0.9)]"
                style={{ color: MULTI_AGENT_ORBIT_COLORS[i % MULTI_AGENT_ORBIT_COLORS.length] }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
  const modelSend = isAiModelId(aiModel) ? aiModel : DEFAULT_AI_MODEL_ID;

  const [useMultiAgent, setUseMultiAgent] = useState(false);
  const [multiModelPickerOpen, setMultiModelPickerOpen] = useState(false);
  const [multiAgentModels, setMultiAgentModels] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem(MULTI_AGENT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((m) => (typeof m === "string" ? migrateLegacyModelIdToCatalog(m) : null))
        .filter((m): m is AiModelId => m != null && isAiModelId(m));
    } catch {
      return [];
    }
  });
  const [synthesizerModel, setSynthesizerModel] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_AI_MODEL_ID;
    try {
      const raw = sessionStorage.getItem(MULTI_AGENT_SYNTH_STORAGE_KEY);
      if (raw) return migrateLegacyModelIdToCatalog(raw);
    } catch {
      /* ignore */
    }
    return DEFAULT_AI_MODEL_ID;
  });
  const [activeMultiAgentCount, setActiveMultiAgentCount] = useState(0);
  const modelControlValue = useMultiAgent ? MULTI_AGENT_MODEL : modelSend;

  const [threads, setThreads] = useState<ServerThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [toolPills, setToolPills] = useState<ToolPill[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [threadsMenuOpen, setThreadsMenuOpen] = useState(false);
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
    setThreadsMenuOpen(false);
  }, [symU, refreshThreads]);

  useEffect(() => {
    if (activeThreadId) void loadThreadMessages(activeThreadId);
    else setMessages([]);
  }, [activeThreadId, loadThreadMessages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(MULTI_AGENT_STORAGE_KEY, JSON.stringify(multiAgentModels));
    } catch {
      /* QuotaExceededError */
    }
  }, [multiAgentModels]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(MULTI_AGENT_SYNTH_STORAGE_KEY, synthesizerModel);
    } catch {
      /* QuotaExceededError */
    }
  }, [synthesizerModel]);

  useEffect(() => {
    if (!useMultiAgent || multiAgentModels.length === 0) return;
    setSynthesizerModel((prev) => (multiAgentModels.includes(prev) ? prev : multiAgentModels[0]!));
  }, [multiAgentModels, useMultiAgent]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming, toolPills]);

  type SendMessageOptions = {
    /** Replace from this index: keep prior messages, drop this one and after, append new assistant only. */
    truncateToIndex?: number;
  };

  const sendMessage = useCallback(
    async (text: string, options?: SendMessageOptions) => {
      if (!text.trim() || isStreaming) return;

      const useServerMultiAgent = useMultiAgent && multiAgentModels.length >= 2;
      if (useMultiAgent && multiAgentModels.length < 2) {
        const assistantId = nextMsgId();
        setMessages((prev) => [
          ...prev,
          { id: nextMsgId(), role: "user", content: text.trim() },
          {
            id: assistantId,
            role: "assistant",
            content: "**Error:** Select at least two models for multi-agent.",
          },
        ]);
        setInput("");
        return;
      }

      const userMsg: UiMessage = { id: nextMsgId(), role: "user", content: text.trim() };
      const assistantId = nextMsgId();
      const truncateToIndex = options?.truncateToIndex;
      setMessages((prev) => {
        const assistantPlaceholder: UiMessage = { id: assistantId, role: "assistant", content: "" };
        if (truncateToIndex !== undefined) {
          return [...prev.slice(0, truncateToIndex), assistantPlaceholder];
        }
        return [...prev, userMsg, assistantPlaceholder];
      });
      setInput("");
      setToolPills([]);
      setIsStreaming(true);
      setLastFailedMessage(null);
      setActiveMultiAgentCount(useServerMultiAgent ? multiAgentModels.length : 0);

      const controller = new AbortController();
      abortRef.current = controller;

      let threadId = activeThreadId;

      const requestBody: Record<string, unknown> = {
        thread_id: threadId ?? undefined,
        message: text.trim(),
        symbol: symU,
      };
      if (useServerMultiAgent) {
        requestBody.multi_agent = {
          models: multiAgentModels,
          synthesizer_model: synthesizerModel,
        };
      } else {
        requestBody.model = modelSend;
      }

      try {
        const res = await fetchWithAuth("/api/ai/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(requestBody),
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
          } else if (ev.type === "status" && ev.phase === "multi_agent_drafting") {
            setActiveMultiAgentCount(ev.model_count ?? multiAgentModels.length);
          } else if (ev.type === "text") {
            setActiveMultiAgentCount(0);
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
        setActiveMultiAgentCount(0);
      }
    },
    [
      activeThreadId,
      isStreaming,
      modelSend,
      multiAgentModels,
      refreshThreads,
      symU,
      synthesizerModel,
      useMultiAgent,
    ],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setToolPills([]);
    setActiveMultiAgentCount(0);
  }, []);

  const handleNewThread = useCallback(() => {
    handleStop();
    cancelAssistantSpeech();
    setActiveThreadId(null);
    setMessages([]);
    setLastFailedMessage(null);
    setThreadsMenuOpen(false);
  }, [handleStop]);

  const handleSelectThread = useCallback((threadId: string) => {
    handleStop();
    cancelAssistantSpeech();
    setActiveThreadId(threadId);
    setThreadsMenuOpen(false);
  }, [handleStop]);

  const handleClear = handleNewThread;

  const regenerateAssistantMessage = useCallback(
    (assistantMsgId: string) => {
      if (isStreaming) return;
      const idx = messages.findIndex((m) => m.id === assistantMsgId);
      if (idx < 0) return;
      let userText: string | null = null;
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i]?.role === "user") {
          userText = messages[i]!.content;
          break;
        }
      }
      if (!userText) return;
      cancelAssistantSpeech();
      void sendMessage(userText, { truncateToIndex: idx });
    },
    [isStreaming, messages, sendMessage],
  );

  const handleRetry = useCallback(() => {
    if (!lastFailedMessage || isStreaming) return;
    const failedIdx = messages.findIndex((m) => m.retryable);
    setLastFailedMessage(null);
    cancelAssistantSpeech();
    if (failedIdx >= 0) {
      void sendMessage(lastFailedMessage, { truncateToIndex: failedIdx });
      return;
    }
    void sendMessage(lastFailedMessage);
  }, [isStreaming, lastFailedMessage, messages, sendMessage]);

  const handleComposerSend = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    void sendMessage(input);
    textareaRef.current?.blur();
  }, [input, isStreaming, sendMessage]);

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
        handleComposerSend();
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
          onPointerDown={(e) => {
            if (!input.trim() || isStreaming) return;
            e.preventDefault();
            handleComposerSend();
          }}
          className="shrink-0 p-2.5 text-white disabled:opacity-30 touch-manipulation transition-opacity active:opacity-60 aria-[busy=true]:opacity-50"
          aria-label="Send"
          aria-busy={isStreaming}
        >
          <Send className="w-5 h-5" />
        </button>
      )}
    </form>
  );

  return (
    <div className="relative flex flex-col flex-1 min-h-0 max-h-[calc(100dvh-9.5rem)] md:max-h-none md:min-h-[280px] bg-[#0a0a0a] border-t border-card-border/40">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-card-border/50 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setThreadsMenuOpen((v) => !v)}
            className={[
              "shrink-0 p-1.5 rounded border transition-colors touch-manipulation",
              threadsMenuOpen
                ? "border-white/35 text-white bg-white/10"
                : "border-card-border text-white/80 hover:text-white hover:border-white/25",
            ].join(" ")}
            aria-label={threadsMenuOpen ? "Close chats menu" : "Open chats menu"}
            aria-expanded={threadsMenuOpen}
          >
            {threadsMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          <span className="font-mono text-[14px] font-semibold text-white tracking-wide uppercase truncate">
            {symU}
          </span>
        </div>
        <div className="relative flex items-center gap-2 shrink-0">
          <select
            value={modelControlValue}
            title={
              useMultiAgent
                ? "Research models run in parallel; when all finish, the synthesizer streams one merged answer."
                : "Single model for this reply."
            }
            onChange={(e) => {
              const value = e.target.value;
              if (value === MULTI_AGENT_MODEL) {
                setUseMultiAgent(true);
                setMultiModelPickerOpen(true);
                return;
              }
              setUseMultiAgent(false);
              setMultiModelPickerOpen(false);
              setAiFeatureSetting("chat", "model", value);
            }}
            className="bg-black/60 border border-card-border rounded px-2 py-1.5 font-mono text-[12px] text-white max-w-[180px] sm:max-w-[230px]"
            aria-label="Chat model"
          >
            <option value={MULTI_AGENT_MODEL}>multi-agent</option>
            {ALL_CHAT_MODELS.map((m) => (
              <option key={m} value={m}>
                {aiModelSelectLabel(m)}
              </option>
            ))}
          </select>
          {useMultiAgent && (
            <button
              type="button"
              onClick={() => setMultiModelPickerOpen((v) => !v)}
              className="rounded border border-card-border bg-black/60 px-2 py-1 font-mono text-[11px] text-white/85"
              aria-label="Choose multi-agent models"
            >
              {multiAgentModels.length || 0} selected
            </button>
          )}
          {useMultiAgent && multiAgentModels.length > 0 && (
            <label className="flex items-center gap-1 min-w-0">
              <span className="hidden sm:inline font-mono text-[10px] text-white/55 shrink-0">
                Synthesize
              </span>
              <select
                value={synthesizerModel}
                onChange={(e) => setSynthesizerModel(e.target.value)}
                className="min-w-0 max-w-[120px] sm:max-w-[200px] truncate bg-black/60 border border-card-border rounded px-1.5 py-1 font-mono text-[11px] text-white"
                aria-label="Model that runs the final synthesis pass"
                title="After parallel research, this model receives every draft and writes one grounded answer"
              >
                {multiAgentModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          {useMultiAgent && multiModelPickerOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-[10120] min-w-[220px] rounded-md border border-card-border bg-[#0b0b0b] p-2 shadow-xl">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-white/60">
                Select models
              </p>
              <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                {ALL_CHAT_MODELS.map((model) => {
                  const checked = multiAgentModels.includes(model);
                  return (
                    <label
                      key={model}
                      className="flex items-center gap-2 rounded px-1 py-1 hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...multiAgentModels, model]
                            : multiAgentModels.filter((m) => m !== model);
                          setMultiAgentModels(next);
                        }}
                      />
                      <span className="font-mono text-[11px] text-white/90">{aiModelSelectLabel(model)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 flex flex-col">
        {threadsMenuOpen && (
          <div className="absolute inset-0 z-30 flex min-h-0" role="dialog" aria-label="Chat history">
            <nav
              className="flex flex-col w-[min(260px,78vw)] max-w-full shrink-0 border-r border-card-border/60 bg-[#0b0b0b] shadow-[4px_0_24px_rgba(0,0,0,0.55)]"
              aria-label="Previous chats"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-card-border/40 shrink-0">
                <span className="font-mono text-[11px] uppercase tracking-wider text-white/55">
                  Chats · {symU}
                </span>
                <button
                  type="button"
                  onClick={() => setThreadsMenuOpen(false)}
                  className="p-1 text-white/65 hover:text-white"
                  aria-label="Close chats menu"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto py-1">
                {threads.length === 0 ? (
                  <p className="px-3 py-3 font-mono text-[12px] text-white/55 leading-relaxed">
                    No saved chats for {symU} yet. Start a conversation below.
                  </p>
                ) : (
                  threads.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => handleSelectThread(t.id)}
                      className={[
                        "w-full text-left font-mono text-[13px] px-3 py-2.5 truncate transition-colors",
                        t.id === activeThreadId
                          ? "bg-white/10 text-white border-l-2 border-white/50"
                          : "text-white/70 hover:bg-white/5 hover:text-white border-l-2 border-transparent",
                      ].join(" ")}
                      title={t.title}
                    >
                      {t.title}
                    </button>
                  ))
                )}
              </div>
              <div className="flex items-center gap-2 px-2 py-2 border-t border-card-border/40 shrink-0">
                <button
                  type="button"
                  onClick={handleNewThread}
                  className="flex flex-1 items-center justify-center gap-1 font-mono text-[12px] text-white/85 hover:text-white py-1.5 rounded border border-card-border/60 hover:border-white/25"
                >
                  <Plus className="w-3 h-3" />
                  New chat
                </button>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="flex items-center gap-1 font-mono text-[12px] text-white/65 hover:text-white px-2 py-1.5 shrink-0"
                    title="Clear current chat"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                )}
              </div>
            </nav>
            <button
              type="button"
              className="flex-1 min-w-0 bg-black/45"
              aria-label="Close chats menu"
              onClick={() => setThreadsMenuOpen(false)}
            />
          </div>
        )}

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
                <AssistantListenButton
                  messageId={msg.id}
                  markdownText={msg.content}
                  size="sm"
                  onRetry={() => regenerateAssistantMessage(msg.id)}
                  retryDisabled={isStreaming}
                />
                {msg.retryable && !isStreaming && (
                  <button type="button" onClick={handleRetry} className="mt-1 text-[12px] text-white/70">
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {isStreaming &&
          messages.length > 0 &&
          messages[messages.length - 1]?.role === "assistant" &&
          !messages[messages.length - 1]!.content.trim() &&
          (activeMultiAgentCount > 1 ? (
            <div className="flex items-center gap-2 py-1 text-white/75">
              <MultiAgentOrbit count={activeMultiAgentCount} />
              <div className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-white/70 animate-pulse" />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-white/70 animate-pulse"
                  style={{ animationDelay: "130ms" }}
                />
                <span
                  className="h-1.5 w-1.5 rounded-full bg-white/70 animate-pulse"
                  style={{ animationDelay: "260ms" }}
                />
              </div>
              <span className="font-mono text-[11px] text-white/65">
                {activeMultiAgentCount} models in parallel, then synthesis…
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse" />
              <span
                className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          ))}
        </div>
      </div>

      {narrowMobile && typeof document !== "undefined"
        ? createPortal(renderComposer(), document.body)
        : renderComposer()}
    </div>
  );
}