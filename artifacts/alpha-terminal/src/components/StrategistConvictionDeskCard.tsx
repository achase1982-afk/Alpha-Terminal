import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import type { BlockReason, StrategistOutcome, StrategistSendToOrderPayload } from "@/components/StrategistV2Card";
import { buildOccSymbol } from "@/components/StrategistV2Card";
import { AlertTriangle, Copy, Play, Pause, Square, Rewind, FastForward, Send } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  isConvictionDeskOutputComplete,
  type ConvictionDeskResult,
  type PayoffScenario,
  type PayoffScenariosSummary,
  type DeskResult,
  type ConvictionFitScore,
} from "@/lib/strategistDeskResult";
import { buildConvictionDeskCardPlainText, buildDeskSpeechSections } from "@/lib/deskCardSpeech";
import {
  DESK_PAL as PAL,
  DESK_SYS_FONT as SYS_FONT,
  DESK_FOCUS_RING as FOCUS_RING,
  DESK_TOUCH_MIN as TOUCH_MIN,
  DeskCardFieldRow,
  DeskCardCollapsibleSection,
  DeskCardStructureDisplay,
  DeskCardPayoffAtExpirationSection,
} from "@/components/deskCardShared";
import { deskResultAudioId } from "@/lib/deskAudioId";
import { useDeskReportTts, DESK_AUDIO_SKIP_SECONDS } from "@/hooks/useDeskReportTts";

const deskVoiceConfig: { voice?: string } = {};

const BODY_PX = 14;
const LABEL_PX = 10;

type BadgeVariant = "green" | "gray" | "gold" | "amber" | "red";

function deskBadgeStyle(variant: BadgeVariant): CSSProperties {
  const m: Record<BadgeVariant, { color: string; bg: string; border: string }> = {
    green: { color: PAL.green, bg: "rgba(74,222,128,0.1)", border: "rgba(74,222,128,0.3)" },
    gray: { color: "#a3a3a3", bg: "rgba(161,161,170,0.12)", border: "rgba(161,161,170,0.35)" },
    gold: { color: PAL.gold, bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.3)" },
    amber: { color: PAL.goldHeader, bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.35)" },
    red: { color: PAL.red, bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.35)" },
  };
  const t = m[variant];
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase" as const,
    color: t.color,
    background: t.bg,
    border: `1px solid ${t.border}`,
    padding: "3px 8px",
    borderRadius: 4,
    fontFamily: SYS_FONT,
  };
}

function formatEnumLabel(raw: string): string {
  return raw.replace(/_/g, " ");
}

function fitScoreBadgeVariant(score: ConvictionFitScore): BadgeVariant {
  switch (score) {
    case "high":
      return "green";
    case "medium":
      return "amber";
    case "low":
      return "gray";
    case "unfit":
      return "red";
  }
}

function convictionBanner(
  strategistOutcome: StrategistOutcome | undefined,
  blockReason: BlockReason | undefined,
  convictionDeskJsonDegraded: ConvictionDeskResult["convictionDeskJsonDegraded"],
): { title: string; body: string; border: string; bg: string; accent: string } | null {
  if (convictionDeskJsonDegraded === "schema_validation_failed_after_retry") {
    return {
      title: "Conviction Desk — Output Parse Failed",
      body: "The desk JSON did not match the required schema after retry. Retry the run or switch model or provider.",
      border: "rgba(239,68,68,0.45)",
      bg: "rgba(239,68,68,0.1)",
      accent: PAL.red,
    };
  }
  if (strategistOutcome === "ANALYSIS_INCOMPLETE" || blockReason?.category === "ANALYSIS_INCOMPLETE") {
    return {
      title: "Analysis Incomplete",
      body: blockReason?.detail ?? "The desk output did not validate after retry.",
      border: "rgba(245,158,11,0.35)",
      bg: "rgba(245,158,11,0.08)",
      accent: PAL.gold,
    };
  }
  return null;
}

export type StrategistConvictionDeskCardProps = {
  deskResult: ConvictionDeskResult;
  generatedAt?: string | number | null;
  strategistOutcome?: StrategistOutcome;
  blockReason?: BlockReason;
  strategistDiagnosticRequestId?: string;
  diagnosticView?: Record<string, unknown> | null;
  onRetry?: (ticker: string) => void;
  onSendToOrder?: (payload: StrategistSendToOrderPayload) => void;
};

export function StrategistConvictionDeskCard({
  deskResult,
  generatedAt,
  strategistOutcome,
  blockReason,
  strategistDiagnosticRequestId,
  diagnosticView,
  onRetry,
  onSendToOrder,
}: StrategistConvictionDeskCardProps) {
  const banner = convictionBanner(strategistOutcome, blockReason, deskResult.convictionDeskJsonDegraded);

  const memoPlain = useMemo(
    () => buildConvictionDeskCardPlainText({ deskResult, generatedAt, strategistOutcome, blockReason }),
    [deskResult, generatedAt, strategistOutcome, blockReason],
  );

  const speechSections = useMemo(
    () =>
      buildDeskSpeechSections(deskResult as DeskResult, {
        bannerTitle: banner?.title,
        bannerBody: banner?.body,
        generatedAt,
      }),
    [deskResult, banner?.title, banner?.body, generatedAt],
  );
  const deskAudioText = useMemo(() => speechSections.map((s) => s.text).join("\n\n"), [speechSections]);

  const deskResultId = useMemo(
    () => deskResultAudioId(deskResult as DeskResult, banner?.title, banner?.body),
    [deskResult, banner?.title, banner?.body],
  );

  const rootRef = useRef<HTMLDivElement>(null);

  const {
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
  } = useDeskReportTts({
    deskAudioText,
    deskResultId,
    voiceConfig: deskVoiceConfig,
    resetDependency: deskResult,
    containerRef: rootRef,
  });

  const [copiedFull, setCopiedFull] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [copiedDiag, setCopiedDiag] = useState(false);
  const [fullDiagLoading, setFullDiagLoading] = useState(false);

  const copyPlain = useCallback(async () => {
    const finish = () => {
      setCopiedFull(true);
      window.setTimeout(() => setCopiedFull(false), 1500);
    };
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = memoPlain;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.message("Copied conviction desk report to clipboard");
        finish();
      } catch {
        /* noop */
      }
    };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(memoPlain);
        toast.message("Copied conviction desk report to clipboard");
        finish();
      } else {
        fallback();
      }
    } catch {
      fallback();
    }
  }, [memoPlain]);

  const copyJson = useCallback(async () => {
    const fallbackDeskOnly = () => {
      const raw = { ...deskResult } as Record<string, unknown>;
      delete raw.convictionDeskRunDiagnostic;
      delete raw.models;
      return JSON.stringify({ strategistPayload: raw, note: "Full server diagnostic was not available (missing request id); desk payload only." }, null, 2);
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

  const conviction = deskResult.conviction;

  const pm = conviction?.pm;
  const isTrade = pm != null && pm.decision === "trade" && pm.structure != null;
  const structure = pm?.structure ?? null;

  const payoffScenarios = deskResult.payoffScenarios;
  const payoffSummary = deskResult.payoffSummary;
  const showPayoff =
    Array.isArray(payoffScenarios) && payoffScenarios.length > 0 && payoffSummary != null && isTrade;

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

  const sendToOrder = useCallback(() => {
    if (!onSendToOrder || !structure) return;
    const isCredit = structure.credit_or_debit < 0;
    const netPrice = Math.abs(structure.credit_or_debit);
    const legs = structure.legs.map((leg) => {
      const action = leg.action.toLowerCase();
      const isBuy = action === "buy" || action.startsWith("buy");
      const typ = leg.type.toUpperCase();
      const optionType = typ.includes("CALL") ? "CALL" : "PUT";
      return {
        schwabSymbol: buildOccSymbol(deskResult.ticker, leg.expiration, leg.type, leg.strike),
        instruction: isBuy ? "BUY_TO_OPEN" : "SELL_TO_OPEN",
        quantity: leg.quantity != null && leg.quantity > 0 ? leg.quantity : 1,
        optionType,
        strike: leg.strike,
        expiration: leg.expiration,
        bid: 0,
        ask: 0,
        delta: 0,
      };
    });
    onSendToOrder({ ticker: deskResult.ticker, legs, netPrice, isCredit });
  }, [deskResult.ticker, onSendToOrder, structure]);

  if (!conviction || !pm || !isConvictionDeskOutputComplete(conviction)) {
    return (
      <div
        ref={rootRef}
        style={{ position: "relative", background: PAL.bgCard, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16, fontFamily: SYS_FONT }}
      >
        {banner && (
          <div style={{ border: `1px solid ${banner.border}`, background: banner.bg, borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: banner.accent, letterSpacing: 0.8, marginBottom: 6 }}>{banner.title}</div>
            <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.6 }}>{banner.body}</div>
            {onRetry && (
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => void copyJson()} style={btnStyle} aria-label="Copy full strategist diagnostic JSON">
            <Copy size={12} />
            {fullDiagLoading ? "…" : copiedJson ? "Copied" : "Copy JSON"}
          </button>
        </div>
      </div>
    );
  }

  const vol = conviction.vol;
  const flow = conviction.flow;
  const catalyst = conviction.catalyst;
  const rs = conviction.regime_synthesis;
  const pc = conviction.positioning_context;
  const fh = conviction.family_hypotheses;
  const selfCheck = conviction.self_check;

  return (
    <div
      ref={rootRef}
      style={{ position: "relative", background: PAL.bgCard, border: `1px solid ${PAL.border}`, borderRadius: 12, padding: 16, fontFamily: SYS_FONT }}
    >
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: isTrade ? PAL.green : "#a3a3a3",
              background: isTrade ? "rgba(74,222,128,0.1)" : "rgba(161,161,170,0.12)",
              border: `1px solid ${isTrade ? "rgba(74,222,128,0.3)" : "rgba(161,161,170,0.35)"}`,
              padding: "3px 8px",
              borderRadius: 4,
            }}
          >
            {isTrade ? "TRADE" : "PASS"}
          </span>
          <span style={{ fontSize: 16, fontWeight: 700, color: PAL.white }}>{deskResult.ticker}</span>
          <span style={{ fontSize: 10, color: PAL.label, letterSpacing: 0.5 }}>CONVICTION DESK</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
          <button
            type="button"
            onClick={() => void copyPlain()}
            style={btnStyle}
            aria-label="Copy conviction desk report"
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
              {segmentStall && (
                <div
                  style={{
                    flex: "1 1 100%",
                    fontSize: 12,
                    color: PAL.body,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span>Couldn&apos;t load next segment</span>
                  <button
                    type="button"
                    onClick={() => void resumeSegmentAfterStall()}
                    style={{
                      ...btnStyle,
                      textTransform: "none",
                      letterSpacing: 0,
                      fontWeight: 600,
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}
              <button
                type="button"
                style={iconBtnBase}
                aria-label={`Rewind ${DESK_AUDIO_SKIP_SECONDS} seconds`}
                onClick={() => seekRelativeSeconds(-DESK_AUDIO_SKIP_SECONDS)}
                disabled={!audioReady || !!segmentStall}
                onFocus={(e) => { e.currentTarget.style.outline = FOCUS_RING; }}
                onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
              >
                <Rewind size={20} aria-hidden />
              </button>
              <button
                type="button"
                style={iconBtnBase}
                aria-label={paused ? "Resume audio playback" : "Pause audio playback"}
                onClick={togglePause}
                disabled={!audioReady || !!segmentStall}
                onFocus={(e) => { e.currentTarget.style.outline = FOCUS_RING; }}
                onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
              >
                {paused ? <Play size={20} aria-hidden /> : <Pause size={20} aria-hidden />}
              </button>
              <button
                type="button"
                style={iconBtnBase}
                aria-label={`Fast-forward ${DESK_AUDIO_SKIP_SECONDS} seconds`}
                onClick={() => seekRelativeSeconds(DESK_AUDIO_SKIP_SECONDS)}
                disabled={!audioReady || !!segmentStall}
                onFocus={(e) => { e.currentTarget.style.outline = FOCUS_RING; }}
                onBlur={(e) => { e.currentTarget.style.outline = "none"; }}
              >
                <FastForward size={20} aria-hidden />
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
                  onChange={(e) => setSpeechRate(Number(e.target.value))}
                  disabled={!!segmentStall}
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
          <span style={{ fontSize: LABEL_PX, fontWeight: 700, color: PAL.label, letterSpacing: 1, textTransform: "uppercase" }}>Decision</span>
        </div>

        {isTrade && structure && <DeskCardStructureDisplay structure={structure} />}

        {!isTrade && pm.watch_for && (
          <div style={{ background: "rgba(251,191,36,0.08)", border: `1px solid rgba(251,191,36,0.3)`, borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ fontSize: LABEL_PX, fontWeight: 700, color: PAL.gold, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>WATCH FOR</div>
            <div style={{ fontSize: BODY_PX, color: PAL.body, lineHeight: 1.6 }}>{pm.watch_for}</div>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: LABEL_PX, fontWeight: 600, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>THESIS</div>
          <div style={{ fontSize: BODY_PX, color: PAL.body, lineHeight: 1.6 }}>{pm.thesis}</div>
        </div>

        {pm.edge_check && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: LABEL_PX, fontWeight: 600, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>EDGE CHECK</div>
            <div style={{ fontSize: BODY_PX, color: PAL.body, lineHeight: 1.6 }}>{pm.edge_check}</div>
          </div>
        )}

        {showPayoff && payoffSummary && (
          <DeskCardPayoffAtExpirationSection scenarios={payoffScenarios as PayoffScenario[]} summary={payoffSummary as PayoffScenariosSummary} />
        )}

        {pm.deviation_from_analysts && pm.deviation_from_analysts.trim().toLowerCase() !== "none" && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: LABEL_PX, fontWeight: 600, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>DEVIATION FROM VOLATILITY SECTION</div>
            <div style={{ fontSize: BODY_PX, color: PAL.body, lineHeight: 1.6 }}>{pm.deviation_from_analysts}</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>SIZE</span>
            <div style={{ fontSize: BODY_PX, fontWeight: 600, color: PAL.white, textTransform: "uppercase" }}>{pm.size}</div>
          </div>
          <div>
            <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>ALIGNMENT</span>
            <div style={{ fontSize: BODY_PX, fontWeight: 600, color: PAL.white }}>{pm.whose_side.replace(/_/g, " ")}</div>
          </div>
          {isTrade && (
            <>
              <div>
                <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>PROFIT TARGET</span>
                <div style={{ fontSize: BODY_PX, fontWeight: 600, color: PAL.green }}>${pm.exit_plan.profit_target.toFixed(2)}</div>
              </div>
              <div>
                <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>STOP LOSS</span>
                <div style={{ fontSize: BODY_PX, fontWeight: 600, color: PAL.red }}>${pm.exit_plan.stop_loss.toFixed(2)}</div>
              </div>
              {pm.exit_plan.time_stop && (
                <div>
                  <span style={{ fontSize: 9, color: PAL.label, letterSpacing: 0.5 }}>TIME STOP</span>
                  <div style={{ fontSize: BODY_PX, fontWeight: 600, color: PAL.white }}>{pm.exit_plan.time_stop}</div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ background: "rgba(220,38,38,0.06)", border: `1px solid rgba(220,38,38,0.2)`, borderRadius: 6, padding: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: PAL.red, letterSpacing: 1, textTransform: "uppercase" }}>BIGGEST RISK</span>
          <div style={{ fontSize: BODY_PX, color: PAL.body, marginTop: 4, lineHeight: 1.55 }}>{pm.biggest_risk}</div>
        </div>

        {deskResult.errors && deskResult.errors.length > 0 && (
          <div style={{ background: "rgba(245,158,11,0.08)", border: `1px solid rgba(245,158,11,0.3)`, borderRadius: 6, padding: 10, marginBottom: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <AlertTriangle size={14} color={PAL.gold} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              {deskResult.errors.map((e, i) => (
                <div key={i} style={{ fontSize: BODY_PX, color: PAL.body, lineHeight: 1.5 }}>{e}</div>
              ))}
            </div>
          </div>
        )}

        {onSendToOrder && isTrade && structure && (
          <button
            type="button"
            onClick={sendToOrder}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 4,
              marginBottom: 12,
              padding: "14px 16px",
              borderRadius: 8,
              border: "none",
              background: PAL.goldHeader,
              color: "#0a0a0a",
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              cursor: "pointer",
              fontFamily: SYS_FONT,
              minHeight: TOUCH_MIN,
            }}
          >
            <Send size={16} aria-hidden />
            Send to Order Ticket
          </button>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: LABEL_PX, fontWeight: 600, color: PAL.label, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>TOPIC SECTIONS</div>

        <div style={{ marginBottom: 8 }}>
          <DeskCardCollapsibleSection title="Volatility" defaultOpen>
            <DeskCardFieldRow label="IV State" value={vol.iv_state} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="Term Structure" value={vol.term_structure} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="Skew" value={vol.skew} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="IV vs Realized" value={vol.implied_vs_realized} valueSizePx={BODY_PX} />
            <div style={{ marginTop: 8, fontSize: BODY_PX, color: PAL.body, lineHeight: 1.6, borderTop: `1px solid ${PAL.borderInner}`, paddingTop: 8 }}>
              {vol.read}
            </div>
          </DeskCardCollapsibleSection>
        </div>

        <div style={{ marginBottom: 8 }}>
          <DeskCardCollapsibleSection title="Flow" defaultOpen>
            <DeskCardFieldRow label="Dominant Flow" value={flow.dominant_flow} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="Institutional" value={flow.institutional_signal} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="Retail" value={flow.retail_signal} valueSizePx={BODY_PX} />
            {flow.key_strikes.length > 0 && (
              <div style={{ marginTop: 6, marginBottom: 6 }}>
                <span style={{ fontSize: LABEL_PX, color: PAL.label, letterSpacing: 0.5 }}>KEY STRIKES</span>
                {flow.key_strikes.map((ks, i) => (
                  <div key={i} style={{ fontSize: BODY_PX, color: PAL.body, padding: "2px 0" }}>
                    {ks.type.toUpperCase()} {ks.strike} ({ks.expiry}): {ks.observation}
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: BODY_PX, color: PAL.body, lineHeight: 1.6, borderTop: `1px solid ${PAL.borderInner}`, paddingTop: 8 }}>
              {flow.read}
            </div>
          </DeskCardCollapsibleSection>
        </div>

        <div style={{ marginBottom: 8 }}>
          <DeskCardCollapsibleSection title="Catalyst" defaultOpen>
            <DeskCardFieldRow label="Primary Catalyst" value={catalyst.primary_catalyst} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="Bar to Clear" value={catalyst.bar_to_clear} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="Asymmetry" value={catalyst.asymmetry} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="Historical" value={catalyst.historical_pattern} valueSizePx={BODY_PX} />
            <div style={{ marginTop: 8, fontSize: BODY_PX, color: PAL.body, lineHeight: 1.6, borderTop: `1px solid ${PAL.borderInner}`, paddingTop: 8 }}>
              {catalyst.read}
            </div>
          </DeskCardCollapsibleSection>
        </div>

        <div style={{ marginBottom: 8 }}>
          <DeskCardCollapsibleSection title="Family hypotheses" defaultOpen>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {fh.map((h) => {
                const isStrongest = rs.strongest_hypothesis === h.family;
                return (
                  <div
                    key={h.family}
                    style={{
                      borderRadius: 8,
                      border: `1px solid ${isStrongest ? "rgba(251,191,36,0.45)" : PAL.borderInner}`,
                      background: isStrongest ? "rgba(251,191,36,0.06)" : PAL.bgInner,
                      padding: 12,
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: LABEL_PX, fontWeight: 700, color: PAL.white, letterSpacing: 0.8, textTransform: "uppercase" }}>
                        {formatEnumLabel(h.family)}
                      </span>
                      <span style={deskBadgeStyle(fitScoreBadgeVariant(h.fit_score))}>{h.fit_score}</span>
                      {isStrongest && <span style={deskBadgeStyle("gold")}>strongest</span>}
                    </div>
                    {h.family !== "pass" && (
                      <>
                        <DeskCardFieldRow label="Candidate structure" value={h.candidate_structure} valueSizePx={BODY_PX} />
                        <DeskCardFieldRow label="Entry math" value={h.entry_math} valueSizePx={BODY_PX} />
                      </>
                    )}
                    <DeskCardFieldRow label="Thesis" value={h.thesis_this_family_represents} valueSizePx={BODY_PX} />
                    <DeskCardFieldRow label="Reason for score" value={h.reason_for_score} valueSizePx={BODY_PX} />
                  </div>
                );
              })}
            </div>
          </DeskCardCollapsibleSection>
        </div>

        <div style={{ marginBottom: 8 }}>
          <DeskCardCollapsibleSection
            title="Regime synthesis"
            defaultOpen
            headerAddon={
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <span style={deskBadgeStyle("gold")}>{formatEnumLabel(rs.regime_read)}</span>
                <span style={deskBadgeStyle(rs.strongest_hypothesis === "pass" ? "gray" : "green")}>{formatEnumLabel(rs.strongest_hypothesis)}</span>
              </div>
            }
          >
            <div style={{ fontSize: BODY_PX, color: PAL.body, lineHeight: 1.65 }}>{rs.synthesis}</div>
          </DeskCardCollapsibleSection>
        </div>

        <div style={{ marginBottom: 8 }}>
          <DeskCardCollapsibleSection title="Risk of ruin" defaultOpen>
            <div style={{ fontSize: 16, fontWeight: 700, color: PAL.white, lineHeight: 1.55 }}>{conviction.risk_of_ruin}</div>
          </DeskCardCollapsibleSection>
        </div>

        <div style={{ marginBottom: 8 }}>
          <DeskCardCollapsibleSection
            title="Positioning context"
            defaultOpen
            headerAddon={<span style={deskBadgeStyle("amber")}>{formatEnumLabel(pc.crowd_state)}</span>}
          >
            <DeskCardFieldRow label="Sell-side targets vs price" value={pc.sell_side_targets_vs_price} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="Implied vs consensus" value={pc.implied_vs_consensus} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="Upside fade risk" value={pc.upside_fade_risk} valueSizePx={BODY_PX} />
            <DeskCardFieldRow label="Downside fade risk" value={pc.downside_fade_risk} valueSizePx={BODY_PX} />
          </DeskCardCollapsibleSection>
        </div>

        <div style={{ marginBottom: 8 }}>
          <DeskCardCollapsibleSection
            title="Self check"
            defaultOpen
            headerAddon={
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span style={deskBadgeStyle(selfCheck.each_family_priced_with_math ? "green" : "red")}>math</span>
                <span style={deskBadgeStyle(selfCheck.decision_consistent_with_strongest_hypothesis ? "green" : "red")}>decision</span>
                <span style={deskBadgeStyle(selfCheck.call_survives_reverse_family_order ? "green" : "red")}>order</span>
              </div>
            }
          >
            <DeskCardFieldRow
              label="Each family priced with math"
              value={`${selfCheck.each_family_priced_with_math ? "Yes" : "No"} — ${selfCheck.each_family_priced_with_math_reason}`}
              valueSizePx={BODY_PX}
            />
            <DeskCardFieldRow
              label="Decision vs strongest hypothesis"
              value={`${selfCheck.decision_consistent_with_strongest_hypothesis ? "Yes" : "No"} — ${selfCheck.decision_consistent_with_strongest_hypothesis_reason}`}
              valueSizePx={BODY_PX}
            />
            <DeskCardFieldRow
              label="Reverse family order"
              value={`${selfCheck.call_survives_reverse_family_order ? "Yes" : "No"} — ${selfCheck.call_survives_reverse_family_order_reason}`}
              valueSizePx={BODY_PX}
            />
          </DeskCardCollapsibleSection>
        </div>
      </div>
    </div>
  );
}
