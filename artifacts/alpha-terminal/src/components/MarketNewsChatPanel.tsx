import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTerminalStore, type MarketNewsChatMessage } from "@/lib/store";
import { useGetQuote } from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Send, Square, RotateCcw, Plus, Trash2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AssistantListenButton, cancelAssistantSpeech, markdownToSpeakable } from "@/components/AssistantListenButton";
import { useVisualViewportComposerMetrics } from "@/hooks/useVisualViewportKeyboardInset";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { toast } from "sonner";

const RETRYABLE_CHAT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MULTI_AGENT_MODEL = "__multi_agent__";
const MULTI_AGENT_STORAGE_KEY = "marketNewsChatMultiModels";

const ALL_CHAT_MODELS = [
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-opus-4-20250514",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.2",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "o4-mini",
  "grok-4-1-fast-reasoning",
  "grok-4",
  "grok-3",
];

let msgCounter = 0;
function nextMsgId(): string {
  return `mnc-${Date.now()}-${++msgCounter}`;
}

export function MarketNewsChatPanel() {
  const symbol = useTerminalStore((s) => s.symbol);
  const accessToken = useTerminalStore((s) => s.accessToken);
  const aiModel = useTerminalStore((s) => s.aiFeatureSettings.chat.model);
  const setAiFeatureSetting = useTerminalStore((s) => s.setAiFeatureSetting);
  const ensureSymbol = useTerminalStore((s) => s.marketNewsChatEnsureSymbol);
  const appendMessage = useTerminalStore((s) => s.marketNewsChatAppendMessage);
  const setAssistantContent = useTerminalStore((s) => s.marketNewsChatSetAssistantContent);
  const createThread = useTerminalStore((s) => s.marketNewsChatCreateThread);
  const selectThread = useTerminalStore((s) => s.marketNewsChatSelectThread);
  const clearActiveThread = useTerminalStore((s) => s.marketNewsChatClearActiveThread);
  const deleteThread = useTerminalStore((s) => s.marketNewsChatDeleteThread);
  const bundle = useTerminalStore((s) => s.marketNewsChatBySymbol[s.symbol.toUpperCase()]);

  const symU = symbol.toUpperCase();
  const activeThreadId = bundle?.activeThreadId ?? "";
  const activeThread = bundle?.threads[activeThreadId];
  const messages = activeThread?.messages ?? [];

  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Reserve space for bottom tab bar when the keyboard is dismissed (see BottomNav). */
  const narrowMobile = useMediaQuery("(max-width: 767px)");
  const dockReservePx = narrowMobile ? (composerFocused ? 0 : 78) : 12;
  const { dockBottomPx, remeasure } = useVisualViewportComposerMetrics(dockReservePx, {
    composerFocused,
  });

  useEffect(() => {
    ensureSymbol(symU);
  }, [symU, ensureSymbol]);

  useEffect(() => {
    remeasure();
    const t1 = setTimeout(remeasure, 50);
    const t2 = setTimeout(remeasure, 400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [symU, remeasure]);

  useEffect(() => {
    setLastFailedMessage(null);
  }, [symU, activeThreadId]);

  const { data: quote } = useGetQuote(
    { symbol: symU, accessToken: accessToken || "" },
    { query: { queryKey: ["quote", symU, accessToken], enabled: !!accessToken } },
  );

  const marketContext = useMemo(() => {
    if (!quote) return `No live market context available for ${symU}.`;
    return (
      `CURRENT MARKET CONTEXT for ${symU}:\nLast: $${quote.last}\nChange: ${quote.changePct}%\n` +
      `Vol: ${quote.volume}\nRange: ${quote.low}-${quote.high}`
    );
  }, [quote, symU]);

  const modelSend = ALL_CHAT_MODELS.includes(aiModel) ? aiModel : ALL_CHAT_MODELS[0]!;
  const [useMultiAgent, setUseMultiAgent] = useState(false);
  const [multiModelPickerOpen, setMultiModelPickerOpen] = useState(false);
  const [multiAgentModels, setMultiAgentModels] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = sessionStorage.getItem(MULTI_AGENT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((m): m is string => typeof m === "string" && ALL_CHAT_MODELS.includes(m));
    } catch {
      return [];
    }
  });
  const activeModels = useMultiAgent ? multiAgentModels : [modelSend];
  const modelControlValue = useMultiAgent ? MULTI_AGENT_MODEL : modelSend;

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(MULTI_AGENT_STORAGE_KEY, JSON.stringify(multiAgentModels));
    } catch {
      /* QuotaExceededError */
    }
  }, [multiAgentModels]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  type ChatHistoryMessage = { role: "user" | "assistant"; content: string };
  type ModelSuccess = { model: string; text: string };
  type ModelFailure = { model: string; message: string; retryable: boolean };

  const normalizeFetchError = useCallback((err: unknown): { message: string; retryable: boolean } => {
    if (
      err &&
      typeof err === "object" &&
      "message" in err &&
      typeof (err as { message?: unknown }).message === "string"
    ) {
      const retryable =
        "retryable" in err && typeof (err as { retryable?: unknown }).retryable === "boolean"
          ? (err as { retryable: boolean }).retryable
          : false;
      return { message: (err as { message: string }).message, retryable };
    }
    const fallback = err instanceof Error ? err.message : "Connection failed";
    const retryable =
      fallback.includes("Failed to fetch") ||
      fallback.includes("NetworkError") ||
      fallback.includes("Load failed");
    return { message: fallback, retryable };
  }, []);

  const fetchModelReply = useCallback(
    async (
      model: string,
      history: ChatHistoryMessage[],
      signal: AbortSignal,
      onPartial?: (partial: string) => void,
    ): Promise<string> => {
      const res = await fetchWithAuth("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          marketContext,
          model,
          symbol: symU,
        }),
        signal,
      });

      const contentType = res.headers.get("content-type") || "";
      const looksLikeHtml = contentType.includes("text/html");
      if (!res.ok || looksLikeHtml) {
        const retryable = RETRYABLE_CHAT_STATUS.has(res.status) || looksLikeHtml;
        const label = !res.ok
          ? `Server returned ${res.status}`
          : "Received unexpected HTML response (API may be restarting)";
        throw { message: label, retryable };
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw { message: "Empty response stream from server.", retryable: true };
      }

      const decoder = new TextDecoder();
      let accumulated = "";
      let htmlDetected = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        if (!htmlDetected && accumulated.length < 220 && /^\s*<!DOCTYPE|^\s*<html/i.test(accumulated)) {
          htmlDetected = true;
          reader.cancel();
          break;
        }
        onPartial?.(accumulated);
      }

      if (htmlDetected) {
        throw { message: "API returned HTML instead of chat output.", retryable: true };
      }
      if (!accumulated.trim()) {
        throw { message: "Empty response from model.", retryable: true };
      }
      return accumulated.trim();
    },
    [marketContext, symU],
  );

  const synthesizeMultiModel = useCallback((successes: ModelSuccess[], failures: ModelFailure[]): string => {
    const firstSentence = (text: string): string => {
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (!cleaned) return "";
      const m = cleaned.match(/(.+?[.!?])(\s|$)/);
      return (m?.[1] ?? cleaned).slice(0, 220);
    };

    if (successes.length === 1) {
      const lines = [
        "### Consensus",
        `- Only one model succeeded: **${successes[0]!.model}**.`,
        "",
        "### Disagreements",
        "- Not applicable with a single successful model.",
      ];
      if (failures.length > 0) {
        lines.push(...failures.map((f) => `- Model failed: **${f.model}** (${f.message}).`));
      }
      lines.push("", "### Final synthesis", successes[0]!.text);
      return lines.join("\n");
    }

    const uniqueLead = [...new Set(successes.map((s) => firstSentence(s.text)).filter(Boolean))];
    const consensusLine =
      uniqueLead.length <= 1
        ? `- Models aligned on the same core answer (${successes.map((s) => `**${s.model}**`).join(", ")}).`
        : `- Models agree on the broad direction, but differ on emphasis/detail (${successes.map((s) => `**${s.model}**`).join(", ")}).`;

    const disagreementLines = successes.map((s) => `- **${s.model}**: ${firstSentence(s.text) || s.text.slice(0, 160)}`);
    const failureLines = failures.map((f) => `- Model failed: **${f.model}** (${f.message}).`);
    const finalBase = successes.slice().sort((a, b) => b.text.length - a.text.length)[0]!;

    return [
      "### Consensus",
      consensusLine,
      "",
      "### Disagreements",
      ...disagreementLines,
      ...(failureLines.length > 0 ? failureLines : []),
      "",
      "### Final synthesis",
      finalBase.text,
    ].join("\n");
  }, []);

  const runAssistantGeneration = useCallback(
    async (args: {
      tid: string;
      assistantId: string;
      history: ChatHistoryMessage[];
      sourcePrompt: string;
      allowStreamingSingle?: boolean;
    }) => {
      const { tid, assistantId, history, sourcePrompt, allowStreamingSingle = false } = args;
      const selectedModels = activeModels.filter((m): m is string => typeof m === "string" && m.length > 0);
      if (selectedModels.length === 0) {
        setAssistantContent(symU, tid, assistantId, "**Error:** Select at least one model for multi-agent.");
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      setLastFailedMessage(null);

      try {
        if (selectedModels.length === 1) {
          const singleModel = selectedModels[0]!;
          const text = await fetchModelReply(
            singleModel,
            history,
            controller.signal,
            allowStreamingSingle ? (partial) => setAssistantContent(symU, tid, assistantId, partial) : undefined,
          );
          setAssistantContent(symU, tid, assistantId, text);
          return;
        }

        setAssistantContent(
          symU,
          tid,
          assistantId,
          `Running multi-agent (${selectedModels.length} models): ${selectedModels.join(", ")}...`,
        );

        const settled = await Promise.all(
          selectedModels.map(async (model): Promise<ModelSuccess | ModelFailure> => {
            try {
              const text = await fetchModelReply(model, history, controller.signal);
              return { model, text };
            } catch (err: unknown) {
              const parsed = normalizeFetchError(err);
              return { model, message: parsed.message, retryable: parsed.retryable };
            }
          }),
        );

        const successes = settled.filter((r): r is ModelSuccess => "text" in r);
        const failures = settled.filter((r): r is ModelFailure => "message" in r);

        if (successes.length === 0) {
          const firstFailure = failures[0];
          const retryable = failures.some((f) => f.retryable);
          if (retryable) setLastFailedMessage(sourcePrompt);
          setAssistantContent(
            symU,
            tid,
            assistantId,
            `**Error:** ${firstFailure?.message ?? "All selected models failed."}${retryable ? " Please retry." : ""}`,
          );
          return;
        }

        setAssistantContent(symU, tid, assistantId, synthesizeMultiModel(successes, failures));
        if (failures.some((f) => f.retryable)) {
          setLastFailedMessage(sourcePrompt);
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        const parsed = normalizeFetchError(err);
        if (parsed.retryable) setLastFailedMessage(sourcePrompt);
        setAssistantContent(
          symU,
          tid,
          assistantId,
          `**Error:** ${parsed.message}${parsed.retryable ? ". Please retry." : ""}`,
        );
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    [activeModels, fetchModelReply, normalizeFetchError, setAssistantContent, symU, synthesizeMultiModel],
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      ensureSymbol(symU);
      const snap = useTerminalStore.getState();
      const b0 = snap.marketNewsChatBySymbol[symU];
      const tid = b0?.activeThreadId;
      if (!tid) return;

      const priorMessages = b0.threads[tid]?.messages ?? [];
      const userMsg: MarketNewsChatMessage = { id: nextMsgId(), role: "user", content: text.trim() };
      const assistantId = nextMsgId();
      appendMessage(symU, tid, userMsg);
      appendMessage(symU, tid, { id: assistantId, role: "assistant", content: "" });
      setInput("");

      const history = [...priorMessages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      await runAssistantGeneration({
        tid,
        assistantId,
        history,
        sourcePrompt: text.trim(),
        allowStreamingSingle: true,
      });
    },
    [appendMessage, ensureSymbol, isStreaming, runAssistantGeneration, symU],
  );

  const retryAssistantBubble = useCallback(
    async (assistantId: string) => {
      if (isStreaming) return;
      ensureSymbol(symU);
      const snap = useTerminalStore.getState();
      const b0 = snap.marketNewsChatBySymbol[symU];
      const tid = b0?.activeThreadId;
      if (!tid) return;

      const threadMessages = b0.threads[tid]?.messages ?? [];
      const assistantIdx = threadMessages.findIndex((m) => m.id === assistantId && m.role === "assistant");
      if (assistantIdx < 0) return;

      let userIdx = -1;
      for (let i = assistantIdx - 1; i >= 0; i -= 1) {
        if (threadMessages[i]?.role === "user") {
          userIdx = i;
          break;
        }
      }
      if (userIdx < 0) return;

      const userText = threadMessages[userIdx]!.content.trim();
      if (!userText) return;

      setAssistantContent(symU, tid, assistantId, "");
      const history = threadMessages
        .slice(0, userIdx + 1)
        .map((m) => ({ role: m.role, content: m.content }));

      await runAssistantGeneration({
        tid,
        assistantId,
        history,
        sourcePrompt: userText,
      });
    },
    [ensureSymbol, isStreaming, runAssistantGeneration, setAssistantContent, symU],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const handleRetry = useCallback(() => {
    if (!lastFailedMessage || isStreaming) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    void retryAssistantBubble(lastAssistant.id);
  }, [isStreaming, lastFailedMessage, messages, retryAssistantBubble]);

  const handleCopyAssistant = useCallback(async (content: string) => {
    const plain = markdownToSpeakable(content);
    if (!plain) return;
    try {
      await navigator.clipboard.writeText(plain);
      toast.message("Copied");
    } catch {
      toast.message("Copy failed");
    }
  }, []);

  const threadOrder = bundle?.threadOrder ?? [];

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
        onPointerDownCapture={() => {
          remeasure();
        }}
        onFocus={() => {
          setComposerFocused(true);
          remeasure();
          setTimeout(remeasure, 80);
          setTimeout(remeasure, 280);
          setTimeout(remeasure, 520);
        }}
        onBlur={() => {
          setComposerFocused(false);
          setTimeout(remeasure, 0);
          setTimeout(remeasure, 120);
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
          type="submit"
          disabled={!input.trim()}
          className="shrink-0 p-2.5 text-white disabled:opacity-30 hover:text-white/75"
          aria-label="Send"
        >
          <Send className="w-5 h-5" />
        </button>
      )}
    </form>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 max-h-[calc(100dvh-9.5rem)] md:max-h-none md:min-h-[280px] bg-[#0a0a0a] border-t border-card-border/40">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-card-border/50 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[14px] font-semibold text-white tracking-wide uppercase truncate">
            {symU}
          </span>
        </div>
        <div className="relative flex items-center gap-2 shrink-0">
          <select
            value={modelControlValue}
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
            className="bg-black/60 border border-card-border rounded px-2 py-1.5 font-mono text-[14px] text-white max-w-[180px] sm:max-w-[230px]"
            aria-label="Chat model"
          >
            <option value={MULTI_AGENT_MODEL}>multi-agent</option>
            {ALL_CHAT_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
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
          {useMultiAgent && multiModelPickerOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-[10120] min-w-[220px] rounded-md border border-card-border bg-[#0b0b0b] p-2 shadow-xl">
              <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-white/60">Select models</p>
              <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                {ALL_CHAT_MODELS.map((model) => {
                  const checked = multiAgentModels.includes(model);
                  return (
                    <label key={model} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-white/5">
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
                      <span className="font-mono text-[11px] text-white/90">{model}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-card-border/30 overflow-x-auto shrink-0">
        {threadOrder.map((tid) => {
          const t = bundle?.threads[tid];
          if (!t) return null;
          const isSel = tid === activeThreadId;
          return (
            <div key={tid} className="flex items-center shrink-0 gap-0.5">
              <button
                type="button"
                onClick={() => selectThread(symU, tid)}
                className={[
                  "font-mono text-[14px] px-2.5 py-1.5 rounded border max-w-[150px] truncate",
                  isSel ? "border-white/35 text-white bg-white/10" : "border-transparent text-white/65 hover:text-white",
                ].join(" ")}
              >
                {t.title}
              </button>
              {threadOrder.length > 1 && (
                <button
                  type="button"
                  onClick={() => deleteThread(symU, tid)}
                  className="p-0.5 text-zinc-600 hover:text-red-400"
                  aria-label={`Delete ${t.title}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => createThread(symU)}
          className="flex items-center gap-1 font-mono text-[14px] text-white/80 hover:text-white px-1.5 py-1.5 shrink-0"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
        {messages.length > 0 && (
          <>
            {lastFailedMessage && !isStreaming && (
              <button
                type="button"
                onClick={handleRetry}
                className="ml-auto flex items-center gap-1 font-mono text-[14px] text-white/80 hover:text-white px-1.5 shrink-0"
              >
                <RotateCcw className="w-3 h-3" />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                handleStop();
                cancelAssistantSpeech();
                setLastFailedMessage(null);
                clearActiveThread(symU);
              }}
              className={`${lastFailedMessage && !isStreaming ? "" : "ml-auto"} flex items-center gap-1 font-mono text-[14px] text-white/65 hover:text-white px-1.5 shrink-0`}
            >
              <RotateCcw className="w-3 h-3" />
              Clear
            </button>
          </>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "#333 transparent",
          ...(narrowMobile
            ? {
                paddingBottom: `calc(44px + ${dockBottomPx}px + env(safe-area-inset-bottom, 0px))`,
              }
            : {}),
        }}
      >
        {messages.length === 0 && (
          <p className="font-mono text-[14px] text-white/70 leading-relaxed">
            Ask about {symU} — flow, tape, and headlines load on the server for each message. Conversations
            stay per ticker until you clear them. Use <strong>New</strong> for another thread (e.g. scenarios
            vs earnings prep).
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
            {msg.role === "user" ? (
              <span className="inline-block font-mono font-medium text-[14px] text-[#f5f5f5] bg-[#1a1a1a] border border-card-border rounded px-3 py-2 max-w-[95%] text-left leading-relaxed">
                {msg.content}
              </span>
            ) : (
              <div className="text-left">
                <div
                  className="font-mono font-medium text-[14px] text-[#f5f5f5] leading-relaxed prose prose-invert prose-sm max-w-none
                prose-p:my-1 prose-p:text-[14px] prose-p:leading-relaxed prose-p:text-[#f5f5f5]
                prose-strong:text-[#f5f5f5] prose-code:text-[#f5f5f5] prose-code:text-[13px]
                prose-headings:text-[15px] prose-headings:text-[#f5f5f5] prose-headings:mt-2 prose-headings:mb-1
                prose-li:text-[14px] prose-li:text-[#f5f5f5] prose-li:my-0.5
                prose-ul:my-0.5 prose-ol:my-0.5
                prose-a:text-[#f5f5f5] prose-pre:text-[13px] prose-pre:bg-black/40 prose-pre:rounded prose-pre:p-2"
                >
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                <AssistantListenButton
                  messageId={msg.id}
                  markdownText={msg.content}
                  size="sm"
                  onCopy={() => {
                    void handleCopyAssistant(msg.content);
                  }}
                  onRetry={() => {
                    void retryAssistantBubble(msg.id);
                  }}
                  retryDisabled={isStreaming}
                />
              </div>
            )}
          </div>
        ))}
        {isStreaming && messages.length > 0 && messages[messages.length - 1]?.role === "user" && (
          <div className="flex items-center gap-1.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse" style={{ animationDelay: "300ms" }} />
          </div>
        )}
      </div>

      {narrowMobile && typeof document !== "undefined"
        ? createPortal(renderComposer(), document.body)
        : !narrowMobile
          ? renderComposer()
          : null}
    </div>
  );
}
