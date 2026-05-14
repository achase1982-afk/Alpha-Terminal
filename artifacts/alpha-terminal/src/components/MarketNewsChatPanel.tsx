import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTerminalStore, type MarketNewsChatMessage } from "@/lib/store";
import { useGetQuote } from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Send, Square, RotateCcw, Plus, Trash2, MessageSquare } from "lucide-react";
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

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
      setInput("");
      setIsStreaming(true);
      setLastFailedMessage(null);

      const history = [...priorMessages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const controller = new AbortController();
      abortRef.current = controller;

      appendMessage(symU, tid, { id: assistantId, role: "assistant", content: "" });

      try {
        const res = await fetchWithAuth("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            marketContext,
            model: modelSend,
            symbol: symU,
          }),
          signal: controller.signal,
        });

        const contentType = res.headers.get("content-type") || "";
        const looksLikeHtml = contentType.includes("text/html");
        if (!res.ok || looksLikeHtml) {
          const retryable = RETRYABLE_CHAT_STATUS.has(res.status) || looksLikeHtml;
          const label = !res.ok
            ? `Server returned ${res.status}`
            : "Received unexpected HTML response (API may be restarting)";
          setAssistantContent(
            symU,
            tid,
            assistantId,
            `**Error:** ${label}.${retryable ? " Please retry in a moment." : ""}`,
          );
          if (retryable) setLastFailedMessage(text.trim());
          setIsStreaming(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setAssistantContent(
            symU,
            tid,
            assistantId,
            "**Error:** Empty response stream from server. Please retry.",
          );
          setLastFailedMessage(text.trim());
          setIsStreaming(false);
          return;
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

          setAssistantContent(symU, tid, assistantId, accumulated);
        }

        if (htmlDetected) {
          setAssistantContent(
            symU,
            tid,
            assistantId,
            "**Error:** API returned HTML instead of chat output. Please retry in a moment.",
          );
          setLastFailedMessage(text.trim());
          return;
        }

        if (!accumulated.trim()) {
          setAssistantContent(
            symU,
            tid,
            assistantId,
            "**Error:** Empty response from model. Please retry.",
          );
          setLastFailedMessage(text.trim());
        } else {
          setLastFailedMessage(null);
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        const errMsg = (err as Error).message || "Connection failed";
        const retryable =
          errMsg.includes("Failed to fetch") ||
          errMsg.includes("NetworkError") ||
          errMsg.includes("Load failed");
        if (retryable) setLastFailedMessage(text.trim());
        setAssistantContent(
          symU,
          tid,
          assistantId,
          `**Error:** ${errMsg}${retryable ? ". Please retry." : ""}`,
        );
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [
      symU,
      isStreaming,
      marketContext,
      modelSend,
      ensureSymbol,
      appendMessage,
      setAssistantContent,
    ],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const handleRetry = useCallback(() => {
    if (!lastFailedMessage || isStreaming) return;
    const retryText = lastFailedMessage;
    setLastFailedMessage(null);
    void sendMessage(retryText);
  }, [lastFailedMessage, isStreaming, sendMessage]);

  const threadOrder = bundle?.threadOrder ?? [];

  const renderComposer = () => (
    <form
      className={[
        "flex items-center gap-1.5 border-t border-card-border/40 bg-[#0a0a0a] px-2 py-1.5",
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
          : { paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }
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
        className="min-h-[36px] max-h-[88px] flex-1 resize-y rounded border border-primary/15 bg-primary/5 px-2 py-1.5 font-mono text-[11px] leading-snug text-white/80 outline-none placeholder:text-white/25 focus:border-primary/35"
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={handleStop}
          className="shrink-0 p-1 text-red-400 transition-colors hover:text-red-300"
          aria-label="Stop"
        >
          <Square className="w-3 h-3 fill-current" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!input.trim()}
          className="shrink-0 p-1 text-primary/50 transition-colors hover:text-primary disabled:text-white/10"
          aria-label="Send"
        >
          <Send className="w-3 h-3" />
        </button>
      )}
    </form>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0a0a0a]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-card-border/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-white/70">Chat</span>
          <span className="truncate font-mono text-[9px] text-white/35">{symU}</span>
        </div>
        <select
          value={modelSend}
          onChange={(e) => setAiFeatureSetting("chat", "model", e.target.value)}
          className="max-w-[min(160px,46vw)] shrink-0 rounded border border-card-border/60 bg-black/50 px-1.5 py-1 font-mono text-[9px] text-white/90"
          aria-label="Chat model"
        >
          {ALL_CHAT_MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-card-border/30 px-2 py-1">
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
                  "max-w-[140px] truncate rounded border px-2 py-1 font-mono text-[10px]",
                  isSel ? "border-primary/35 bg-primary/10 text-white" : "border-transparent text-white/55 hover:text-white/90",
                ].join(" ")}
              >
                {t.title}
              </button>
              {threadOrder.length > 1 && (
                <button
                  type="button"
                  onClick={() => deleteThread(symU, tid)}
                  className="p-0.5 text-white/25 hover:text-red-400"
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
          className="flex shrink-0 items-center gap-0.5 px-1 py-1 font-mono text-[9px] uppercase tracking-wider text-primary/70 hover:text-primary"
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
                className="ml-auto flex shrink-0 items-center gap-1 px-1 font-mono text-[8px] uppercase tracking-wider text-white/40 hover:text-white/70"
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
              className={`${lastFailedMessage && !isStreaming ? "" : "ml-auto"} flex shrink-0 items-center gap-1 px-1 font-mono text-[8px] uppercase tracking-wider text-white/30 hover:text-white/60`}
            >
              <RotateCcw className="w-3 h-3" />
              Clear
            </button>
          </>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 py-2"
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
          <p className="font-mono text-[10px] leading-relaxed text-white/45">
            Ask about {symU} — server loads flow, tape, and headlines per message. Threads stay on this symbol; use{" "}
            <span className="text-primary/80">New</span> for another scenario.
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
            {msg.role === "user" ? (
              <span className="inline-block max-w-[90%] rounded border border-primary/15 bg-primary/8 px-2 py-1 text-left font-mono text-[10px] text-primary/80">
                {msg.content}
              </span>
            ) : (
              <div className="space-y-2 text-left">
                <div
                  className="max-w-none font-mono text-[10px] leading-relaxed text-white/70 prose prose-invert prose-sm
                    prose-p:my-0.5 prose-p:text-[10px] prose-p:leading-relaxed prose-p:text-white/70
                    prose-strong:text-white/90 prose-code:text-primary prose-code:text-[9px]
                    prose-headings:text-[11px] prose-headings:text-white/80 prose-headings:mt-1.5 prose-headings:mb-0.5
                    prose-li:my-0 prose-li:text-[10px] prose-li:text-white/70
                    prose-ul:my-0.5 prose-ol:my-0.5
                    prose-a:text-primary prose-pre:rounded prose-pre:bg-black/40 prose-pre:p-1.5 prose-pre:text-[9px]"
                >
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                <AssistantListenButton messageId={msg.id} markdownText={msg.content} size="sm" />
              </div>
            )}
          </div>
        ))}
        {isStreaming && messages.length > 0 && messages[messages.length - 1]?.role === "user" && (
          <div className="flex items-center gap-1.5 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" style={{ animationDelay: "150ms" }} />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" style={{ animationDelay: "300ms" }} />
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
