import { useState, useEffect, useCallback, useRef } from "react";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  TrendingUp, TrendingDown, Clock, Shield, ChevronDown, ChevronUp, Beaker, XCircle,
} from "lucide-react";

const API_BASE = "/api";

interface PrimaryProposal {
  thesis: string;
  structure: string;
  riskNotes: string;
}

interface SkepticCritique {
  objections: string;
  evidence: string;
  suggestedChanges: string;
}

interface FinalDecision {
  decision: "PROCEED" | "MODIFIED" | "REJECT";
  finalStructure: string;
  resolutionRationale: string;
}

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
  primaryProposal: PrimaryProposal | null;
  skepticCritique: SkepticCritique | null;
  finalDecision: FinalDecision | null;
}

interface ConversationTurn {
  round: number;
  role: "analyst" | "skeptic";
  timestamp: string;
  content: Record<string, unknown>;
}

interface DeliberationLog {
  totalRounds: number;
  reachedConsensus: boolean;
  turns: ConversationTurn[];
  consensusSummary: string;
}

interface AiLabDeliberation {
  id: number;
  symbol: string;
  source: string;
  createdAt: string;
  analystModelName: string | null;
  criticModelName: string | null;
  primaryProposal: PrimaryProposal | null;
  skepticCritique: SkepticCritique | null;
  finalDecision: FinalDecision | null;
  ideaId: number | null;
  conversationLog: DeliberationLog | null;
}

type ViewFilter = "shown" | "rejected" | "all";

const DECISION_COLORS: Record<string, string> = {
  PROCEED: "#2ecc71",
  MODIFIED: "#FFB800",
  REJECT: "#ff4b5c",
};

function AnalystReport({
  primaryProposal,
  skepticCritique,
  finalDecision,
  analystModelName,
  criticModelName,
  conversationLog,
}: {
  primaryProposal: PrimaryProposal | null;
  skepticCritique: SkepticCritique | null;
  finalDecision: FinalDecision | null;
  analystModelName?: string | null;
  criticModelName?: string | null;
  conversationLog?: DeliberationLog | null;
}) {
  const [open, setOpen] = useState(false);
  if (!primaryProposal && !skepticCritique && !finalDecision) return null;

  const hasMultiRound = conversationLog && conversationLog.totalRounds > 1 && conversationLog.turns.length > 2;

  return (
    <div className="mt-2 rounded-lg overflow-hidden" style={{ border: "1px solid #2A2A2C" }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="w-full flex items-center justify-between px-3 py-2 cursor-pointer transition-colors"
        style={{ background: "#0d0d0f" }}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">Analyst Report</span>
          {conversationLog && conversationLog.totalRounds > 1 && (
            <span className="font-mono text-[9px] px-1.5 py-0.5 rounded" style={{ color: "#c084fc", background: "#c084fc15" }}>
              {conversationLog.totalRounds} rounds
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-3 h-3 text-zinc-500" /> : <ChevronDown className="w-3 h-3 text-zinc-500" />}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3" style={{ background: "#0d0d0f" }}>
          {primaryProposal && (
            <div className="space-y-2 pt-2">
              <span className="font-mono text-[9px] font-bold text-zinc-300 uppercase tracking-widest">
                {hasMultiRound ? "Round 1 — " : ""}Analyst {analystModelName ? <span className="text-zinc-500 normal-case">({analystModelName})</span> : ""}
              </span>
              <ReportRow label="Thesis" value={primaryProposal.thesis} />
              <ReportRow label="Structure" value={primaryProposal.structure} />
              <ReportRow label="Risk Notes" value={primaryProposal.riskNotes} />
            </div>
          )}

          {skepticCritique && (
            <div className="space-y-2 pt-1">
              <div className="h-px bg-zinc-800" />
              <span className="font-mono text-[9px] font-bold uppercase tracking-widest" style={{ color: "#c084fc" }}>
                {hasMultiRound ? "Round 1 — " : ""}Skeptic {criticModelName ? <span className="text-zinc-500 normal-case">({criticModelName})</span> : ""}
              </span>
              <ReportRow label="Objections" value={skepticCritique.objections} color="#c084fc" />
              <ReportRow label="Evidence" value={skepticCritique.evidence} />
              <ReportRow label="Suggested Changes" value={skepticCritique.suggestedChanges} color="#FFB800" />
            </div>
          )}

          {hasMultiRound && conversationLog.turns.filter(t => t.round > 1).map((turn, idx) => (
            <div key={idx} className="space-y-2 pt-1">
              <div className="h-px bg-zinc-800" />
              {turn.role === "analyst" ? (
                <>
                  <span className="font-mono text-[9px] font-bold text-zinc-300 uppercase tracking-widest">
                    Round {turn.round} — Analyst Rebuttal
                  </span>
                  {turn.content.concessions && (
                    <ReportRow label="Concessions" value={String(turn.content.concessions)} color="#FFB800" />
                  )}
                  {turn.content.changesFromPrevious && (
                    <ReportRow label="Changes Made" value={String(turn.content.changesFromPrevious)} />
                  )}
                  {turn.content.note && (
                    <ReportRow label="Rebuttal" value={String(turn.content.note)} />
                  )}
                  {turn.content.structure && (
                    <ReportRow label="Revised Structure" value={String(turn.content.structure)} />
                  )}
                  {turn.content.agreesWithSkeptic && (
                    <p className="font-mono text-[11px] leading-relaxed" style={{ color: "#FFB800" }}>Analyst conceded to skeptic's position</p>
                  )}
                </>
              ) : (
                <>
                  <span className="font-mono text-[9px] font-bold uppercase tracking-widest" style={{ color: "#c084fc" }}>
                    Round {turn.round} — Skeptic Re-evaluation
                    {turn.content.critiqueScore != null && (
                      <span className="text-zinc-500 normal-case"> (score: {String(turn.content.critiqueScore)})</span>
                    )}
                  </span>
                  {turn.content.objections && (
                    <ReportRow label="Objections" value={String(turn.content.objections)} color="#c084fc" />
                  )}
                  {turn.content.remainingConcerns && (
                    <ReportRow label="Remaining Concerns" value={String(turn.content.remainingConcerns)} />
                  )}
                  {turn.content.suggestedChanges && (
                    <ReportRow label="Further Changes" value={String(turn.content.suggestedChanges)} color="#FFB800" />
                  )}
                  {turn.content.satisfiedWithChanges && (
                    <p className="font-mono text-[11px] leading-relaxed" style={{ color: "#2ecc71" }}>Skeptic satisfied with changes</p>
                  )}
                </>
              )}
            </div>
          ))}

          {conversationLog?.consensusSummary && (
            <div className="space-y-1 pt-1">
              <div className="h-px bg-zinc-800" />
              <span className="font-mono text-[9px] font-bold text-zinc-300 uppercase tracking-widest">Consensus</span>
              <p className="font-mono text-[11px] text-zinc-200 leading-relaxed">{conversationLog.consensusSummary}</p>
            </div>
          )}

          {finalDecision && (
            <div className="space-y-2 pt-1">
              <div className="h-px bg-zinc-800" />
              <span className="font-mono text-[9px] font-bold text-zinc-300 uppercase tracking-widest">Final Decision</span>
              <div className="flex items-center gap-2">
                <span
                  className="font-mono text-[10px] font-bold px-2 py-0.5 rounded"
                  style={{
                    color: DECISION_COLORS[finalDecision.decision] ?? "#71717a",
                    background: `${DECISION_COLORS[finalDecision.decision] ?? "#71717a"}15`,
                  }}
                >
                  {finalDecision.decision}
                </span>
                {finalDecision.finalStructure && (
                  <span className="font-mono text-[10px] text-zinc-400">{finalDecision.finalStructure}</span>
                )}
              </div>
              {finalDecision.resolutionRationale && (
                <p className="font-mono text-[11px] text-zinc-200 leading-relaxed">{finalDecision.resolutionRationale}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReportRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="space-y-0.5">
      <span className="font-mono text-[9px] text-zinc-500 uppercase tracking-widest">{label}</span>
      <p className="font-mono text-[11px] leading-relaxed" style={{ color: color ?? "#e4e4e7" }}>{value}</p>
    </div>
  );
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
              {idea.finalDecision && (
                <span
                  className="font-mono text-[8px] px-1.5 py-0.5 rounded"
                  style={{
                    color: DECISION_COLORS[idea.finalDecision.decision] ?? "#71717a",
                    background: `${DECISION_COLORS[idea.finalDecision.decision] ?? "#71717a"}10`,
                  }}
                >
                  {idea.finalDecision.decision}
                </span>
              )}
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

          <AnalystReport
            primaryProposal={idea.primaryProposal}
            skepticCritique={idea.skepticCritique}
            finalDecision={idea.finalDecision}
            analystModelName={idea.analystModelName}
            criticModelName={idea.criticModelName}
          />
        </div>
      )}
    </div>
  );
}

function DeliberationCard({ deliberation }: { deliberation: AiLabDeliberation }) {
  const [expanded, setExpanded] = useState(false);
  const fd = deliberation.finalDecision;

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "#111113", border: "1px solid #2A2A2C" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between cursor-pointer active:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "#ff4b5c15", border: "1px solid #ff4b5c30" }}
          >
            <XCircle className="w-4 h-4 text-[#ff4b5c]" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] text-white font-bold">{deliberation.symbol}</span>
              <span className="font-mono text-[9px] font-bold px-1.5 py-0.5 rounded text-[#ff4b5c] bg-[#ff4b5c15]">
                REJECTED
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-[9px] text-zinc-500">{deliberation.source}</span>
              <span className="text-zinc-700">·</span>
              <span className="font-mono text-[9px] text-zinc-600">
                {new Date(deliberation.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {fd && (
            <span className="font-mono text-[9px] text-zinc-500 text-right max-w-[120px] truncate">
              {fd.resolutionRationale?.slice(0, 40)}…
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
        <div className="px-4 pb-4 border-t border-zinc-800/50">
          <AnalystReport
            primaryProposal={deliberation.primaryProposal}
            skepticCritique={deliberation.skepticCritique}
            finalDecision={deliberation.finalDecision}
            analystModelName={deliberation.analystModelName}
            criticModelName={deliberation.criticModelName}
            conversationLog={deliberation.conversationLog}
          />
        </div>
      )}
    </div>
  );
}

export function AiLabStrategistView() {
  const { aiLabStrategistConfig, setAiLabStrategistConfig } = useTerminalStore();
  const [ideas, setIdeas] = useState<AiLabIdea[]>([]);
  const [deliberations, setDeliberations] = useState<AiLabDeliberation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewFilter>("shown");
  const syncedRef = useRef(false);

  const fetchData = useCallback(async (currentFilter: ViewFilter) => {
    setLoading(true);
    setError(null);
    try {
      if (currentFilter === "shown") {
        const res = await fetchWithAuth(`${API_BASE}/ai-lab/ideas?status=NEW,ACTIVE&limit=50`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setIdeas(data.ideas ?? []);
        setDeliberations([]);
      } else if (currentFilter === "rejected") {
        const res = await fetchWithAuth(`${API_BASE}/ai-lab/deliberations?decision=REJECT&limit=50`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setDeliberations(data.deliberations ?? []);
        setIdeas([]);
      } else {
        const [ideasRes, delibRes] = await Promise.all([
          fetchWithAuth(`${API_BASE}/ai-lab/ideas?status=NEW,ACTIVE&limit=50`),
          fetchWithAuth(`${API_BASE}/ai-lab/deliberations?limit=50`),
        ]);
        if (!ideasRes.ok) throw new Error(`HTTP ${ideasRes.status}`);
        if (!delibRes.ok) throw new Error(`HTTP ${delibRes.status}`);
        const [ideasData, delibData] = await Promise.all([ideasRes.json(), delibRes.json()]);
        setIdeas(ideasData.ideas ?? []);
        setDeliberations(delibData.deliberations?.filter((d: AiLabDeliberation) => d.ideaId == null) ?? []);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!syncedRef.current) {
      syncedRef.current = true;
      fetchWithAuth(`${API_BASE}/ai-lab/config`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data?.config) return;
          const cfg = data.config;
          if (cfg.analystModelProvider) setAiLabStrategistConfig("analystModelProvider", cfg.analystModelProvider);
          if (cfg.analystModelName) setAiLabStrategistConfig("analystModelName", cfg.analystModelName);
          if (cfg.skepticModelProvider) setAiLabStrategistConfig("skepticModelProvider", cfg.skepticModelProvider);
          if (cfg.skepticModelName) setAiLabStrategistConfig("skepticModelName", cfg.skepticModelName);
        })
        .catch(() => {});
    }
    fetchData(filter);
    const interval = setInterval(() => fetchData(filter), 30_000);
    return () => clearInterval(interval);
  }, [fetchData, filter, setAiLabStrategistConfig]);

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

  if (loading && ideas.length === 0 && deliberations.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="font-mono text-[10px] text-zinc-500">Loading...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6 gap-3">
        <Shield className="w-5 h-5 text-[#ff4b5c]" />
        <p className="font-mono text-[11px] text-zinc-400">Failed to load: {error}</p>
      </div>
    );
  }

  const filterOptions: { value: ViewFilter; label: string }[] = [
    { value: "shown", label: "Shown" },
    { value: "rejected", label: "Rejected" },
    { value: "all", label: "All" },
  ];

  const hasItems = ideas.length > 0 || deliberations.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className="px-2.5 py-1 rounded font-mono text-[9px] tracking-wider transition-colors cursor-pointer"
              style={{
                background: filter === opt.value ? "#FFB80015" : "transparent",
                color: filter === opt.value ? "#FFB800" : "#71717a",
                border: `1px solid ${filter === opt.value ? "#FFB80040" : "#2A2A2C"}`,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {loading && (
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        )}
      </div>

      {!hasItems && !loading && (
        <div className="flex flex-col items-center justify-center py-12 px-6 gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "#18181B", border: "1px solid #2A2A2C" }}
          >
            <Beaker className="w-6 h-6 text-zinc-600" />
          </div>
          <div className="text-center space-y-1.5">
            <p className="font-mono text-[12px] text-zinc-400">
              {filter === "shown" && "No active ideas yet."}
              {filter === "rejected" && "No rejected evaluations yet."}
              {filter === "all" && "No evaluations yet."}
            </p>
            <p className="font-mono text-[10px] text-zinc-600">
              The AI Lab pipeline generates ideas during scheduled passes or event triggers.
            </p>
          </div>
        </div>
      )}

      {ideas.map((idea) => (
        <IdeaCard key={idea.id} idea={idea} />
      ))}

      {deliberations.map((d) => (
        <DeliberationCard key={d.id} deliberation={d} />
      ))}
    </div>
  );
}
