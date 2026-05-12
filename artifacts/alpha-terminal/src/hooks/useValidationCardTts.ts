import { type CSSProperties, type RefObject } from "react";
import { useDeskBufferedCardTts } from "@/hooks/useDeskBufferedCardTts";

const SESSION_RATE_KEY = "strategistValidationSpeechRate";

const EMPTY_VOICE: Record<string, unknown> = {};

export const VALIDATION_AUDIO_SKIP_SECONDS = 15;

const TOUCH_MIN = 44;

/**
 * Buffered desk-audio pipeline (same `/api/tts/desk-audio` as Desk card): merged MP3 for PWA background play.
 */
export function useValidationCardTts(args: {
  plainText: string;
  /** Telemetry / cache partition id (e.g. `validation-${jobId}`). */
  audioId: string;
  /** When this changes, playback stops and session is cleared. */
  resetDependency: unknown;
  containerRef?: RefObject<HTMLElement | null>;
}): ReturnType<typeof useDeskBufferedCardTts> & { iconBtnBase: CSSProperties } {
  const tts = useDeskBufferedCardTts({
    plainText: args.plainText,
    audioId: args.audioId,
    voiceConfig: EMPTY_VOICE,
    sessionRateStorageKey: SESSION_RATE_KEY,
    resetDependency: args.resetDependency,
    containerRef: args.containerRef,
  });

  const iconBtnBase: CSSProperties = {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    border: "1px solid #2a2a2a",
    background: "#0d0d0f",
    color: "#e5e5e5",
    cursor: "pointer",
  };

  return { ...tts, iconBtnBase };
}
