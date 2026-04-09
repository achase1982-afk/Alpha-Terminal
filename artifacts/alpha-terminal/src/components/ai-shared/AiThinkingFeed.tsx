import { useEffect, useRef, useState } from "react";

interface AiThinkingFeedProps {
  texts: string[];
  isStreaming: boolean;
  className?: string;
}

export function AiThinkingFeed({ texts, isStreaming, className = "" }: AiThinkingFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setCollapsed(false);
    }
  }, [isStreaming]);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && texts.length > 0) {
      const timer = setTimeout(() => setCollapsed(true), 900);
      prevStreamingRef.current = false;
      return () => clearTimeout(timer);
    }
    if (isStreaming) prevStreamingRef.current = true;
  }, [isStreaming, texts.length]);

  useEffect(() => {
    if (scrollRef.current && isStreaming) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [texts, isStreaming]);

  if (!isStreaming && texts.length === 0) return null;

  if (collapsed && !isStreaming) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-colors hover:opacity-80"
        style={{ background: "#111113", border: "1px solid #2A2A2C" }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500/50" />
          <span className="font-mono text-[11px] font-bold text-emerald-500/70 tracking-widest">AI REASONING</span>
        </div>
        <span className="font-mono text-[10px] text-zinc-600 tracking-wider">tap to expand</span>
      </button>
    );
  }

  return (
    <div className={`relative rounded-xl overflow-hidden ${className}`} style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid #1a1a1c" }}>
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          ) : (
            <span className="inline-flex rounded-full h-2 w-2 bg-emerald-500/50" />
          )}
          <span className="font-mono text-[11px] font-bold text-emerald-500/70 tracking-widest">
            AI REASONING
            {isStreaming && <span className="ml-2 text-[#52525b] font-normal animate-pulse">thinking...</span>}
          </span>
        </div>
        {!isStreaming && texts.length > 0 && (
          <button
            onClick={() => setCollapsed(true)}
            className="font-mono text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors tracking-wider"
          >
            collapse
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="max-h-[150px] overflow-y-auto px-4 py-3 relative"
        style={{ scrollBehavior: "smooth" }}
      >
        <div className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words" style={{ color: "#4ade80" }}>
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
