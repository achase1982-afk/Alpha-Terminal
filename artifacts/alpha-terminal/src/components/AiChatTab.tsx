import { useState, useRef, useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import { useRunChatQuery, useGetQuote } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Trash2, TerminalSquare, User } from "lucide-react";
import ReactMarkdown from "react-markdown";

export function AiChatTab() {
  const { symbol, accessToken, aiModel, aiTemp, chatHistory, addChatMessage, clearChat } = useTerminalStore();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Fetch latest quote to attach as market context automatically
  const { data: quote } = useGetQuote({ symbol, accessToken: accessToken || '' }, { query: { enabled: !!accessToken } });
  
  const chatMutation = useRunChatQuery();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory, chatMutation.isPending]);

  const handleSend = () => {
    if (!input.trim() || !accessToken) return;

    const userMessage = input.trim();
    setInput("");
    addChatMessage({ role: 'user', content: userMessage });

    const marketContext = quote 
      ? `CURRENT MARKET CONTEXT for ${symbol}:\nLast: $${quote.last}\nChange: ${quote.changePct}%\nVol: ${quote.volume}\nRange: ${quote.low}-${quote.high}`
      : `No live market context available for ${symbol}.`;

    chatMutation.mutate(
      { data: { question: userMessage, marketContext, model: aiModel, temperature: aiTemp } },
      {
        onSuccess: (data) => {
          addChatMessage({ role: 'assistant', content: data.response });
        },
        onError: (err) => {
          addChatMessage({ role: 'assistant', content: `**ERROR:** ${err.message}` });
        }
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto terminal-panel bg-[#0D1117] min-h-[400px]">
      
      {/* CHAT HEADER */}
      <div className="flex items-center justify-between p-3 sm:p-4 border-b border-card-border bg-card">
        <div className="flex items-center gap-2 text-primary font-mono font-bold text-sm">
          <TerminalSquare className="w-5 h-5" />
          AI TRADING ASSISTANT
        </div>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={clearChat}
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 font-mono text-xs"
        >
          <Trash2 className="w-4 h-4 mr-2" /> CLEAR CHAT
        </Button>
      </div>

      {/* CHAT HISTORY */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6"
      >
        {chatHistory.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 font-mono text-sm">
            <TerminalSquare className="w-12 h-12 mb-4" />
            READY TO ANSWER MARKET INQUIRIES CONCERNING {symbol}
          </div>
        )}

        {chatHistory.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`flex items-center gap-2 mb-1 px-1 font-mono text-[10px] uppercase tracking-wider
              ${msg.role === 'user' ? 'text-[#58A6FF]' : 'text-primary'}`}
            >
              {msg.role === 'user' ? <User className="w-3 h-3" /> : <TerminalSquare className="w-3 h-3" />}
              {msg.role === 'user' ? 'YOU' : 'AI ANALYST'}
            </div>
            
            <div className={`max-w-[85%] rounded-xl p-4 shadow-sm
              ${msg.role === 'user' 
                ? 'bg-[#1F6FEB]/10 border border-[#1F6FEB]/30 text-gray-200' 
                : 'bg-primary/5 border border-primary/20 text-gray-300'}`}
            >
              <div className="prose prose-invert prose-sm max-w-none
                prose-p:leading-relaxed prose-pre:bg-[#0D1117] prose-pre:border prose-pre:border-card-border
                prose-code:text-primary prose-a:text-primary"
              >
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}

        {chatMutation.isPending && (
          <div className="flex flex-col items-start">
             <div className="flex items-center gap-2 mb-1 px-1 font-mono text-[10px] uppercase tracking-wider text-primary">
              <TerminalSquare className="w-3 h-3" /> AI ANALYST
            </div>
            <div className="max-w-[85%] rounded-xl p-4 bg-primary/5 border border-primary/20 text-gray-300 flex items-center gap-3">
               <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
              </span>
              <span className="font-mono text-xs text-primary animate-pulse">PROCESSING...</span>
            </div>
          </div>
        )}
      </div>

      {/* CHAT INPUT */}
      <div className="p-4 border-t border-card-border bg-card">
        <div className="relative">
          <Textarea 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Ask about ${symbol} options, risk, or technicals... (Press Enter to send)`}
            className="min-h-[80px] pr-16 bg-[#0D1117] border-card-border font-mono text-sm resize-none focus-visible:ring-primary/50"
          />
          <Button 
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending || !accessToken}
            size="icon"
            className="absolute bottom-3 right-3 h-8 w-8 bg-primary hover:bg-primary/80 text-background rounded-full transition-transform hover:scale-105"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        {!accessToken && (
          <p className="text-xs text-destructive font-mono mt-2 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-destructive inline-block" /> Connect Schwab to enable AI Chat
          </p>
        )}
      </div>

    </div>
  );
}
