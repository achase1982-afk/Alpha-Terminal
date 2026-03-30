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
        className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-400 transition-colors py-2 px-1"
      >
        <span className="text-emerald-500">&#9679;</span>
        View AI Reasoning ({texts.length} tokens)
      </button>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {isStreaming && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          )}
          {!isStreaming && (
            <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500/50" />
          )}
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
            AI Reasoning
          </span>
        </div>
        {!isStreaming && texts.length > 0 && (
          <button
            onClick={() => setIsExpanded(false)}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Hide
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="max-h-[150px] overflow-y-auto px-3 pb-3 border-l-2 border-emerald-500/30 ml-3"
        style={{ scrollBehavior: "smooth" }}
      >
        <div className="text-xs font-mono text-zinc-400 leading-relaxed whitespace-pre-wrap break-words">
          {texts.length === 0 && isStreaming && (
            <span className="text-zinc-500">Waiting for AI reasoning...</span>
          )}
          {texts.map((text, i) => (
            <span key={i}>{text}</span>
          ))}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 bg-emerald-500 ml-0.5 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}
