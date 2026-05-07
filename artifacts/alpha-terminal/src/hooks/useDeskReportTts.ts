import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { emitDeskTtsClientEvent, fetchDeskTtsChunkBlob } from "@/lib/deskAudioApi";
import { splitDeskAudioTextIntoChunks } from "@/lib/deskAudioChunking";
import { STRATEGIST_ANALYSIS_CANCEL_EVENT, STRATEGIST_ANALYSIS_START_EVENT } from "@/lib/strategistDeskSpeechEvents";

const SESSION_RATE_KEY = "strategistDeskSpeechRate";

/** Skip / rewind step in the desk audio bar (seconds within the current segment). */
export const DESK_AUDIO_SKIP_SECONDS = 15;

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
  const { deskAudioText, deskResultId, voiceConfig = {}, resetDependency, containerRef } = args;

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
  const progressiveFetchAbortRef = useRef<AbortController | null>(null);
  type ProgressiveSession = { playGen: number; chunks: string[]; index: number; sessionId: string };
  const progressiveSessionRef = useRef<ProgressiveSession | null>(null);
  const deskTtsSessionIdRef = useRef<string | null>(null);
  const [deskTtsSessionId, setDeskTtsSessionId] = useState<string | null>(null);
  const [segmentStall, setSegmentStall] = useState<{ chunkIndex: number } | null>(null);
  const warmedDeskTtsRef = useRef<{ warmKey: string; sessionId: string } | null>(null);
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
    progressiveFetchAbortRef.current?.abort();
    progressiveFetchAbortRef.current = null;
    progressiveSessionRef.current = null;
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
    setSegmentStall(null);
    setDeskTtsSessionId(null);
    deskTtsSessionIdRef.current = null;
    warmedDeskTtsRef.current = null;
  }, [revokeObjectUrl]);

  const startPlay = useCallback(async () => {
    if (!deskAudioText.trim() || deskAudioChunks.length === 0) return;
    const playGen = ++audioPlayGenRef.current;
    ttsFetchAbortRef.current?.abort();
    ttsFetchAbortRef.current = null;
    progressiveFetchAbortRef.current?.abort();
    progressiveFetchAbortRef.current = null;
    progressiveSessionRef.current = null;

    setAudioError(null);
    setSegmentStall(null);
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

    const ensureSession = async (): Promise<string | null> => {
      const warmed = warmedDeskTtsRef.current;
      if (warmed && warmed.warmKey === deskTtsWarmKey) {
        deskTtsSessionIdRef.current = warmed.sessionId;
        setDeskTtsSessionId(warmed.sessionId);
        return warmed.sessionId;
      }
      const existing = deskTtsSessionIdRef.current;
      if (existing) return existing;
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
        const j = (await res.json()) as { sessionId?: string };
        if (typeof j.sessionId === "string" && j.sessionId) {
          setDeskTtsSessionId(j.sessionId);
          deskTtsSessionIdRef.current = j.sessionId;
          return j.sessionId;
        }
        return null;
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
      const sid = await ensureSession();
      if (playGen !== audioPlayGenRef.current) return;
      if (!sid) {
        setAudioError("Audio unavailable — could not start playback session");
        setAudioBarOpen(true);
        return;
      }

      const blob = await fetchDeskTtsChunkBlob(sid, 0, ac.signal);
      if (playGen !== audioPlayGenRef.current) return;
      const url = URL.createObjectURL(blob);
      const ok = attachAndPlay(url);
      if (ok && deskAudioChunks.length > 1) {
        progressiveSessionRef.current = { playGen, chunks: deskAudioChunks, index: 0, sessionId: sid };
      }
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
  }, [deskAudioChunks, deskAudioText, deskResultId, deskTtsWarmKey, voiceConfig, revokeObjectUrl]);

  const loadProgressiveChunkAtIndex = useCallback(
    async (targetIdx: number) => {
      const sess = progressiveSessionRef.current;
      if (!sess) return;
      const { playGen, chunks, sessionId } = sess;
      if (playGen !== audioPlayGenRef.current) return;
      if (targetIdx < 0) return;
      if (targetIdx >= chunks.length) {
        progressiveSessionRef.current = null;
        stopAudio();
        return;
      }
      progressiveFetchAbortRef.current?.abort();
      const ac = new AbortController();
      progressiveFetchAbortRef.current = ac;
      try {
        const blob = await fetchDeskTtsChunkBlob(sessionId, targetIdx, ac.signal);
        if (playGen !== audioPlayGenRef.current) return;
        revokeObjectUrl();
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        progressiveSessionRef.current = { playGen, chunks, index: targetIdx, sessionId };
        setSegmentStall(null);
        const el = audioRef.current;
        if (el) {
          el.src = url;
          el.playbackRate = speechRateRef.current;
          expectAudioPlaybackRef.current = true;
          try {
            const p = el.play();
            if (p !== undefined) {
              void p.catch(() => {
                expectAudioPlaybackRef.current = false;
                if (playGen === audioPlayGenRef.current) {
                  progressiveSessionRef.current = null;
                  setAudioError("Audio unavailable — playback failed");
                }
              });
            }
          } catch {
            expectAudioPlaybackRef.current = false;
            if (playGen === audioPlayGenRef.current) {
              progressiveSessionRef.current = null;
              setAudioError("Audio unavailable — playback failed");
            }
          }
        }
      } catch (e) {
        if (playGen !== audioPlayGenRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        const is404 = /\b404\b/.test(msg);
        if (is404) {
          progressiveSessionRef.current = null;
          setAudioError("Audio unavailable — session expired. Tap Play to start again.");
          return;
        }
        const el = audioRef.current;
        if (el && !el.paused) {
          el.pause();
          setPaused(true);
        }
        setSegmentStall({ chunkIndex: targetIdx });
      } finally {
        if (progressiveFetchAbortRef.current === ac) {
          progressiveFetchAbortRef.current = null;
        }
      }
    },
    [revokeObjectUrl, stopAudio],
  );

  const resumeSegmentAfterStall = useCallback(() => {
    const stall = segmentStall;
    if (!stall) return;
    void loadProgressiveChunkAtIndex(stall.chunkIndex);
  }, [loadProgressiveChunkAtIndex, segmentStall]);

  const advanceProgressiveChunk = useCallback(async () => {
    const sess = progressiveSessionRef.current;
    if (!sess) return;
    await loadProgressiveChunkAtIndex(sess.index + 1);
  }, [loadProgressiveChunkAtIndex]);

  useEffect(() => {
    const text = deskAudioText.trim();
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
          body: JSON.stringify({ text, voiceConfig }),
          signal: ac.signal,
          clerkTokenTimeoutMs: 8000,
        });
        if (gen !== warmGenRef.current) return;
        if (!res.ok) {
          void emitDeskTtsClientEvent({ stage: "tts_warm_failed", httpStatus: res.status, deskResultId });
          return;
        }
        const j = (await res.json()) as { sessionId?: string };
        if (gen !== warmGenRef.current) return;
        if (typeof j.sessionId === "string" && j.sessionId) {
          warmedDeskTtsRef.current = { warmKey, sessionId: j.sessionId };
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

      if (deltaSec < 0) {
        const t = el.currentTime + deltaSec;
        if (t > 0.25) {
          el.currentTime = Math.max(0, t);
          resumeIfPaused();
          return;
        }
        const sess = progressiveSessionRef.current;
        if (sess && sess.playGen === audioPlayGenRef.current && sess.index > 0) {
          void loadProgressiveChunkAtIndex(sess.index - 1);
          return;
        }
        el.currentTime = 0;
        resumeIfPaused();
        return;
      }

      const dur = Number.isFinite(el.duration) ? el.duration : NaN;
      const t = el.currentTime + deltaSec;
      if (!Number.isFinite(dur) || dur <= 0) {
        el.currentTime = Math.max(0, t);
        resumeIfPaused();
        return;
      }
      const nearEnd = t >= dur - 0.35 || el.currentTime >= dur - 0.25;
      const sess = progressiveSessionRef.current;
      const hasNextChunk =
        sess && sess.playGen === audioPlayGenRef.current && sess.index < sess.chunks.length - 1;
      if (nearEnd && hasNextChunk) {
        void loadProgressiveChunkAtIndex(sess.index + 1);
        return;
      }
      el.currentTime = Math.min(dur, t);
      resumeIfPaused();
    },
    [loadProgressiveChunkAtIndex, audioReady],
  );

  const onAudioEnded = useCallback(() => {
    const sess = progressiveSessionRef.current;
    if (sess && sess.playGen === audioPlayGenRef.current) {
      void advanceProgressiveChunk();
    } else {
      stopAudio();
    }
  }, [advanceProgressiveChunk, stopAudio]);

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
    progressiveSessionRef.current = null;
    setAudioError("Audio unavailable — media could not be played");
    setAudioReady(false);
  }, []);

  return {
    audioRef,
    audioBarOpen,
    audioLoading,
    audioReady,
    audioError,
    paused,
    segmentStall,
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
