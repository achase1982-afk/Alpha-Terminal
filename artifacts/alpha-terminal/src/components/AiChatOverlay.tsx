import { useState, useRef, useEffect, useCallback } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetQuote } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { X, Send, TerminalSquare, TrendingUp } from "lucide-react";
import ReactMarkdown from "react-markdown";

const API_BASE = "/api";

function getChipsForSymbol(symbol: string): string[] {
  return [
    `Analyze ${symbol} price action`,
    `Key technical levels for ${symbol}?`,
    `Options strategy for ${symbol}`,
    `Sentiment & risk for ${symbol}?`,
    `Catalysts for ${symbol} this week`,
  ];
}

interface AiChatOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AiChatOverlay({ isOpen, onClose }: AiChatOverlayProps) {
  const {
    symbol, accessToken, aiModel, aiTemp,
    chatHistory, addChatMessage, clearChat,
  } = useTerminalStore();

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { enabled: !!accessToken } }
  );

  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, isChatLoading]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const cancelPending = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsChatLoading(false);
  }, []);

  const handleSend = () => {
    if (!chatInput.trim() || !accessToken || isChatLoading) return;
    const userMessage = chatInput.trim();
    setChatInput("");

    addChatMessage({ role: "user", content: userMessage });

    const marketContext = quote
      ? `CURRENT MARKET CONTEXT for ${symbol}:\nLast: $${quote.last}\nChange: ${quote.changePct}%\nVol: ${quote.volume}\nRange: ${quote.low}-${quote.high}`
      : `No live market context available for ${symbol}.`;

    const controller = new AbortController();
    abortRef.current = controller;
    setIsChatLoading(true);
    fetch(`${API_BASE}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: userMessage, marketContext, model: aiModel, temperature: aiTemp }),
      signal: controller.signal,
    })
      .then(r => r.json())
      .then((data: { response?: string }) => {
        addChatMessage({ role: "assistant", content: data.response ?? "No response." });
      })
      .catch(err => {
        if (err.name !== "AbortError") {
          addChatMessage({ role: "assistant", content: `**ERROR:** ${err.message}` });
        }
      })
      .finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsChatLoading(false);
        }
      });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" style={{ background: "#0A0F16" }}>
      <div className="flex items-center justify-between px-4 h-12 border-b border-card-border bg-[#0D1117] shrink-0">
        <div className="flex items-center gap-2">
          <TerminalSquare className="w-4 h-4 text-primary" />
          <span className="font-mono text-xs font-bold text-primary tracking-wider">AI ASSISTANT</span>
          <span className="font-mono text-[10px] text-muted-foreground">— {symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          {chatHistory.length > 0 && (
            <button
              onClick={() => { cancelPending(); clearChat(); }}
              className="font-mono text-[9px] text-muted-foreground hover:text-destructive transition-colors px-2 py-1"
            >
              CLEAR
            </button>
          )}
          <button
            onClick={() => { cancelPending(); onClose(); }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors"
            aria-label="Close chat"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
        {chatHistory.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <TerminalSquare className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-sans font-bold text-foreground text-lg mb-1">AI Trading Assistant</h3>
            <p className="font-mono text-[11px] text-muted-foreground mb-6 leading-relaxed">
              Ask about technicals, options strategies, market sentiment, risk profiles, and more.
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-sm">
              {getChipsForSymbol(symbol).map(chip => (
                <button
                  key={chip}
                  onClick={() => { setChatInput(chip); inputRef.current?.focus(); }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20
                    text-primary font-mono text-[10px] hover:bg-primary/20 transition-colors"
                >
                  <TrendingUp className="w-2.5 h-2.5 shrink-0" />
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {chatHistory.map((msg, i) => (
          <div
            key={i}
            className={`flex mb-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] px-3.5 py-2.5 shadow-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md"
                  : "bg-[#1C2333] text-gray-200 rounded-2xl rounded-bl-md border border-card-border"
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
            </div>
          </div>
        ))}

        {isChatLoading && (
          <div className="flex justify-start mb-3">
            <div className="bg-[#1C2333] border border-card-border rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
              <span className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-card-border bg-[#0D1117] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message about ${symbol}...`}
            rows={1}
            className="flex-1 min-h-[40px] max-h-[120px] px-3.5 py-2.5 rounded-2xl bg-[#161B22] border border-card-border
              text-sm text-foreground placeholder:text-muted-foreground/50 resize-none
              focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          <Button
            onClick={handleSend}
            disabled={!chatInput.trim() || !accessToken || isChatLoading}
            size="icon"
            className="h-10 w-10 rounded-full bg-primary hover:bg-primary/80 text-primary-foreground shrink-0 disabled:opacity-30"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        {!accessToken && (
          <p className="text-[10px] text-destructive font-mono mt-1.5 text-center">
            Connect Schwab to enable AI chat
          </p>
        )}
      </div>
    </div>
  );
}
