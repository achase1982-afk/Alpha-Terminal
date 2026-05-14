import { useCallback, useEffect, useMemo, type CSSProperties, type RefObject } from "react";
import { Play, Pause, Square, Rewind, FastForward } from "lucide-react";
import { markdownToSpeakable, cancelAssistantSpeech } from "@/components/AssistantListenButton";
import { useDeskBufferedCardTts } from "@/hooks/useDeskBufferedCardTts";
import { VALIDATION_AUDIO_SKIP_SECONDS } from "@/hooks/useValidationCardTts";

const SESSION_RATE_KEY = "strategistDeskSpeechRate";
const EMPTY_VOICE: Record<string, unknown> = {};
const FOCUS_RING = "2px solid rgba(255,184,0,0.45)";

/** Only one Markets news-chat desk clip at a time (shared `<audio>` per row). */
let activeMarketNewsDeskStop: (() => void) | null = null;

function registerMarketNewsDeskStop(stopFn: () => void) {
  activeMarketNewsDeskStop?.();
  activeMarketNewsDeskStop = stopFn;
}

function unregisterMarketNewsDeskStop(stopFn: () => void) {
  if (activeMarketNewsDeskStop === stopFn) activeMarketNewsDeskStop = null;
}

export function stopAllMarketNewsDeskTts() {
  activeMarketNewsDeskStop?.();
  activeMarketNewsDeskStop = null;
}

interface MarketNewsAssistantDeskPlayProps {
  messageId: string;
  markdownText: string;
  symbolUpper: string;
  threadId: string;
  containerRef?: RefObject<HTMLElement | null>;
}

/**
 * High-quality desk TTS for one assistant bubble — same `/api/tts/desk-audio` pipeline as Strategist cards.
 * UI stays compact (mono ~9–10px); Play expands to transport + speed like other desk surfaces.
 */
export function MarketNewsAssistantDeskPlay({
  messageId,
  markdownText,
  symbolUpper,
  threadId,
  containerRef,
}: MarketNewsAssistantDeskPlayProps) {
  const plainText = useMemo(() => markdownToSpeakable(markdownText), [markdownText]);
  const audioId = `market-news-chat-${symbolUpper}-${threadId}-${messageId}`;
  const resetKey = `${symbolUpper}|${threadId}`;

  const {
    audioRef,
    audioBarOpen,
    audioLoading,
    audioReady,
    audioError,
    paused,
    speechRate,
    setSpeechRate,
    speedLabel,
    startPlay: startPlayInner,
    stopAudio,
    togglePause,
    seekRelativeSeconds,
    onAudioEnded,
    onLoadedMetadata,
    onPlay,
    onPause,
    onAudioElementError,
  } = useDeskBufferedCardTts({
    plainText,
    audioId,
    voiceConfig: EMPTY_VOICE,
    sessionRateStorageKey: SESSION_RATE_KEY,
    resetDependency: resetKey,
    containerRef,
  });

  useEffect(() => {
    return () => unregisterMarketNewsDeskStop(stopAudio);
  }, [stopAudio]);

  const startPlay = useCallback(async () => {
    cancelAssistantSpeech();
    registerMarketNewsDeskStop(stopAudio);
    await startPlayInner();
  }, [startPlayInner, stopAudio]);

  const iconBtn: CSSProperties = useMemo(
    () => ({
      minWidth: 32,
      minHeight: 32,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 6,
      border: "1px solid #2a2a2a",
      background: "#111113",
      color: "#e5e5e5",
      cursor: "pointer",
    }),
    [],
  );

  if (!plainText.trim()) return null;

  const showExpanded = audioBarOpen;

  if (showExpanded) {
    return (
      <>
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
        <div
          role="region"
          aria-label="Audio playback controls"
          className="mt-1 flex flex-wrap items-center gap-1.5 rounded border border-zinc-700/80 bg-[#111113] px-1.5 py-1"
        >
          {audioError ? (
            <span className="w-full font-mono text-[9px] text-red-400">{audioError}</span>
          ) : (
            <>
              <button
                type="button"
                style={iconBtn}
                aria-label={`Rewind ${VALIDATION_AUDIO_SKIP_SECONDS} seconds`}
                disabled={!audioReady}
                onClick={() => seekRelativeSeconds(-VALIDATION_AUDIO_SKIP_SECONDS)}
                onFocus={(e) => {
                  e.currentTarget.style.outline = FOCUS_RING;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.outline = "none";
                }}
              >
                <Rewind className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                style={iconBtn}
                aria-label={paused ? "Resume audio playback" : "Pause audio playback"}
                disabled={!audioReady}
                onClick={togglePause}
                onFocus={(e) => {
                  e.currentTarget.style.outline = FOCUS_RING;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.outline = "none";
                }}
              >
                {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
              </button>
              <button
                type="button"
                style={iconBtn}
                aria-label={`Fast-forward ${VALIDATION_AUDIO_SKIP_SECONDS} seconds`}
                disabled={!audioReady}
                onClick={() => seekRelativeSeconds(VALIDATION_AUDIO_SKIP_SECONDS)}
                onFocus={(e) => {
                  e.currentTarget.style.outline = FOCUS_RING;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.outline = "none";
                }}
              >
                <FastForward className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button
                type="button"
                style={iconBtn}
                aria-label="Stop audio playback"
                onClick={stopAudio}
                onFocus={(e) => {
                  e.currentTarget.style.outline = FOCUS_RING;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.outline = "none";
                }}
              >
                <Square className="h-3.5 w-3.5" aria-hidden />
              </button>
              <label className="flex items-center gap-1 font-mono text-[9px] text-zinc-400">
                <span className="sr-only">Playback speed</span>
                <select
                  aria-label={`Playback speed, currently ${speedLabel}`}
                  className="rounded border border-zinc-600 bg-[#0c0c0c] px-1.5 py-0.5 font-mono text-[9px] text-zinc-200"
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
      </>
    );
  }

  return (
    <>
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
      <button
        type="button"
        onClick={() => void startPlay()}
        disabled={audioLoading}
        className="mt-1 inline-flex min-h-[32px] min-w-[32px] items-center gap-1 rounded border border-primary/20 px-2 py-1 font-mono text-[8px] uppercase tracking-wider text-primary/70 transition-colors hover:border-primary/35 hover:text-primary disabled:opacity-40"
        aria-label="Play high-quality audio of this reply"
      >
        <Play className="h-3 w-3 shrink-0" aria-hidden />
        {audioLoading ? "Loading…" : "Play"}
      </button>
    </>
  );
}
