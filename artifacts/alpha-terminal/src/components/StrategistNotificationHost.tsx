import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { readStrategistNotificationSettings } from "@/lib/strategistNotificationSettings";
import { useTerminalStore } from "@/lib/store";

interface StrategistNotificationEvent {
  kind: "ready" | "failed" | "ivr_ready" | "ivr_failed";
  ticker: string;
  jobId?: string | null;
  message: string;
  resultStatus?: string;
  createdAt: string;
}

function isSuccess(kind: StrategistNotificationEvent["kind"]): boolean {
  return kind === "ready" || kind === "ivr_ready";
}

function playSoftTone() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.025;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // best-effort sound
  }
}

export function StrategistNotificationHost() {
  const [, navigate] = useLocation();
  const [toast, setToast] = useState<StrategistNotificationEvent | null>(null);
  const seenIds = useRef(new Set<string>());

  const settings = useMemo(() => readStrategistNotificationSettings(), [toast]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetchWithAuth("/api/strategist/notifications/recent");
        if (!res.ok) return;
        const events = await res.json() as StrategistNotificationEvent[];
        const next = events
          .slice()
          .reverse()
          .find((e) => {
            const id = `${e.createdAt}:${e.jobId ?? ""}:${e.kind}`;
            if (seenIds.current.has(id)) return false;
            seenIds.current.add(id);
            return true;
          });
        if (!next || cancelled) return;
        if (settings.toastEnabled) {
          setToast(next);
          window.setTimeout(() => setToast((cur) => (cur === next ? null : cur)), 5000);
        }
        if (settings.soundEnabled) playSoftTone();
      } catch {
        // best-effort notification polling
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [settings.toastEnabled, settings.soundEnabled]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") === "strategist") {
      navigate("/");
    }
  }, [navigate]);

  if (!toast) return null;

  const success = isSuccess(toast.kind);
  const title = success ? `Strategist ready for ${toast.ticker}` : `Strategist failed for ${toast.ticker}`;
  return (
    <button
      type="button"
      onClick={() => {
        useTerminalStore.getState().setSymbol(toast.ticker);
        setToast(null);
        navigate("/");
      }}
      className="fixed right-4 top-4 z-[10000] w-[min(360px,calc(100vw-2rem))] rounded-xl border p-4 text-left shadow-2xl animate-in slide-in-from-right-4 fade-in"
      style={{ background: "#111113", borderColor: success ? "rgba(74,222,128,0.45)" : "rgba(248,113,113,0.45)" }}
    >
      <div className="font-mono text-[12px] font-bold text-white uppercase tracking-wider">{title}</div>
      <div className="mt-1 font-mono text-[11px] text-zinc-400">{toast.message}</div>
      <div className="mt-2 font-mono text-[10px]" style={{ color: success ? "#4ade80" : "#f87171" }}>
        Tap to open Strategist
      </div>
    </button>
  );
}
