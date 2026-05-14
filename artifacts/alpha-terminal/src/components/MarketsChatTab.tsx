import { useState, useRef, useEffect, useCallback, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { useTerminalStore } from "@/lib/store";
import { useGetQuote } from "@workspace/api-client-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Send, Square, RotateCcw, MessageSquare, Play, Pause, Rewind, FastForward } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { MARKETS_CHAT_AUDIO_SKIP_SECONDS, useMarketsChatDeskTts } from "@/hooks/useMarketsChatDeskTts";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

let msgCounter = 0;
function nextId(): string {
  return `mkt-chat-${Date.now()}-${++msgCounter}`;
}

/** Strip markdown to plain text for TTS (assistant replies only). */
function markdownToPlainForTts(md: string): string {
  if (!md.trim()) return "";
  let s = md;
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`([^`]+)`/g, "$1");
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  s = s.replace(/\s+/g, " ");
  return s.trim();
}

const FOCUS_RING = "2px solid rgba(255,184,0,0.45)";

function AssistantMessageAudio(props: {
  msg: ChatMessage;
  isStreaming: boolean;
  streamingAssistantId: string | null;
  playbackMessageId: string | null;
  audioBarOpen: boolean;
  audioLoading: boolean;
  audioReady: boolean;
  audioError: string | null;
  paused: boolean;
  speechRate: number;
  setSpeechRate: (r: number) => void;
  speedLabel: string;
  startPlay: (messageId: string, plainText: string) => Promise<void>;
  stopAudio: () => void;
  togglePause: () => void;
  seekRelativeSeconds: (deltaSec: number) => void;
  iconBtnBase: CSSProperties;
}) {
  const {
    msg,
    isStreaming,
    streamingAssistantId,
    playbackMessageId,
    audioBarOpen,
    audioLoading,
    audioReady,
    audioError,
    paused,
    speechRate,
    setSpeechRate,
    speedLabel,
    startPlay,
    stopAudio,
    togglePause,
    seekRelativeSeconds,
    iconBtnBase,
  } = props;

  if (!msg.content.trim() || (streamingAssistantId === msg.id && isStreaming)) {
    return null;
  }
  const plain = markdownToPlainForTts(msg.content);
  if (!plain) return null;

  const isThisPlayback = playbackMessageId === msg.id;
  const showExpanded = isThisPlayback && audioBarOpen;

  if (showExpanded) {
    return (
      <div
        role="region"
        aria-label="Audio playback controls"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-700/80 bg-[#111113] px-2 py-2"
      >
        {audioError ? (
          <span className="text-[10px] text-red-400 w-full">{audioError}</span>
        ) : (
          <>
            <button
              type="button"
              style={iconBtnBase}
              aria-label={`Rewind ${MARKETS_CHAT_AUDIO_SKIP_SECONDS} seconds`}
              onClick={() => seekRelativeSeconds(-MARKETS_CHAT_AUDIO_SKIP_SECONDS)}
              disabled={!audioReady}
              onFocus={(e) => {
                e.currentTarget.style.outline = FOCUS_RING;
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = "none";
              }}
            >
              <Rewind className="w-4 h-4" aria-hidden />
            </button>
            <button
              type="button"
              style={iconBtnBase}
              aria-label={paused ? "Resume audio playback" : "Pause audio playback"}
              onClick={togglePause}
              disabled={!audioReady}
              onFocus={(e) => {
                e.currentTarget.style.outline = FOCUS_RING;
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = "none";
              }}
            >
              {paused ? <Play className="w-4 h-4" aria-hidden /> : <Pause className="w-4 h-4" aria-hidden />}
            </button>
            <button
              type="button"
              style={iconBtnBase}
              aria-label={`Fast-forward ${MARKETS_CHAT_AUDIO_SKIP_SECONDS} seconds`}
              onClick={() => seekRelativeSeconds(MARKETS_CHAT_AUDIO_SKIP_SECONDS)}
              disabled={!audioReady}
              onFocus={(e) => {
                e.currentTarget.style.outline = FOCUS_RING;
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = "none";
              }}
            >
              <FastForward className="w-4 h-4" aria-hidden />
            </button>
            <button
              type="button"
              style={iconBtnBase}
              aria-label="Stop audio playback"
              onClick={stopAudio}
              onFocus={(e) => {
                e.currentTarget.style.outline = FOCUS_RING;
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = "none";
              }}
            >
              <Square className="w-4 h-4" aria-hidden />
            </button>
            <label className="flex items-center gap-1 text-[10px] text-zinc-400">
              <span className="sr-only">Playback speed</span>
              <select
                aria-label={`Playback speed, currently ${speedLabel}`}
                className="rounded border border-zinc-600 bg-[#0c0c0c] text-zinc-200 text-[10px] py-1 px-2"
                value={speechRate}
                onChange={(e) => setSpeechRate(Number(e.target.value))}
              >
                <option value={1}>1x</option>
                <option value={1.25}>1.25x</option>
                <option value={1.5}>1.5x</option>
                <option value={2}>2x</option>
              </select>
            </label>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void startPlay(msg.id, plain)}
      disabled={audioLoading && isThisPlayback}
      className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-primary/70 hover:text-primary border border-primary/20 rounded px-2 py-1 disabled:opacity-40"
    >
      <Play className="w-3 h-3 shrink-0" />
      {audioLoading && isThisPlayback ? "Loading…" : "Play"}
    </button>
  );
}

export function MarketsChatTab() {
  const { symbol, accessToken, aiFeatureSettings } = useTerminalStore();
  const aiModel = aiFeatureSettings.chat.model;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const {
    audioRef,
    playbackMessageId,
    audioBarOpen,
    audioLoading,
    audioReady,
    audioError,
    paused,
    speechRate,
    setSpeechRate,
    speedLabel,
    startPlay,
    stopAudio,
    togglePause,
    seekRelativeSeconds,
    onAudioEnded,
    onLoadedMetadata,
    onPlay,
    onPause,
    onAudioElementError,
    iconBtnBase,
  } = useMarketsChatDeskTts({ symbol, containerRef: rootRef });

  const { data: quote } = useGetQuote(
    { symbol, accessToken: accessToken || "" },
    { query: { queryKey: ["quote", symbol, accessToken], enabled: !!accessToken } },
  );

  const marketContext = quote
    ? `CURRENT MARKET CONTEXT for ${symbol}: Last: $${quote.last}, Change: ${quote.changePct}%, Vol: ${quote.volume}`
    : `No live market context available for ${symbol}.`;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      const userMsg: ChatMessage = { id: nextId(), role: "user", content: text.trim() };
      const assistantId = nextId();

      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setIsStreaming(true);
      setStreamingAssistantId(assistantId);

      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetchWithAuth("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, marketContext, model: aiModel }),
          signal: controller.signal,
        });

        if (!res.ok) {
          setMessages((prev) => [
            ...prev,
            { id: assistantId, role: "assistant", content: `Error ${res.status}. Try again.` },
          ]);
          setIsStreaming(false);
          setStreamingAssistantId(null);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "No response." }]);
          setIsStreaming(false);
          setStreamingAssistantId(null);
          return;
        }

        const decoder = new TextDecoder();
        let accumulated = "";
        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          const current = accumulated;
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: current } : m)));
        }

        if (!accumulated.trim()) {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: "*(No response)*" } : m)));
        }
      } catch (err: unknown) {
        if ((err as Error).name === "AbortError") return;
        const errText = `Error: ${(err as Error).message}`;
        setMessages((prev) => {
          if (prev.some((m) => m.id === assistantId)) {
            return prev.map((m) => (m.id === assistantId ? { ...m, content: errText } : m));
          }
          return [...prev, { id: assistantId, role: "assistant" as const, content: errText }];
        });
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
        setStreamingAssistantId(null);
      }
    },
    [messages, marketContext, isStreaming, aiModel],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamingAssistantId(null);
  }, []);

  const handleClear = useCallback(() => {
    handleStop();
    stopAudio();
    setMessages([]);
  }, [handleStop, stopAudio]);

  const symbolRef = useRef(symbol);
  useEffect(() => {
    if (symbolRef.current === symbol) return;
    symbolRef.current = symbol;
    handleStop();
    stopAudio();
    setMessages([]);
  }, [symbol, handleStop, stopAudio]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isStreaming) void sendMessage(input);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isStreaming) void sendMessage(input);
    }
  };

  return (
    <div
      ref={rootRef}
      className="flex flex-col rounded-lg border border-card-border bg-[#0a0a0a] overflow-hidden"
      style={{ minHeight: 280 }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border/50">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-primary" />
          <span className="font-mono text-[10px] font-bold text-white/70 tracking-widest uppercase">Chat</span>
          <span className="font-mono text-[9px] text-white/35">{symbol}</span>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="font-mono text-[8px] text-white/30 hover:text-white/60 transition-colors tracking-wider uppercase flex items-center gap-1"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Clear
          </button>
        )}
      </div>

      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        className="hidden"
        onEnded={onAudioEnded}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={onPlay}
        onPause={onPause}
        onError={onAudioElementError}
      />

      {messages.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-[min(420px,50vh)] overflow-y-auto px-2.5 py-2 space-y-2"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#333 transparent" }}
        >
          {messages.map((msg) => (
            <div key={msg.id} className={msg.role === "user" ? "text-right" : "text-left"}>
              {msg.role === "user" ? (
                <span className="inline-block font-mono text-[10px] text-primary/80 bg-primary/8 border border-primary/15 rounded px-2 py-1 max-w-[90%] text-left">
                  {msg.content}
                </span>
              ) : (
                <div className="space-y-2">
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
                  <AssistantMessageAudio
                    msg={msg}
                    isStreaming={isStreaming}
                    streamingAssistantId={streamingAssistantId}
                    playbackMessageId={playbackMessageId}
                    audioBarOpen={audioBarOpen}
                    audioLoading={audioLoading}
                    audioReady={audioReady}
                    audioError={audioError}
                    paused={paused}
                    speechRate={speechRate}
                    setSpeechRate={setSpeechRate}
                    speedLabel={speedLabel}
                    startPlay={startPlay}
                    stopAudio={stopAudio}
                    togglePause={togglePause}
                    seekRelativeSeconds={seekRelativeSeconds}
                    iconBtnBase={iconBtnBase}
                  />
                </div>
              )}
            </div>
          ))}

          {isStreaming && streamingAssistantId && (
            <div className="flex items-center gap-1.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "150ms" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: "300ms" }} />
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-center gap-1.5 px-2 py-1.5 border-t border-card-border/40 mt-auto">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Ask about ${symbol}…`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 bg-transparent border-none outline-none font-mono text-[11px] text-white/80 placeholder:text-white/20 min-w-0"
        />
        {isStreaming ? (
          <button type="button" onClick={handleStop} className="p-1 text-red-400 hover:text-red-300 transition-colors shrink-0" aria-label="Stop generating">
            <Square className="w-3 h-3 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="p-1 text-primary/50 hover:text-primary disabled:text-white/10 transition-colors shrink-0"
            aria-label="Send message"
          >
            <Send className="w-3 h-3" />
          </button>
        )}
      </form>
    </div>
  );
}
