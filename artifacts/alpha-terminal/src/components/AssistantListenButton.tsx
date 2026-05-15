import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Pause, Play, Square } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { fetchAllDeskTtsChunksMerged } from "@/lib/deskAudioApi";
import { splitDeskAudioTextIntoChunks } from "@/lib/deskAudioChunking";

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

const listeners = new Set<() => void>();
const RATE_STORAGE_KEY = "assistantSpeechRate";

type PlaybackState = {
  activeMessageId: string | null;
  loading: boolean;
  ready: boolean;
  paused: boolean;
  error: string | null;
  speechRate: number;
};

const playbackState: PlaybackState = {
  activeMessageId: null,
  loading: false,
  ready: false,
  paused: false,
  error: null,
  speechRate: (() => {
    if (typeof window === "undefined") return 1;
    const v = Number(sessionStorage.getItem(RATE_STORAGE_KEY));
    return [0.75, 1, 1.25, 1.5, 2].includes(v) ? v : 1;
  })(),
};

let globalAudio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let fetchAbort: AbortController | null = null;
let playNonce = 0;
let mediaSessionBound = false;

function subscribeActiveTts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getActiveTtsSnapshot() {
  return { ...playbackState };
}

function emitPlayback() {
  for (const l of listeners) l();
}

function setPlaybackState(patch: Partial<PlaybackState>) {
  Object.assign(playbackState, patch);
  emitPlayback();
}

function revokeObjectUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function ensureAudioElement() {
  if (globalAudio) return globalAudio;
  const audio = new Audio();
  audio.preload = "auto";
  audio.playsInline = true;
  audio.playbackRate = playbackState.speechRate;

  audio.addEventListener("play", () => {
    setPlaybackState({ paused: false, loading: false, ready: true, error: null });
  });
  audio.addEventListener("pause", () => {
    if (!audio.ended) {
      setPlaybackState({ paused: true });
    }
  });
  audio.addEventListener("ended", () => {
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
    revokeObjectUrl();
    setPlaybackState({
      activeMessageId: null,
      loading: false,
      ready: false,
      paused: false,
      error: null,
    });
  });
  audio.addEventListener("error", () => {
    setPlaybackState({
      loading: false,
      ready: false,
      paused: false,
      error: "Audio unavailable — media could not be played.",
    });
  });

  if (typeof navigator !== "undefined" && "mediaSession" in navigator && !mediaSessionBound) {
    navigator.mediaSession.setActionHandler("play", () => {
      void audio.play();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      audio.pause();
    });
    navigator.mediaSession.setActionHandler("stop", () => {
      audio.pause();
      audio.currentTime = 0;
      setPlaybackState({ paused: false });
    });
    navigator.mediaSession.setActionHandler("seekbackward", () => {
      audio.currentTime = Math.max(0, audio.currentTime - 15);
    });
    navigator.mediaSession.setActionHandler("seekforward", () => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : Infinity;
      audio.currentTime = Math.min(dur, audio.currentTime + 15);
    });
    mediaSessionBound = true;
  }

  globalAudio = audio;
  return audio;
}

function parseStartResponse(
  payload: unknown,
  fallbackChunks: number,
): { sessionId: string; totalChunks: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as { sessionId?: unknown; totalChunks?: unknown };
  if (typeof rec.sessionId !== "string" || !rec.sessionId.trim()) return null;
  const count =
    typeof rec.totalChunks === "number" && Number.isInteger(rec.totalChunks) && rec.totalChunks >= 1
      ? rec.totalChunks
      : Math.max(1, fallbackChunks);
  return { sessionId: rec.sessionId.trim(), totalChunks: count };
}

async function startAssistantPlayback(messageId: string, plainText: string): Promise<void> {
  if (!plainText.trim()) return;
  const audio = ensureAudioElement();
  const nonce = ++playNonce;

  fetchAbort?.abort();
  fetchAbort = null;

  setPlaybackState({
    activeMessageId: messageId,
    loading: true,
    ready: false,
    paused: false,
    error: null,
  });

  const ac = new AbortController();
  fetchAbort = ac;
  const fallbackChunks = Math.max(1, splitDeskAudioTextIntoChunks(plainText).length);

  try {
    const startRes = await fetchWithAuth("/api/tts/desk-audio/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: plainText.trim(), voiceConfig: {} }),
      signal: ac.signal,
      clerkTokenTimeoutMs: 8000,
    });
    if (!startRes.ok) {
      throw new Error(`HTTP ${startRes.status}`);
    }
    const startJson = (await startRes.json()) as unknown;
    const startMeta = parseStartResponse(startJson, fallbackChunks);
    if (!startMeta) {
      throw new Error("invalid_start_response");
    }

    const merged = await fetchAllDeskTtsChunksMerged(startMeta.sessionId, startMeta.totalChunks, ac.signal);
    if (nonce !== playNonce) return;

    const nextUrl = URL.createObjectURL(merged);
    revokeObjectUrl();
    objectUrl = nextUrl;
    audio.src = nextUrl;
    audio.playbackRate = playbackState.speechRate;
    if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Alpha Terminal chat response",
      });
    }
    await audio.play();
    if (nonce !== playNonce) return;
    setPlaybackState({ loading: false, ready: true, paused: false, error: null });
  } catch (err) {
    if (nonce !== playNonce) return;
    const aborted = err instanceof DOMException && err.name === "AbortError";
    setPlaybackState({
      loading: false,
      ready: false,
      paused: false,
      error: aborted ? "Audio request was cancelled." : "Audio unavailable — network error.",
    });
  } finally {
    if (fetchAbort === ac) {
      fetchAbort = null;
    }
  }
}

function pauseAssistantPlayback() {
  if (!globalAudio) return;
  globalAudio.pause();
  setPlaybackState({ paused: true });
}

function resumeAssistantPlayback() {
  if (!globalAudio) return;
  void globalAudio.play();
}

function stopAssistantPlayback() {
  playNonce += 1;
  fetchAbort?.abort();
  fetchAbort = null;

  if (globalAudio) {
    globalAudio.pause();
    globalAudio.currentTime = 0;
    globalAudio.removeAttribute("src");
    globalAudio.load();
  }
  revokeObjectUrl();
  setPlaybackState({
    activeMessageId: null,
    loading: false,
    ready: false,
    paused: false,
    error: null,
  });
}

function setAssistantSpeechRate(rate: number) {
  const normalized = [0.75, 1, 1.25, 1.5, 2].includes(rate) ? rate : 1;
  playbackState.speechRate = normalized;
  try {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(RATE_STORAGE_KEY, String(normalized));
    }
  } catch {
    /* QuotaExceededError */
  }
  if (globalAudio) {
    globalAudio.playbackRate = normalized;
  }
  emitPlayback();
}

/** Stop any in-flight assistant TTS (e.g. when clearing chat). */
export function cancelAssistantSpeech() {
  stopAssistantPlayback();
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
  const isActive = playingId.activeMessageId === messageId;
  const isPlaying = isActive && playingId.ready && !playingId.paused;
  const isPaused = isActive && playingId.ready && playingId.paused;
  const canSpeak = plain.length > 0;

  const onClick = useCallback(() => {
    if (!canSpeak) return;
    if (isPlaying) {
      pauseAssistantPlayback();
      return;
    }
    if (isPaused) {
      resumeAssistantPlayback();
      return;
    }
    void startAssistantPlayback(messageId, plain);
  }, [canSpeak, isPaused, isPlaying, messageId, plain]);

  const onPause = useCallback(() => {
    if (!isActive || !isPlaying) return;
    pauseAssistantPlayback();
  }, [isActive, isPlaying]);

  const onStop = useCallback(() => {
    if (!isActive) return;
    stopAssistantPlayback();
  }, [isActive]);

  const onRateChange = useCallback((nextRate: number) => {
    setAssistantSpeechRate(nextRate);
  }, []);

  const iconClass = size === "sm" ? "w-3.5 h-3.5" : "w-5 h-5";
  const baseBtn =
    "inline-flex items-center justify-center rounded-md text-white/90 hover:text-white disabled:opacity-35 disabled:cursor-not-allowed";
  const controlBtn = size === "sm" ? "h-8 w-8" : "h-9 w-9";

  if (!canSpeak && !isActive) {
    return null;
  }

  return (
    <div className={size === "sm" ? "mt-1 flex items-center gap-1.5" : "mt-2 flex items-center gap-2"}>
      <button
        type="button"
        onClick={onClick}
        disabled={!canSpeak || playingId.loading}
        title={isPlaying ? "Pause" : isPaused ? "Resume" : "Play"}
        aria-label={isPlaying ? "Pause audio" : isPaused ? "Resume audio" : "Play audio"}
        className={`${baseBtn} ${controlBtn}`}
      >
        {isPlaying ? (
          <Pause className={iconClass} />
        ) : (
          <Play className={iconClass} />
        )}
      </button>

      {isActive && (
        <>
          <button
            type="button"
            onClick={onPause}
            disabled={!isPlaying}
            title="Pause"
            aria-label="Pause audio"
            className={`${baseBtn} ${controlBtn}`}
          >
            <Pause className={iconClass} />
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={!isActive}
            title="Stop"
            aria-label="Stop audio"
            className={`${baseBtn} ${controlBtn}`}
          >
            <Square className={`${iconClass} fill-current`} />
          </button>
          <select
            value={playingId.speechRate}
            onChange={(e) => onRateChange(Number(e.target.value))}
            aria-label="Playback speed"
            className={
              size === "sm"
                ? "h-8 rounded bg-[#101010] border border-white/15 text-white text-[11px] px-1.5"
                : "h-9 rounded bg-[#101010] border border-white/15 text-white text-xs px-2"
            }
          >
            <option value={0.75}>0.75x</option>
            <option value={1}>1x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
          </select>
        </>
      )}

      {isActive && playingId.loading && (
        <span className={size === "sm" ? "font-mono text-[10px] text-white/65" : "font-mono text-xs text-white/65"}>
          Loading...
        </span>
      )}
      {isActive && playingId.error && (
        <span className={size === "sm" ? "font-mono text-[10px] text-red-300" : "font-mono text-xs text-red-300"}>
          {playingId.error}
        </span>
      )}
    </div>
  );
}
