import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { emitDeskTtsClientEvent, fetchAllDeskTtsChunksMerged } from "@/lib/deskBufferedTtsClient";
import { splitDeskAudioTextIntoChunks } from "@/lib/deskAudioChunking";
import { STRATEGIST_ANALYSIS_CANCEL_EVENT, STRATEGIST_ANALYSIS_START_EVENT } from "@/lib/strategistDeskSpeechEvents";

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
}): {
  audioRef: RefObject<HTMLAudioElement | null>;
  audioBarOpen: boolean;
  audioLoading: boolean;
  audioReady: boolean;
  audioError: string | null;
  paused: boolean;
  speechRate: number;
  setSpeechRate: (r: number) => void;
  speedLabel: string;
  startPlay: () => Promise<void>;
  stopAudio: () => void;
  togglePause: () => void;
  seekRelativeSeconds: (deltaSec: number) => void;
  onAudioEnded: () => void;
  onLoadedMetadata: () => void;
  onPlay: () => void;
  onPause: () => void;
  onAudioElementError: () => void;
  iconBtnBase: CSSProperties;
} {
  const { plainText, audioId, resetDependency, containerRef } = args;

  const deskAudioChunks = useMemo(() => splitDeskAudioTextIntoChunks(plainText), [plainText]);
  const deskTtsWarmKey = useMemo(
    () => `${audioId}\0${plainText.trim()}\0${JSON.stringify(EMPTY_VOICE)}`,
    [audioId, plainText],
  );

  const [speechRate, setSpeechRateState] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const v = Number(sessionStorage.getItem(SESSION_RATE_KEY));
    return [1, 1.25, 1.5, 2].includes(v) ? v : 1;
  });
  const speechRateRef = useRef(speechRate);
  speechRateRef.current = speechRate;

  const speedLabel = speechRate === 1 ? "1x" : speechRate === 1.25 ? "1.25x" : speechRate === 1.5 ? "1.5x" : "2x";

  const setSpeechRate = useCallback((r: number) => {
    setSpeechRateState(r);
    try {
      sessionStorage.setItem(SESSION_RATE_KEY, String(r));
    } catch {
      /* QuotaExceededError */
    }
    speechRateRef.current = r;
    if (audioRef.current) {
      audioRef.current.playbackRate = r;
    }
  }, []);

  const [audioBarOpen, setAudioBarOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const audioPlayGenRef = useRef(0);
  const ttsFetchAbortRef = useRef<AbortController | null>(null);
  const deskTtsSessionIdRef = useRef<string | null>(null);
  const [deskTtsSessionId, setDeskTtsSessionId] = useState<string | null>(null);
  const warmedDeskTtsRef = useRef<{ warmKey: string; sessionId: string; totalChunks: number } | null>(null);
  const warmGenRef = useRef(0);
  const ttsLoadingPlayGenRef = useRef<number | null>(null);
  const expectAudioPlaybackRef = useRef(false);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    deskTtsSessionIdRef.current = deskTtsSessionId;
  }, [deskTtsSessionId]);

  const stopAudio = useCallback(() => {
    expectAudioPlaybackRef.current = false;
    audioPlayGenRef.current += 1;
    ttsFetchAbortRef.current?.abort();
    ttsFetchAbortRef.current = null;
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
      el.removeAttribute("src");
      el.load();
    }
    revokeObjectUrl();
    setPaused(false);
    setAudioBarOpen(false);
    setAudioLoading(false);
    ttsLoadingPlayGenRef.current = null;
    setAudioReady(false);
    setAudioError(null);
    setDeskTtsSessionId(null);
    deskTtsSessionIdRef.current = null;
    warmedDeskTtsRef.current = null;
  }, [revokeObjectUrl]);

  const startPlay = useCallback(async () => {
    if (!plainText.trim() || deskAudioChunks.length === 0) return;
    const playGen = ++audioPlayGenRef.current;
    ttsFetchAbortRef.current?.abort();
    ttsFetchAbortRef.current = null;

    setAudioError(null);
    setAudioReady(false);

    const attachAndPlay = (blobUrl: string): boolean => {
      const el = audioRef.current;
      if (!el || playGen !== audioPlayGenRef.current) return false;
      revokeObjectUrl();
      objectUrlRef.current = blobUrl;
      setAudioBarOpen(true);
      setPaused(false);
      setAudioReady(true);
      el.src = blobUrl;
      el.playbackRate = speechRateRef.current;
      expectAudioPlaybackRef.current = true;
      try {
        const p = el.play();
        if (p !== undefined) {
          void p.catch(() => {
            expectAudioPlaybackRef.current = false;
            if (playGen === audioPlayGenRef.current) {
              setAudioError("Audio unavailable — playback failed");
              setAudioReady(false);
            }
          });
        }
      } catch {
        expectAudioPlaybackRef.current = false;
        if (playGen === audioPlayGenRef.current) {
          setAudioError("Audio unavailable — playback failed");
          setAudioReady(false);
        }
        return false;
      }
      return playGen === audioPlayGenRef.current;
    };

    const ac = new AbortController();
    ttsFetchAbortRef.current = ac;
    const TTS_FETCH_MS = 180_000;
    const timeoutId =
      typeof window !== "undefined"
        ? window.setTimeout(() => {
            ac.abort();
          }, TTS_FETCH_MS)
        : 0;

    setAudioLoading(true);
    ttsLoadingPlayGenRef.current = playGen;

    const ensureSession = async (): Promise<{ sessionId: string; totalChunks: number } | null> => {
      const warmed = warmedDeskTtsRef.current;
      if (warmed && warmed.warmKey === deskTtsWarmKey) {
        deskTtsSessionIdRef.current = warmed.sessionId;
        setDeskTtsSessionId(warmed.sessionId);
        return { sessionId: warmed.sessionId, totalChunks: warmed.totalChunks };
      }
      const existingId = deskTtsSessionIdRef.current;
      if (existingId) {
        return { sessionId: existingId, totalChunks: deskAudioChunks.length };
      }
      try {
        const res = await fetchWithAuth("/api/tts/desk-audio/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: plainText.trim(), voiceConfig: EMPTY_VOICE }),
          signal: ac.signal,
          clerkTokenTimeoutMs: 8000,
        });
        if (!res.ok) {
          void emitDeskTtsClientEvent({
            stage: "tts_session_start_failed",
            httpStatus: res.status,
            deskResultId: audioId,
          });
          return null;
        }
        const j = (await res.json()) as { sessionId?: string; totalChunks?: number };
        if (typeof j.sessionId !== "string" || !j.sessionId) return null;
        const totalChunks =
          typeof j.totalChunks === "number" && Number.isFinite(j.totalChunks) && j.totalChunks >= 1
            ? Math.floor(j.totalChunks)
            : deskAudioChunks.length;
        setDeskTtsSessionId(j.sessionId);
        deskTtsSessionIdRef.current = j.sessionId;
        warmedDeskTtsRef.current = { warmKey: deskTtsWarmKey, sessionId: j.sessionId, totalChunks };
        return { sessionId: j.sessionId, totalChunks };
      } catch (e) {
        void emitDeskTtsClientEvent({
          stage: "tts_session_start_failed",
          httpStatus: null,
          detail: e instanceof Error ? e.message : String(e),
          deskResultId: audioId,
        });
        return null;
      }
    };

    try {
      const session = await ensureSession();
      if (playGen !== audioPlayGenRef.current) return;
      if (!session) {
        setAudioError("Audio unavailable — could not start playback session");
        setAudioBarOpen(true);
        return;
      }

      const { sessionId: sid, totalChunks: nRaw } = session;
      const n =
        typeof nRaw === "number" && Number.isFinite(nRaw) && nRaw >= 1 ? Math.floor(nRaw) : deskAudioChunks.length;

      const merged = await fetchAllDeskTtsChunksMerged(sid, n, ac.signal);
      if (playGen !== audioPlayGenRef.current) return;
      const url = URL.createObjectURL(merged);
      const ok = attachAndPlay(url);
      if (!ok) {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      if (playGen !== audioPlayGenRef.current) return;
      const aborted = e instanceof DOMException && e.name === "AbortError";
      setAudioError(
        aborted
          ? "Audio unavailable — request timed out or was cancelled"
          : "Audio unavailable — network error",
      );
      setAudioBarOpen(true);
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (ttsFetchAbortRef.current === ac) {
        ttsFetchAbortRef.current = null;
      }
      if (ttsLoadingPlayGenRef.current === playGen) {
        setAudioLoading(false);
        ttsLoadingPlayGenRef.current = null;
      }
    }
  }, [audioId, deskAudioChunks, deskTtsWarmKey, plainText, revokeObjectUrl]);

  useEffect(() => {
    const text = plainText.trim();
    if (!text) {
      warmGenRef.current += 1;
      warmedDeskTtsRef.current = null;
      setDeskTtsSessionId(null);
      deskTtsSessionIdRef.current = null;
      return;
    }
    warmGenRef.current += 1;
    const gen = warmGenRef.current;
    const warmKey = deskTtsWarmKey;
    const ac = new AbortController();

    void (async () => {
      try {
        const res = await fetchWithAuth("/api/tts/desk-audio/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voiceConfig: EMPTY_VOICE }),
          signal: ac.signal,
          clerkTokenTimeoutMs: 8000,
        });
        if (gen !== warmGenRef.current) return;
        if (!res.ok) {
          void emitDeskTtsClientEvent({ stage: "tts_warm_failed", httpStatus: res.status, deskResultId: audioId });
          return;
        }
        const j = (await res.json()) as { sessionId?: string; totalChunks?: number };
        if (gen !== warmGenRef.current) return;
        if (typeof j.sessionId === "string" && j.sessionId) {
          const totalChunks =
            typeof j.totalChunks === "number" && Number.isFinite(j.totalChunks) && j.totalChunks >= 1
              ? Math.floor(j.totalChunks)
              : deskAudioChunks.length;
          warmedDeskTtsRef.current = { warmKey, sessionId: j.sessionId, totalChunks };
          setDeskTtsSessionId((prev) => {
            if (prev) return prev;
            deskTtsSessionIdRef.current = j.sessionId!;
            return j.sessionId!;
          });
        }
      } catch (e) {
        if (gen === warmGenRef.current) {
          void emitDeskTtsClientEvent({
            stage: "tts_warm_failed",
            httpStatus: null,
            detail: e instanceof Error ? e.message : String(e),
            deskResultId: audioId,
          });
        }
      }
    })();

    return () => {
      ac.abort();
    };
  }, [audioId, deskAudioChunks.length, deskTtsWarmKey, plainText]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  useEffect(() => {
    stopAudio();
  }, [resetDependency, stopAudio]);

  useEffect(() => {
    const root = containerRef?.current;
    if (!root) return;
    const mo = new MutationObserver(() => {
      if (!root.isConnected) {
        stopAudio();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [containerRef, stopAudio]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && audioBarOpen) {
        e.preventDefault();
        stopAudio();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audioBarOpen, stopAudio]);

  useEffect(() => {
    const onAnalysisStart = () => stopAudio();
    window.addEventListener(STRATEGIST_ANALYSIS_START_EVENT, onAnalysisStart);
    window.addEventListener(STRATEGIST_ANALYSIS_CANCEL_EVENT, onAnalysisStart);
    return () => {
      window.removeEventListener(STRATEGIST_ANALYSIS_START_EVENT, onAnalysisStart);
      window.removeEventListener(STRATEGIST_ANALYSIS_CANCEL_EVENT, onAnalysisStart);
    };
  }, [stopAudio]);

  const togglePause = useCallback(() => {
    if (!audioBarOpen) return;
    const el = audioRef.current;
    if (!el?.src) return;
    if (el.paused) {
      void el.play().catch(() => {});
      setPaused(false);
    } else {
      el.pause();
      setPaused(true);
    }
  }, [audioBarOpen]);

  const seekRelativeSeconds = useCallback(
    (deltaSec: number) => {
      const el = audioRef.current;
      if (!el?.src || !audioReady) return;

      const resumeIfPaused = () => {
        if (el.paused) {
          void el.play().catch(() => {});
          setPaused(false);
        }
      };

      const dur = Number.isFinite(el.duration) ? el.duration : NaN;
      const next = el.currentTime + deltaSec;
      if (!Number.isFinite(dur) || dur <= 0) {
        el.currentTime = Math.max(0, next);
        resumeIfPaused();
        return;
      }
      el.currentTime = Math.min(dur, Math.max(0, next));
      resumeIfPaused();
    },
    [audioReady],
  );

  const onAudioEnded = useCallback(() => {
    stopAudio();
  }, [stopAudio]);

  const onLoadedMetadata = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.playbackRate = speechRateRef.current;
    }
  }, []);

  const onPlay = useCallback(() => {
    expectAudioPlaybackRef.current = false;
    setPaused(false);
  }, []);

  const onPause = useCallback(() => {
    setPaused(true);
  }, []);

  const onAudioElementError = useCallback(() => {
    if (!expectAudioPlaybackRef.current) return;
    expectAudioPlaybackRef.current = false;
    setAudioError("Audio unavailable — media could not be played");
    setAudioReady(false);
  }, []);

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

  return {
    audioRef,
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
  };
}
