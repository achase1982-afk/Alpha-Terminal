import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  emitDeskTtsClientEvent,
  fetchAllDeskTtsChunksMerged,
} from "@/lib/deskAudioApi";
import { splitDeskAudioTextIntoChunks } from "@/lib/deskAudioChunking";
import { STRATEGIST_ANALYSIS_CANCEL_EVENT, STRATEGIST_ANALYSIS_START_EVENT } from "@/lib/strategistDeskSpeechEvents";

const SESSION_RATE_KEY = "strategistDeskSpeechRate";

const EMPTY_DESK_REPORT_TTS_VOICE_CONFIG: Record<string, unknown> = {};

/** Skip / rewind step in the desk audio bar (seconds on the continuous timeline). */
export const DESK_AUDIO_SKIP_SECONDS = 15;

type DeskSessionMeta = { sessionId: string; totalChunks: number };

function parseStartResponse(j: unknown, fallbackChunkCount: number): DeskSessionMeta | null {
  if (!j || typeof j !== "object") return null;
  const sessionId = "sessionId" in j && typeof (j as { sessionId?: unknown }).sessionId === "string" ? (j as { sessionId: string }).sessionId : "";
  const tc = "totalChunks" in j ? (j as { totalChunks?: unknown }).totalChunks : undefined;
  const fromApi = typeof tc === "number" && Number.isInteger(tc) && tc >= 1 ? tc : 0;
  const totalChunks = fromApi || Math.max(1, fallbackChunkCount);
  if (!sessionId.trim()) return null;
  return { sessionId: sessionId.trim(), totalChunks };
}

export function useDeskReportTts(args: {
  /** Full script for TTS (plain text). */
  deskAudioText: string;
  /** Cache / telemetry id (from `deskResultAudioId`). */
  deskResultId: string;
  voiceConfig?: Record<string, unknown>;
  /** When this changes, playback stops (e.g. the full desk result). */
  resetDependency: unknown;
  /** If set, stop audio when this node is removed from the document. */
  containerRef?: RefObject<HTMLElement | null>;
}): {
  audioRef: RefObject<HTMLAudioElement | null>;
  audioBarOpen: boolean;
  audioLoading: boolean;
  audioReady: boolean;
  audioError: string | null;
  paused: boolean;
  segmentStall: { chunkIndex: number } | null;
  speechRate: number;
  setSpeechRate: (r: number) => void;
  speedLabel: string;
  startPlay: () => Promise<void>;
  stopAudio: () => void;
  togglePause: () => void;
  seekRelativeSeconds: (deltaSec: number) => void;
  resumeSegmentAfterStall: () => void;
  onAudioEnded: () => void;
  onLoadedMetadata: () => void;
  onPlay: () => void;
  onPause: () => void;
  onAudioElementError: () => void;
} {
  const {
    deskAudioText,
    deskResultId,
    voiceConfig = EMPTY_DESK_REPORT_TTS_VOICE_CONFIG,
    resetDependency,
    containerRef,
  } = args;

  const deskAudioChunks = useMemo(() => splitDeskAudioTextIntoChunks(deskAudioText), [deskAudioText]);

  const deskTtsWarmKey = useMemo(
    () => `${deskResultId}\0${deskAudioText.trim()}\0${JSON.stringify(voiceConfig)}`,
    [deskResultId, deskAudioText, voiceConfig],
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
  const deskTtsSessionMetaRef = useRef<DeskSessionMeta | null>(null);
  const warmedDeskTtsRef = useRef<{ warmKey: string } & DeskSessionMeta | null>(null);
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
    deskTtsSessionMetaRef.current = null;
    warmedDeskTtsRef.current = null;
  }, [revokeObjectUrl]);

  const startPlay = useCallback(async () => {
    if (!deskAudioText.trim() || deskAudioChunks.length === 0) return;
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

    const fallbackChunkCount = Math.max(1, deskAudioChunks.length);

    const ensureSession = async (): Promise<DeskSessionMeta | null> => {
      const warmed = warmedDeskTtsRef.current;
      if (warmed && warmed.warmKey === deskTtsWarmKey) {
        const meta: DeskSessionMeta = { sessionId: warmed.sessionId, totalChunks: warmed.totalChunks };
        deskTtsSessionMetaRef.current = meta;
        deskTtsSessionIdRef.current = meta.sessionId;
        setDeskTtsSessionId(meta.sessionId);
        return meta;
      }
      const cached = deskTtsSessionMetaRef.current;
      const sid = deskTtsSessionIdRef.current;
      if (cached && sid && cached.sessionId === sid) {
        return cached;
      }
      try {
        const res = await fetchWithAuth("/api/tts/desk-audio/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: deskAudioText.trim(), voiceConfig }),
          signal: ac.signal,
          clerkTokenTimeoutMs: 8000,
        });
        if (!res.ok) {
          void emitDeskTtsClientEvent({
            stage: "tts_session_start_failed",
            httpStatus: res.status,
            deskResultId,
          });
          return null;
        }
        const j = (await res.json()) as unknown;
        const parsed = parseStartResponse(j, fallbackChunkCount);
        if (!parsed) {
          void emitDeskTtsClientEvent({
            stage: "tts_session_start_failed",
            httpStatus: res.status,
            detail: "invalid_start_response",
            deskResultId,
          });
          return null;
        }
        const meta: DeskSessionMeta = parsed;
        deskTtsSessionMetaRef.current = meta;
        setDeskTtsSessionId(meta.sessionId);
        deskTtsSessionIdRef.current = meta.sessionId;
        return meta;
      } catch (e) {
        void emitDeskTtsClientEvent({
          stage: "tts_session_start_failed",
          httpStatus: null,
          detail: e instanceof Error ? e.message : String(e),
          deskResultId,
        });
        return null;
      }
    };

    try {
      const meta = await ensureSession();
      if (playGen !== audioPlayGenRef.current) return;
      if (!meta) {
        setAudioError("Audio unavailable — could not start playback session");
        setAudioBarOpen(true);
        return;
      }

      const merged = await fetchAllDeskTtsChunksMerged(meta.sessionId, meta.totalChunks, ac.signal);
      if (playGen !== audioPlayGenRef.current) return;
      const url = URL.createObjectURL(merged);
      attachAndPlay(url);
    } catch (e) {
      if (playGen !== audioPlayGenRef.current) return;
      const aborted = e instanceof DOMException && e.name === "AbortError";
      setAudioError(
        aborted ? "Audio unavailable — request timed out or was cancelled" : "Audio unavailable — network error",
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
  }, [deskAudioChunks.length, deskAudioText, deskResultId, deskTtsWarmKey, voiceConfig, revokeObjectUrl]);

  useEffect(() => {
    const text = deskAudioText.trim();
    if (!text) {
      warmGenRef.current += 1;
      warmedDeskTtsRef.current = null;
      setDeskTtsSessionId(null);
      deskTtsSessionIdRef.current = null;
      deskTtsSessionMetaRef.current = null;
      return;
    }
    warmGenRef.current += 1;
    const gen = warmGenRef.current;
    const warmKey = deskTtsWarmKey;
    const ac = new AbortController();
    const fallbackChunks = Math.max(1, splitDeskAudioTextIntoChunks(text).length);

    void (async () => {
      try {
        const res = await fetchWithAuth("/api/tts/desk-audio/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voiceConfig }),
          signal: ac.signal,
          clerkTokenTimeoutMs: 8000,
        });
        if (gen !== warmGenRef.current) return;
        if (!res.ok) {
          void emitDeskTtsClientEvent({ stage: "tts_warm_failed", httpStatus: res.status, deskResultId });
          return;
        }
        const j = (await res.json()) as unknown;
        const parsed = parseStartResponse(j, fallbackChunks);
        if (gen !== warmGenRef.current) return;
        if (!parsed) {
          void emitDeskTtsClientEvent({
            stage: "tts_warm_failed",
            httpStatus: res.status,
            detail: "invalid_start_response",
            deskResultId,
          });
          return;
        }
        warmedDeskTtsRef.current = { warmKey, sessionId: parsed.sessionId, totalChunks: parsed.totalChunks };
        deskTtsSessionMetaRef.current = parsed;
        setDeskTtsSessionId((prev) => {
          if (prev) return prev;
          deskTtsSessionIdRef.current = parsed.sessionId;
          return parsed.sessionId;
        });
      } catch (e) {
        if (gen === warmGenRef.current) {
          void emitDeskTtsClientEvent({
            stage: "tts_warm_failed",
            httpStatus: null,
            detail: e instanceof Error ? e.message : String(e),
            deskResultId,
          });
        }
      }
    })();

    return () => {
      ac.abort();
    };
  }, [deskAudioText, deskTtsWarmKey, deskResultId, voiceConfig]);

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

  const seekRelativeSeconds = useCallback((deltaSec: number) => {
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
  }, [audioReady]);

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

  const resumeSegmentAfterStall = useCallback(() => {}, []);

  return {
    audioRef,
    audioBarOpen,
    audioLoading,
    audioReady,
    audioError,
    paused,
    segmentStall: null,
    speechRate,
    setSpeechRate,
    speedLabel,
    startPlay,
    stopAudio,
    togglePause,
    seekRelativeSeconds,
    resumeSegmentAfterStall,
    onAudioEnded,
    onLoadedMetadata,
    onPlay,
    onPause,
    onAudioElementError,
  };
}
