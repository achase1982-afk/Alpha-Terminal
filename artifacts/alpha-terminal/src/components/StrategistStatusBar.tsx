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

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function phaseLabel(job: ActiveJob): string {
  if (job.status === "queued") {
    if (job.queuePosition == null || job.queuePosition <= 1) {
      return "starting";
    }
    return `queued (${ordinal(job.queuePosition)} in line)`;
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

/** Inline strip above the bottom nav — not fixed, so it does not cover scrollable content. */
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
      className="shrink-0 border-t border-zinc-700/90 bg-zinc-950 px-3 py-2.5 sm:py-2 text-[13px] sm:text-xs font-mono text-zinc-100 z-50"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-x-3 gap-y-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <span className="text-zinc-400 shrink-0 text-[11px] sm:text-xs uppercase tracking-wide">
          {headline}
        </span>
        {jobs.map((job) => (
          <button
            key={job.jobId}
            type="button"
            className="shrink-0 text-emerald-400 hover:text-emerald-300 underline-offset-2 hover:underline whitespace-nowrap"
            onClick={() => {
              setSymbol(job.ticker);
              window.dispatchEvent(
                new CustomEvent("strategist-push-open", {
                  detail: { jobId: job.jobId, ticker: job.ticker },
                }),
              );
            }}
          >
            {job.ticker} · {phaseLabel(job)}
          </button>
        ))}
      </div>
    </div>
  );
}
