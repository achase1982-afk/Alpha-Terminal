import { useEffect } from "react";
import { useTerminalStore } from "@/lib/store";
import {
  reconcileRunningStrategistJobs,
  resumeAllRunningPollers,
  openStrategistJobFromNotification,
} from "@/lib/strategistPoller";
import { installStrategistPushMessageListener } from "@/lib/strategistPushMessages";
import { readStashedStrategistPushJob } from "@/lib/strategistPushCache";
import {
  peekPendingStrategistPushJobId,
  setPendingStrategistPushJobId,
} from "@/lib/strategistPushNav";

/**
 * Keeps in-flight Strategist jobs aligned with the server when the tab sleeps
 * (iOS throttles setTimeout polling). Server work continues; we reconcile from
 * persisted history on resume, on a timer while jobs run, and when a completion
 * push arrives.
 */
export default function StrategistJobBackgroundSync() {
  useEffect(() => {
    const resumeFromServer = async (opts?: { toastOnComplete?: boolean; reconnectHint?: boolean }) => {
      await reconcileRunningStrategistJobs();
      resumeAllRunningPollers({
        toastOnComplete: opts?.toastOnComplete ?? false,
        reconnectHint: opts?.reconnectHint === true,
      });
    };

    void resumeFromServer();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void resumeFromServer({ toastOnComplete: true, reconnectHint: true });
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pageshow", onVisible);

    const interval = window.setInterval(() => {
      const jobs = useTerminalStore.getState().strategistJobs;
      const hasRunning = Object.values(jobs).some(
        (j) => j.status === "running" || j.status === "interrupted",
      );
      if (!hasRunning) return;
      void reconcileRunningStrategistJobs();
      if (document.visibilityState === "visible") {
        resumeAllRunningPollers({ toastOnComplete: false });
      }
    }, 5000);

    const unsubStore = useTerminalStore.subscribe((state, prev) => {
      const wasRunning = Object.values(prev.strategistJobs).some((j) => j.status === "running");
      const nowRunning = Object.values(state.strategistJobs).some((j) => j.status === "running");
      if (!wasRunning && nowRunning) {
        void resumeFromServer();
      }
    });

    const unsubPush = installStrategistPushMessageListener((msg) => {
      setPendingStrategistPushJobId(msg.jobId);
      window.dispatchEvent(
        new CustomEvent("strategist-push-open", {
          detail: { jobId: msg.jobId, ticker: msg.ticker },
        }),
      );
      void openStrategistJobFromNotification(msg.jobId, { ticker: msg.ticker }).then((result) => {
        if (result.ok && result.ticker) {
          useTerminalStore.getState().setSymbol(result.ticker);
        }
      });
    });

    void (async () => {
      const stashed = await readStashedStrategistPushJob();
      const jobId = stashed?.jobId ?? peekPendingStrategistPushJobId();
      if (!jobId) return;
      setPendingStrategistPushJobId(jobId);
      const result = await openStrategistJobFromNotification(jobId, { ticker: stashed?.ticker });
      if (result.ok && result.ticker) {
        useTerminalStore.getState().setSymbol(result.ticker);
      }
    })();

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.clearInterval(interval);
      unsubStore();
      unsubPush();
    };
  }, []);

  return null;
}
