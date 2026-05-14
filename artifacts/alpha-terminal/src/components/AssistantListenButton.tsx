import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Play, Square } from "lucide-react";

/** Strip common Markdown so TTS does not read markup literally. */
export function markdownToSpeakable(md: string): string {
  if (!md) return "";
  let t = md;
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  t = t.replace(/```[\s\S]*?```/g, " ");
  t = t.replace(/`([^`]+)`/g, "$1");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/[*_~|]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

let activeMessageId: string | null = null;
const listeners = new Set<() => void>();

function subscribeActiveTts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getActiveTtsSnapshot() {
  return activeMessageId;
}

function setActiveTtsMessageId(id: string | null) {
  activeMessageId = id;
  for (const l of listeners) l();
}

/** Stop any in-flight assistant TTS (e.g. when clearing chat). */
export function cancelAssistantSpeech() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  setActiveTtsMessageId(null);
}

interface AssistantListenButtonProps {
  messageId: string;
  /** Raw assistant markdown / plain text. */
  markdownText: string;
  /** Visual size for dense sidebar vs overlay. */
  size?: "sm" | "md";
}

/**
 * Play / stop speech for one assistant bubble. Uses `speechSynthesis` (no server).
 * Only one message plays globally; starting another cancels the previous.
 */
export function AssistantListenButton({ messageId, markdownText, size = "md" }: AssistantListenButtonProps) {
  const playingId = useSyncExternalStore(subscribeActiveTts, getActiveTtsSnapshot, getActiveTtsSnapshot);
  const plain = useMemo(() => markdownToSpeakable(markdownText), [markdownText]);
  const isPlaying = playingId === messageId;
  const canSpeak = plain.length > 0;

  const onClick = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    if (isPlaying) {
      window.speechSynthesis.cancel();
      setActiveTtsMessageId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(plain);
    utter.rate = 1;
    utter.pitch = 1;
    utter.onend = () => {
      if (getActiveTtsSnapshot() === messageId) {
        setActiveTtsMessageId(null);
      }
    };
    utter.onerror = () => {
      setActiveTtsMessageId(null);
    };
    setActiveTtsMessageId(messageId);
    window.speechSynthesis.speak(utter);
  }, [isPlaying, messageId, plain]);

  const iconClass = size === "sm" ? "w-3.5 h-3.5" : "w-5 h-5";
  const pad =
    size === "sm"
      ? "mt-1 inline-flex p-1"
      : "mt-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 p-2.5";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canSpeak && !isPlaying}
      title={isPlaying ? "Stop" : "Listen"}
      aria-label={isPlaying ? "Stop reading" : "Play reading of this reply"}
      className={[
        "inline-flex items-center gap-1 rounded border border-transparent font-mono tracking-wider shadow-none transition-colors outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/40 focus-visible:ring-offset-0 focus-visible:ring-offset-transparent",
        pad,
        size === "sm" ? "text-[8px]" : "text-[9px]",
        isPlaying
          ? "text-zinc-200 hover:text-white"
          : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300",
        !canSpeak && !isPlaying ? "cursor-not-allowed opacity-30" : "",
      ].join(" ")}
    >
      {isPlaying ? <Square className={`${iconClass} fill-current`} /> : <Play className={iconClass} />}
      {size === "md" && <span>{isPlaying ? "Stop" : "Listen"}</span>}
    </button>
  );
}
