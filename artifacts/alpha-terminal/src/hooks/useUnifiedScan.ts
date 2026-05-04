import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { UnifiedScanJobResult } from "@/lib/unifiedScanTypes";

const API_BASE = "/api";
const PENDING_KEY = "alpha.unifiedScan.pending.v1";

export type UnifiedScanPhase = "idle" | "scanning" | "complete" | "error";

export interface UseUnifiedScanState {
  phase: UnifiedScanPhase;
  scanId: string | null;
  estimatedSeconds: number;
  etaRemaining: number;
  slowNotice: boolean;
  result: UnifiedScanJobResult | null;
  errorMessage: string | null;
  pollNetworkRetries: number;
  startScan: (universeId: string) => Promise<void>;
  cancelLocal: () => void;
  retryPoll: () => void;
}

const POLL_MS = 2000;
const SLOW_AFTER_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clearPendingStorage() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function writePendingStorage(scanId: string, universeId: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ scanId, universeId, savedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function useUnifiedScan(): UseUnifiedScanState {
  const [phase, setPhase] = useState<UnifiedScanPhase>("idle");
  const [scanId, setScanId] = useState<string | null>(null);
  const [estimatedSeconds, setEstimatedSeconds] = useState(15);
  const [etaRemaining, setEtaRemaining] = useState(15);
  const [slowNotice, setSlowNotice] = useState(false);
  const [result, setResult] = useState<UnifiedScanJobResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pollNetworkRetries, setPollNetworkRetries] = useState(0);

  const scanIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);
  const scanStartMsRef = useRef<number>(0);
  const etaIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hydratedRef = useRef(false);

  const clearEtaTicker = useCallback(() => {
    if (etaIntervalRef.current) {
      clearInterval(etaIntervalRef.current);
      etaIntervalRef.current = null;
    }
  }, []);

  const startEtaCountdown = useCallback(
    (seconds: number) => {
      clearEtaTicker();
      const est = Math.max(1, seconds);
      setEtaRemaining(est);
      etaIntervalRef.current = setInterval(() => {
        setEtaRemaining((x) => Math.max(0, x - 1));
      }, 1000);
    },
    [clearEtaTicker],
  );

  const cancelLocal = useCallback(() => {
    cancelledRef.current = true;
    scanIdRef.current = null;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    clearEtaTicker();
    setSlowNotice(false);
    setPhase("idle");
    setScanId(null);
    setResult(null);
    setErrorMessage(null);
    setPollNetworkRetries(0);
    clearPendingStorage();
  }, [clearEtaTicker]);

  const fetchStatus = useCallback(async (id: string, signal: AbortSignal): Promise<UnifiedScanJobResult> => {
    const res = await fetchWithAuth(`${API_BASE}/ai/scan/${encodeURIComponent(id)}`, { signal });
    if (res.status === 404) {
      throw new Error("NOT_FOUND");
    }
    if (res.status === 401) {
      throw new Error("UNAUTHORIZED");
    }
    if (res.status === 500) {
      throw new Error("SERVER_ERROR");
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(t || `HTTP ${res.status}`);
    }
    return (await res.json()) as UnifiedScanJobResult;
  }, []);

  const runPollingLoop = useCallback(
    async (id: string) => {
      cancelledRef.current = false;
      scanIdRef.current = id;
      scanStartMsRef.current = Date.now();
      setSlowNotice(false);
      setPollNetworkRetries(0);

      let networkFailStreak = 0;

      while (!cancelledRef.current && scanIdRef.current === id) {
        if (Date.now() - scanStartMsRef.current > SLOW_AFTER_MS) {
          setSlowNotice(true);
        }

        const ac = new AbortController();
        pollAbortRef.current = ac;

        let data: UnifiedScanJobResult;
        try {
          data = await fetchStatus(id, ac.signal);
          networkFailStreak = 0;
        } catch (e) {
          if (cancelledRef.current || scanIdRef.current !== id) return;
          if (e instanceof Error && e.name === "AbortError") return;
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === "UNAUTHORIZED") {
            setPhase("error");
            setErrorMessage("Session expired. Please sign in again.");
            clearEtaTicker();
            clearPendingStorage();
            return;
          }
          if (msg === "NOT_FOUND") {
            setPhase("error");
            setErrorMessage("Scan not found.");
            clearEtaTicker();
            clearPendingStorage();
            return;
          }
          if (msg === "SERVER_ERROR") {
            setPhase("error");
            setErrorMessage("Server error. Please try again.");
            clearEtaTicker();
            clearPendingStorage();
            return;
          }
          networkFailStreak++;
          setPollNetworkRetries(networkFailStreak);
          if (networkFailStreak >= 3) {
            setPhase("error");
            setErrorMessage("Network error. Check connection and tap Retry.");
            clearEtaTicker();
            return;
          }
          const backoff = 800 * 2 ** (networkFailStreak - 1);
          await sleep(backoff);
          continue;
        }

        if (cancelledRef.current || scanIdRef.current !== id) return;

        setResult(data);

        if (data.status === "complete" || data.status === "failed") {
          clearEtaTicker();
          clearPendingStorage();
          setPhase(data.status === "failed" ? "error" : "complete");
          if (data.status === "failed") {
            setErrorMessage(data.error ?? "Scan failed");
          } else {
            setErrorMessage(null);
          }
          return;
        }

        await sleep(POLL_MS);
      }
    },
    [clearEtaTicker, fetchStatus],
  );

  useEffect(() => {
    const id = scanId;
    if (!id || phase !== "scanning") return;
    cancelledRef.current = false;
    void runPollingLoop(id);
    return () => {
      pollAbortRef.current?.abort();
    };
  }, [scanId, phase, runPollingLoop]);

  /** Resume a job after remount (sessionStorage) or retry after poll network errors. */
  const beginScanningWithId = useCallback(
    (id: string, est: number) => {
      cancelledRef.current = false;
      setErrorMessage(null);
      setResult(null);
      setPollNetworkRetries(0);
      setSlowNotice(false);
      setPhase("scanning");
      setScanId(id);
      scanIdRef.current = id;
      setEstimatedSeconds(est);
      startEtaCountdown(est);
    },
    [startEtaCountdown],
  );

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { scanId?: string };
      if (typeof parsed.scanId === "string" && parsed.scanId) {
        beginScanningWithId(parsed.scanId, 15);
      }
    } catch {
      /* ignore */
    }
  }, [beginScanningWithId]);

  const startScan = useCallback(
    async (universeId: string) => {
      cancelLocal();
      setErrorMessage(null);
      setResult(null);
      setPollNetworkRetries(0);
      setSlowNotice(false);
      setPhase("scanning");

      let postRetries = 0;
      while (postRetries < 3) {
        try {
          const res = await fetchWithAuth(`${API_BASE}/ai/scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ universeId }),
          });
          if (res.status === 401) {
            setPhase("error");
            setErrorMessage("Session expired. Please sign in again.");
            return;
          }
          if (res.status === 429) {
            const j = await res.json().catch(() => ({}));
            setPhase("error");
            setErrorMessage((j as { error?: string }).error ?? "Too many scans. Wait 10 seconds.");
            return;
          }
          if (res.status === 409) {
            const j = (await res.json().catch(() => ({}))) as { message?: string };
            setPhase("error");
            setErrorMessage(j.message ?? "Scanning paused — regime shock active");
            return;
          }
          if (!res.ok) {
            if (res.status === 500) {
              setPhase("error");
              setErrorMessage("Server error. Please try again.");
              return;
            }
            const t = await res.text().catch(() => "");
            throw new Error(t || `HTTP ${res.status}`);
          }
          const body = (await res.json()) as { scanId: string; estimatedSeconds: number };
          const est = Math.max(1, body.estimatedSeconds ?? 15);
          writePendingStorage(body.scanId, universeId);
          beginScanningWithId(body.scanId, est);
          return;
        } catch {
          postRetries++;
          if (postRetries >= 3) {
            setPhase("error");
            setErrorMessage("Couldn't start scan. Check connection and try again.");
            return;
          }
          await sleep(400 * 2 ** (postRetries - 1));
        }
      }
    },
    [beginScanningWithId, cancelLocal],
  );

  const retryPoll = useCallback(() => {
    const id = scanId;
    if (!id) return;
    setErrorMessage(null);
    setPhase("scanning");
    void runPollingLoop(id);
  }, [scanId, runPollingLoop]);

  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
      cancelledRef.current = true;
    };
  }, []);

  return {
    phase,
    scanId,
    estimatedSeconds,
    etaRemaining,
    slowNotice,
    result,
    errorMessage,
    pollNetworkRetries,
    startScan,
    cancelLocal,
    retryPoll,
  };
}
