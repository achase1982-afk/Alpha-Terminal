import { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { useTerminalStore } from "../../lib/store";
import { useMarketPulseStore } from "../../stores/marketPulseStore";
import type { MarketPulseData, ClusterKey } from "../../types/marketPulse";
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
  STRONGLY_BULLISH: { text: "#22c55e", border: "#14532d" },
  MODERATELY_BULLISH: { text: "#22c55e", border: "#14532d" },
  SLIGHTLY_BULLISH: { text: "#4ade80", border: "#14532d" },
  BULLISH: { text: "#22c55e", border: "#14532d" },
  NEUTRAL: { text: "#fbbf24", border: "#422006" },
  SLIGHTLY_BEARISH: { text: "#f87171", border: "#450a0a" },
  MODERATELY_BEARISH: { text: "#ef4444", border: "#450a0a" },
  BEARISH: { text: "#ef4444", border: "#450a0a" },
  STRONGLY_BEARISH: { text: "#ef4444", border: "#450a0a" },
  NO_EDGE: { text: "#71717a", border: "#27272a" },
  ERROR: { text: "#ef4444", border: "#450a0a" },
};

const REGIME_COLORS: Record<string, string> = {
  RISK_ON: "#22c55e",
  RISK_OFF: "#ef4444",
  TRANSITION: "#fbbf24",
  NO_READ: "#52525b",
};

const RISK_COLORS: Record<string, string> = {
  PRESS: "#22c55e",
  NORMAL: "#d4d4d8",
  REDUCED: "#fbbf24",
  NO_TRADE: "#ef4444",
};

interface MarketPulseDashboardProps {
  autoGenerate?: boolean;
  onAutoGenConsumed?: () => void;
}

export interface MarketPulseDashboardHandle {
  fetchPulse: () => void;
}

export const MarketPulseDashboard = forwardRef<MarketPulseDashboardHandle, MarketPulseDashboardProps>(function MarketPulseDashboard({ autoGenerate, onAutoGenConsumed }, ref) {
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

  const hasInitiatedRef = useRef(!!pulseData);

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
    if (autoGenerate && !isLoading && !isStreaming && accessToken) {
      fetchPulse();
      onAutoGenConsumed?.();
    }
  }, [autoGenerate, isLoading, isStreaming, accessToken]);

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
      <div className="p-8 text-center" style={{ background: "#000" }}>
        <p className="font-mono text-[11px] text-[#52525b] mb-4 tracking-wider">CONNECT BROKERAGE FOR MARKET PULSE</p>
        <button
          onClick={handleConnectSchwab}
          disabled={isAuthNavigating}
          className="inline-flex items-center gap-2 px-4 py-2 font-mono text-[11px] font-bold tracking-wider transition-colors"
          style={{ background: "#000", color: "#fbbf24", border: "1px solid #fbbf24" }}
        >
          {isAuthNavigating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          CONNECT
        </button>
      </div>
    );
  }

  const isActive = isLoading || isStreaming;
  const showEmptyOrLoading = !pulseData && !error;
  const showEmptyBox = showEmptyOrLoading && !isActive && !hasInitiatedRef.current;

  return (
    <div className={`px-3 sm:px-4 lg:px-5 pt-1 ${showEmptyOrLoading ? "overflow-hidden h-full flex flex-col" : "space-y-3 overflow-x-hidden"}`} style={{ background: "#000" }}>

      {pulseData && isActive && (
        <div className="mt-3">
          <PulseLoadingStatus thinkingTokens={thinkingTokens} statusMessages={statusMessages} />
        </div>
      )}

      {showEmptyBox && (
        <div className="flex-1 flex flex-col justify-center">
          <div className="p-8 text-center" style={{ background: "#000" }}>
            <p className="font-mono text-[11px] text-[#3f3f46] mb-4 tracking-widest">NO PULSE GENERATED</p>
            <button
              onClick={fetchPulse}
              disabled={!accessToken}
              className="font-mono text-[12px] font-bold tracking-wider px-5 py-2 transition-colors active:scale-95"
              style={{ background: "#000", color: "#fbbf24", border: "1px solid #fbbf24" }}
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
        <div className="mt-3 px-4 py-3" style={{ background: "#000", border: "1px solid #450a0a" }}>
          <p className="font-mono text-[10px] text-[#ef4444]">{error}</p>
          <button onClick={fetchPulse} className="mt-2 font-mono text-[10px] text-[#ef4444] hover:text-[#d4d4d8] uppercase tracking-wider">
            RETRY
          </button>
        </div>
      )}

      {pulseData && !isActive && (
        <div className="space-y-3 animate-in fade-in duration-200 pb-4">

          {thinkingTokens.length > 0 && (
            <div style={{ background: "#000", border: "1px solid #1a1a1a" }}>
              <button
                onClick={() => setShowTranscript((v) => !v)}
                className="w-full px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[#0a0a0a] transition-colors"
              >
                <span className="w-1.5 h-1.5 bg-emerald-500" style={{ boxShadow: "0 0 4px #10b981" }} />
                <span className="font-mono text-[10px] text-emerald-500/70 uppercase tracking-widest font-bold flex-1 text-left">AI REASONING</span>
                <span className="font-mono text-[10px] text-[#3f3f46]">{showTranscript ? "HIDE" : "SHOW"}</span>
              </button>
              {showTranscript && (
                <div className="max-h-[220px] overflow-y-auto px-4 py-3" style={{ borderTop: "1px solid #1a1a1a", scrollBehavior: "smooth" }}>
                  <div className="border-l border-emerald-500/30 pl-3">
                    <p className="font-mono text-[10px] text-[#a1a1aa] leading-[1.7] whitespace-pre-wrap break-words">
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
            <div className="px-4 py-2.5 flex items-start gap-2" style={{ background: "#000", border: "1px solid #422006" }}>
              <span className="font-mono text-[10px] font-bold text-[#fbbf24] shrink-0">DIVERGENCE</span>
              <span className="font-mono text-[10px] text-[#a1a1aa] leading-[1.5]">{pulseData.divergenceNote}</span>
            </div>
          )}

          {settings.showClusterDetails && !settings.compactMode && pulseData.clusters && (
            <>
              <div className="font-mono text-[9px] text-[#3f3f46] uppercase tracking-widest px-1 pt-1">SIGNAL CLUSTERS</div>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:-mx-4 sm:px-4">
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
      <div style={{ background: "#000", border: "1px solid #1a1a1a" }}>
        <div className="px-4 py-2 flex items-center gap-3">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full bg-[#fbbf24] opacity-75" />
            <span className="relative inline-flex h-2 w-2 bg-[#fbbf24]" />
          </span>
          <span className="font-mono text-[11px] font-bold text-[#fbbf24] tracking-wider flex-1">
            {stages[currentIdx].label}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-[#3f3f46]">{elapsed}s</span>
        </div>

        <div className="h-[2px]" style={{ background: "#1a1a1a" }}>
          <div className="h-full transition-all duration-1000 ease-out" style={{ width: `${progress}%`, background: "#fbbf24" }} />
        </div>

        <div className="px-4 py-2 space-y-1">
          {stages.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 shrink-0" style={{
                background: i < currentIdx ? "#22c55e" : i === currentIdx ? "#fbbf24" : "#1a1a1a",
              }} />
              <span className="font-mono text-[9px] tracking-wider" style={{
                color: i < currentIdx ? "#22c55e" : i === currentIdx ? "#fbbf24" : "#3f3f46",
                fontWeight: i === currentIdx ? 700 : 400,
              }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: "#000", border: "1px solid #1a1a1a" }}>
        <div className="px-4 py-2 flex items-center gap-2" style={{ borderBottom: "1px solid #1a1a1a" }}>
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 bg-emerald-500" />
          </span>
          <span className="font-mono text-[10px] text-emerald-500/70 uppercase tracking-widest font-bold">LIVE REASONING</span>
        </div>
        <div ref={thinkingRef} className="max-h-[180px] overflow-y-auto px-4 py-2.5" style={{ scrollBehavior: "smooth" }}>
          {thinkingTokens.length === 0 ? (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 border border-emerald-500 border-t-transparent animate-spin" />
              <span className="font-mono text-[10px] text-[#3f3f46]">Connecting...</span>
            </div>
          ) : (
            <div className="border-l border-emerald-500/30 pl-3">
              <p className="font-mono text-[10px] text-[#a1a1aa] leading-[1.7] whitespace-pre-wrap break-words">
                {thinkingTokens.join("")}
                <span className="inline-block w-1 h-3 bg-emerald-500 ml-0.5 animate-pulse align-text-bottom" />
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BiasHero({ data }: { data: MarketPulseData }) {
  const biasStyle = BIAS_COLORS[data.bias] ?? BIAS_COLORS.NO_EDGE;
  const regimeColor = REGIME_COLORS[data.structuralRegime?.label] ?? "#52525b";
  const riskColor = RISK_COLORS[data.riskState?.label] ?? "#52525b";
  const pct = data.maxConfidence > 0 ? (data.confidenceScore / data.maxConfidence) * 100 : 0;

  return (
    <div style={{ background: "#000", border: `1px solid ${biasStyle.border}` }}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="font-mono text-[14px] font-black tracking-wider" style={{ color: biasStyle.text }}>
            {data.bias.replace(/_/g, " ")}
          </span>

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] text-[#3f3f46] uppercase tracking-wider">COMP</span>
            <span className="font-mono text-[13px] font-black tabular-nums" style={{ color: biasStyle.text }}>
              {data.compositeScore > 0 ? "+" : ""}{data.compositeScore.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] text-[#3f3f46] uppercase tracking-wider">CONF</span>
            <span className="font-mono text-[13px] font-bold tabular-nums text-[#d4d4d8]">
              {Math.round(data.confidenceScore)}
            </span>
            <span className="font-mono text-[10px] text-[#3f3f46]">/</span>
            <span className="font-mono text-[11px] tabular-nums text-[#3f3f46]">
              {Math.round(data.maxConfidence)}
            </span>
          </div>
        </div>

        <div className="mt-2 h-[2px] w-full" style={{ background: "#1a1a1a" }}>
          <div className="h-full transition-all duration-500" style={{ width: `${Math.min(pct, 100)}%`, background: biasStyle.text }} />
        </div>

        <div className="mt-2 flex items-center gap-4 flex-wrap">
          <span className="font-mono text-[9px] font-bold tracking-wider" style={{ color: regimeColor }}>
            REGIME {data.structuralRegime?.label?.replace(/_/g, " ")}
          </span>
          <span className="font-mono text-[9px] font-bold tracking-wider" style={{ color: BIAS_COLORS[data.sessionBias?.label]?.text ?? "#52525b" }}>
            SESSION {data.sessionBias?.label?.replace(/_/g, " ")}
          </span>
          <span className="font-mono text-[9px] font-bold tracking-wider" style={{ color: riskColor }}>
            SIZE {data.riskState?.label?.replace(/_/g, " ")}
          </span>
          <span className="font-mono text-[9px] text-[#3f3f46]">
            {data.timeET} ET
          </span>
        </div>
      </div>
    </div>
  );
}
