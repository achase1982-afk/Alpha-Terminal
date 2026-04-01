import { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Zap, Activity, Radio } from "lucide-react";
import { useTerminalStore } from "../../lib/store";
import { useMarketPulseStore } from "../../stores/marketPulseStore";
import type { MarketPulseData, ClusterKey } from "../../types/marketPulse";
import { STRATEGY_LABELS } from "../../types/marketPulse";
import { PulseStatusHeader } from "./PulseStatusHeader";
import { ClusterCard } from "./ClusterCard";
import { ActionPlanCard } from "./ActionPlanCard";
import { InvalidationBox } from "./InvalidationBox";
import { LevelsToWatch } from "./LevelsToWatch";
import { EngineAuditPanel } from "./EngineAuditPanel";
import { ALL_PULSE_INDICATORS } from "@/types/marketPulse";
import { AiThinkingFeed } from "../ai-shared/AiThinkingFeed";
import { runPulseStream } from "../../stores/pulseStreamRunner";

const CLUSTER_ORDER: ClusterKey[] = ["rates", "credit", "volLevel", "volTerm", "breadth", "riskAppetite", "macro"];

const BIAS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  STRONGLY_BULLISH: { bg: "rgba(0,209,102,0.15)", text: "#00d166", border: "rgba(0,209,102,0.4)" },
  MODERATELY_BULLISH: { bg: "rgba(0,209,102,0.12)", text: "#00d166", border: "rgba(0,209,102,0.35)" },
  SLIGHTLY_BULLISH: { bg: "rgba(0,209,102,0.08)", text: "#34d399", border: "rgba(0,209,102,0.25)" },
  BULLISH: { bg: "rgba(0,209,102,0.10)", text: "#00d166", border: "rgba(0,209,102,0.3)" },
  NEUTRAL: { bg: "rgba(255,184,0,0.10)", text: "#FFB800", border: "rgba(255,184,0,0.3)" },
  SLIGHTLY_BEARISH: { bg: "rgba(242,54,69,0.08)", text: "#fb7185", border: "rgba(242,54,69,0.25)" },
  MODERATELY_BEARISH: { bg: "rgba(242,54,69,0.12)", text: "#f23645", border: "rgba(242,54,69,0.35)" },
  BEARISH: { bg: "rgba(242,54,69,0.10)", text: "#f23645", border: "rgba(242,54,69,0.3)" },
  STRONGLY_BEARISH: { bg: "rgba(242,54,69,0.15)", text: "#f23645", border: "rgba(242,54,69,0.4)" },
  NO_EDGE: { bg: "rgba(113,113,122,0.10)", text: "#71717a", border: "rgba(113,113,122,0.3)" },
  ERROR: { bg: "rgba(242,54,69,0.10)", text: "#f23645", border: "rgba(242,54,69,0.3)" },
};

const REGIME_COLORS: Record<string, string> = {
  RISK_ON: "#00d166",
  RISK_OFF: "#f23645",
  TRANSITION: "#FFB800",
  NO_READ: "#71717a",
};

const RISK_COLORS: Record<string, string> = {
  PRESS: "#00d166",
  NORMAL: "#e4e4e7",
  REDUCED: "#FFB800",
  NO_TRADE: "#f23645",
};

interface MarketPulseDashboardProps {
  autoGenerate?: boolean;
}

export interface MarketPulseDashboardHandle {
  fetchPulse: () => void;
}

export const MarketPulseDashboard = forwardRef<MarketPulseDashboardHandle, MarketPulseDashboardProps>(function MarketPulseDashboard({ autoGenerate }, ref) {
  const { accessToken, aiFeatureSettings } = useTerminalStore();
  const { model: aiModel, temperature: aiTemp } = aiFeatureSettings.marketPulse;
  const {
    pulseData,
    isLoading,
    isStreaming,
    thinkingTokens,
    error,
    settings,
    setError,
  } = useMarketPulseStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  // Use refs to avoid fetchPulse changing on every pulseData/store update
  const pulseDataRef = useRef(pulseData);
  useEffect(() => { pulseDataRef.current = pulseData; }, [pulseData]);

  const accessTokenRef = useRef(accessToken);
  useEffect(() => { accessTokenRef.current = accessToken; }, [accessToken]);

  const aiModelRef = useRef(aiModel);
  useEffect(() => { aiModelRef.current = aiModel; }, [aiModel]);

  const aiTempRef = useRef(aiTemp);
  useEffect(() => { aiTempRef.current = aiTemp; }, [aiTemp]);

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const fetchPulse = useCallback(() => {
    const token = accessTokenRef.current;
    if (!token) return;
    setShowTranscript(false);

    const s = settingsRef.current;
    const allowedList = s.allowedStrategies.map((k) => STRATEGY_LABELS[k]);

    const activeSymbols = s.pulseIndicators && s.pulseIndicators.length > 0
      ? s.pulseIndicators
      : ALL_PULSE_INDICATORS.map(i => i.symbol);

    if (activeSymbols.length === 0) {
      setError("No indicators selected. Open Settings → Market Pulse → Indicators to enable at least one.");
      return;
    }

    runPulseStream({
      accessToken: token,
      symbols: activeSymbols,
      model: aiModelRef.current,
      temperature: aiTempRef.current,
      previousBias: pulseDataRef.current?.bias ?? undefined,
      preferences: {
        allowedStrategies: allowedList,
        defaultSpreadWidth: s.defaultSpreadWidth,
        maxContracts: s.maxContracts,
        accountSizeTier: s.accountSizeTier,
        preferredTickers: s.preferredTickers,
        maxRiskPerTrade: s.maxRiskPerTrade,
      },
    });
  }, [setError]); // stable — all deps read from refs

  useImperativeHandle(ref, () => ({ fetchPulse }), [fetchPulse]);

  // Auto-generate once on first mount when autoGenerate=true and no data yet
  const autoGenFiredRef = useRef(false);
  useEffect(() => {
    if (autoGenerate && !autoGenFiredRef.current && !pulseData && !isLoading && !isStreaming && accessToken) {
      autoGenFiredRef.current = true;
      fetchPulse();
    }
    // Only run when the guard conditions change, not on every pulseData update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, isLoading, isStreaming, accessToken]);

  // Auto-refresh interval — stable since fetchPulse is stable
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (settings.autoRefresh && settings.autoRefreshInterval > 0) {
      intervalRef.current = setInterval(fetchPulse, settings.autoRefreshInterval * 60_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [settings.autoRefresh, settings.autoRefreshInterval, fetchPulse]);

  if (!accessToken) {
    return (
      <div className="rounded-xl border border-[#2A2A2C] p-8 text-center" style={{ background: "#111113" }}>
        <Zap className="w-8 h-8 text-[#FFB800] mx-auto mb-3 opacity-40" />
        <p className="font-mono text-sm text-[#71717a] mb-3">Connect Schwab to enable Market Pulse</p>
        <a
          href="/api/schwab/auth"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs font-bold tracking-wider text-[#0c0c0c] bg-[#FFB800] hover:bg-[#FFB800]/90 transition-colors"
        >
          Connect Schwab →
        </a>
      </div>
    );
  }

  const isActive = isLoading || isStreaming;

  return (
    <div className="space-y-4 px-3 sm:px-4 lg:px-5 overflow-x-hidden pt-1">
      {/* Header always visible when we have data (even while refreshing) */}
      {pulseData && (
        <PulseStatusHeader
          data={pulseData}
          isRefreshing={isActive}
          onRefresh={fetchPulse}
          disabled={!accessToken}
        />
      )}

      {isActive && (
        <>
          <PulseLoadingStatus thinkingTokens={thinkingTokens} />
          <AiThinkingFeed texts={thinkingTokens} isStreaming={true} />
        </>
      )}

      {error && !isActive && (
        <div className="rounded-xl border border-[#f23645]/30 p-4" style={{ background: "rgba(242,54,69,0.06)" }}>
          <p className="font-mono text-xs text-[#f23645]">{error}</p>
          <button
            onClick={fetchPulse}
            className="mt-2 font-mono text-[10px] text-[#f23645] hover:text-[#e4e4e7] transition-colors uppercase tracking-wider"
          >
            Try Again
          </button>
        </div>
      )}

      {pulseData && !isActive && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <BiasHero data={pulseData} />

          {thinkingTokens.length > 0 && (
            <AiThinkingFeed texts={thinkingTokens} isStreaming={false} />
          )}

          {pulseData.hasDivergence && pulseData.divergenceNote && (
            <div
              className="rounded-xl border px-4 py-3 flex items-start gap-2"
              style={{ background: "rgba(255,184,0,0.06)", borderColor: "rgba(255,184,0,0.3)" }}
            >
              <span className="text-[#FFB800] text-sm mt-0.5">⚠</span>
              <div>
                <span className="font-mono text-[10px] font-bold text-[#FFB800] uppercase tracking-wider">Signal Conflict</span>
                <p className="font-sans text-xs text-[#a1a1aa] mt-1">{pulseData.divergenceNote}</p>
              </div>
            </div>
          )}

          {settings.showClusterDetails && !settings.compactMode && pulseData.clusters && (
            <>
              <div className="font-mono text-[10px] text-[#71717a] uppercase tracking-widest px-1">Signal Clusters</div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-3 px-3 sm:-mx-4 sm:px-4">
                {CLUSTER_ORDER.map((key) => pulseData.clusters[key] ? (
                  <ClusterCard key={key} clusterKey={key} cluster={pulseData.clusters[key]} />
                ) : null)}
              </div>
            </>
          )}

          {settings.showActionPlan && !settings.compactMode && pulseData.actionPlan && (
            <ActionPlanCard items={pulseData.actionPlan} bias={pulseData.bias} />
          )}

          {!settings.compactMode && pulseData.invalidation && (
            <InvalidationBox conditions={Array.isArray(pulseData.invalidation) ? pulseData.invalidation : (pulseData.invalidation.conditions ?? [])} />
          )}

          {!settings.compactMode && pulseData.levelsToWatch && (
            <LevelsToWatch levels={pulseData.levelsToWatch} />
          )}

          <EngineAuditPanel data={pulseData} />
        </div>
      )}
    </div>
  );
});

function PulseLoadingStatus({ thinkingTokens }: { thinkingTokens: string[] }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const stages = [
    { label: "CONNECTING", threshold: 0 },
    { label: "FETCHING MARKET DATA", threshold: 1 },
    { label: "ANALYZING WITH AI", threshold: 4 },
    { label: "GENERATING SIGNALS", threshold: 8 },
  ];

  const allThinking = thinkingTokens.join("").toLowerCase();

  let currentStageIdx = 0;
  for (let i = stages.length - 1; i >= 0; i--) {
    if (elapsed >= stages[i].threshold) {
      currentStageIdx = i;
      break;
    }
  }

  if (allThinking.includes("analyz") || allThinking.includes("signal")) {
    currentStageIdx = Math.max(currentStageIdx, 2);
  }
  if (allThinking.includes("generat") || allThinking.includes("narrativ")) {
    currentStageIdx = Math.max(currentStageIdx, 3);
  }

  const currentStage = stages[currentStageIdx];
  const progress = Math.min((elapsed / 15) * 100, 95);

  return (
    <div className="space-y-3">
      <div
        className="rounded-xl border overflow-hidden"
        style={{ background: "#111113", borderColor: "rgba(255,184,0,0.3)" }}
      >
        <div
          className="px-4 py-3 flex items-center gap-3"
          style={{ background: "rgba(255,184,0,0.06)" }}
        >
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FFB800] opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#FFB800]" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-[#FFB800] tracking-wider">
                {currentStage.label}
              </span>
              <span className="font-mono text-xs tabular-nums text-[#71717a]">
                {elapsed}s
              </span>
            </div>
          </div>
        </div>

        <div className="h-1 bg-[#2A2A2C]">
          <div
            className="h-full transition-all duration-1000 ease-out"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, #FFB800, #FF8C00)",
            }}
          />
        </div>

        <div className="px-4 py-3 space-y-2.5">
          <div className="space-y-1.5">
            {stages.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background:
                      i < currentStageIdx
                        ? "#00d166"
                        : i === currentStageIdx
                          ? "#FFB800"
                          : "#2A2A2C",
                    boxShadow:
                      i === currentStageIdx
                        ? "0 0 6px rgba(255,184,0,0.5)"
                        : "none",
                  }}
                />
                <span
                  className="font-mono text-[10px] tracking-wider"
                  style={{
                    color:
                      i < currentStageIdx
                        ? "#00d166"
                        : i === currentStageIdx
                          ? "#FFB800"
                          : "#52525b",
                    fontWeight: i === currentStageIdx ? 700 : 400,
                  }}
                >
                  {s.label}
                </span>
                {i < currentStageIdx && (
                  <span className="font-mono text-[9px] text-[#00d166]">✓</span>
                )}
              </div>
            ))}
          </div>

          {thinkingTokens.length > 0 && (
            <div className="pt-1 border-t border-[#2A2A2C] space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span className="font-mono text-[9px] text-emerald-500 uppercase tracking-widest">AI Reasoning</span>
              </div>
              <div
                className="max-h-[80px] overflow-y-auto border-l-2 border-emerald-500/30 pl-2"
                style={{ scrollBehavior: "smooth" }}
                ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
              >
                <span className="font-mono text-[10px] text-[#a1a1aa] leading-relaxed whitespace-pre-wrap">
                  {thinkingTokens.join("")}
                  <span className="inline-block w-1 h-3 bg-emerald-500 ml-0.5 animate-pulse" />
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3">
        {["RATES", "CREDIT", "VOL", "TERM", "BREADTH", "RISK APP", "MACRO"].map((label, i) => (
          <div
            key={label}
            className="rounded-lg border border-[#2A2A2C] p-2.5 space-y-2 shrink-0"
            style={{ background: "#111113", width: 100 }}
          >
            <div
              className="h-2 w-10 rounded bg-[#2A2A2C]/60 animate-pulse"
              style={{ animationDelay: `${i * 200}ms` }}
            />
            <div
              className="h-4 w-full rounded bg-[#2A2A2C]/60 animate-pulse"
              style={{ animationDelay: `${i * 200 + 100}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function BiasHero({ data }: { data: MarketPulseData }) {
  const biasStyle = BIAS_COLORS[data.bias] ?? BIAS_COLORS.NO_EDGE;
  const regimeColor = REGIME_COLORS[data.structuralRegime?.label] ?? "#71717a";
  const riskColor = RISK_COLORS[data.riskState?.label] ?? "#71717a";

  const pct = data.maxConfidence > 0 ? (data.confidenceScore / data.maxConfidence) * 100 : 0;

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ background: biasStyle.bg, borderColor: biasStyle.border }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className="px-3 py-1.5 rounded-full font-mono text-sm font-black tracking-wider"
          style={{ background: biasStyle.border, color: biasStyle.text }}
        >
          {data.bias.replace(/_/g, " ")}
        </span>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider">Composite</span>
          <span
            className="font-mono text-sm font-black tabular-nums"
            style={{ color: biasStyle.text }}
          >
            {data.compositeScore > 0 ? "+" : ""}{data.compositeScore.toFixed(2)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider">Confidence</span>
          <span className="font-mono text-sm font-bold tabular-nums text-[#e4e4e7]">
            {Math.round(data.confidenceScore)}
          </span>
          <span className="font-mono text-[10px] text-[#71717a]">/</span>
          <span className="font-mono text-sm tabular-nums text-[#71717a]">
            {Math.round(data.maxConfidence)}
          </span>
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-[#2A2A2C] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, background: biasStyle.text }}
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="px-2 py-0.5 rounded font-mono text-[9px] font-bold tracking-wider"
          style={{ background: `${regimeColor}15`, color: regimeColor }}
        >
          REGIME: {data.structuralRegime?.label?.replace(/_/g, " ")} ({data.structuralRegime?.timeframe})
        </span>
        <span
          className="px-2 py-0.5 rounded font-mono text-[9px] font-bold tracking-wider"
          style={{ background: `${BIAS_COLORS[data.sessionBias?.label]?.bg ?? "rgba(113,113,122,0.1)"}`, color: BIAS_COLORS[data.sessionBias?.label]?.text ?? "#71717a" }}
        >
          TODAY: {data.sessionBias?.label}
        </span>
        <span
          className="px-2 py-0.5 rounded font-mono text-[9px] font-bold tracking-wider"
          style={{ background: `${riskColor}15`, color: riskColor }}
        >
          SIZE: {data.riskState?.label}
        </span>
      </div>
    </div>
  );
}
