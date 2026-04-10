import { useState, useEffect, useCallback, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  TrendingUp, TrendingDown, Clock, Shield, AlertTriangle,
  ChevronDown, ChevronUp, Beaker,
} from "lucide-react";

const API_BASE = "/api";

interface AiLabIdea {
  id: number;
  symbol: string;
  direction: "LONG" | "SHORT";
  instrumentType: string;
  optionStructureType: string | null;
  timeHorizon: string | null;
  thesis: string | null;
  catalyst: string | null;
  signalStrength: number | null;
  convictionLevel: string | null;
  analystNote: string | null;
  criticNote: string | null;
  analystModelName: string | null;
  criticModelName: string | null;
  entryZone: unknown;
  targetZone: unknown;
  softStop: number | null;
  regimeFit: string | null;
  status: string;
  createdAt: string;
}

function IdeaCard({ idea }: { idea: AiLabIdea }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = idea.direction === "LONG";
  const dirColor = isLong ? "#2ecc71" : "#ff4b5c";
  const dirLabel = isLong ? "BULLISH" : "BEARISH";
  const DirIcon = isLong ? TrendingUp : TrendingDown;

  const convictionColors: Record<string, string> = {
    HIGH: "#2ecc71",
    MEDIUM: "#FFB800",
    LOW: "#ff4b5c",
  };

  const entryZone = idea.entryZone as { min?: number; max?: number } | null;
  const targetZone = idea.targetZone as { min?: number; max?: number } | null;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between cursor-pointer active:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `${dirColor}15`, border: `1px solid ${dirColor}30` }}
          >
            <DirIcon className="w-4 h-4" style={{ color: dirColor }} />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] text-white font-bold">{idea.symbol}</span>
              <span
                className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ color: dirColor, background: `${dirColor}15` }}
              >
                {dirLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {idea.optionStructureType && (
                <span className="font-mono text-[9px] text-zinc-500">{idea.optionStructureType}</span>
              )}
              {!idea.optionStructureType && (
                <span className="font-mono text-[9px] text-zinc-500">{idea.instrumentType}</span>
              )}
              {idea.timeHorizon && (
                <>
                  <span className="text-zinc-700">·</span>
                  <span className="font-mono text-[9px] text-zinc-500 flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5" /> {idea.timeHorizon}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {idea.convictionLevel && (
            <span
              className="font-mono text-[9px] font-bold px-2 py-1 rounded"
              style={{
                color: convictionColors[idea.convictionLevel] ?? "#71717a",
                background: `${convictionColors[idea.convictionLevel] ?? "#71717a"}15`,
              }}
            >
              {idea.convictionLevel}
            </span>
          )}
          {idea.signalStrength != null && (
            <span className="font-mono text-[10px] text-zinc-500 tabular-nums w-6 text-right">
              {idea.signalStrength}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-800/50">
          {idea.thesis && (
            <div className="pt-3 space-y-1">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Thesis</span>
              <p className="font-mono text-[11px] text-zinc-300 leading-relaxed">{idea.thesis}</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {entryZone && (
              <div className="space-y-0.5">
                <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Entry Zone</span>
                <p className="font-mono text-[10px] text-zinc-300">
                  {entryZone.min?.toFixed(2)} – {entryZone.max?.toFixed(2)}
                </p>
              </div>
            )}
            {targetZone && (
              <div className="space-y-0.5">
                <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Target</span>
                <p className="font-mono text-[10px] text-[#2ecc71]">
                  {targetZone.min?.toFixed(2)} – {targetZone.max?.toFixed(2)}
                </p>
              </div>
            )}
            {idea.softStop != null && (
              <div className="space-y-0.5">
                <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Stop</span>
                <p className="font-mono text-[10px] text-[#ff4b5c]">{idea.softStop.toFixed(2)}</p>
              </div>
            )}
          </div>

          {idea.catalyst && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Catalyst</span>
              <span className="font-mono text-[10px] text-primary">{idea.catalyst}</span>
              {idea.regimeFit && (
                <>
                  <span className="text-zinc-700 mx-1">·</span>
                  <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Regime Fit</span>
                  <span className="font-mono text-[10px] text-zinc-300">{idea.regimeFit}</span>
                </>
              )}
            </div>
          )}

          {idea.analystNote && (
            <div className="space-y-1">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">
                Analyst Note {idea.analystModelName && <span className="text-zinc-600">({idea.analystModelName})</span>}
              </span>
              <p className="font-mono text-[10px] text-zinc-400 leading-relaxed">{idea.analystNote}</p>
            </div>
          )}

          {idea.criticNote && (
            <div className="space-y-1">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">
                Critic Note {idea.criticModelName && <span className="text-zinc-600">({idea.criticModelName})</span>}
              </span>
              <p className="font-mono text-[10px] text-zinc-400 leading-relaxed">{idea.criticNote}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AiLabStrategistView() {
  const { aiLabStrategistConfig } = useTerminalStore();
  const [ideas, setIdeas] = useState<AiLabIdea[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncedRef = useRef(false);

  const shadow = aiLabStrategistConfig.mode === "SHADOW";

  const fetchIdeas = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/ai-lab/ideas?status=NEW,ACTIVE&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIdeas(data.ideas ?? []);
    } catch (err: any) {
      setError(err.message);
      setIdeas([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!syncedRef.current) {
      syncedRef.current = true;
      fetchWithAuth(`${API_BASE}/ai-lab/strategist-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(aiLabStrategistConfig),
      }).catch(() => {});
    }
    fetchIdeas();
    const interval = setInterval(fetchIdeas, 30_000);
    return () => clearInterval(interval);
  }, [fetchIdeas]);

  if (!aiLabStrategistConfig.enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 gap-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: "#18181B", border: "1px solid #2A2A2C" }}
        >
          <Beaker className="w-6 h-6 text-zinc-600" />
        </div>
        <div className="text-center space-y-1.5">
          <p className="font-mono text-[12px] text-zinc-400">AI Lab Strategist is disabled.</p>
          <p className="font-mono text-[10px] text-zinc-600">
            Enable it in AI Parameters to start generating ideas.
          </p>
        </div>
      </div>
    );
  }

  if (shadow) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 gap-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: "#FFB80010", border: "1px solid #FFB80030" }}
        >
          <AlertTriangle className="w-6 h-6 text-[#FFB800]" />
        </div>
        <div className="text-center space-y-1.5">
          <p className="font-mono text-[12px] text-zinc-400">Shadow Mode Active</p>
          <p className="font-mono text-[10px] text-zinc-600">
            AI Lab Strategist is running in Shadow Mode. Ideas are being generated but not surfaced.
          </p>
        </div>
      </div>
    );
  }

  if (loading && ideas.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="font-mono text-[10px] text-zinc-500">Loading AI Lab ideas...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 gap-3">
        <Shield className="w-5 h-5 text-[#ff4b5c]" />
        <p className="font-mono text-[11px] text-zinc-400">Failed to load ideas: {error}</p>
      </div>
    );
  }

  if (ideas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 gap-4">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: "#18181B", border: "1px solid #2A2A2C" }}
        >
          <Beaker className="w-6 h-6 text-zinc-600" />
        </div>
        <div className="text-center space-y-1.5">
          <p className="font-mono text-[12px] text-zinc-400">No active ideas yet.</p>
          <p className="font-mono text-[10px] text-zinc-600">
            The AI Lab pipeline will generate ideas during scheduled passes or event triggers.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">
          {ideas.length} Active Idea{ideas.length !== 1 ? "s" : ""}
        </span>
        {loading && (
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        )}
      </div>
      {ideas.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} />
      ))}
    </div>
  );
}
