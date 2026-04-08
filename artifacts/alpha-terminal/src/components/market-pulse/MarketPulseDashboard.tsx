import { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { useTerminalStore } from "../../lib/store";
import { useMarketPulseStore } from "../../stores/marketPulseStore";
import type { MarketPulseData, ClusterKey, DeltaHealth } from "../../types/marketPulse";
import { STRATEGY_LABELS } from "../../types/marketPulse";
import { ClusterCard } from "./ClusterCard";
import { ActionPlanCard } from "./ActionPlanCard";
import { InvalidationBox } from "./InvalidationBox";
import { LevelsToWatch } from "./LevelsToWatch";
import { EngineAuditPanel } from "./EngineAuditPanel";
import { ALL_PULSE_INDICATORS } from "@/types/marketPulse";
import { runPulseStream, isPulseStreamActive } from "../../stores/pulseStreamRunner";
import { useGetAuthUrl } from "@workspace/api-client-react";

const CLUSTER_ORDER: ClusterKey[] = ["rates", "credit", "volLevel", "volTerm", "breadth", "riskAppetite", "macro"];

const BIAS_COLORS: Record<string, { text: string; border: string }> = {
  STRONGLY_BULLISH: { text: "#00d166", border: "rgba(0,209,102,0.3)" },
  MODERATELY_BULLISH: { text: "#00d166", border: "rgba(0,209,102,0.3)" },
  SLIGHTLY_BULLISH: { text: "#4ade80", border: "rgba(0,209,102,0.2)" },
  BULLISH: { text: "#00d166", border: "rgba(0,209,102,0.3)" },
  NEUTRAL: { text: "#FFB800", border: "rgba(255,184,0,0.3)" },
  SLIGHTLY_BEARISH: { text: "#f87171", border: "rgba(242,54,69,0.2)" },
  MODERATELY_BEARISH: { text: "#f23645", border: "rgba(242,54,69,0.3)" },
  BEARISH: { text: "#f23645", border: "rgba(242,54,69,0.3)" },
  STRONGLY_BEARISH: { text: "#f23645", border: "rgba(242,54,69,0.3)" },
  NO_EDGE: { text: "#9CA3AF", border: "rgba(63,63,70,0.5)" },
  ERROR: { text: "#f23645", border: "rgba(242,54,69,0.3)" },
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

export interface MarketPulseDashboardHandle {
  fetchPulse: () => void;
}

export const MarketPulseDashboard = forwardRef<MarketPulseDashboardHandle, object>(function MarketPulseDashboard(_props, ref) {
  const { accessToken, aiFeatureSettings } = useTerminalStore();
  const { model: aiModel, temperature: aiTemp } = aiFeatureSettings.marketPulse;
  const {
    pulseData,
    isLoading,
    isStreaming,
    thinkingTokens,
    statusMessages,
    error,
    settings,
    setError,
  } = useMarketPulseStore();

  const clearPulse = useMarketPulseStore((s) => s.clearPulse);
  const clearThinking = useMarketPulseStore((s) => s.clearThinking);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const EXPIRY_MS = 2 * 60 * 60 * 1000;
  useEffect(() => {
    if (pulseData && pulseData.generatedAt) {
      const age = Date.now() - pulseData.generatedAt;
      if (age > EXPIRY_MS) {
        clearPulse();
        clearThinking();
      }
    }
  }, [pulseData, clearPulse, clearThinking]);

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

  const { data: authUrlData, refetch: refetchAuthUrl } = useGetAuthUrl({
    query: { enabled: !accessToken },
  });

  const hasInitiatedRef = useRef(!!pulseData || isPulseStreamActive());

  useEffect(() => {
    if (isPulseStreamActive() && !pulseData) {
      hasInitiatedRef.current = true;
    }
  }, []);

  const [isAuthNavigating, setIsAuthNavigating] = useState(false);
  const handleConnectSchwab = useCallback(async () => {
    setIsAuthNavigating(true);
    let url = authUrlData?.url || "";
    if (!url) {
      const result = await refetchAuthUrl();
      url = result.data?.url || "";
    }
    if (!url) {
      setIsAuthNavigating(false);
      return;
    }
    window.location.href = url;
  }, [authUrlData, refetchAuthUrl]);

  const fetchPulse = useCallback(() => {
    if (isPulseStreamActive()) return;
    const token = accessTokenRef.current;
    if (!token) return;
    hasInitiatedRef.current = true;
    setShowTranscript(false);

    const s = settingsRef.current;
    const allowedList = s.allowedStrategies.map((k) => STRATEGY_LABELS[k]);
    const activeSymbols = s.pulseIndicators && s.pulseIndicators.length > 0
      ? s.pulseIndicators
      : ALL_PULSE_INDICATORS.map(i => i.symbol);

    if (activeSymbols.length === 0) {
      setError("No indicators selected. Open Settings to enable at least one.");
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
  }, [setError]);

  useImperativeHandle(ref, () => ({ fetchPulse }), [fetchPulse]);

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
      <div className="p-8 text-center">
        <p className="font-mono text-sm text-zinc-500 mb-4 tracking-wider">CONNECT BROKERAGE FOR MARKET PULSE</p>
        <button
          onClick={handleConnectSchwab}
          disabled={isAuthNavigating}
          className="inline-flex items-center gap-2 px-5 py-2.5 font-mono text-sm font-bold tracking-wider transition-colors rounded-lg border border-[#FFB800] text-[#FFB800] hover:bg-[#FFB800]/10"
        >
          {isAuthNavigating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          CONNECT
        </button>
      </div>
    );
  }

  const isActive = isLoading || isStreaming;
  const showEmptyOrLoading = !pulseData && !error;
  const showEmptyBox = showEmptyOrLoading && !isActive && !hasInitiatedRef.current;

  return (
    <div className={`px-3 sm:px-4 lg:px-5 pt-1 ${showEmptyOrLoading ? "overflow-hidden h-full flex flex-col" : "space-y-3 overflow-x-hidden"}`}>

      {pulseData && isActive && (
        <div className="mt-3">
          <PulseLoadingStatus thinkingTokens={thinkingTokens} statusMessages={statusMessages} />
        </div>
      )}

      {showEmptyBox && (
        <div className="flex-1 flex flex-col justify-center">
          <div className="p-8 text-center">
            <p className="font-mono text-sm text-zinc-500 mb-4 tracking-widest">NO PULSE GENERATED</p>
            <button
              onClick={fetchPulse}
              disabled={!accessToken}
              className="font-mono text-sm font-bold tracking-wider px-6 py-2.5 transition-colors active:scale-95 rounded-lg border border-[#FFB800] text-[#FFB800] hover:bg-[#FFB800]/10"
            >
              CHECK PULSE
            </button>
          </div>
        </div>
      )}

      {showEmptyOrLoading && !showEmptyBox && (
        <div className="flex-1 flex flex-col overflow-y-auto space-y-3">
          <PulseLoadingStatus thinkingTokens={thinkingTokens} statusMessages={statusMessages} />
        </div>
      )}

      {error && !isActive && !pulseData && (
        <div className="mt-3 px-4 py-3 rounded-lg border border-red-900/50">
          <p className="font-mono text-sm text-[#f23645]">{error}</p>
          <button onClick={fetchPulse} className="mt-2 font-mono text-xs text-[#f23645] hover:text-zinc-200 uppercase tracking-wider">
            RETRY
          </button>
        </div>
      )}

      {pulseData && !isActive && (
        <div className="space-y-3 animate-in fade-in duration-200 pb-4">

          {thinkingTokens.length > 0 && (
            <div className="rounded-lg border border-zinc-800/50 overflow-hidden">
              <button
                onClick={() => setShowTranscript((v) => !v)}
                className="w-full px-4 py-3 flex items-center gap-2 cursor-pointer hover:bg-zinc-800/30 transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" style={{ boxShadow: "0 0 6px #10b981" }} />
                <span className="font-mono text-xs text-emerald-500 uppercase tracking-wider font-bold flex-1 text-left">AI REASONING</span>
                <span className="font-mono text-xs text-zinc-500">{showTranscript ? "HIDE" : "SHOW"}</span>
              </button>
              {showTranscript && (
                <div className="max-h-[240px] overflow-y-auto px-4 py-3 border-t border-zinc-800/50" style={{ scrollBehavior: "smooth" }}>
                  <div className="border-l-2 border-emerald-500/30 pl-3">
                    <p className="font-mono text-[12px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
                      {thinkingTokens.join("")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <EngineAuditPanel data={pulseData} />

          <BiasHero data={pulseData} />

          {pulseData.hasDivergence && pulseData.divergenceNote && (
            <div className="px-4 py-3 flex items-start gap-3 rounded-lg border border-[#FFB800]/30">
              <span className="font-mono text-xs font-bold text-[#FFB800] shrink-0">DIVERGENCE</span>
              <span className="font-mono text-[12px] text-zinc-300 leading-snug">{pulseData.divergenceNote}</span>
            </div>
          )}

          {settings.showClusterDetails && !settings.compactMode && pulseData.clusters && (
            <>
              <div className="font-mono text-[11px] text-zinc-500 uppercase tracking-wider px-1 pt-1">SIGNAL CLUSTERS</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
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
        </div>
      )}
    </div>
  );
});

function PulseLoadingStatus({ thinkingTokens, statusMessages }: { thinkingTokens: string[]; statusMessages: string[] }) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  const thinkingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (thinkingRef.current) thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
  }, [thinkingTokens]);

  const latestStatus = statusMessages.length > 0 ? statusMessages[statusMessages.length - 1] : "";
  const lower = latestStatus.toLowerCase();
  const hasScored = lower.includes("scored") || lower.includes("narrative") || lower.includes("generat");
  const hasData = lower.includes("loaded") || lower.includes("running scoring");
  const hasAi = thinkingTokens.length > 0 || lower.includes("narrative") || lower.includes("generat");

  const stages = [
    { label: "FETCHING MARKET DATA" },
    { label: "RUNNING SCORING ENGINE" },
    { label: "CLAUDE AI REASONING" },
  ];
  const currentIdx = hasAi ? 2 : hasScored ? 2 : hasData ? 1 : 0;
  const progress = Math.min((elapsed / 20) * 100, 95);

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-zinc-800/50 overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FFB800] opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#FFB800]" />
          </span>
          <span className="font-mono text-sm font-bold text-[#FFB800] tracking-wider flex-1">
            {stages[currentIdx].label}
          </span>
          <span className="font-mono text-xs tabular-nums text-zinc-500">{elapsed}s</span>
        </div>

        <div className="h-[3px]" style={{ background: "rgba(63,63,70,0.3)" }}>
          <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${progress}%`, background: "#FFB800" }} />
        </div>

        <div className="px-4 py-3 space-y-2">
          {stages.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2.5">
              <div className="w-2 h-2 shrink-0 rounded-full" style={{
                background: i < currentIdx ? "#00d166" : i === currentIdx ? "#FFB800" : "rgba(63,63,70,0.3)",
              }} />
              <span className="font-mono text-xs tracking-wider" style={{
                color: i < currentIdx ? "#00d166" : i === currentIdx ? "#FFB800" : "#71717a",
                fontWeight: i === currentIdx ? 700 : 400,
              }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800/50 overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2 border-b border-zinc-800/50">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono text-xs text-emerald-500 uppercase tracking-wider font-bold">LIVE REASONING</span>
        </div>
        <div ref={thinkingRef} className="max-h-[200px] overflow-y-auto px-4 py-3" style={{ scrollBehavior: "smooth" }}>
          {thinkingTokens.length === 0 ? (
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              <span className="font-mono text-xs text-zinc-500">Connecting...</span>
            </div>
          ) : (
            <div className="border-l-2 border-emerald-500/30 pl-3">
              <p className="font-mono text-[12px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
                {thinkingTokens.join("")}
                <span className="inline-block w-1.5 h-3.5 bg-emerald-500 ml-0.5 animate-pulse align-text-bottom rounded-sm" />
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const DELTA_STATE_COLORS: Record<string, string> = {
  SOFTENING: "#eab308",
  FADING: "#f97316",
  REVERSING: "#ef4444",
  DEGRADED: "#71717a",
};

function DeltaTrendLine({ deltaHealth, baselineReset }: { deltaHealth: DeltaHealth; baselineReset: boolean }) {
  const color = DELTA_STATE_COLORS[deltaHealth.state] ?? "#71717a";
  const sinceTime = deltaHealth.stateEnteredAt
    ? new Date(deltaHealth.stateEnteredAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })
    : "";
  const deltaPDisplay = deltaHealth.delta_p_session >= 0
    ? `+${deltaHealth.delta_p_session.toFixed(3)}`
    : deltaHealth.delta_p_session.toFixed(3);

  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap">
      <span className="font-mono text-[10px] font-bold tracking-wider" style={{ color }}>
        TREND: {deltaHealth.state}
      </span>
      {sinceTime && (
        <span className="font-mono text-[10px] text-zinc-500">
          since {sinceTime}
        </span>
      )}
      <span className="font-mono text-[10px] text-zinc-400">
        participation {deltaPDisplay} from baseline
      </span>
      {baselineReset && (
        <span className="font-mono text-[9px] text-zinc-600 italic">
          Baseline shifted to 10:45 AM
        </span>
      )}
      {deltaHealth.flags.length > 0 && (
        <span className="font-mono text-[9px] font-bold text-red-400">
          {deltaHealth.flags.join(" | ")}
        </span>
      )}
    </div>
  );
}

function BiasHero({ data }: { data: MarketPulseData }) {
  const biasStyle = BIAS_COLORS[data.bias] ?? BIAS_COLORS.NO_EDGE;
  const regimeColor = REGIME_COLORS[data.structuralRegime?.label] ?? "#71717a";
  const riskColor = RISK_COLORS[data.riskState?.label] ?? "#71717a";
  const pct = data.maxConfidence > 0 ? (data.confidenceScore / data.maxConfidence) * 100 : 0;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${biasStyle.border}` }}>
      <div className="px-4 py-4">
        <div className="flex items-center gap-5 flex-wrap">
          <span className="font-mono text-lg font-black tracking-wider" style={{ color: biasStyle.text }}>
            {data.bias.replace(/_/g, " ")}
          </span>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-500 uppercase tracking-wider">COMP</span>
            <span className="font-mono text-base font-black tabular-nums" style={{ color: biasStyle.text }}>
              {data.compositeScore > 0 ? "+" : ""}{data.compositeScore.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-zinc-500 uppercase tracking-wider">CONF</span>
            <span className="font-mono text-base font-bold tabular-nums text-zinc-200">
              {Math.round(data.confidenceScore)}
            </span>
            <span className="font-mono text-sm text-zinc-500">/</span>
            <span className="font-mono text-sm tabular-nums text-zinc-400">
              {Math.round(data.maxConfidence)}
            </span>
          </div>
        </div>

        <div className="mt-3 h-[3px] w-full rounded-full" style={{ background: "rgba(63,63,70,0.3)" }}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, background: biasStyle.text }} />
        </div>

        <div className="mt-3 flex items-center gap-5 flex-wrap">
          <span className="font-mono text-xs font-bold tracking-wider" style={{ color: regimeColor }}>
            REGIME {data.structuralRegime?.label?.replace(/_/g, " ")}
          </span>
          <span className="font-mono text-xs font-bold tracking-wider" style={{ color: BIAS_COLORS[data.sessionBias?.label]?.text ?? "#71717a" }}>
            SESSION {data.sessionBias?.label?.replace(/_/g, " ")}
          </span>
          <span className="font-mono text-xs font-bold tracking-wider" style={{ color: riskColor }}>
            SIZE {data.riskState?.label?.replace(/_/g, " ")}
          </span>
          <span className="font-mono text-xs text-zinc-500">
            {data.timeET}
          </span>
        </div>

        {data.deltaHealth && data.deltaHealth.state !== "HEALTHY" && data.deltaHealth.state !== "AWAITING_BASELINE" && (
          <DeltaTrendLine deltaHealth={data.deltaHealth} baselineReset={data.deltaHealth.baselineType === "effective"} />
        )}
      </div>
    </div>
  );
}
