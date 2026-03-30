import { useCallback, useEffect, useRef } from "react";
import { Zap } from "lucide-react";
import { useTerminalStore } from "../../lib/store";
import { useMarketPulseStore } from "../../stores/marketPulseStore";
import { fetchWithAuth } from "../../lib/fetchWithAuth";
import type { MarketPulseData } from "../../types/marketPulse";
import { PulseStatusHeader } from "./PulseStatusHeader";
import { ClusterCard } from "./ClusterCard";
import { ActionPlanCard } from "./ActionPlanCard";
import { InvalidationBox } from "./InvalidationBox";
import { PulseSkeleton } from "./PulseSkeleton";
import { DEFAULT_PULSE_SYMBOLS } from "../MarketPulseModal";

const API_BASE = "/api";

export function MarketPulseDashboard() {
  const { accessToken, aiModel } = useTerminalStore();
  const {
    pulseData,
    isLoading,
    error,
    settings,
    setPulseData,
    setLoading,
    setError,
  } = useMarketPulseStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPulse = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);

    try {
      const symbols =
        settings.preferredInstruments.length > 0
          ? settings.preferredInstruments
          : DEFAULT_PULSE_SYMBOLS;

      const res = await fetchWithAuth(`${API_BASE}/ai/market-pulse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken,
          symbols,
          model: aiModel,
          temperature: 0.2,
          riskTolerance: settings.riskTolerance,
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error ?? `Request failed: ${res.status}`);
      }

      const data = (await res.json()) as MarketPulseData;

      if (!data.bias || !data.clusters || !data.actionPlan || !data.invalidation) {
        throw new Error("Incomplete response from AI — missing required fields.");
      }
      if (!Array.isArray(data.clusters)) data.clusters = [];
      if (!Array.isArray(data.actionPlan?.alternativePlays)) data.actionPlan.alternativePlays = [];
      if (!Array.isArray(data.invalidation?.conditions)) data.invalidation.conditions = [];
      if (!Array.isArray(data.invalidation?.keyLevels)) data.invalidation.keyLevels = [];

      setPulseData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [accessToken, aiModel, settings.preferredInstruments, settings.riskTolerance, setPulseData, setLoading, setError]);

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
        <p className="font-mono text-sm text-[#71717a]">Connect Schwab to enable Market Pulse</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#FFB800]/15 border border-[#FFB800]/30 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-[#FFB800]" />
          </div>
          <div>
            <h2 className="font-mono font-bold text-sm text-[#e4e4e7] tracking-wider">MARKET PULSE</h2>
            <p className="font-mono text-[9px] text-[#71717a] tracking-widest uppercase">AI-Powered Macro Analysis</p>
          </div>
        </div>

        {!pulseData && !isLoading && (
          <button
            onClick={fetchPulse}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-xs font-bold tracking-wider text-[#0c0c0c] bg-[#FFB800] hover:bg-[#FFB800]/90 transition-colors"
          >
            <Zap className="w-3.5 h-3.5" />
            GENERATE PULSE
          </button>
        )}
      </div>

      {isLoading && <PulseSkeleton />}

      {error && !isLoading && (
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

      {pulseData && !isLoading && (
        <div className="space-y-4 animate-in fade-in">
          <PulseStatusHeader
            data={pulseData}
            isRefreshing={isLoading}
            onRefresh={fetchPulse}
            disabled={!accessToken}
          />

          <BiasHero bias={pulseData.bias} />

          {pulseData.clusters.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pulseData.clusters.map((cluster) => (
                <ClusterCard key={cluster.id} cluster={cluster} />
              ))}
            </div>
          )}

          <ActionPlanCard plan={pulseData.actionPlan} />
          <InvalidationBox invalidation={pulseData.invalidation} />
        </div>
      )}
    </div>
  );
}

function BiasHero({ bias }: { bias: MarketPulseData["bias"] }) {
  const BIAS_COLORS = {
    BULLISH: "#00d166",
    BEARISH: "#f23645",
    NEUTRAL: "#FFB800",
  };
  const color = BIAS_COLORS[bias.direction];

  return (
    <div
      className="rounded-xl border p-4 flex items-center gap-4"
      style={{
        background: `${color}08`,
        borderColor: `${color}30`,
      }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center font-mono text-xl font-black"
        style={{ background: `${color}15`, color }}
      >
        {bias.direction === "BULLISH" ? "↑" : bias.direction === "BEARISH" ? "↓" : "→"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-sm font-bold tracking-wider" style={{ color }}>
            {bias.direction}
          </span>
          <span
            className="px-2 py-0.5 rounded-full font-mono text-[9px] font-bold tracking-wider"
            style={{ background: `${color}15`, color }}
          >
            {bias.confidence} CONFIDENCE
          </span>
          <span className="font-mono text-[10px] text-[#71717a] uppercase tracking-wider ml-auto">
            {bias.regime}
          </span>
        </div>
        <p className="font-sans text-sm text-[#e4e4e7] leading-snug">{bias.headline}</p>
      </div>
    </div>
  );
}
