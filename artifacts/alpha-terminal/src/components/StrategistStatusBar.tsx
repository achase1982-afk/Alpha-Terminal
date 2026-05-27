import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTerminalStore } from "@/lib/store";

type ActiveJob = {
  jobId: string;
  ticker: string;
  kind: "analyze" | "validate_trade";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: string | null;
  progress?: { debateTurn?: number; expectedTurns?: number };
  queuePosition?: number;
  startedAt: string | null;
  completedAt: string | null;
  error?: { code: string; message: string } | null;
};

function phaseLabel(job: ActiveJob): string {
  if (job.status === "queued") {
    return job.queuePosition != null ? `queued (${job.queuePosition}${job.queuePosition === 1 ? "st" : "th"} in line)` : "queued";
  }
  if (job.status === "completed") return "ready";
  if (job.status === "failed") return "failed";
  if (job.status === "cancelled") return "cancelled";
  switch (job.phase) {
    case "preparing_iv":
      return "preparing IV";
    case "debating": {
      const turn = job.progress?.debateTurn;
      const expected = job.progress?.expectedTurns;
      return turn != null && expected != null ? `debating ${turn}/${expected}` : "debating";
    }
    case "analyzing":
      return "analyzing";
    case "validating":
      return "validating";
    default:
      return job.phase ?? "running";
  }
}

export default function StrategistStatusBar() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const setSymbol = useTerminalStore((s) => s.setSymbol);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetchWithAuth("/api/strategist/jobs/active");
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as { active?: ActiveJob[] };
        if (Array.isArray(json.active)) {
          setJobs(json.active);
        }
      } catch {
        // keep last known state
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (jobs.length === 0) return null;

  const activeCount = jobs.filter((j) => j.status === "queued" || j.status === "running").length;
  const headline =
    activeCount > 0
      ? `${activeCount} ${activeCount === 1 ? "analysis" : "analyses"} active`
      : "Recent strategist jobs";

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-700/80 bg-zinc-950/95 backdrop-blur-sm px-3 py-2 text-xs font-mono text-zinc-200"
      role="status"
      aria-live="polite"
    >
      <div className="max-w-screen-2xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-zinc-400 shrink-0">{headline}:</span>
        {jobs.map((job) => (
          <button
            key={job.jobId}
            type="button"
            className="text-emerald-400/90 hover:text-emerald-300 underline-offset-2 hover:underline"
            onClick={() => {
              setSymbol(job.ticker);
              window.dispatchEvent(
                new CustomEvent("strategist-push-open", {
                  detail: { jobId: job.jobId, ticker: job.ticker },
                }),
              );
            }}
          >
            {job.ticker} ({phaseLabel(job)})
          </button>
        ))}
      </div>
    </div>
  );
}
