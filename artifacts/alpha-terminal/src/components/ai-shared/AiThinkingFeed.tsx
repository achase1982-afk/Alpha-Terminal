import { useEffect, useRef, useState } from "react";

interface AiThinkingFeedProps {
  texts: string[];
  isStreaming: boolean;
  className?: string;
}

export function AiThinkingFeed({ texts, isStreaming, className = "" }: AiThinkingFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const prevStreamingRef = useRef(isStreaming);

  const handleCopy = async () => {
    const text = texts.join("");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // best-effort fallback
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch { /* give up */ }
    }
  };

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
        <div className="flex items-center gap-3">
          {texts.length > 0 && (
            <button
              onClick={handleCopy}
              className="font-mono text-[10px] text-zinc-500 hover:text-emerald-400 transition-colors tracking-wider uppercase"
              title="Copy AI reasoning to clipboard"
            >
              {copied ? "copied!" : "copy"}
            </button>
          )}
          {!isStreaming && texts.length > 0 && (
            <button
              onClick={() => setCollapsed(true)}
              className="font-mono text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors tracking-wider"
            >
              collapse
            </button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="max-h-[150px] overflow-y-auto px-4 py-3 relative"
        style={{ scrollBehavior: "smooth" }}
      >
        <div className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words" style={{ color: "#e4e4e7" }}>
          {texts.length === 0 && isStreaming && (
            <span style={{ color: "#3f3f46" }}>Awaiting AI output...</span>
          )}
          {texts.map((text, i) => (
            <span key={i}>{text}</span>
          ))}
          {isStreaming && (
            <span className="inline-block w-1.5 h-3.5 ml-0.5 animate-pulse" style={{ background: "#e4e4e7" }} />
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
