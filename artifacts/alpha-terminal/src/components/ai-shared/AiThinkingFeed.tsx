import { useEffect, useRef, useState } from "react";

interface AiThinkingFeedProps {
  tokens: string[];
  isStreaming: boolean;
  onToggleTranscript?: () => void;
  showTranscript?: boolean;
}

export function AiThinkingFeed({ tokens, isStreaming, onToggleTranscript, showTranscript }: AiThinkingFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [tokens]);

  if (!isStreaming && tokens.length === 0) return null;

  if (!isStreaming && tokens.length > 0 && !showTranscript) {
    return (
      <button
        onClick={onToggleTranscript}
        className="font-mono text-[10px] text-[#71717a] hover:text-[#a1a1aa] transition-colors uppercase tracking-wider px-3 py-1.5"
      >
        View AI Reasoning →
      </button>
    );
  }

  const fullText = tokens.join("");

  return (
    <div
      className="transition-opacity duration-200"
      style={{ opacity: isStreaming ? 1 : showTranscript ? 0.8 : 0 }}
    >
      {isStreaming && (
        <div className="flex items-center gap-2 px-3 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d166] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00d166]" />
          </span>
          <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider">AI Reasoning</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="overflow-y-auto border-l-2 border-[#00d166]/30 bg-[#0c0c0c]/80 rounded-r-lg px-3 py-2"
        style={{ maxHeight: isStreaming ? 140 : 300 }}
      >
        <pre className="font-mono text-[11px] text-[#71717a] whitespace-pre-wrap leading-relaxed break-words">
          {fullText}
          {isStreaming && <span className="animate-pulse text-[#00d166]">▊</span>}
        </pre>
      </div>
      {!isStreaming && showTranscript && (
        <button
          onClick={onToggleTranscript}
          className="font-mono text-[10px] text-[#71717a] hover:text-[#a1a1aa] transition-colors uppercase tracking-wider px-3 py-1"
        >
          Hide Reasoning
        </button>
      )}
    </div>
  );
}
