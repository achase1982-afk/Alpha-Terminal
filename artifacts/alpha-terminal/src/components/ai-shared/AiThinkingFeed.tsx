import { useEffect, useRef, useState } from "react";

interface AiThinkingFeedProps {
  texts: string[];
  isStreaming: boolean;
  className?: string;
}

export function AiThinkingFeed({ texts, isStreaming, className = "" }: AiThinkingFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (scrollRef.current && isStreaming) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [texts, isStreaming]);

  if (!isStreaming && texts.length === 0) return null;

  if (!isStreaming && texts.length > 0 && !isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="flex items-center gap-2 text-xs text-[#52525b] hover:text-[#a1a1aa] transition-colors py-2 px-3"
      >
        <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500/50" />
        <span className="font-mono text-[10px] tracking-wider">View Ai Reasoning</span>
      </button>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          ) : (
            <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500/50" />
          )}
          <span className="font-mono text-[9px] font-light text-emerald-500/70 tracking-widest">
            AI Reasoning
          </span>
        </div>
        {!isStreaming && texts.length > 0 && (
          <button
            onClick={() => setIsExpanded(false)}
            className="font-mono text-[9px] text-[#3f3f46] hover:text-[#71717a] transition-colors tracking-wider"
          >
            Hide
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="max-h-[150px] overflow-y-auto px-4 pb-3 relative"
        style={{ scrollBehavior: "smooth" }}
      >
        <div className="font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-words"
          style={{ color: "#4ade80" }}>
          {texts.length === 0 && isStreaming && (
            <span style={{ color: "#2A2A2C" }}>Awaiting AI output...</span>
          )}
          {texts.map((text, i) => (
            <span key={i}>{text}</span>
          ))}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 ml-0.5 animate-pulse" style={{ background: "#4ade80" }} />
          )}
        </div>
        <div className="pointer-events-none absolute inset-0" style={{
          backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)",
          backgroundSize: "100% 4px",
        }} />
      </div>
    </div>
  );
}
