import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { JournalScreen } from "./journal/JournalScreen";
import type { InsightsPayload, JournalPeriod, JournalView } from "./journal/journalModel";

export function JournalTab(props: {
  period?: JournalPeriod;
  onPeriod?: (period: JournalPeriod) => void;
  accountId?: string;
  onAccount?: (accountId: string) => void;
} = {}) {
  const [periodState, setPeriodState] = useState<JournalPeriod>(props.period ?? "ytd");
  const [accountState, setAccountState] = useState(props.accountId ?? "all_live");
  const period = props.period ?? periodState;
  const accountId = props.accountId ?? accountState;
  const setPeriod = props.onPeriod ?? setPeriodState;
  const setAccount = props.onAccount ?? setAccountState;
  const [view, setView] = useState<JournalView>("insights");
  const [strategy, setStrategy] = useState<string | null>(null);
  const [payload, setPayload] = useState<InsightsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const periodRef = useRef(period);
  const accountRef = useRef(accountId);
  periodRef.current = period;
  accountRef.current = accountId;

  const load = useCallback(async (next: JournalPeriod, account: string) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/journal/insights?period=${next}&accountId=${encodeURIComponent(account)}`);
      if (seq !== requestSeq.current) return;
      if (!res.ok) throw new Error("unavailable");
      const body = await res.json() as InsightsPayload;
      if (seq !== requestSeq.current) return;
      setPayload(body);
    } catch {
      if (seq !== requestSeq.current) return;
      setError("Journal is unavailable right now.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period, accountId);
  }, [load, period, accountId]);

  useEffect(() => {
    let cancel = false;
    void fetchWithAuth("/api/journal/sync", { method: "POST" }).then(async (res) => {
      const body = await res.json().catch(() => ({} as { status?: string }));
      if (cancel) return;
      const status = body.status ?? (res.status === 401 ? "no_token" : res.ok ? "ok" : "failed");
      if (status === "failed") setSyncNote("Sync failed");
      else if (status === "no_token") setSyncNote("Sync needs a connection");
      else setSyncNote(null);
      if (status === "ok") void load(periodRef.current, accountRef.current);
    }).catch(() => {
      if (!cancel) setSyncNote("Sync failed");
    });
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
      onRetry={() => void load(period, accountId)}
      accountId={accountId}
      onAccount={setAccount}
      syncNote={syncNote}
      onImportCsv={async (input) => {
        const res = await fetchWithAuth("/api/journal/import-csv", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const body = await res.json().catch(() => ({} as { error?: string; importedTrades?: number; skippedDuplicates?: number }));
        if (!res.ok || body.importedTrades == null || body.skippedDuplicates == null) return { error: "Import failed" };
        void load(period, accountId);
        return { importedTrades: body.importedTrades, skippedDuplicates: body.skippedDuplicates };
      }}
    />
  );
}
