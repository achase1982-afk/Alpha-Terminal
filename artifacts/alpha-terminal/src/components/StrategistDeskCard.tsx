import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { BlockReason, StrategistOutcome } from "@/components/StrategistV2Card";
import { ChevronDown, ChevronUp, AlertTriangle, Copy, Play, Pause, Square } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { DeskResult, DeskStructure } from "@/lib/strategistDeskResult";
import { buildDeskSpeechSections } from "@/lib/deskCardSpeech";
import { STRATEGIST_ANALYSIS_CANCEL_EVENT, STRATEGIST_ANALYSIS_START_EVENT } from "@/lib/strategistDeskSpeechEvents";

export type { DeskResult } from "@/lib/strategistDeskResult";

/** OpenAI TTS input limit per request; smaller chunks start audio sooner. */
const TTS_CHUNK_TARGET_CHARS = 900;

const PAL = {
  bgCard: "#141414",
  bgInner: "#0a0a0a",
  border: "#2a2a2a",
  borderInner: "#1f1f1f",
  label: "#a3a3a3",
  body: "#e5e5e5",
  white: "#ffffff",
  green: "#4ade80",
  red: "#f87171",
  gold: "#fbbf24",
  goldHeader: "#f59e0b",
};

const SYS_FONT = "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif";

const FOCUS_RING = "2px solid rgba(255,255,255,0.85)";
const TOUCH_MIN = 44;

/** Stable id for TTS cache partitioning (hash of serialized desk payload). */
function deskResultAudioId(deskResult: DeskResult, bannerTitle?: string, bannerBody?: string): string {
  const payload = JSON.stringify({
    ticker: deskResult.ticker,
    mode: deskResult.mode,
    pm: deskResult.pm,
    vol: deskResult.vol,
    flow: deskResult.flow,
    catalyst: deskResult.catalyst,
    errors: deskResult.errors,
    bannerTitle: bannerTitle ?? null,
    bannerBody: bannerBody ?? null,
  });
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `desk-${(h >>> 0).toString(16)}`;
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
      <span style={{ fontFamily: SYS_FONT, fontSize: 11, color: PAL.label, minWidth: 120, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: SYS_FONT, fontSize: 11, color: PAL.body, lineHeight: 1.5 }}>{value}</span>
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen,
  headerAddon,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  headerAddon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div
      style={{
        border: `1px solid ${PAL.borderInner}`,
        borderRadius: 8,
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", background: PAL.bgInner, border: "none", cursor: "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", textAlign: "left" }}>
          <span style={{ fontFamily: SYS_FONT, fontSize: 12, fontWeight: 600, color: PAL.white, letterSpacing: 0.5 }}>{title}</span>
          {headerAddon}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {open ? <ChevronUp size={14} color={PAL.label} /> : <ChevronDown size={14} color={PAL.label} />}
        </div>
      </button>
      {open && <div style={{ padding: 12, background: PAL.bgCard }}>{children}</div>}
    </div>
  );
}

function StructureDisplay({ structure }: { structure: DeskStructure }) {
  return (
    <div style={{ background: PAL.bgInner, border: `1px solid ${PAL.borderInner}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
      <div style={{ fontFamily: SYS_FONT, fontSize: 12, fontWeight: 600, color: PAL.goldHeader, marginBottom: 6, textTransform: "uppercase" }}>
        {structure.type.replace(/_/g, " ")}
      </div>
      <div style={{ fontFamily: SYS_FONT, fontSize: 11, color: PAL.label, marginBottom: 4 }}>
        Expiry: {structure.expiry} &middot; {structure.credit_or_debit < 0 ? "Credit" : "Debit"}: ${Math.abs(structure.credit_or_debit).toFixed(2)}
      </div>
      {structure.legs.map((leg, i) => (
        <div key={i} style={{ fontFamily: SYS_FONT, fontSize: 11, color: PAL.body, padding: "2px 0" }}>
          {leg.action.toUpperCase()} {leg.type.toUpperCase()} {leg.strike} ({leg.expiration})
          {leg.quantity && leg.quantity > 1 ? ` x${leg.quantity}` : ""}
        </div>
      ))}
    </div>
  );
}

/** Plain text for the full Desk card (all sections including topic sections, regardless of collapse). */
export function buildDeskCardPlainText(args: {
  deskResult: DeskResult;
  generatedAt?: string | number | null;
  strategistOutcome?: StrategistOutcome;
  blockReason?: BlockReason;
}): string {
  const { deskResult, generatedAt, strategistOutcome, blockReason } = args;
  const { pm, vol, flow, catalyst, errors } = deskResult;
  const isTrade = pm.decision === "trade";
  const banner = deskBanner(strategistOutcome, blockReason, !isTrade, deskResult.soloDeskJsonDegraded);

  const lines: string[] = [];
  if (banner) {
    lines.push(banner.title.toUpperCase(), banner.body, "");
  }

  const when =
    generatedAt == null
      ? null
      : typeof generatedAt === "number"
        ? new Date(generatedAt).toLocaleString()
        : String(generatedAt);

  lines.push(`${isTrade ? "TRADE" : "PASS"}  ${deskResult.ticker}  ${deskResult.mode === "solo_desk" ? "SOLO DESK" : "DESK"} MODE`);
  if (when) lines.push(`Generated: ${when}`);
  lines.push("");

  if (isTrade && pm.structure) {
    const s = pm.structure;
    lines.push(
      s.type.replace(/_/g, " ").toUpperCase(),
      `Expiry: ${s.expiry}  ·  ${s.credit_or_debit < 0 ? "Credit" : "Debit"}: $${Math.abs(s.credit_or_debit).toFixed(2)}`,
    );
    for (const leg of s.legs) {
      const q = leg.quantity && leg.quantity > 1 ? ` x${leg.quantity}` : "";
      lines.push(`${leg.action.toUpperCase()} ${leg.type.toUpperCase()} ${leg.strike} (${leg.expiration})${q}`);
    }
    lines.push("");
  }

  if (!isTrade && pm.watch_for) {
    lines.push("WATCH FOR", pm.watch_for, "");
  }

  lines.push("THESIS", pm.thesis, "");
  if (pm.edge_check) {
    lines.push("EDGE CHECK", pm.edge_check, "");
  }
  const dev = pm.deviation_from_analysts?.trim();
  if (dev && dev.toLowerCase() !== "none") {
    lines.push("DEVIATION FROM VOLATILITY SECTION", dev, "");
  }
  lines.push("SIZE", pm.size.toUpperCase());
  lines.push("ALIGNMENT", pm.whose_side.replace(/_/g, " "));

  if (isTrade) {
    lines.push("PROFIT TARGET", `$${pm.exit_plan.profit_target.toFixed(2)}`);
    lines.push("STOP LOSS", `$${pm.exit_plan.stop_loss.toFixed(2)}`);
    if (pm.exit_plan.time_stop) lines.push("TIME STOP", pm.exit_plan.time_stop);
  }
  lines.push("");

  lines.push("BIGGEST RISK", pm.biggest_risk, "");

  if (errors && errors.length > 0) {
    lines.push("NOTES / WARNINGS");
    for (const e of errors) lines.push(`- ${e}`);
    lines.push("");
  }

  lines.push("TOPIC SECTIONS", "");

  lines.push("— Volatility —");
  lines.push("IV State", vol.iv_state);
  lines.push("Term Structure", vol.term_structure);
  lines.push("Skew", vol.skew);
  lines.push("IV vs Realized", vol.implied_vs_realized);
  lines.push("Read", vol.read, "");

  lines.push("— Flow —");
  lines.push("Dominant Flow", flow.dominant_flow);
  lines.push("Institutional", flow.institutional_signal);
  lines.push("Retail", flow.retail_signal);
  if (flow.key_strikes.length > 0) {
    lines.push("Key Strikes");
    for (const ks of flow.key_strikes) {
      lines.push(`  ${ks.type.toUpperCase()} ${ks.strike} (${ks.expiry}): ${ks.observation}`);
    }
  }
  lines.push("Read", flow.read, "");

  lines.push("— Catalyst —");
  lines.push("Primary Catalyst", catalyst.primary_catalyst);
  lines.push("Bar to Clear", catalyst.bar_to_clear);
  lines.push("Asymmetry", catalyst.asymmetry);
  lines.push("Historical", catalyst.historical_pattern);
  lines.push("Read", catalyst.read, "");

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function deskBanner(
  outcome: StrategistOutcome | undefined,
  blockReason: BlockReason | undefined,
  pmPass: boolean,
  soloDeskJsonDegraded?: DeskResult["soloDeskJsonDegraded"],
): { title: string; body: string; border: string; bg: string; accent: string } | null {
  if (soloDeskJsonDegraded === "schema_validation_failed_after_retry") {
    return {
      title: "Solo Desk — Output Parse Failed",
      body:
        "The consolidated JSON did not match the required schema after retry. The PASS below is a safety stub, not a deliberate no-trade from the model. Retry the run or switch model/provider.",
      border: "rgba(239,68,68,0.45)",
      bg: "rgba(239,68,68,0.1)",
      accent: PAL.red,
    };
  }
  if (outcome === "ANALYSIS_INCOMPLETE" || blockReason?.category === "ANALYSIS_INCOMPLETE") {
    return {
      title: "Analysis Incomplete",
      body: blockReason?.detail ?? "The Decision section did not match the required format after retry. Try running the analysis again.",
      border: "rgba(245,158,11,0.35)",
      bg: "rgba(245,158,11,0.08)",
      accent: PAL.gold,
    };
  }
  if (outcome === "NO_TRADE" || pmPass) {
    return {
      title: "No Trade Recommended",
      body: "No trade is recommended for this name right now. Review the topic sections below, especially Watch for, to see what would need to change.",
      border: "rgba(161,161,170,0.35)",
      bg: "rgba(161,161,170,0.06)",
      accent: "#a3a3a3",
    };
  }
  return null;
}

export function StrategistDeskCard({
  deskResult,
  generatedAt,
  strategistOutcome,
  blockReason,
  onRetry,
  strategistDiagnosticRequestId,
  diagnosticView,
}: {
  deskResult: DeskResult;
  generatedAt?: string | number | null;
  strategistOutcome?: StrategistOutcome;
  blockReason?: BlockReason;
  onRetry?: (ticker: string) => void;
  strategistDiagnosticRequestId?: string;
  /** Server-built compact JSON; preferred over fetching full telemetry for sharing. */
  diagnosticView?: Record<string, unknown> | null;
}) {
  const { pm, vol, flow, catalyst, errors } = deskResult;
  const isTrade = pm.decision === "trade";
  const banner = deskBanner(strategistOutcome, blockReason, !isTrade, deskResult.soloDeskJsonDegraded);
  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedDiag, setCopiedDiag] = useState(false);
  const [fullDiagLoading, setFullDiagLoading] = useState(false);

  const copyPlain = useCallback(async () => {
    const text = buildDeskCardPlainText({ deskResult, generatedAt, strategistOutcome, blockReason });
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.message("Copied desk card to clipboard");
        setCopiedFull(true);
        window.setTimeout(() => setCopiedFull(false), 1500);
      } catch {
        /* noop */
      }
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.message("Copied desk card to clipboard");
        setCopiedFull(true);
        window.setTimeout(() => setCopiedFull(false), 1500);
      } else {
        fallback();
      }
    } catch {
      fallback();
    }
  }, [deskResult, generatedAt, strategistOutcome, blockReason]);

  const copyJson = useCallback(async () => {
    const fallbackDeskOnly = () => {
      const { models: _omitFromClientCopy, ...rest } = deskResult;
      void _omitFromClientCopy;
      return JSON.stringify({ strategistPayload: rest, note: "Full server diagnostic was not available (missing request id); this is the desk sections only." }, null, 2);
    };

    let text: string;
    if (strategistDiagnosticRequestId) {
      setFullDiagLoading(true);
      try {
        const res = await fetchWithAuth(
          `/api/strategist/telemetry/strategist/request/${encodeURIComponent(strategistDiagnosticRequestId)}`,
        );
        if (!res.ok) {
          text = fallbackDeskOnly();
          toast.message("Copied partial JSON (telemetry fetch unavailable)");
        } else {
          const row = (await res.json()) as { fullDiagnostic?: unknown };
          text = JSON.stringify(row.fullDiagnostic ?? row, null, 2);
        }
      } catch {
        text = fallbackDeskOnly();
        toast.message("Copied partial JSON (telemetry fetch failed)");
      } finally {
        setFullDiagLoading(false);
      }
    } else {
      text = fallbackDeskOnly();
      toast.message("Copied partial JSON (run id missing)");
    }

    const finishCopy = () => {
      setCopiedJson(true);
      window.setTimeout(() => setCopiedJson(false), 2000);
    };

    const fallbackExec = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.message("Copied full diagnostic JSON");
        finishCopy();
      } catch {
        /* noop */
      }
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.message("Copied full diagnostic JSON");
        finishCopy();
      } else {
        fallbackExec();
      }
    } catch {
      fallbackExec();
    }
  }, [deskResult, strategistDiagnosticRequestId]);

  const copyDiagnosticJson = useCallback(async () => {
    if (!diagnosticView || typeof diagnosticView !== "object") {
      toast.message("Diagnostic view not available for this run");
      return;
    }
    const text = JSON.stringify(diagnosticView, null, 2);
    const finish = () => {
      setCopiedDiag(true);
      window.setTimeout(() => setCopiedDiag(false), 1500);
    };
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.message("Copied diagnostic JSON");
        finish();
      } catch {
        /* noop */
      }
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast.message("Copied diagnostic JSON");
        finish();
      } else {
        fallback();
      }
    } catch {
      fallback();
    }
  }, [diagnosticView]);

  const speechSections = useMemo(
    () =>
      buildDeskSpeechSections(deskResult, {
        bannerTitle: banner?.title,
        bannerBody: banner?.body,
      }),
    [deskResult, banner?.title, banner?.body],
  );
  const deskAudioText = useMemo(() => speechSections.map((s) => s.text).join("\n\n"), [speechSections]);
  const deskResultId = useMemo(
    () => deskResultAudioId(deskResult, banner?.title, banner?.body),
    [deskResult, banner?.title, banner?.body],
  );

  /** Split desk script into TTS-sized chunks so the first request returns faster (progressive play). */
  const deskAudioChunks = useMemo(() => {
    const t = deskAudioText.trim();
    if (!t) return [];
    const out: string[] = [];
    let rest = t;
    while (rest.length > 0) {
      if (rest.length <= 4096) {
        out.push(rest);
        break;
      }
      let cut = Math.min(TTS_CHUNK_TARGET_CHARS, rest.length - 1);
      let splitAt = cut;
      for (let i = cut; i > Math.max(0, cut - 500); i--) {
        const ch = rest[i];
        if (ch === "\n" || ch === "." || ch === "!" || ch === "?" || ch === ";") {
          splitAt = i + 1;
          break;
        }
      }
      const piece = rest.slice(0, splitAt).trimEnd();
      if (piece) out.push(piece);
      rest = rest.slice(splitAt).trimStart();
    }
    return out.filter(Boolean);
  }, [deskAudioText]);

  const deskAudioFetchKey = useMemo(
    () => `${deskResultId}\0${deskAudioText.trim()}`,
    [deskResultId, deskAudioText],
  );

  const prefetchPrimaryKey = useMemo(() => {
    if (deskAudioChunks.length <= 1) return deskAudioFetchKey;
    const first = deskAudioChunks[0] ?? "";
    return `${deskAudioFetchKey}\0chunk0\0${first}`;
  }, [deskAudioChunks, deskAudioFetchKey]);

  const SESSION_RATE_KEY = "strategistDeskSpeechRate";
  const [speechRate, setSpeechRate] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const v = Number(sessionStorage.getItem(SESSION_RATE_KEY));
    return [1, 1.25, 1.5, 2].includes(v) ? v : 1;
  });
  const speechRateRef = useRef(speechRate);
  speechRateRef.current = speechRate;

  const [audioBarOpen, setAudioBarOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const audioPlayGenRef = useRef(0);
  const ttsFetchAbortRef = useRef<AbortController | null>(null);
  const progressiveFetchAbortRef = useRef<AbortController | null>(null);
  type ProgressiveSession = { playGen: number; chunks: string[]; index: number };
  const progressiveSessionRef = useRef<ProgressiveSession | null>(null);
  const prefetchGenRef = useRef(0);
  const prefetchedAudioUrlRef = useRef<string | null>(null);
  const prefetchedAudioKeyRef = useRef<string | null>(null);
  /** Which `startPlay` generation turned on `audioLoading` (fetch path); always clear in `finally` for that gen. */
  const ttsLoadingPlayGenRef = useRef<number | null>(null);
  /** True while we expect `<audio>` to decode/play our blob (ignore spurious errors from `stopAudio` clearing `src`). */
  const expectAudioPlaybackRef = useRef(false);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

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
    if (prefetchedAudioUrlRef.current) {
      URL.revokeObjectURL(prefetchedAudioUrlRef.current);
      prefetchedAudioUrlRef.current = null;
      prefetchedAudioKeyRef.current = null;
    }
    setPaused(false);
    setAudioBarOpen(false);
    setAudioLoading(false);
    ttsLoadingPlayGenRef.current = null;
    setAudioReady(false);
    setAudioError(null);
  }, [revokeObjectUrl]);

  const startPlay = useCallback(async () => {
    if (!deskAudioText.trim() || deskAudioChunks.length === 0) return;
    const playGen = ++audioPlayGenRef.current;
    ttsFetchAbortRef.current?.abort();
    ttsFetchAbortRef.current = null;
    progressiveFetchAbortRef.current?.abort();
    progressiveFetchAbortRef.current = null;
    progressiveSessionRef.current = null;

    const firstText = deskAudioChunks[0] ?? deskAudioText.trim();
    const prefetchHit =
      prefetchedAudioUrlRef.current &&
      prefetchedAudioKeyRef.current === prefetchPrimaryKey &&
      prefetchPrimaryKey.length > 0;

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

    if (prefetchHit) {
      setAudioLoading(false);
      ttsLoadingPlayGenRef.current = null;
      const url = prefetchedAudioUrlRef.current!;
      prefetchedAudioUrlRef.current = null;
      prefetchedAudioKeyRef.current = null;
      const ok = attachAndPlay(url);
      if (ok && deskAudioChunks.length > 1) {
        progressiveSessionRef.current = { playGen, chunks: deskAudioChunks, index: 0 };
      }
      return;
    }

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
    try {
      const res = await fetchWithAuth("/api/tts/desk-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: firstText, deskResultId }),
        signal: ac.signal,
        clerkTokenTimeoutMs: 8000,
      });
      if (playGen !== audioPlayGenRef.current) return;
      if (!res.ok) {
        let msg = "Audio unavailable";
        try {
          const j = (await res.clone().json()) as { detail?: string; error?: string };
          if (typeof j.detail === "string" && j.detail.trim()) {
            msg = `Audio unavailable — ${j.detail.trim()}`;
          }
        } catch {
          /* ignore */
        }
        setAudioError(msg);
        setAudioBarOpen(true);
        return;
      }
      const blob = await res.blob();
      if (playGen !== audioPlayGenRef.current) return;
      const url = URL.createObjectURL(blob);
      const ok = attachAndPlay(url);
      if (ok && deskAudioChunks.length > 1) {
        progressiveSessionRef.current = { playGen, chunks: deskAudioChunks, index: 0 };
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
  }, [deskAudioChunks, deskAudioText, deskResultId, prefetchPrimaryKey, revokeObjectUrl]);

  const advanceProgressiveChunk = useCallback(async () => {
    const sess = progressiveSessionRef.current;
    if (!sess) return;
    const { playGen, chunks, index } = sess;
    if (playGen !== audioPlayGenRef.current) return;
    const nextIdx = index + 1;
    if (nextIdx >= chunks.length) {
      progressiveSessionRef.current = null;
      stopAudio();
      return;
    }
    progressiveFetchAbortRef.current?.abort();
    const ac = new AbortController();
    progressiveFetchAbortRef.current = ac;
    const text = chunks[nextIdx];
    if (!text?.trim()) {
      progressiveSessionRef.current = null;
      stopAudio();
      return;
    }
    try {
      const res = await fetchWithAuth("/api/tts/desk-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, deskResultId }),
        signal: ac.signal,
        clerkTokenTimeoutMs: 8000,
      });
      if (playGen !== audioPlayGenRef.current) return;
      if (!res.ok) {
        progressiveSessionRef.current = null;
        setAudioError("Audio unavailable — next segment failed");
        return;
      }
      const blob = await res.blob();
      if (playGen !== audioPlayGenRef.current) return;
      revokeObjectUrl();
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      progressiveSessionRef.current = { playGen, chunks, index: nextIdx };
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
    } catch {
      if (playGen === audioPlayGenRef.current) {
        progressiveSessionRef.current = null;
        setAudioError("Audio unavailable — network error");
      }
    } finally {
      if (progressiveFetchAbortRef.current === ac) {
        progressiveFetchAbortRef.current = null;
      }
    }
  }, [deskResultId, revokeObjectUrl, stopAudio]);

  /** Prefetch first TTS segment (or full script if short) so Play often skips waiting. */
  useEffect(() => {
    const text = deskAudioChunks[0]?.trim() ?? "";
    if (!text || !deskResultId.trim()) {
      prefetchGenRef.current += 1;
      if (prefetchedAudioUrlRef.current) {
        URL.revokeObjectURL(prefetchedAudioUrlRef.current);
        prefetchedAudioUrlRef.current = null;
        prefetchedAudioKeyRef.current = null;
      }
      return;
    }
    prefetchGenRef.current += 1;
    const gen = prefetchGenRef.current;
    const fetchKey = prefetchPrimaryKey;
    const ac = new AbortController();
    const timeoutId =
      typeof window !== "undefined"
        ? window.setTimeout(() => {
            ac.abort();
          }, 180_000)
        : 0;

    void (async () => {
      try {
        const res = await fetchWithAuth("/api/tts/desk-audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, deskResultId }),
          signal: ac.signal,
          clerkTokenTimeoutMs: 8000,
        });
        if (gen !== prefetchGenRef.current) return;
        if (!res.ok) return;
        const blob = await res.blob();
        if (gen !== prefetchGenRef.current) return;
        if (prefetchedAudioUrlRef.current) {
          URL.revokeObjectURL(prefetchedAudioUrlRef.current);
        }
        prefetchedAudioUrlRef.current = URL.createObjectURL(blob);
        prefetchedAudioKeyRef.current = fetchKey;
      } catch {
        /* ignore prefetch errors; Play will retry */
      } finally {
        if (timeoutId) window.clearTimeout(timeoutId);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [deskAudioChunks, deskResultId, prefetchPrimaryKey]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  useEffect(() => {
    stopAudio();
  }, [deskResult, stopAudio]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mo = new MutationObserver(() => {
      if (!root.isConnected) {
        stopAudio();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [stopAudio]);

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

  const setRate = useCallback(
    (r: number) => {
      setSpeechRate(r);
      sessionStorage.setItem(SESSION_RATE_KEY, String(r));
      speechRateRef.current = r;
      if (audioRef.current) {
        audioRef.current.playbackRate = r;
      }
    },
    [],
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

  const iconBtnBase: CSSProperties = {
    minWidth: TOUCH_MIN,
    minHeight: TOUCH_MIN,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    border: `1px solid ${PAL.borderInner}`,
    background: PAL.bgInner,
    color: PAL.body,
    cursor: "pointer",
  };

  const btnStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: TOUCH_MIN,
    padding: "8px 12px",
    borderRadius: 6,
    border: `1px solid ${PAL.borderInner}`,
    background: PAL.bgInner,
    color: PAL.label,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    cursor: "pointer",
    fontFamily: SYS_FONT,
    outline: "none",
  };

  const speedLabel = speechRate === 1 ? "1x" : speechRate === 1.25 ? "1.25x" : speechRate === 1.5 ? "1.5x" : "2x";

  return (
    <div
      ref={rootRef}
      style={{ position: "relative", background: PAL.bgCard, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16, fontFamily: SYS_FONT }}
    >
      {/* Outcome banner (non-error framing) */}
      {banner && (
        <div style={{ border: `1px solid ${banner.border}`, background: banner.bg, borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: banner.accent, letterSpacing: 0.8, marginBottom: 6 }}>{banner.title}</div>
          <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>{banner.body}</div>
          {(strategistOutcome === "ANALYSIS_INCOMPLETE" || blockReason?.category === "ANALYSIS_INCOMPLETE") && onRetry && (
            <button
              type="button"
              onClick={() => onRetry(deskResult.ticker)}
              style={{ marginTop: 10, padding: "8px 14px", borderRadius: 6, border: "none", background: "#fbbf24", color: "#0a0a0a", fontWeight: 700, fontSize: 11, cursor: "pointer" }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Decision header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
            color: isTrade ? PAL.green : "#a3a3a3",
            background: isTrade ? "rgba(74,222,128,0.1)" : "rgba(161,161,170,0.12)",
            border: `1px solid ${isTrade ? "rgba(74,222,128,0.3)" : "rgba(161,161,170,0.35)"}`,
            padding: "3px 8px", borderRadius: 4,
          }}>
            {isTrade ? "TRADE" : "PASS"}
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: PAL.white }}>{deskResult.ticker}</span>
          <span style={{ fontSize: 10, color: PAL.label, letterSpacing: 0.5 }}>DESK MODE</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          <button
            type="button"
            onClick={() => void copyPlain()}
            style={btnStyle}
            aria-label="Copy desk report"
            onFocus={(e) => { e.currentTarget.style.outline = FOCUS_RING; }}
            onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
          >
            <Copy size={12} />
            {copiedFull ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => void copyJson()}
            style={btnStyle}
            aria-label="Copy full strategist diagnostic JSON"
            onFocus={(e) => { e.currentTarget.style.outline = FOCUS_RING; }}
            onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
          >
            <Copy size={12} />
            {fullDiagLoading ? "…" : copiedJson ? "Copied" : "Copy JSON"}
          </button>
          <button
            type="button"
            onClick={() => void copyDiagnosticJson()}
            disabled={!diagnosticView}
            title={!diagnosticView ? "Diagnostic view is not available for this run (e.g. saved before this feature)." : undefined}
            style={{
              ...btnStyle,
              opacity: diagnosticView ? 1 : 0.45,
              cursor: diagnosticView ? "pointer" : "not-allowed",
            }}
            aria-label="Copy strategist diagnostic view JSON"
            onFocus={(e) => { e.currentTarget.style.outline = FOCUS_RING; }}
            onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
          >
            <Copy size={12} />
            {copiedDiag ? "Copied" : "Copy diagnostic"}
          </button>
          {!audioBarOpen && (
            <button
              type="button"
              onClick={() => void startPlay()}
              disabled={audioLoading || !deskAudioText.trim()}
              style={{
                ...btnStyle,
                opacity: audioLoading || !deskAudioText.trim() ? 0.55 : 1,
                cursor: audioLoading || !deskAudioText.trim() ? "not-allowed" : "pointer",
              }}
              aria-label="Play audio report"
              onFocus={(e) => { e.currentTarget.style.outline = FOCUS_RING; }}
              onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
            >
              <Play size={12} aria-hidden />
              {audioLoading ? "Loading…" : "Play"}
            </button>
          )}
          {generatedAt && (
            <span style={{ fontSize: 9, color: PAL.label }}>{typeof generatedAt === "number" ? new Date(generatedAt).toLocaleString() : generatedAt}</span>
          )}
        </div>
      </div>

      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        style={{ display: "none" }}
        onEnded={onAudioEnded}
        onLoadedMetadata={onLoadedMetadata}
        onPlay={onPlay}
        onPause={onPause}
        onError={onAudioElementError}
      />
      {audioBarOpen && (
        <div
          role="region"
          aria-label="Audio playback controls"
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 8,
            border: `1px solid ${PAL.borderInner}`,
            background: PAL.bgInner,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 10,
          }}
        >
          {audioError ? (
            <span style={{ fontSize: 12, color: PAL.red, flex: "1 1 100%" }}>{audioError}</span>
          ) : (
            <>
          <button
            type="button"
            style={iconBtnBase}
            aria-label={paused ? "Resume audio playback" : "Pause audio playback"}
            onClick={togglePause}
            disabled={!audioReady}
            onFocus={(e) => { e.currentTarget.style.outline = FOCUS_RING; }}
            onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
          >
            {paused ? <Play size={20} aria-hidden /> : <Pause size={20} aria-hidden />}
          </button>
          <button
            type="button"
            style={iconBtnBase}
            aria-label="Stop audio playback"
            onClick={stopAudio}
            onFocus={(e) => { e.currentTarget.style.outline = FOCUS_RING; }}
            onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
          >
            <Square size={20} aria-hidden />
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: 8, color: PAL.body, fontSize: 12 }}>
            <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)" }}>
              Playback speed
            </span>
            <select
              aria-label={`Playback speed, currently ${speedLabel}`}
              value={speechRate}
              onChange={(e) => setRate(Number(e.target.value))}
              style={{
                minHeight: TOUCH_MIN,
                padding: "0 12px",
                borderRadius: 8,
                border: `1px solid ${PAL.borderInner}`,
                background: PAL.bgCard,
                color: PAL.body,
                fontSize: 12,
                outline: "none",
              }}
              onFocus={(e) => { e.currentTarget.style.outline = FOCUS_RING; }}
              onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
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
      )}

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: PAL.label, letterSpacing: 1, textTransform: "uppercase" }}>
            Decision
          </span>
        </div>

      {/* Structure (if trade) */}
      {isTrade && pm.structure && <StructureDisplay structure={pm.structure} />}

      {/* Watch For (if pass) */}
      {!isTrade && pm.watch_for && (
        <div style={{ background: "rgba(251,191,36,0.08)", border: `1px solid rgba(251,191,36,0.3)`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: PAL.gold, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
            WATCH FOR
          </div>
          <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>{pm.watch_for}</div>
        </div>
      )}

      {/* PM Thesis */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>THESIS</div>
        <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>{pm.thesis}</div>
      </div>

      {pm.edge_check && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>EDGE CHECK</div>
          <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>{pm.edge_check}</div>
        </div>
      )}

      {pm.deviation_from_analysts && pm.deviation_from_analysts.trim().toLowerCase() !== "none" && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>DEVIATION FROM VOLATILITY SECTION</div>
          <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>{pm.deviation_from_analysts}</div>
        </div>
      )}

      {/* Decision details */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>SIZE</span>
          <div style={{ fontSize: 12, fontWeight: 600, color: PAL.white, textTransform: "uppercase" }}>{pm.size}</div>
        </div>
        <div>
          <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>ALIGNMENT</span>
          <div style={{ fontSize: 12, fontWeight: 600, color: PAL.white }}>{pm.whose_side.replace(/_/g, " ")}</div>
        </div>
        {isTrade && (
          <>
            <div>
              <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>PROFIT TARGET</span>
              <div style={{ fontSize: 12, fontWeight: 600, color: PAL.green }}>${pm.exit_plan.profit_target.toFixed(2)}</div>
            </div>
            <div>
              <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>STOP LOSS</span>
              <div style={{ fontSize: 12, fontWeight: 600, color: PAL.red }}>${pm.exit_plan.stop_loss.toFixed(2)}</div>
            </div>
            {pm.exit_plan.time_stop && (
              <div>
                <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>TIME STOP</span>
                <div style={{ fontSize: 12, fontWeight: 600, color: PAL.white }}>{pm.exit_plan.time_stop}</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Biggest Risk */}
      <div style={{ background: "rgba(220,38,38,0.06)", border: `1px solid rgba(220,38,38,0.2)`, borderRadius: 6, padding: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: PAL.red, letterSpacing: 1, textTransform: "uppercase" }}>BIGGEST RISK</span>
        <div style={{ fontSize: 11, color: PAL.body, marginTop: 4, lineHeight: 1.5 }}>{pm.biggest_risk}</div>
      </div>

      {/* Errors */}
      {errors && errors.length > 0 && (
        <div style={{ background: "rgba(245,158,11,0.08)", border: `1px solid rgba(245,158,11,0.3)`, borderRadius: 6, padding: 10, marginBottom: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <AlertTriangle size={14} color={PAL.gold} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            {errors.map((e, i) => <div key={i} style={{ fontSize: 10, color: PAL.body, lineHeight: 1.5 }}>{e}</div>)}
          </div>
        </div>
      )}

      </div>

      {/* Topic sections (collapsible) */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>TOPIC SECTIONS</div>

        <div style={{ marginBottom: 8 }}>
          <CollapsibleSection title="Volatility" defaultOpen>
          <FieldRow label="IV State" value={vol.iv_state} />
          <FieldRow label="Term Structure" value={vol.term_structure} />
          <FieldRow label="Skew" value={vol.skew} />
          <FieldRow label="IV vs Realized" value={vol.implied_vs_realized} />
          <div style={{ marginTop: 8, fontSize: 12, color: PAL.body, lineHeight: 1.6, borderTop: `1px solid ${PAL.borderInner}`, paddingTop: 8 }}>
            {vol.read}
          </div>
        </CollapsibleSection>
        </div>

        <div style={{ marginBottom: 8 }}>
          <CollapsibleSection title="Flow" defaultOpen>
          <FieldRow label="Dominant Flow" value={flow.dominant_flow} />
          <FieldRow label="Institutional" value={flow.institutional_signal} />
          <FieldRow label="Retail" value={flow.retail_signal} />
          {flow.key_strikes.length > 0 && (
            <div style={{ marginTop: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: PAL.label, letterSpacing: 0.5 }}>KEY STRIKES</span>
              {flow.key_strikes.map((ks, i) => (
                <div key={i} style={{ fontSize: 11, color: PAL.body, padding: "2px 0" }}>
                  {ks.type.toUpperCase()} {ks.strike} ({ks.expiry}): {ks.observation}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 12, color: PAL.body, lineHeight: 1.6, borderTop: `1px solid ${PAL.borderInner}`, paddingTop: 8 }}>
            {flow.read}
          </div>
        </CollapsibleSection>
        </div>

        <div style={{ marginBottom: 8 }}>
          <CollapsibleSection title="Catalyst" defaultOpen>
          <FieldRow label="Primary Catalyst" value={catalyst.primary_catalyst} />
          <FieldRow label="Bar to Clear" value={catalyst.bar_to_clear} />
          <FieldRow label="Asymmetry" value={catalyst.asymmetry} />
          <FieldRow label="Historical" value={catalyst.historical_pattern} />
          <div style={{ marginTop: 8, fontSize: 12, color: PAL.body, lineHeight: 1.6, borderTop: `1px solid ${PAL.borderInner}`, paddingTop: 8 }}>
            {catalyst.read}
          </div>
        </CollapsibleSection>
        </div>
      </div>
    </div>
  );
}
