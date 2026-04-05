import { useState, useRef, useEffect, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetQuote } from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Button } from "@/components/ui/button";
import { X, Send, Search, Square, RotateCw } from "lucide-react";
import ReactMarkdown from "react-markdown";

function getChipsForSymbol(symbol: string): string[] {
  return [
    `${symbol} key levels`,
    `${symbol} P/E & EPS`,
    `${symbol} vs sector`,
    `${symbol} earnings date`,
    `Top movers today`,
  ];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  retryable?: boolean;
}

interface AiChatOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

let msgCounter = 0;
function nextId(): string {
  return `msg-${Date.now()}-${++msgCounter}`;
}

export function AiChatOverlay({ isOpen, onClose }: AiChatOverlayProps) {
  const { symbol, accessToken, aiFeatureSettings } = useTerminalStore();
  const aiModel = aiFeatureSettings.chat.model;

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { queryKey: ["quote", symbol, accessToken], enabled: !!accessToken } }
  );

  const marketContext = quote
    ? `CURRENT MARKET CONTEXT for ${symbol}:\nLast: $${quote.last}\nChange: ${quote.changePct}%\nVol: ${quote.volume}\nRange: ${quote.low}-${quote.high}`
    : `No live market context available for ${symbol}.`;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = { id: nextId(), role: "user", content: text.trim() };
    const assistantId = nextId();

    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);

    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetchWithAuth("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, marketContext, model: aiModel }),
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") || "";

      if (!res.ok || contentType.includes("text/html")) {
        const isRetryable = [404, 502, 503, 504].includes(res.status) || contentType.includes("text/html");
        const label = !res.ok
          ? `Server returned ${res.status}`
          : "Received unexpected HTML response — the API server may be restarting";
        setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: `**Error:** ${label}. Please try again in a moment.`, retryable: isRetryable }]);
        if (isRetryable) setLastFailedMessage(text.trim());
        setIsStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "**Error:** No response stream." }]);
        setIsStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = "";

      setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      let htmlDetected = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });

        if (!htmlDetected && accumulated.length < 200 && /^\s*<!DOCTYPE|^\s*<html/i.test(accumulated)) {
          htmlDetected = true;
          reader.cancel();
          break;
        }

        const current = accumulated;
        setMessages(prev =>
          prev.map(m => (m.id === assistantId ? { ...m, content: current } : m))
        );
      }

      if (htmlDetected) {
        setMessages(prev =>
          prev.map(m => (m.id === assistantId ? { ...m, content: "**Error:** The API server may be restarting. Please try again in a moment.", retryable: true } : m))
        );
        setLastFailedMessage(text.trim());
      } else {
        const trimmed = accumulated.trim();
        if (!trimmed) {
          setMessages(prev =>
            prev.map(m => (m.id === assistantId ? { ...m, content: "*(No response generated)*" } : m))
          );
        } else {
          setMessages(prev =>
            prev.map(m => (m.id === assistantId ? { ...m, content: trimmed } : m))
          );
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") return;
      const errMsg = (err as Error).message || "Connection failed";
      const isNetworkError = errMsg.includes("Failed to fetch") || errMsg.includes("NetworkError") || errMsg.includes("Load failed");
      setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: `**Error:** ${errMsg}`, retryable: isNetworkError }]);
      if (isNetworkError) setLastFailedMessage(text.trim());
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, [messages, marketContext, isStreaming]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const handleClear = useCallback(() => {
    handleStop();
    setMessages([]);
    setLastFailedMessage(null);
  }, [handleStop]);

  const handleRetry = useCallback(() => {
    if (!lastFailedMessage || isStreaming) return;
    setMessages(prev => prev.filter(m => !m.retryable));
    setLastFailedMessage(null);
    setTimeout(() => sendMessage(lastFailedMessage), 2000);
  }, [lastFailedMessage, isStreaming, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isStreaming) {
        sendMessage(input);
      }
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isStreaming) {
      sendMessage(input);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: "#0c0c0c" }}>
      <div className="flex items-center justify-between px-4 h-12 border-b border-card-border bg-[#0c0c0c] shrink-0">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-primary" />
          <span className="font-mono text-xs font-light text-primary tracking-wider">SEARCH</span>
          <span className="font-mono text-[10px] text-muted-foreground">— {symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="font-mono text-[9px] text-muted-foreground hover:text-destructive transition-colors px-2 py-1"
            >
              CLEAR
            </button>
          )}
          <button
            onClick={() => { handleStop(); onClose(); }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors"
            aria-label="Close chat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-16 h-16 rounded-2xl border border-primary/20 flex items-center justify-center mb-4">
              <Search className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-sans font-light text-foreground text-lg mb-1">Ask anything</h3>
            <p className="font-mono text-[11px] text-muted-foreground mb-6 leading-relaxed">
              Stocks, fundamentals, macro, earnings — or anything else.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-sm">
              {getChipsForSymbol(symbol).map(chip => (
                <button
                  key={chip}
                  onClick={() => { setInput(chip); inputRef.current?.focus(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary/20
                    text-primary font-mono text-[10px] hover:border-primary/40 transition-colors"
                >
                  <Search className="w-2.5 h-2.5 shrink-0" />
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex mb-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] px-3.5 py-2.5 shadow-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md"
                  : "bg-[#1a1a1a] text-gray-200 rounded-2xl rounded-bl-md border border-card-border"
              }`}
            >
              <div className={`prose prose-sm max-w-none ${
                msg.role === "user"
                  ? "prose-invert prose-p:text-primary-foreground"
                  : "prose-invert prose-p:text-gray-200"
              } prose-p:leading-relaxed prose-p:my-1 prose-pre:text-xs prose-code:text-primary prose-a:text-primary
                prose-headings:text-foreground prose-li:text-gray-200 prose-strong:text-white`}>
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
              {msg.retryable && !isStreaming && (
                <button
                  onClick={handleRetry}
                  className="mt-2 flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  <RotateCw className="w-3 h-3" />
                  Retry
                </button>
              )}
            </div>
          </div>
        ))}

        {isStreaming && messages.length > 0 && messages[messages.length - 1].role === "user" && (
          <div className="flex justify-start mb-3">
            <div className="bg-[#1a1a1a] border border-card-border rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
              <span className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
              <span className="text-xs text-muted-foreground ml-1">Claude is searching live data...</span>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-card-border bg-[#0c0c0c] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <form onSubmit={handleFormSubmit} className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Search ${symbol}, markets, anything...`}
            rows={1}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            name="ai-chat-input"
            className="flex-1 min-h-[40px] max-h-[120px] px-3.5 py-2.5 rounded-2xl bg-[#141414] border border-card-border
              text-sm text-foreground placeholder:text-muted-foreground/50 resize-none
              focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          {isStreaming ? (
            <Button
              type="button"
              onClick={handleStop}
              size="icon"
              className="h-10 w-10 rounded-full bg-destructive hover:bg-destructive/80 text-destructive-foreground shrink-0"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!input.trim()}
              size="icon"
              className="h-10 w-10 rounded-full bg-primary hover:bg-primary/80 text-primary-foreground shrink-0 disabled:opacity-30"
            >
              <Send className="w-4 h-4" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
