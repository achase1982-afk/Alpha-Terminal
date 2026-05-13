import { useState, useRef, useEffect, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetQuote } from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Send, Square, RotateCcw, BrainCircuit } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AssistantListenButton, cancelAssistantSpeech } from "@/components/AssistantListenButton";
import { useVisualViewportComposerMetrics } from "@/hooks/useVisualViewportKeyboardInset";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

let msgCounter = 0;
function nextId(): string {
  return `sc-${Date.now()}-${++msgCounter}`;
}

export function SidebarChat() {
  const { symbol, accessToken, aiFeatureSettings } = useTerminalStore();
  const aiModel = aiFeatureSettings.chat.model;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { keyboardInset, remeasure } = useVisualViewportComposerMetrics(0);

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { queryKey: ["quote", symbol, accessToken], enabled: !!accessToken } }
  );

  const marketContext = quote
    ? `CURRENT MARKET CONTEXT for ${symbol}: Last: $${quote.last}, Change: ${quote.changePct}%, Vol: ${quote.volume}`
    : `No live market context available for ${symbol}.`;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = { id: nextId(), role: "user", content: text.trim() };
    const assistantId = nextId();

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);
    setIsExpanded(true);

    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetchWithAuth("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, marketContext, model: aiModel, symbol }),
        signal: controller.signal,
      });

      if (!res.ok) {
        setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: `Error ${res.status}. Try again.` }]);
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "No response." }]);
        setIsStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = "";
      setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const current = accumulated;
        setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, content: current } : m)));
      }

      if (!accumulated.trim()) {
        setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, content: "*(No response)*" } : m)));
      }
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: `Error: ${(err as Error).message}` }]);
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, [messages, marketContext, isStreaming, aiModel, symbol]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const handleClear = useCallback(() => {
    handleStop();
    cancelAssistantSpeech();
    setMessages([]);
    setIsExpanded(false);
  }, [handleStop]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isStreaming) sendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isStreaming) sendMessage(input);
    }
  };

  return (
    <div className="rounded-lg border border-card-border bg-[#0a0a0a] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border/50">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-3.5 h-3.5 text-primary" />
          <span className="font-mono text-[10px] font-bold text-white/70 tracking-widest uppercase">AI</span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="font-mono text-[8px] text-white/30 hover:text-white/60 transition-colors tracking-wider uppercase flex items-center gap-1"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Clear
          </button>
        )}
      </div>

      {isExpanded && messages.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-[240px] overflow-y-auto px-2.5 py-2 space-y-2"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#333 transparent" }}
        >
          {messages.map((msg) => (
            <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
              {msg.role === "user" ? (
                <span className="inline-block font-mono text-[10px] text-primary/80 bg-primary/8 border border-primary/15 rounded px-2 py-1 max-w-[90%] text-left">
                  {msg.content}
                </span>
              ) : (
                <div className="text-left">
                  <div className="font-mono text-[10px] text-white/70 leading-relaxed prose prose-invert prose-sm max-w-none
                    prose-p:my-0.5 prose-p:text-[10px] prose-p:leading-relaxed prose-p:text-white/70
                    prose-strong:text-white/90 prose-code:text-primary prose-code:text-[9px]
                    prose-headings:text-[11px] prose-headings:text-white/80 prose-headings:mt-1.5 prose-headings:mb-0.5
                    prose-li:text-[10px] prose-li:text-white/70 prose-li:my-0
                    prose-ul:my-0.5 prose-ol:my-0.5
                    prose-a:text-primary prose-pre:text-[9px] prose-pre:bg-black/40 prose-pre:rounded prose-pre:p-1.5">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                  <AssistantListenButton messageId={msg.id} markdownText={msg.content} size="sm" />
                </div>
              )}
            </div>
          ))}

          {isStreaming && messages.length > 0 && messages[messages.length - 1].role === "user" && (
            <div className="flex items-center gap-1.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-1.5 px-2 py-1.5"
        style={{
          paddingBottom: `calc(${keyboardInset}px + max(6px, env(safe-area-inset-bottom, 0px)))`,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (messages.length > 0) setIsExpanded(true);
            remeasure();
            setTimeout(remeasure, 80);
            setTimeout(remeasure, 280);
            requestAnimationFrame(() => {
              inputRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            });
          }}
          placeholder={`Ask about ${symbol}...`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 bg-transparent border-none outline-none font-mono text-[11px] text-white/80 placeholder:text-white/20 min-w-0"
        />
        {isStreaming ? (
          <button type="button" onClick={handleStop} className="p-1 text-red-400 hover:text-red-300 transition-colors shrink-0">
            <Square className="w-3 h-3 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="p-1 text-primary/50 hover:text-primary disabled:text-white/10 transition-colors shrink-0"
          >
            <Send className="w-3 h-3" />
          </button>
        )}
      </form>
    </div>
  );
}
