import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { BlockReason, StrategistOutcome, StrategistSendToOrderPayload } from "@/components/StrategistV2Card";
import { buildOccSymbol } from "@/components/StrategistV2Card";
import { AlertTriangle, Copy, Play, Pause, Square, Rewind, FastForward, Send } from "lucide-react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type {
  DeskResult,
  DeskResultClassic,
} from "@/lib/strategistDeskResult";
import { buildDeskSpeechSections } from "@/lib/deskCardSpeech";
import { StrategistConvictionDeskCard } from "@/components/StrategistConvictionDeskCard";
import { StrategistTradeCard } from "@/components/StrategistTradeCard";
import { modelFromDeskResult } from "@/lib/strategistCardModel";
import { deskResultAudioId } from "@/lib/deskAudioId";
import { useDeskReportTts, DESK_AUDIO_SKIP_SECONDS } from "@/hooks/useDeskReportTts";
import {
  DESK_PAL as PAL,
  DESK_SYS_FONT as SYS_FONT,
  DESK_FOCUS_RING as FOCUS_RING,
  DESK_TOUCH_MIN as TOUCH_MIN,
  DeskCardFieldRow as FieldRow,
  DeskCardCollapsibleSection as CollapsibleSection,
  DeskCardStructureDisplay as StructureDisplay,
  DeskCardPayoffAtExpirationSection as PayoffAtExpirationSection,
} from "@/components/deskCardShared";

export type { DeskResult } from "@/lib/strategistDeskResult";

const deskVoiceConfig: { voice?: string } = {};

function buildDeskSendToOrderPayload(deskResult: DeskResultClassic): StrategistSendToOrderPayload {
  const s = deskResult.pm.structure!;
  const isCredit = s.credit_or_debit < 0;
  const netPrice = Math.abs(s.credit_or_debit);
  const legs = s.legs.map((leg) => {
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
  return { ticker: deskResult.ticker, legs, netPrice, isCredit };
}

/** Plain text for the full Desk card (all sections including topic sections, regardless of collapse). */
export function buildDeskCardPlainText(args: {
  deskResult: DeskResultClassic;
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
  soloDeskJsonDegraded?: DeskResultClassic["soloDeskJsonDegraded"],
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

export type StrategistDeskCardProps = {
  deskResult: DeskResult;
  generatedAt?: string | number | null;
  strategistOutcome?: StrategistOutcome;
  blockReason?: BlockReason;
  onRetry?: (ticker: string) => void;
  strategistDiagnosticRequestId?: string;
  /** Server-built compact JSON; preferred over fetching full telemetry for sharing. */
  diagnosticView?: Record<string, unknown> | null;
  /** Opens order ticket pre-filled from desk structure (trade recommendations only). */
  onSendToOrder?: (payload: StrategistSendToOrderPayload) => void;
};

export function StrategistDeskCard(props: StrategistDeskCardProps) {
  if (props.deskResult.mode === "conviction_desk") {
    return <StrategistConvictionDeskCard {...props} deskResult={props.deskResult} />;
  }
  return <StrategistDeskCardInner {...props} />;
}

function StrategistDeskCardInner({
  deskResult: deskRaw,
  generatedAt,
  strategistOutcome,
  blockReason,
  onRetry,
  strategistDiagnosticRequestId,
  diagnosticView,
  onSendToOrder,
}: StrategistDeskCardProps) {
  const deskResult = deskRaw as DeskResultClassic;
  const { pm, vol, flow, catalyst, errors } = deskResult;
  const isTrade = pm.decision === "trade";

  const payoffScenarios = pm.scenarios;
  const payoffSummary = pm.scenariosSummary;
  const showPayoffTable =
    Array.isArray(payoffScenarios) &&
    payoffScenarios.length > 0 &&
    payoffSummary != null;

  const sendToOrder = useCallback(() => {
    if (!onSendToOrder || !pm.structure) return;
    onSendToOrder(buildDeskSendToOrderPayload(deskResult));
  }, [deskResult, onSendToOrder, pm.structure]);

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
        generatedAt,
      }),
    [deskResult, banner?.title, banner?.body, generatedAt],
  );
  const deskAudioText = useMemo(() => speechSections.map((s) => s.text).join("\n\n"), [speechSections]);
  const universalModel = useMemo(
    () => (isTrade ? modelFromDeskResult(deskResult, deskResult.ticker, generatedAt) : null),
    [deskResult, generatedAt, isTrade],
  );

  const deskResultId = useMemo(
    () => deskResultAudioId(deskResult, banner?.title, banner?.body),
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


  if (isTrade && universalModel && pm.structure) {
    return (
      <div style={{ fontFamily: SYS_FONT }}>
        {banner ? (
          <div
            style={{
              border: `1px solid ${banner.border}`,
              background: banner.bg,
              borderRadius: 8,
              padding: 12,
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: banner.accent, marginBottom: 4 }}>
              {banner.title}
            </div>
            <div style={{ fontSize: 12, color: PAL.body, lineHeight: 1.5 }}>{banner.body}</div>
          </div>
        ) : null}
        <StrategistTradeCard
          model={universalModel}
          onSendToOrder={onSendToOrder}
          buildSendPayload={() => buildDeskSendToOrderPayload(deskResult)}
          plainText={deskAudioText}
          generatedAt={generatedAt}
        />
      </div>
    );
  }

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

      {showPayoffTable && payoffSummary && (
        <PayoffAtExpirationSection scenarios={payoffScenarios} summary={payoffSummary} />
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

      {onSendToOrder && isTrade && pm.structure && (
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
            marginBottom: 0,
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
