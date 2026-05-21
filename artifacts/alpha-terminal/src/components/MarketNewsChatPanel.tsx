import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTerminalStore } from "@/lib/store";
import { resolveActiveChatThreadId } from "@/lib/chatPersistence";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  mergeChatDisplayMessages,
  useChatStreamStore,
  type ChatUiMessage,
} from "@/lib/chatStreamStore";
import { Send, Square, RotateCcw, Plus, Bot, Menu, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AssistantListenButton, cancelAssistantSpeech } from "@/components/AssistantListenButton";
import { useKeyboardOverlapPx } from "@/hooks/useVisualViewportKeyboardInset";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  AI_MODEL_IDS,
  aiModelSelectLabel,
  DEFAULT_AI_MODEL_ID,
  isAiModelId,
  migrateLegacyModelIdToCatalog,
  type AiModelId,
} from "@workspace/ai-models";

const MULTI_AGENT_MODEL = "__multi_agent__";
const MULTI_AGENT_STORAGE_KEY = "marketNewsChatMultiModels";
const MULTI_AGENT_SYNTH_STORAGE_KEY = "marketNewsChatSynthesizerModel";

const ALL_CHAT_MODELS: readonly AiModelId[] = AI_MODEL_IDS;

const MULTI_AGENT_ORBIT_COLORS = ["#22d3ee", "#a78bfa", "#fbbf24", "#fb7185", "#4ade80", "#38bdf8"] as const;

function pendingStreamKey(symbol: string): string {
  return `__pending__:${symbol.toUpperCase()}`;
}

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
  const setActiveChatThreadForSymbol = useTerminalStore((s) => s.setActiveChatThreadForSymbol);

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
  const modelControlValue = useMultiAgent ? MULTI_AGENT_MODEL : modelSend;

  const [threads, setThreads] = useState<ServerThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [threadsMenuOpen, setThreadsMenuOpen] = useState(false);

  const streamsByThreadId = useChatStreamStore((s) => s.streamsByThreadId);
  const sendChatMessage = useChatStreamStore((s) => s.sendMessage);
  const abortStreamForThread = useChatStreamStore((s) => s.abortStreamForThread);
  const reconcileThreadFromServer = useChatStreamStore((s) => s.reconcileThreadFromServer);
  const clearLastFailedForThread = useChatStreamStore((s) => s.clearLastFailedForThread);

  const streamState = useMemo(() => {
    const pending = pendingStreamKey(symU);
    if (activeThreadId && streamsByThreadId[activeThreadId]) {
      return streamsByThreadId[activeThreadId];
    }
    return streamsByThreadId[pending] ?? null;
  }, [streamsByThreadId, activeThreadId, symU]);

  const isStreaming = streamState?.isStreaming ?? false;
  const toolPills = streamState?.toolPills ?? [];
  const activeMultiAgentCount = streamState?.activeMultiAgentCount ?? 0;
  const lastFailedMessage = streamState?.lastFailedMessage ?? null;

  const displayMessages = useMemo(
    () => mergeChatDisplayMessages(messages, streamState),
    [messages, streamState],
  );

  const composerSendLockRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const narrowMobile = useMediaQuery("(max-width: 767px)");
  const { composerLiftPx, remeasure } = useKeyboardOverlapPx(composerFocused);

  const refreshThreads = useCallback(async (): Promise<ServerThread[]> => {
    try {
      const res = await fetchWithAuth(`/api/chat/threads?symbol=${encodeURIComponent(symU)}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { threads?: ServerThread[] };
      const list = data.threads ?? [];
      setThreads(list);
      return list;
    } catch {
      return [];
    }
  }, [symU]);

  const activateThread = useCallback(
    (threadId: string | null) => {
      setActiveThreadId(threadId);
      setActiveChatThreadForSymbol(symU, threadId);
    },
    [symU, setActiveChatThreadForSymbol],
  );

  const loadThreadMessages = useCallback(
    async (threadId: string) => {
      try {
        const res = await fetchWithAuth(`/api/chat/threads/${encodeURIComponent(threadId)}/messages`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          messages?: Array<{ id: string; role: string; content: string }>;
        };
        const loaded = (data.messages ?? []).map((m) => ({
          id: m.id,
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: m.content,
        }));
        setMessages(loaded);
        reconcileThreadFromServer(
          threadId,
          loaded.map((m) => m.id),
        );
      } catch {
        setMessages([]);
      }
    },
    [reconcileThreadFromServer],
  );

  useEffect(() => {
    let cancelled = false;
    setThreadsMenuOpen(false);

    void (async () => {
      const list = await refreshThreads();
      if (cancelled) return;

      const persisted = useTerminalStore.getState().activeChatThreadBySymbol[symU];
      const threadId = resolveActiveChatThreadId(list, persisted);
      if (threadId) {
        setActiveThreadId(threadId);
        setActiveChatThreadForSymbol(symU, threadId);
      } else {
        setActiveThreadId(null);
        setActiveChatThreadForSymbol(symU, null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symU, refreshThreads, setActiveChatThreadForSymbol]);

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
  }, [displayMessages, isStreaming, toolPills]);

  const handleStop = useCallback(() => {
    abortStreamForThread(activeThreadId, symU);
  }, [abortStreamForThread, activeThreadId, symU]);

  const sendMessage = useCallback(
    async (text: string, options?: { truncateToIndex?: number }) => {
      await sendChatMessage({
        text,
        symbol: symU,
        threadId: activeThreadId,
        model: modelSend,
        useMultiAgent,
        multiAgentModels,
        synthesizerModel,
        truncateToIndex: options?.truncateToIndex,
        onThreadActivated: activateThread,
        onRefreshThreads: () => {
          void refreshThreads();
        },
      });
      setInput("");
    },
    [
      activateThread,
      activeThreadId,
      modelSend,
      multiAgentModels,
      refreshThreads,
      sendChatMessage,
      symU,
      synthesizerModel,
      useMultiAgent,
    ],
  );

  const handleNewThread = useCallback(() => {
    handleStop();
    cancelAssistantSpeech();
    activateThread(null);
    setMessages([]);
    clearLastFailedForThread(null, symU);
    setThreadsMenuOpen(false);
  }, [activateThread, clearLastFailedForThread, handleStop, symU]);

  const handleSelectThread = useCallback(
    (threadId: string) => {
      cancelAssistantSpeech();
      activateThread(threadId);
      setThreadsMenuOpen(false);
    },
    [activateThread],
  );

  useEffect(() => {
    if (!activeThreadId || !streamState?.inFlightAssistant?.complete) return;
    void loadThreadMessages(activeThreadId);
  }, [
    activeThreadId,
    loadThreadMessages,
    streamState?.inFlightAssistant?.complete,
    streamState?.inFlightAssistant?.id,
  ]);

  const handleClear = handleNewThread;

  const regenerateAssistantMessage = useCallback(
    (assistantMsgId: string) => {
      if (isStreaming) return;
      const idx = displayMessages.findIndex((m) => m.id === assistantMsgId);
      if (idx < 0) return;
      let userText: string | null = null;
      for (let i = idx - 1; i >= 0; i--) {
        if (displayMessages[i]?.role === "user") {
          userText = displayMessages[i]!.content;
          break;
        }
      }
      if (!userText) return;
      cancelAssistantSpeech();
      void sendMessage(userText, { truncateToIndex: idx });
    },
    [displayMessages, isStreaming, sendMessage],
  );

  const handleRetry = useCallback(() => {
    if (!lastFailedMessage || isStreaming) return;
    const failedIdx = displayMessages.findIndex((m) => m.retryable);
    clearLastFailedForThread(activeThreadId, symU);
    cancelAssistantSpeech();
    if (failedIdx >= 0) {
      void sendMessage(lastFailedMessage, { truncateToIndex: failedIdx });
      return;
    }
    void sendMessage(lastFailedMessage);
  }, [
    activeThreadId,
    clearLastFailedForThread,
    displayMessages,
    isStreaming,
    lastFailedMessage,
    sendMessage,
    symU,
  ]);

  const handleComposerSend = useCallback(() => {
    if (composerSendLockRef.current) return;
    if (!input.trim() || isStreaming) return;
    composerSendLockRef.current = true;
    void sendMessage(input);
    textareaRef.current?.blur();
    queueMicrotask(() => {
      composerSendLockRef.current = false;
    });
  }, [input, isStreaming, sendMessage]);

  const lastDisplayMsg = displayMessages[displayMessages.length - 1];
  const showThinkingDots =
    isStreaming &&
    displayMessages.length > 0 &&
    lastDisplayMsg?.role === "assistant" &&
    !lastDisplayMsg.content.trim();

  return (
    <div className="relative flex flex-col flex-1 min-h-0 w-full max-md:max-h-none md:max-h-none md:min-h-[280px] bg-[#0a0a0a] border-t border-card-border/40">
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
                {displayMessages.length > 0 && (
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

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
          {displayMessages.length === 0 && (
            <p className="font-mono text-[14px] text-white/70 leading-relaxed">
              Ask about {symU} — the assistant calls tools for live quotes, flow, news, and technicals.
              Conversations are saved to your account.
            </p>
          )}
          {displayMessages.map((msg) => (
            <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
              {msg.role === "user" ? (
                <span className="inline-block font-mono text-[14px] text-[#f5f5f5] bg-[#1a1a1a] border border-card-border rounded px-3 py-2 max-w-[95%] text-left">
                  {msg.content}
                </span>
              ) : (
                <div>
                  {toolPills.length > 0 && msg.id === lastDisplayMsg?.id && (
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
          {showThinkingDots &&
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

        <form
          className="relative z-[60] flex shrink-0 gap-2 border-t border-card-border/50 bg-[#0a0a0a] p-2 items-end shadow-[0_-10px_30px_rgba(0,0,0,0.25)]"
          style={{
            paddingBottom: "max(10px, env(safe-area-inset-bottom, 0px))",
            ...(narrowMobile && composerLiftPx > 0
              ? { marginBottom: `${composerLiftPx}px` }
              : {}),
          }}
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
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              handleComposerSend();
            }}
            onFocus={() => {
              setComposerFocused(true);
              remeasure();
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  textareaRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
                  remeasure();
                });
              });
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
      </div>
    </div>
  );
}
