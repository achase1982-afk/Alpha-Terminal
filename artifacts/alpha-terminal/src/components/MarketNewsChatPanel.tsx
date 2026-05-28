import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTerminalStore } from "@/lib/store";
import { resolveActiveChatThreadId } from "@/lib/chatPersistence";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  mergeChatDisplayMessages,
  resolveChatStreamStateForSymbol,
  useChatStreamStore,
  type ChatUiMessage,
} from "@/lib/chatStreamStore";
import { Send, Square, RotateCcw, Plus, Bot, Menu, X, Paperclip } from "lucide-react";
import { CHAT_ATTACHMENT_MAX_COUNT, type ChatAttachmentInput } from "@workspace/chat-types";
import {
  CHAT_ACCEPTED_FILE_TYPES,
  filesToChatAttachments,
} from "@/lib/chatAttachments";
import { ChatUserMessage } from "@/components/ChatUserMessage";
import ReactMarkdown from "react-markdown";
import { AssistantListenButton, cancelAssistantSpeech } from "@/components/AssistantListenButton";
import { useChatComposerDock } from "@/hooks/useVisualViewportKeyboardInset";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  AI_MODEL_IDS,
  aiModelSelectLabel,
  DEFAULT_AI_MODEL_ID,
  isAiModelId,
  isAnthropicOpusEffortModel,
  migrateLegacyModelIdToCatalog,
  type AiModelId,
} from "@workspace/ai-models";
import { LlmOpusOptionsFields } from "./ai-shared/LlmOpusOptionsFields";

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

/** Within this distance (px) of the bottom, treat the user as "following" the stream. */
const CHAT_SCROLL_PIN_THRESHOLD_PX = 80;

export interface MarketNewsChatPanelProps {
  /** When true, do not portal the mobile composer (e.g. Search overlay is open). */
  hideMobileComposerDock?: boolean;
}

export function MarketNewsChatPanel({
  hideMobileComposerDock = false,
}: MarketNewsChatPanelProps = {}) {
  const symbol = useTerminalStore((s) => s.symbol);
  const aiModel = useTerminalStore((s) => s.aiFeatureSettings.chat.model);
  const anthropicOpusEffort = useTerminalStore((s) => s.aiFeatureSettings.chat.anthropicOpusEffort);
  const anthropicOpusSpeed = useTerminalStore((s) => s.aiFeatureSettings.chat.anthropicOpusSpeed);
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

  const chatUsesOpus =
    (!useMultiAgent && isAnthropicOpusEffortModel(modelSend)) ||
    (useMultiAgent &&
      (isAnthropicOpusEffortModel(synthesizerModel) ||
        multiAgentModels.some((m) => isAnthropicOpusEffortModel(m))));

  const opusControlModelId = useMultiAgent ? synthesizerModel : modelSend;

  const [threads, setThreads] = useState<ServerThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatUiMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachmentInput[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [threadsMenuOpen, setThreadsMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const streamsByThreadId = useChatStreamStore((s) => s.streamsByThreadId);
  const sendChatMessage = useChatStreamStore((s) => s.sendMessage);
  const abortStreamForThread = useChatStreamStore((s) => s.abortStreamForThread);
  const reconcileThreadFromServer = useChatStreamStore((s) => s.reconcileThreadFromServer);
  const clearLastFailedForThread = useChatStreamStore((s) => s.clearLastFailedForThread);

  const streamState = useMemo(
    () => resolveChatStreamStateForSymbol(streamsByThreadId, symU, activeThreadId),
    [streamsByThreadId, activeThreadId, symU],
  );

  const isStreaming = streamState?.isStreaming ?? false;
  const activeMultiAgentCount = streamState?.activeMultiAgentCount ?? 0;
  const lastFailedMessage = streamState?.lastFailedMessage ?? null;

  const displayMessages = useMemo(
    () => mergeChatDisplayMessages(messages, streamState),
    [messages, streamState],
  );

  const composerSendLockRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const [composerHeightPx, setComposerHeightPx] = useState(72);

  const narrowMobile = useMediaQuery("(max-width: 767px)");
  const mobileComposerDockActive = narrowMobile && !hideMobileComposerDock;
  const { dockStyle, scrollPaddingBottomPx, remeasure } = useChatComposerDock(
    mobileComposerDockActive,
    composerFocused,
    composerHeightPx,
  );

  useEffect(() => {
    if (!hideMobileComposerDock) return;
    setComposerFocused(false);
    textareaRef.current?.blur();
    remeasure();
  }, [hideMobileComposerDock, remeasure]);

  const scrollToBottom = useCallback((force = false) => {
    const el = scrollRef.current;
    if (!el) return;
    if (force || isPinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    isPinnedToBottomRef.current =
      distanceFromBottom <= CHAT_SCROLL_PIN_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const el = composerFormRef.current;
    if (!el || !narrowMobile) return;
    const measure = () => setComposerHeightPx(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [narrowMobile]);

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
          messages?: Array<{ id: string; role: string; content: string; attachments?: ChatAttachmentInput[] | null }>;
        };
        const loaded = (data.messages ?? []).map((m) => ({
          id: m.id,
          role: m.role === "user" ? ("user" as const) : ("assistant" as const),
          content: m.content,
          attachments: m.attachments?.length ? m.attachments : undefined,
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
    setMessages([]);
    setActiveThreadId(null);
    setInput("");
    setPendingAttachments([]);
    setAttachError(null);

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
    isPinnedToBottomRef.current = true;
    scrollToBottom(true);
  }, [activeThreadId, symU, scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [displayMessages, isStreaming, scrollToBottom]);

  const handleStop = useCallback(() => {
    abortStreamForThread(activeThreadId, symU);
  }, [abortStreamForThread, activeThreadId, symU]);

  const sendMessage = useCallback(
    async (
      text: string,
      options?: {
        truncateToIndex?: number;
        truncateFromMessageId?: string | null;
        attachments?: ChatAttachmentInput[];
      },
    ) => {
      isPinnedToBottomRef.current = true;
      abortStreamForThread(activeThreadId, symU);
      await sendChatMessage({
        text,
        attachments: options?.attachments,
        symbol: symU,
        threadId: activeThreadId,
        model: modelSend,
        anthropicOpusEffort,
        anthropicOpusSpeed,
        useMultiAgent,
        multiAgentModels,
        synthesizerModel,
        truncateToIndex: options?.truncateToIndex,
        truncateFromMessageId: options?.truncateFromMessageId,
        onThreadActivated: activateThread,
        onRefreshThreads: () => void refreshThreads(),
      });
    },
    [abortStreamForThread, activateThread, activeThreadId, anthropicOpusEffort, anthropicOpusSpeed, modelSend, multiAgentModels, refreshThreads, sendChatMessage, symU, synthesizerModel, useMultiAgent],
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

  /** After app backgrounding, reload transcript in case the server finished while SSE was down. */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !activeThreadId) return;
      void loadThreadMessages(activeThreadId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [activeThreadId, loadThreadMessages]);

  /** When returning to chat (e.g. Chart tab), pull transcript if the reply finished off-screen. */
  useEffect(() => {
    if (!activeThreadId) return;
    const stream = resolveChatStreamStateForSymbol(
      useChatStreamStore.getState().streamsByThreadId,
      symU,
      activeThreadId,
    );
    if (stream?.isStreaming || stream?.inFlightAssistant) {
      void loadThreadMessages(activeThreadId);
    }
  }, [activeThreadId, symU, loadThreadMessages]);

  const handleClear = handleNewThread;

  const regenerateAssistantMessage = useCallback(
    (assistantMsgId: string) => {
      const idx = displayMessages.findIndex((m) => m.id === assistantMsgId);
      if (idx < 0) return;
      let userMsg: ChatUiMessage | null = null;
      for (let i = idx - 1; i >= 0; i--) {
        if (displayMessages[i]?.role === "user") userMsg = displayMessages[i]!;
      }
      if (!userMsg || (!userMsg.content.trim() && !(userMsg.attachments?.length ?? 0))) return;
      cancelAssistantSpeech();
      void sendMessage(userMsg.content, {
        truncateToIndex: idx,
        truncateFromMessageId: assistantMsgId,
        attachments: userMsg.attachments,
      });
    },
    [displayMessages, sendMessage],
  );

  const handleEditUserMessage = useCallback(
    (messageId: string, messageIndex: number, nextText: string) => {
      cancelAssistantSpeech();
      const truncateFromMessageId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId) ? messageId : null;
      void sendMessage(nextText, { truncateToIndex: messageIndex, truncateFromMessageId });
    },
    [sendMessage],
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
    const text = input.trim();
    const attachments = pendingAttachments;
    if ((!text && attachments.length === 0) || isStreaming) return;
    composerSendLockRef.current = true;
    setInput("");
    setPendingAttachments([]);
    setAttachError(null);
    void sendMessage(text, { attachments: attachments.length > 0 ? attachments : undefined });
    textareaRef.current?.blur();
    window.setTimeout(() => { composerSendLockRef.current = false; }, 400);
  }, [input, isStreaming, pendingAttachments, sendMessage]);

  const handlePickFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setAttachError(null);
    try {
      const added = await filesToChatAttachments(files);
      setPendingAttachments((prev) => [...prev, ...added].slice(0, CHAT_ATTACHMENT_MAX_COUNT));
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : "Could not attach file");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const renderComposer = (extraStyle?: CSSProperties) => (
    <form
      ref={composerFormRef}
      className={[
        "relative flex gap-2 border-t border-card-border/50 bg-[#0a0a0a] p-2 items-end",
        narrowMobile
          ? "shadow-[0_-10px_30px_rgba(0,0,0,0.45)]"
          : "relative z-[60] shrink-0 shadow-[0_-10px_30px_rgba(0,0,0,0.25)]",
      ].join(" ")}
      style={{
        paddingBottom:
          narrowMobile && composerFocused
            ? "8px"
            : "max(10px, env(safe-area-inset-bottom, 0px))",
        ...extraStyle,
      }}
      onSubmit={(e) => { e.preventDefault(); handleComposerSend(); }}
    >
      <input ref={fileInputRef} type="file" accept={CHAT_ACCEPTED_FILE_TYPES} multiple className="hidden" onChange={(e) => void handlePickFiles(e.target.files)} />
      {(pendingAttachments.length > 0 || attachError) && (
        <div className="absolute left-2 right-2 bottom-full mb-1 flex flex-col gap-1">
          {attachError && <p className="font-mono text-[11px] text-red-300/90">{attachError}</p>}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {pendingAttachments.map((att) => (
                <span key={att.id} className="inline-flex items-center gap-1 font-mono text-[11px] text-white/80 bg-[#1a1a1a] border border-card-border rounded px-2 py-0.5">
                  {att.name}
                  <button type="button" className="text-white/50 hover:text-white" aria-label={`Remove ${att.name}`} onClick={() => setPendingAttachments((prev) => prev.filter((a) => a.id !== att.id))}>
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <button type="button" disabled={isStreaming || pendingAttachments.length >= CHAT_ATTACHMENT_MAX_COUNT} onClick={() => fileInputRef.current?.click()} className="shrink-0 p-2.5 rounded-md border border-card-border text-white/75 hover:text-white disabled:opacity-30" aria-label="Attach file or photo">
        <Paperclip className="w-4 h-4" />
      </button>
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
          disabled={!input.trim() && pendingAttachments.length === 0}
          onPointerDown={(e) => {
            if ((!input.trim() && pendingAttachments.length === 0) || isStreaming) return;
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

  const lastDisplayMsg = displayMessages[displayMessages.length - 1];
  const inFlightAssistantTurn =
    isStreaming &&
    displayMessages.length > 0 &&
    lastDisplayMsg?.role === "assistant" &&
    !lastDisplayMsg.content.trim();
  const showThinkingLabel =
    inFlightAssistantTurn && activeMultiAgentCount <= 1;

  return (
    <div className="relative flex flex-col flex-1 min-h-0 w-full max-md:max-h-none md:max-h-none md:min-h-[280px] bg-[#0a0a0a] border-t border-card-border/40">
      <div className="shrink-0 border-b border-card-border/50">
      <div className="flex items-center justify-between gap-2 px-3 py-2 flex-wrap">
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
      {chatUsesOpus && (
        <div className="px-3 pb-2">
          <LlmOpusOptionsFields
            compact
            modelId={opusControlModelId}
            effort={anthropicOpusEffort}
            speed={anthropicOpusSpeed}
            onEffortChange={(effort) => setAiFeatureSetting("chat", "anthropicOpusEffort", effort)}
            onSpeedChange={(speed) => setAiFeatureSetting("chat", "anthropicOpusSpeed", speed)}
          />
        </div>
      )}
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

        <div
          ref={scrollRef}
          onScroll={handleMessagesScroll}
          className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2"
          style={
            mobileComposerDockActive
              ? { paddingBottom: `${scrollPaddingBottomPx}px` }
              : undefined
          }
        >
          {displayMessages.length === 0 && (
            <p className="font-mono text-[14px] text-white/70 leading-relaxed">
              Ask about {symU} — the assistant calls tools for live quotes, flow, news, and technicals.
              Conversations are saved to your account.
            </p>
          )}
          {displayMessages.map((msg, msgIndex) => (
            <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
              {msg.role === "user" ? (
                <ChatUserMessage
                  content={msg.content}
                  attachments={msg.attachments}
                  onEditConfirm={(nextText) => handleEditUserMessage(msg.id, msgIndex, nextText)}
                />
              ) : (
                <div>
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
          {showThinkingLabel && (
            <p className="text-left font-mono text-[14px] text-white py-1" aria-live="polite">
              thinking
            </p>
          )}
          {inFlightAssistantTurn && activeMultiAgentCount > 1 && (
            <div className="flex items-center gap-2 py-1">
              <MultiAgentOrbit count={activeMultiAgentCount} />
              <span className="font-mono text-[14px] text-white">thinking</span>
            </div>
          )}
        </div>

        {!narrowMobile && renderComposer()}
      </div>

      {mobileComposerDockActive && typeof document !== "undefined"
        ? createPortal(renderComposer(dockStyle), document.body)
        : null}
    </div>
  );
}
