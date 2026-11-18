import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { JournalScreen } from "./journal/JournalScreen";
import type { InsightsPayload, JournalPeriod, JournalView } from "./journal/journalModel";

export function JournalTab() {
  const [period, setPeriod] = useState<JournalPeriod>("ytd");
  const [view, setView] = useState<JournalView>("insights");
  const [strategy, setStrategy] = useState<string | null>(null);
  const [payload, setPayload] = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const periodRef = useRef(period);
  periodRef.current = period;

  const load = useCallback(async (next: JournalPeriod) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/journal/insights?period=${next}`);
      if (!res.ok) throw new Error("unavailable");
      const body = await res.json() as InsightsPayload;
      setPayload(body);
    } catch {
      setError("Journal is unavailable right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  useEffect(() => {
    let cancel = false;
    void fetchWithAuth("/api/journal/sync", { method: "POST" }).then((res) => {
      if (res.ok && !cancel) void load(periodRef.current);
    }).catch(() => {});
    return () => {
      cancel = true;
    };
  }, [load]);

  return (
    <JournalScreen
      payload={payload}
      loading={loading}
      error={error}
      period={period}
      onPeriod={setPeriod}
      view={view}
      onView={setView}
      strategy={strategy}
      onStrategy={setStrategy}
      onRetry={() => void load(period)}
    />
  );
}
