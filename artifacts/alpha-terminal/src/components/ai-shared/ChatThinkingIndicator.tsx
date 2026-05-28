import { useEffect, useState } from "react";
import { chatToolActivityLabel } from "@/lib/chatStreamStore";

type ToolPill = { toolName: string; status: string };

type Props = {
  multiAgent?: boolean;
  multiAgentCount?: number;
  activityNote?: string;
  toolPills?: ToolPill[];
  orbit?: React.ReactNode;
  startedAtMs?: number;
};

function humanizeActivityNote(note: string | undefined): string {
  const raw = note?.trim() ?? "";
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "thinking") return "Working on your question…";
  if (lower === "starting analysis…") return "Starting analysis…";
  if (lower === "reconnecting…") return "Reconnecting to the server…";
  return raw;
}

function defaultSubtext(multiAgent: boolean, multiAgentCount: number): string {
  if (multiAgent && multiAgentCount > 1) {
    return `${multiAgentCount} models researching, then synthesis…`;
  }
  return "Connected — waiting for the model…";
}

/** Live “thinking” line — animated, with optional tool/status subtext (no reasoning dump). */
export function ChatThinkingIndicator({
  multiAgent = false,
  multiAgentCount = 0,
  activityNote,
  toolPills = [],
  orbit,
  startedAtMs,
}: Props) {
  const [dots, setDots] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setDots((d) => (d.length >= 3 ? "" : `${d}.`));
    }, 420);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!startedAtMs) return;
    const tick = () => setElapsedSec(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs]);

  const runningTool = toolPills.find((p) => p.status === "running");
  const humanNote = humanizeActivityNote(activityNote);
  const subtext =
    humanNote ||
    (runningTool ? chatToolActivityLabel(runningTool.toolName) : "") ||
    defaultSubtext(multiAgent, multiAgentCount);

  const longWait = elapsedSec >= 20;

  return (
    <div className="flex items-start gap-2 py-1 text-left" aria-live="polite" aria-busy="true">
      {multiAgent && orbit}
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex items-baseline gap-0.5">
          <span className="font-mono text-[14px] text-white chat-thinking-breath">thinking</span>
          <span className="font-mono text-[14px] text-white/90 chat-thinking-breath w-[1.1em]">
            {dots}
          </span>
        </div>
        {subtext ? (
          <span className="font-mono text-[11px] text-white/55 leading-snug">{subtext}</span>
        ) : null}
        {longWait ? (
          <span className="font-mono text-[10px] text-white/40 leading-snug">
            Still running ({elapsedSec}s) — Opus can take a minute on complex questions. You can stop
            and retry, or switch to a faster model.
          </span>
        ) : null}
      </div>
    </div>
  );
}
