import { useMemo, useState } from "react";

interface SavedTurn {
  id?: string;
  round: 1 | 2 | 3 | "synthesis";
  role: "A" | "B" | "synthesis" | "system";
  phase: string;
  model: string;
  label: string;
  text: string;
}

const ROLE_STYLE: Record<string, { fg: string; label: string }> = {
  A: { fg: "#FFB800", label: "Bull Case" },
  B: { fg: "#26C6DA", label: "Bear Case" },
  synthesis: { fg: "#00D166", label: "Recommendation" },
  system: { fg: "#BA82FF", label: "Verdict" },
};

function formatTurnText(raw: string): string {
  if (!raw) return "";
  const stripped = raw.replace(/^```(json)?/i, "").replace(/```\s*$/i, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) return raw;
  try {
    const obj = JSON.parse(stripped.slice(start, end + 1));
    return JSON.stringify(obj, null, 2);
  } catch {
    return raw;
  }
}

function phaseLabel(phase: string, round: 1 | 2 | 3 | "synthesis", role: string): string {
  if (role === "system" && phase === "info") return "Verdict";
  if (round === "synthesis") return "Phase 3 · Senior PM Arbitration";
  if (round === 3 && phase === "propose") return "Phase 2 · R3 · Structure Vote";
  if (phase === "propose") return `Phase 1 · R${round} · Pitch`;
  if (phase === "critique") return `Phase 1 · R${round} · Rebut`;
  if (phase === "final") return "Phase 3 · Trade Build";
  return phase;
}

function roundHeader(round: 1 | 2 | 3 | "synthesis"): string {
  if (round === "synthesis") return "Phase 3 — Senior PM Arbitration (Final Trade)";
  if (round === 1) return "Phase 1 — Round 1 (Directional Pitch)";
  if (round === 2) return "Phase 1 — Round 2 (Rebuttal & Verdict)";
  return "Phase 2 — Round 3 (Trade Structure Vote)";
}

/**
 * Read-only debate transcript for the history view. Renders saved turns
 * inside a collapsible bar that defaults to collapsed; click to expand
 * and see the full JSON conversation that produced the saved trade card.
 */
export function HistoryDebateTranscript({ transcript }: { transcript: SavedTurn[] }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const groups = useMemo(() => {
    const m = new Map<1 | 2 | 3 | "synthesis", SavedTurn[]>();
    for (const t of transcript) {
      if (!m.has(t.round)) m.set(t.round, []);
      (m.get(t.round) as SavedTurn[]).push(t);
    }
    return Array.from(m.entries());
  }, [transcript]);

  const summary = useMemo(() => {
    const turnCount = transcript.length;
    const verdictTurn = [...transcript].reverse().find((t) => t.role === "system" && t.phase === "info");
    let verdict: string | null = null;
    if (verdictTurn) {
      try {
        const parsed = JSON.parse(verdictTurn.text.replace(/^```(json)?/i, "").replace(/```\s*$/i, "").trim());
        if (parsed && typeof parsed.verdict === "string") verdict = parsed.verdict;
      } catch {
        /* noop */
      }
    }
    if (turnCount === 0) return "no turns";
    if (verdict) return `${verdict} · ${turnCount} turns`;
    return `${turnCount} turns`;
  }, [transcript]);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Institutional copy payload — strip role/phase/label/model attribution.
    // Full attribution is preserved in the strategist_telemetry table and the
    // direct API endpoint; the user-facing copy is just round + content.
    const payload = transcript.map((t) => ({
      round: t.round,
      text: formatTurnText(t.text),
    }));
    const text = JSON.stringify(payload, null, 2);
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* noop */
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
        fallback,
      );
    } else {
      fallback();
    }
  };

  if (transcript.length === 0) return null;

  return (
    <div
      className="rounded-lg overflow-hidden mb-2"
      style={{ background: "#0c0c0e", border: "1px solid rgba(255,184,0,0.18)" }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: expanded ? "1px solid rgba(255,255,255,0.06)" : "none" }}
      >
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-label={expanded ? "Collapse debate transcript" : "Expand debate transcript"}
        >
          <span className="font-mono text-[11px] text-[#FFB800] leading-none">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#FFB800]">
            Bull · Bear Debate
          </span>
          <span className="font-mono text-[10px] text-[#888] truncate">· {summary}</span>
        </button>
        <button
          onClick={handleCopy}
          className="font-mono text-[10px] uppercase tracking-wider px-2 py-1 rounded transition-colors shrink-0"
          style={{
            background: copied ? "rgba(0,209,102,0.15)" : "rgba(255,184,0,0.10)",
            border: `1px solid ${copied ? "rgba(0,209,102,0.5)" : "rgba(255,184,0,0.4)"}`,
            color: copied ? "#00D166" : "#FFB800",
          }}
        >
          {copied ? "✓ Copied" : "⧉ Copy JSON"}
        </button>
      </div>
      {expanded && (
        <div className="p-4 max-h-[480px] overflow-y-auto space-y-4">
          {groups.map(([round, turns], gi) => (
            <div key={String(round)} className="space-y-3">
              <div
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#888]"
                style={{
                  paddingTop: gi === 0 ? 0 : 8,
                  borderTop: gi === 0 ? "none" : "1px dashed rgba(255,255,255,0.08)",
                }}
              >
                {roundHeader(round)}
              </div>
              {turns.map((t, ti) => {
                const style = ROLE_STYLE[t.role] ?? { fg: "#999", label: "·" };
                return (
                  <div key={t.id ?? `${round}-${ti}`} className="pl-3" style={{ borderLeft: `2px solid ${style.fg}` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: style.fg }}>
                        {style.label}
                      </span>
                      <span className="ml-auto font-mono text-[9px] text-[#666]">{phaseLabel(t.phase, t.round, t.role)}</span>
                    </div>
                    <pre className="font-mono text-[11px] leading-[1.55] text-[#ddd] whitespace-pre-wrap break-words m-0">
                      {formatTurnText(t.text) || <span className="text-[#666]">(no output)</span>}
                    </pre>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
