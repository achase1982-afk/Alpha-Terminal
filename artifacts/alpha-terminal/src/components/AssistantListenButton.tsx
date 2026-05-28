import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Copy, Pause, Play, RotateCw, Square } from "lucide-react";
import {
  attachDeskAudioBlob,
  DeskAudioChunkLoader,
  startDeskAudioSession,
} from "@/lib/deskAudioSequentialPlay";
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

const RATE_STORAGE_KEY = "assistantSpeechRate";
const listeners = new Set<() => void>();

type PlaybackState = {
  activeMessageId: string | null;
  loading: boolean;
  ready: boolean;
  paused: boolean;
  error: string | null;
  speechRate: number;
};

let playbackState: PlaybackState = {
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
const objectUrls: string[] = [];
let fetchAbort: AbortController | null = null;
let playNonce = 0;
let mediaSessionBound = false;

type SequentialPlayback = {
  nonce: number;
  sessionId: string;
  totalChunks: number;
  chunkIndex: number;
  loader: DeskAudioChunkLoader;
};

let sequentialPlayback: SequentialPlayback | null = null;

function subscribeActiveTts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getActiveTtsSnapshot() {
  return playbackState;
}

function emitPlayback() {
  for (const l of listeners) l();
}

function setPlaybackState(patch: Partial<PlaybackState>) {
  playbackState = { ...playbackState, ...patch };
  emitPlayback();
}

function revokeObjectUrls() {
  while (objectUrls.length > 0) {
    const url = objectUrls.pop();
    if (url) URL.revokeObjectURL(url);
  }
}

function setAssistantSpeechRate(rate: number) {
  const normalized = [0.75, 1, 1.25, 1.5, 2].includes(rate) ? rate : 1;
  playbackState = { ...playbackState, speechRate: normalized };
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

function stopAssistantPlayback() {
  playNonce += 1;
  fetchAbort?.abort();
  fetchAbort = null;
  sequentialPlayback?.loader.clearPrefetch();
  sequentialPlayback = null;

  if (globalAudio) {
    globalAudio.pause();
    globalAudio.currentTime = 0;
    globalAudio.removeAttribute("src");
    globalAudio.load();
  }
  revokeObjectUrls();
  setPlaybackState({
    activeMessageId: null,
    loading: false,
    ready: false,
    paused: false,
    error: null,
  });
}

function ensureAudioElement() {
  if (globalAudio) return globalAudio;
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "true");
  audio.playbackRate = playbackState.speechRate;

  audio.addEventListener("play", () => {
    setPlaybackState({ paused: false, loading: false, ready: true, error: null });
  });
  audio.addEventListener("pause", () => {
    if (!audio.ended) setPlaybackState({ paused: true });
  });
  audio.addEventListener("ended", () => {
    void onAssistantAudioEnded();
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
      stopAssistantPlayback();
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

async function playAssistantChunk(chunkIndex: number, nonce: number): Promise<void> {
  const seq = sequentialPlayback;
  const audio = globalAudio;
  if (!seq || !audio || seq.nonce !== nonce || chunkIndex !== seq.chunkIndex) return;

  try {
    const blob = await seq.loader.loadChunk(chunkIndex);
    if (seq.nonce !== nonce || sequentialPlayback !== seq) return;

    const url = attachDeskAudioBlob(audio, blob, playbackState.speechRate);
    objectUrls.push(url);
    seq.loader.prefetchChunk(chunkIndex + 1);

    if (
      typeof navigator !== "undefined" &&
      "mediaSession" in navigator &&
      typeof MediaMetadata !== "undefined" &&
      chunkIndex === 0
    ) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Alpha Terminal chat response",
      });
    }

    await audio.play();
    if (seq.nonce !== nonce) return;
    setPlaybackState({ loading: false, ready: true, paused: false, error: null });
  } catch (err) {
    if (seq.nonce !== nonce) return;
    const aborted = err instanceof DOMException && err.name === "AbortError";
    sequentialPlayback = null;
    setPlaybackState({
      loading: false,
      ready: false,
      paused: false,
      error: aborted ? "Audio request was cancelled." : "Audio unavailable — network error.",
    });
  }
}

async function onAssistantAudioEnded(): Promise<void> {
  const seq = sequentialPlayback;
  const audio = globalAudio;
  if (!seq || !audio) {
    if (audio) {
      audio.currentTime = 0;
      setPlaybackState({ loading: false, ready: true, paused: true, error: null });
    }
    return;
  }

  const nonce = seq.nonce;
  const nextIndex = seq.chunkIndex + 1;
  if (nextIndex >= seq.totalChunks) {
    sequentialPlayback = null;
    audio.currentTime = 0;
    setPlaybackState({ loading: false, ready: true, paused: true, error: null });
    return;
  }

  seq.chunkIndex = nextIndex;
  await playAssistantChunk(nextIndex, nonce);
}

async function startAssistantPlayback(messageId: string, plainText: string): Promise<void> {
  if (!plainText.trim()) return;
  const audio = ensureAudioElement();
  const nonce = ++playNonce;

  fetchAbort?.abort();
  fetchAbort = null;
  sequentialPlayback?.loader.clearPrefetch();
  sequentialPlayback = null;
  revokeObjectUrls();

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
    const startMeta = await startDeskAudioSession(plainText, {}, ac.signal, fallbackChunks);
    if (nonce !== playNonce) return;

    const loader = new DeskAudioChunkLoader(startMeta.sessionId, ac.signal);
    sequentialPlayback = {
      nonce,
      sessionId: startMeta.sessionId,
      totalChunks: startMeta.totalChunks,
      chunkIndex: 0,
      loader,
    };
    loader.prefetchChunk(0);
    await playAssistantChunk(0, nonce);
  } catch (err) {
    if (nonce !== playNonce) return;
    const aborted = err instanceof DOMException && err.name === "AbortError";
    sequentialPlayback = null;
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
  onCopy?: () => void;
  onRetry?: () => void;
  retryDisabled?: boolean;
}

/**
 * Bubble-level controls backed by global desk TTS playback:
 * - Same voice pipeline as validation cards
 * - Play/pause/stop + speed
 * - Playback survives bubble re-renders and view transitions
 */
export function AssistantListenButton({
  messageId,
  markdownText,
  size = "md",
  onCopy,
  onRetry,
  retryDisabled = false,
}: AssistantListenButtonProps) {
  const state = useSyncExternalStore(subscribeActiveTts, getActiveTtsSnapshot, getActiveTtsSnapshot);
  const plain = useMemo(() => markdownToSpeakable(markdownText), [markdownText]);
  const canSpeak = plain.length > 0;
  const textToCopy = useMemo(() => {
    const t = plain.trim();
    if (t.length > 0) return t;
    return markdownText.trim();
  }, [markdownText, plain]);

  const [copyFlash, setCopyFlash] = useState<null | "ok" | "fail">(null);
  const copyFlashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyFlashTimerRef.current !== null) window.clearTimeout(copyFlashTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!plain.trim()) return;
    const ac = new AbortController();
    const fallbackChunks = Math.max(1, splitDeskAudioTextIntoChunks(plain).length);
    void startDeskAudioSession(plain, {}, ac.signal, fallbackChunks).catch(() => {});
    return () => ac.abort();
  }, [plain]);

  const handleCopyClick = useCallback(async () => {
    if (!textToCopy) return;
    const flash = (kind: "ok" | "fail") => {
      setCopyFlash(kind);
      if (copyFlashTimerRef.current !== null) window.clearTimeout(copyFlashTimerRef.current);
      copyFlashTimerRef.current = window.setTimeout(() => {
        setCopyFlash(null);
        copyFlashTimerRef.current = null;
      }, 650);
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        throw new Error("clipboard unavailable");
      }
      flash("ok");
      onCopy?.();
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = textToCopy;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("execCommand failed");
        flash("ok");
        onCopy?.();
      } catch {
        flash("fail");
      }
    }
  }, [onCopy, textToCopy]);

  const isActive = state.activeMessageId === messageId;
  const isPlaying = isActive && state.ready && !state.paused;
  const isPaused = isActive && state.ready && state.paused;

  const onPlayToggle = useCallback(() => {
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

  const iconClass = size === "sm" ? "w-3.5 h-3.5" : "w-5 h-5";
  const iconButtonBase =
    "inline-flex items-center justify-center rounded border border-white/10 bg-transparent text-zinc-400 hover:text-zinc-200 hover:border-white/25 disabled:opacity-35 disabled:cursor-not-allowed";
  const iconButtonSize = size === "sm" ? "h-9 w-9 p-1" : "h-10 w-10 p-2";

  if (!canSpeak && !isActive) return null;

  return (
    <div className={size === "sm" ? "mt-1 flex flex-wrap items-center gap-1.5" : "mt-2 flex flex-wrap items-center gap-2"}>
      <button
        type="button"
        onClick={onPlayToggle}
        disabled={!canSpeak || state.loading}
        title={isPlaying ? "Pause" : isPaused ? "Resume" : "Play"}
        aria-label={isPlaying ? "Pause audio" : isPaused ? "Resume audio" : "Play audio"}
        className={`${iconButtonBase} ${iconButtonSize}`}
      >
        {isPlaying ? <Pause className={iconClass} /> : <Play className={iconClass} />}
      </button>
      <button
        type="button"
        onClick={() => void handleCopyClick()}
        disabled={!textToCopy}
        title="Copy"
        aria-label={
          copyFlash === "ok" ? "Copied to clipboard" : copyFlash === "fail" ? "Copy failed" : "Copy response"
        }
        className={`${iconButtonBase} ${iconButtonSize}${
          copyFlash === "ok"
            ? " ring-2 ring-emerald-400/70 border-emerald-400/55 bg-emerald-500/15 text-emerald-100"
            : copyFlash === "fail"
              ? " ring-2 ring-red-400/65 border-red-400/50 bg-red-500/10 text-red-100"
              : ""
        }`}
      >
        <Copy className={iconClass} />
      </button>
      <button
        type="button"
        onClick={onRetry}
        disabled={!onRetry || retryDisabled}
        title="Retry"
        aria-label="Retry response"
        className={`${iconButtonBase} ${iconButtonSize}`}
      >
        <RotateCw className={iconClass} />
      </button>

      {isActive && (
        <>
          <button
            type="button"
            onClick={onPause}
            disabled={!isPlaying}
            title="Pause"
            aria-label="Pause audio"
            className={`${iconButtonBase} ${iconButtonSize}`}
          >
            <Pause className={iconClass} />
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={!isActive}
            title="Stop"
            aria-label="Stop audio"
            className={`${iconButtonBase} ${iconButtonSize}`}
          >
            <Square className={`${iconClass} fill-current`} />
          </button>
          <select
            value={state.speechRate}
            onChange={(e) => setAssistantSpeechRate(Number(e.target.value))}
            aria-label="Playback speed"
            className={
              size === "sm"
                ? "h-9 rounded border border-white/10 bg-[#101010] px-1.5 text-[11px] text-zinc-300"
                : "h-10 rounded border border-white/10 bg-[#101010] px-2 text-xs text-zinc-300"
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

      {isActive && state.loading && (
        <span className={size === "sm" ? "font-mono text-[10px] text-white/65" : "font-mono text-xs text-white/65"}>
          Loading...
        </span>
      )}
      {isActive && state.error && (
        <span className={size === "sm" ? "font-mono text-[10px] text-red-300" : "font-mono text-xs text-red-300"}>
          {state.error}
        </span>
      )}
    </div>
  );
}
