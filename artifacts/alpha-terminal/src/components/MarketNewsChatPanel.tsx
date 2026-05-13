import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTerminalStore, type MarketNewsChatMessage } from "@/lib/store";
import { useGetQuote } from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Send, Square, RotateCcw, Plus, Trash2, MessageSquareText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AssistantListenButton, cancelAssistantSpeech } from "@/components/AssistantListenButton";
import { useVisualViewportComposerMetrics } from "@/hooks/useVisualViewportKeyboardInset";
import { useMediaQuery } from "@/hooks/useMediaQuery";

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
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Reserve space for bottom tab bar when the keyboard is dismissed (see BottomNav). */
  const narrowMobile = useMediaQuery("(max-width: 767px)");
  const dockReservePx = narrowMobile ? 78 : 12;
  const { dockBottomPx, remeasure } = useVisualViewportComposerMetrics(dockReservePx);

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

        if (!res.ok) {
          setAssistantContent(symU, tid, assistantId, `Error ${res.status}. Try again.`);
          setIsStreaming(false);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setAssistantContent(symU, tid, assistantId, "No response.");
          setIsStreaming(false);
          return;
        }

        const decoder = new TextDecoder();
        let accumulated = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setAssistantContent(symU, tid, assistantId, accumulated);
        }

        if (!accumulated.trim()) {
          setAssistantContent(symU, tid, assistantId, "*(No response)*");
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        setAssistantContent(
          symU,
          tid,
          assistantId,
          `Error: ${(err as Error).message}`,
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
          remeasure();
          setTimeout(remeasure, 80);
          setTimeout(remeasure, 280);
          setTimeout(remeasure, 520);
        }}
        placeholder={`Ask about ${symU}…`}
        className="flex-1 resize-none bg-[#111] border border-card-border rounded-md px-2 py-1.5 font-mono text-[11px] text-white/85 placeholder:text-white/25 outline-none focus:border-primary/40 min-h-[44px]"
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
          className="shrink-0 p-2.5 rounded-md border border-primary/40 text-primary disabled:opacity-30 hover:bg-primary/10"
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </button>
      )}
    </form>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 max-h-[calc(100dvh-9.5rem)] md:max-h-none md:min-h-[280px] bg-[#0a0a0a] border-t border-card-border/40">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-card-border/50 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquareText className="w-4 h-4 text-primary shrink-0" />
          <span className="font-mono text-[10px] font-bold text-white/70 tracking-widest uppercase truncate">
            Chat · {symU}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <select
            value={modelSend}
            onChange={(e) => setAiFeatureSetting("chat", "model", e.target.value)}
            className="bg-black/60 border border-card-border rounded px-1.5 py-1 font-mono text-[9px] text-white/80 max-w-[140px] sm:max-w-[200px]"
            aria-label="Chat model"
          >
            {ALL_CHAT_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
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
                  "font-mono text-[9px] px-2 py-1 rounded border max-w-[120px] truncate",
                  isSel ? "border-primary text-primary bg-primary/10" : "border-transparent text-zinc-500 hover:text-zinc-300",
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
          className="flex items-center gap-0.5 font-mono text-[9px] text-primary/80 hover:text-primary px-1.5 py-1 shrink-0"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              handleStop();
              cancelAssistantSpeech();
              clearActiveThread(symU);
            }}
            className="ml-auto flex items-center gap-0.5 font-mono text-[9px] text-zinc-500 hover:text-zinc-300 px-1.5 shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            Clear
          </button>
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
          <p className="font-mono text-[10px] text-zinc-600 leading-relaxed">
            Ask about {symU} — flow, tape, and headlines load on the server for each message. Conversations
            stay per ticker until you clear them. Use <strong>New</strong> for another thread (e.g. scenarios
            vs earnings prep).
          </p>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
            {msg.role === "user" ? (
              <span className="inline-block font-mono text-[10px] text-primary/80 bg-primary/8 border border-primary/15 rounded px-2 py-1 max-w-[95%] text-left">
                {msg.content}
              </span>
            ) : (
              <div className="text-left">
                <div
                  className="font-mono text-[10px] text-white/70 leading-relaxed prose prose-invert prose-sm max-w-none
                prose-p:my-0.5 prose-p:text-[10px] prose-p:leading-relaxed prose-p:text-white/70
                prose-strong:text-white/90 prose-code:text-primary prose-code:text-[9px]
                prose-headings:text-[11px] prose-headings:text-white/80 prose-headings:mt-1.5 prose-headings:mb-0.5
                prose-li:text-[10px] prose-li:text-white/70 prose-li:my-0
                prose-ul:my-0.5 prose-ol:my-0.5
                prose-a:text-primary prose-pre:text-[9px] prose-pre:bg-black/40 prose-pre:rounded prose-pre:p-1.5"
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
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "150ms" }} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "300ms" }} />
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
