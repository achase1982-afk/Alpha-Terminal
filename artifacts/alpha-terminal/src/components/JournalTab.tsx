import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ChevronLeft, CheckCircle2, XCircle, Clock, TrendingUp, TrendingDown, BookOpen, BarChart3, Target } from "lucide-react";

const C = {
  bg: "#0c0c0c",
  card: "#18181b",
  border: "#27272a80",
  borderHi: "#3f3f46",
  text: "#e4e4e7",
  textMuted: "#d4d4d8",
  textDim: "#a1a1aa",
  dim: "#71717a",
  gold: "#FFB800",
  green: "#00d166",
  red: "#dc2626",
  cyan: "#22d3ee",
};

const f = `'Inter','SF Pro Text',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

interface JournalEntry {
  id: number;
  schwabOrderId: string | null;
  symbol: string;
  strategyType: string | null;
  direction: string | null;
  pulseComposite: number | null;
  pulseConfidence: number | null;
  pulseBias: string | null;
  scannerScore: number | null;
  tradingMode: number | null;
  tradingModeLabel: string | null;
  eventConflicts: any;
  ivr: number | null;
  entryPrice: number | null;
  isCredit: boolean | null;
  maxLoss: number | null;
  maxGain: number | null;
  thesis: string | null;
  legs: unknown;
  quantity: number | null;
  exitPrice: number | null;
  realizedPL: number | null;
  resultNote: string | null;
  followedPlan: boolean | null;
  resultLoggedAt: string | null;
  createdAt: string;
}

interface JournalOrderLeg {
  instruction?: string;
  quantity?: number;
  symbol?: string;
  strike?: number;
  putCall?: string | null;
}

function journalOrderLegsFromEntry(raw: unknown): JournalOrderLeg[] | null {
  if (!Array.isArray(raw)) return null;
  const out: JournalOrderLeg[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    out.push({
      instruction: typeof o.instruction === "string" ? o.instruction : undefined,
      quantity: typeof o.quantity === "number" ? o.quantity : undefined,
      symbol: typeof o.symbol === "string" ? o.symbol : undefined,
      strike: typeof o.strike === "number" ? o.strike : undefined,
      putCall: typeof o.putCall === "string" ? o.putCall : o.putCall === null ? null : undefined,
    });
  }
  return out.length > 0 ? out : null;
}

interface JournalStats {
  total: number;
  withResultCount: number;
  winRate: number;
  avgPL: number;
  modeBreakdown: Record<string, { count: number; wins: number; total: number }>;
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function JournalTab() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [stats, setStats] = useState<JournalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [showLogResult, setShowLogResult] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesRes, statsRes] = await Promise.all([
        fetchWithAuth("/api/journal/entries"),
        fetchWithAuth("/api/journal/stats"),
      ]);
      if (entriesRes.ok) setEntries(await entriesRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (selectedEntry) {
    return (
      <EntryDetail
        entry={selectedEntry}
        onBack={() => { setSelectedEntry(null); fetchData(); }}
        showLogResult={showLogResult}
        setShowLogResult={setShowLogResult}
      />
    );
  }

  return (
    <div style={{ fontFamily: f }}>
      {stats && (
        <div style={{ padding: "8px 10px", borderBottom: `1px solid ${C.borderHi}`, background: "#0e0e0e" }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <StatChip label="Total Trades" value={String(stats.total)} color={C.text} />
            <StatChip label="Win Rate" value={stats.withResultCount > 0 ? `${stats.winRate.toFixed(0)}%` : "—"} color={stats.winRate >= 50 ? C.green : stats.winRate > 0 ? C.red : C.dim} />
            <StatChip label="Avg P/L" value={stats.withResultCount > 0 ? fmtCurrency(stats.avgPL) : "—"} color={stats.avgPL > 0 ? C.green : stats.avgPL < 0 ? C.red : C.dim} />
            <StatChip label="Logged" value={`${stats.withResultCount}/${stats.total}`} color={C.dim} />
          </div>
          {Object.keys(stats.modeBreakdown).length > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              {Object.entries(stats.modeBreakdown).map(([mode, data]) => (
                <span key={mode} style={{ fontSize: 10, color: C.textDim, background: "#1a1a1a", padding: "2px 6px", borderRadius: 3, fontFamily: f }}>
                  {mode}: {data.count} ({data.total > 0 ? `${((data.wins / data.total) * 100).toFixed(0)}% W` : "—"})
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: C.dim, fontSize: 13 }}>Loading journal...</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 24, textAlign: "center" }}>
          <BookOpen style={{ width: 28, height: 28, color: C.dim, margin: "0 auto 8px" }} />
          <div style={{ fontSize: 13, color: C.dim }}>No journal entries yet</div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>Entries are created automatically when you place trades through the order ticket.</div>
        </div>
      ) : (
        <div>
          {entries.map(entry => (
            <button
              key={entry.id}
              onClick={() => { setSelectedEntry(entry); setShowLogResult(false); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 10px", background: "transparent", border: "none",
                borderBottom: `1px solid ${C.border}`, cursor: "pointer", fontFamily: f, textAlign: "left",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text, fontVariantNumeric: "tabular-nums" }}>{entry.symbol}</span>
                  {entry.strategyType && (
                    <span style={{ fontSize: 10, color: C.gold, background: `${C.gold}15`, padding: "1px 5px", borderRadius: 3 }}>{entry.strategyType}</span>
                  )}
                  {entry.direction && (
                    <span style={{ fontSize: 10, color: entry.direction.includes("SELL") ? C.red : C.green }}>{entry.direction}</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                  <span style={{ fontSize: 10, color: C.dim }}>{fmtDate(entry.createdAt)}</span>
                  {entry.entryPrice != null && (
                    <span style={{ fontSize: 10, color: C.textDim }}>@ {fmtCurrency(entry.entryPrice)}</span>
                  )}
                  {entry.pulseComposite != null && (
                    <span style={{ fontSize: 10, color: C.cyan }}>Pulse {entry.pulseComposite.toFixed(0)}</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {entry.resultLoggedAt ? (
                  <div>
                    <span style={{
                      fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                      color: (entry.realizedPL ?? 0) > 0 ? C.green : (entry.realizedPL ?? 0) < 0 ? C.red : C.dim,
                    }}>
                      {entry.realizedPL != null ? fmtCurrency(entry.realizedPL) : "—"}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end", marginTop: 2 }}>
                      {entry.followedPlan ? (
                        <CheckCircle2 style={{ width: 10, height: 10, color: C.green }} />
                      ) : entry.followedPlan === false ? (
                        <XCircle style={{ width: 10, height: 10, color: C.red }} />
                      ) : null}
                      <span style={{ fontSize: 9, color: C.dim }}>LOGGED</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <Clock style={{ width: 11, height: 11, color: C.gold }} />
                    <span style={{ fontSize: 10, color: C.gold }}>OPEN</span>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.dim, textTransform: "uppercase", letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color, fontVariantNumeric: "tabular-nums", fontFamily: f }}>{value}</div>
    </div>
  );
}

function EntryDetail({
  entry,
  onBack,
  showLogResult,
  setShowLogResult,
}: {
  entry: JournalEntry;
  onBack: () => void;
  showLogResult: boolean;
  setShowLogResult: (v: boolean) => void;
}) {
  const [exitPrice, setExitPrice] = useState(entry.exitPrice?.toString() ?? "");
  const [realizedPL, setRealizedPL] = useState(entry.realizedPL?.toString() ?? "");
  const [resultNote, setResultNote] = useState(entry.resultNote ?? "");
  const [followedPlan, setFollowedPlan] = useState<boolean | null>(entry.followedPlan);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/journal/entries/${entry.id}/result`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exitPrice: exitPrice ? parseFloat(exitPrice) : null,
          realizedPL: realizedPL ? parseFloat(realizedPL) : null,
          resultNote: resultNote || null,
          followedPlan,
        }),
      });
      if (res.ok) {
        setShowLogResult(false);
        onBack();
      }
    } catch {}
    setSaving(false);
  };

  const legs = journalOrderLegsFromEntry(entry.legs);

  return (
    <div style={{ fontFamily: f }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: `1px solid ${C.borderHi}`, background: "#0e0e0e" }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2, display: "flex" }}>
          <ChevronLeft style={{ width: 16, height: 16, color: C.dim }} />
        </button>
        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{entry.symbol}</span>
        {entry.strategyType && (
          <span style={{ fontSize: 10, color: C.gold, background: `${C.gold}15`, padding: "1px 5px", borderRadius: 3 }}>{entry.strategyType}</span>
        )}
        <span style={{ fontSize: 10, color: C.dim, marginLeft: "auto" }}>{fmtDate(entry.createdAt)}</span>
      </div>

      <div style={{ padding: "0" }}>
        <DetailSection title="ENTRY">
          <DetailRow label="Direction" value={entry.direction ?? "—"} color={entry.direction?.includes("SELL") ? C.red : C.green} />
          <DetailRow label="Entry Price" value={entry.entryPrice != null ? fmtCurrency(entry.entryPrice) : "—"} />
          <DetailRow label="Quantity" value={String(entry.quantity ?? "—")} />
          <DetailRow label="Credit/Debit" value={entry.isCredit ? "CREDIT" : "DEBIT"} color={entry.isCredit ? C.green : C.red} />
          {entry.schwabOrderId && <DetailRow label="Order ID" value={entry.schwabOrderId} />}
        </DetailSection>

        {legs && legs.length > 0 && (
          <DetailSection title="LEGS">
            {legs.map((leg, i) => (
              <div key={i} style={{ padding: "4px 10px", display: "flex", justifyContent: "space-between", fontSize: 12, color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
                <span>{leg.instruction} {leg.quantity ?? 1}x</span>
                <span style={{ color: C.textDim }}>{leg.symbol} {leg.strike ? `$${leg.strike}` : ""} {leg.putCall ?? ""}</span>
              </div>
            ))}
          </DetailSection>
        )}

        <DetailSection title="CONTEXT AT ENTRY">
          {entry.pulseComposite != null && <DetailRow label="Pulse Composite" value={entry.pulseComposite.toFixed(1)} color={C.cyan} />}
          {entry.pulseConfidence != null && <DetailRow label="Pulse Confidence" value={entry.pulseConfidence.toFixed(1)} />}
          {entry.pulseBias && <DetailRow label="Pulse Bias" value={entry.pulseBias} />}
          {entry.ivr != null && <DetailRow label="IVR" value={`${entry.ivr.toFixed(1)}%`} />}
          {entry.tradingModeLabel && <DetailRow label="Trading Mode" value={entry.tradingModeLabel} />}
          {entry.eventConflicts && Array.isArray(entry.eventConflicts) && entry.eventConflicts.length > 0 && (
            <DetailRow label="Event Conflicts" value={entry.eventConflicts.map((e: any) => e.eventTitle ?? e).join(", ")} color={C.gold} />
          )}
        </DetailSection>

        {entry.thesis && (
          <DetailSection title="THESIS">
            <div style={{ padding: "6px 10px", fontSize: 12, color: C.textMuted, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{entry.thesis}</div>
          </DetailSection>
        )}

        {entry.resultLoggedAt ? (
          <DetailSection title="RESULT">
            <DetailRow label="Exit Price" value={entry.exitPrice != null ? fmtCurrency(entry.exitPrice) : "—"} />
            <DetailRow
              label="Realized P/L"
              value={entry.realizedPL != null ? fmtCurrency(entry.realizedPL) : "—"}
              color={(entry.realizedPL ?? 0) > 0 ? C.green : (entry.realizedPL ?? 0) < 0 ? C.red : C.dim}
            />
            <DetailRow label="Followed Plan" value={entry.followedPlan ? "Yes" : entry.followedPlan === false ? "No" : "—"} color={entry.followedPlan ? C.green : entry.followedPlan === false ? C.red : C.dim} />
            {entry.resultNote && <DetailRow label="Note" value={entry.resultNote} />}
          </DetailSection>
        ) : (
          <div style={{ padding: "8px 10px" }}>
            {!showLogResult ? (
              <button
                onClick={() => setShowLogResult(true)}
                style={{
                  width: "100%", padding: "10px", fontSize: 12, fontWeight: 600,
                  background: `${C.gold}15`, color: C.gold, border: `1px solid ${C.gold}40`,
                  borderRadius: 4, cursor: "pointer", fontFamily: f, letterSpacing: 0.5,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}
              >
                <Target style={{ width: 14, height: 14 }} />
                LOG RESULT
              </button>
            ) : (
              <div style={{ border: `1px solid ${C.borderHi}`, borderRadius: 4, overflow: "hidden" }}>
                <div style={{ padding: "8px 10px", background: "#0e0e0e", borderBottom: `1px solid ${C.borderHi}` }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>Log Trade Result</span>
                </div>
                <div style={{ padding: "8px 10px" }}>
                  <FormField label="Exit Price">
                    <input
                      type="number"
                      step="0.01"
                      value={exitPrice}
                      onChange={e => setExitPrice(e.target.value)}
                      placeholder="0.00"
                      style={inputStyle}
                    />
                  </FormField>
                  <FormField label="Realized P/L ($)">
                    <input
                      type="number"
                      step="0.01"
                      value={realizedPL}
                      onChange={e => setRealizedPL(e.target.value)}
                      placeholder="0.00"
                      style={inputStyle}
                    />
                  </FormField>
                  <FormField label="Followed Plan?">
                    <div style={{ display: "flex", gap: 8 }}>
                      {[true, false, null].map(val => (
                        <button
                          key={String(val)}
                          onClick={() => setFollowedPlan(val)}
                          style={{
                            flex: 1, padding: "6px 0", fontSize: 11, fontWeight: 500, fontFamily: f,
                            background: followedPlan === val ? (val === true ? `${C.green}20` : val === false ? `${C.red}20` : `${C.dim}20`) : "transparent",
                            border: `1px solid ${followedPlan === val ? (val === true ? C.green : val === false ? C.red : C.dim) : C.border}`,
                            borderRadius: 3, cursor: "pointer",
                            color: followedPlan === val ? (val === true ? C.green : val === false ? C.red : C.dim) : C.dim,
                          }}
                        >
                          {val === true ? "Yes" : val === false ? "No" : "N/A"}
                        </button>
                      ))}
                    </div>
                  </FormField>
                  <FormField label="Notes">
                    <textarea
                      value={resultNote}
                      onChange={e => setResultNote(e.target.value)}
                      placeholder="What happened? What did you learn?"
                      rows={3}
                      style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
                    />
                  </FormField>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => setShowLogResult(false)}
                      style={{ flex: 1, padding: "8px", fontSize: 12, color: C.dim, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 3, cursor: "pointer", fontFamily: f }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      style={{
                        flex: 1, padding: "8px", fontSize: 12, fontWeight: 600, fontFamily: f,
                        color: "#000", background: C.gold, border: "none", borderRadius: 3, cursor: "pointer",
                        opacity: saving ? 0.5 : 1,
                      }}
                    >
                      {saving ? "Saving..." : "Save Result"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ padding: "6px 10px", background: "#0e0e0e", borderBottom: `1px solid ${C.borderHi}` }}>
        <span style={{ fontSize: 10, fontWeight: 500, color: C.dim, letterSpacing: 1, textTransform: "uppercase" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 10px", borderBottom: `1px solid ${C.border}`, fontFamily: f }}>
      <span style={{ fontSize: 12, color: C.dim }}>{label}</span>
      <span style={{ fontSize: 12, color: color ?? C.textMuted, fontVariantNumeric: "tabular-nums", maxWidth: "60%", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: "block", fontSize: 10, color: C.dim, marginBottom: 4, letterSpacing: 0.5, textTransform: "uppercase" }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 8px",
  fontSize: 13,
  fontFamily: f,
  color: C.text,
  background: "#1a1a1e",
  border: `1px solid ${C.border}`,
  borderRadius: 3,
  outline: "none",
  boxSizing: "border-box",
};
