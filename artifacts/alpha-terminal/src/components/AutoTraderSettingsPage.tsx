import { useCallback, useEffect, useRef, useState } from "react";
import { Power, PlayCircle, X, Plus, Loader2, AlertTriangle, ShieldAlert, Activity } from "lucide-react";
import { AI_MODEL_CATALOG } from "@workspace/ai-models";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useSchwabAccountStore } from "@/lib/schwab-account-store";

type InstrumentMode = "stock" | "options" | "both";

interface AutoTradeConfig {
  enabled: boolean;
  running: boolean;
  accountHash: string | null;
  modelId: string;
  tickers: string[];
  instrumentMode: InstrumentMode;
  totalBudget: number;
  maxPerTrade: number;
  dailyMaxLoss: number;
  pollIntervalSec: number;
  enableExtendedHours: boolean;
  flattenAtClose: boolean;
}

interface DecisionRow {
  id: number;
  ticker: string;
  decision: string;
  instrument: string | null;
  quantity: number | null;
  notional: number | null;
  reasoning: string | null;
  placed: boolean;
  error: string | null;
  createdAt: string;
}

const INSTRUMENT_OPTIONS: { value: InstrumentMode; label: string }[] = [
  { value: "stock", label: "Stocks only" },
  { value: "both", label: "Both — LLM decides" },
  { value: "options", label: "Options only" },
];

const inputCls =
  "w-full bg-[#0c0c0c] border border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-mono text-[#fafafa] tabular-nums focus:border-[#f5a623] focus:outline-none disabled:opacity-50";
const selectCls =
  "w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-mono text-white hover:border-[#f5a623] focus:border-[#f5a623] focus:outline-none disabled:opacity-40";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-300">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-zinc-500 font-mono leading-relaxed">{hint}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${checked ? "bg-[#f5a623]" : "bg-zinc-700"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

async function saveConfig(patch: Partial<AutoTradeConfig>): Promise<AutoTradeConfig | null> {
  try {
    const res = await fetchWithAuth("/api/auto-trade/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { config: AutoTradeConfig };
    return data.config;
  } catch {
    return null;
  }
}

export function AutoTraderSettingsPage() {
  const accounts = useSchwabAccountStore((s) => s.accounts);
  const defaultTradingAccountHash = useSchwabAccountStore((s) => s.defaultTradingAccountHash);

  const [config, setConfig] = useState<AutoTradeConfig | null>(null);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickerInput, setTickerInput] = useState("");

  // String state for number inputs so the user can clear and retype freely.
  const [nums, setNums] = useState({ totalBudget: "", maxPerTrade: "", dailyMaxLoss: "", pollIntervalSec: "" });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshConfig = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/auto-trade/config");
      if (res.ok) {
        const data = (await res.json()) as { config: AutoTradeConfig };
        setConfig(data.config);
        setNums({
          totalBudget: String(data.config.totalBudget),
          maxPerTrade: String(data.config.maxPerTrade),
          dailyMaxLoss: String(data.config.dailyMaxLoss),
          pollIntervalSec: String(data.config.pollIntervalSec),
        });
      }
    } catch {
      setError("Failed to load config.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshDecisions = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/auto-trade/decisions");
      if (res.ok) setDecisions((await res.json()) as DecisionRow[]);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    void refreshConfig();
    void refreshDecisions();
  }, [refreshConfig, refreshDecisions]);

  // Auto-save the default account hash as soon as we have both config and the store.
  useEffect(() => {
    if (!config || config.accountHash || !defaultTradingAccountHash) return;
    void saveConfig({ accountHash: defaultTradingAccountHash }).then((saved) => {
      if (saved) setConfig(saved);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.accountHash, defaultTradingAccountHash]);

  // Poll while running.
  useEffect(() => {
    if (!config?.running) return;
    const id = setInterval(() => {
      void refreshConfig();
      void refreshDecisions();
    }, 10_000);
    return () => clearInterval(id);
  }, [config?.running, refreshConfig, refreshDecisions]);

  // Debounced save for number inputs.
  const debouncedSave = useCallback((patch: Partial<AutoTradeConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const saved = await saveConfig(patch);
      if (!saved) setError("Save failed — check your connection.");
    }, 600);
  }, []);

  // Immediate save for toggles and dropdowns.
  const immediateSave = useCallback(async (patch: Partial<AutoTradeConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
    const saved = await saveConfig(patch);
    if (!saved) setError("Save failed — check your connection.");
  }, []);

  const addTicker = useCallback(() => {
    const sym = tickerInput.trim().toUpperCase();
    if (!sym || !config || config.tickers.includes(sym)) { setTickerInput(""); return; }
    void immediateSave({ tickers: [...config.tickers, sym] });
    setTickerInput("");
  }, [tickerInput, config, immediateSave]);

  const removeTicker = useCallback((sym: string) => {
    if (!config) return;
    void immediateSave({ tickers: config.tickers.filter((t) => t !== sym) });
  }, [config, immediateSave]);

  const handleStart = useCallback(async () => {
    // Flush any pending debounced save first.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/auto-trade/start", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(startErrorLabel(body.error));
      } else {
        await refreshConfig();
      }
    } catch {
      setError("Failed to start.");
    } finally {
      setBusy(false);
    }
  }, [refreshConfig]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/auto-trade/stop", { method: "POST" });
      if (res.ok) {
        const body = (await res.json()) as { cancelledOrders?: number };
        if (body.cancelledOrders) setError(`Stopped. Cancelled ${body.cancelledOrders} working order(s).`);
        await refreshConfig();
      }
    } catch {
      setError("Failed to stop.");
    } finally {
      setBusy(false);
    }
  }, [refreshConfig]);

  if (loading || !config) {
    return (
      <div className="max-w-xl mx-auto flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-[#f5a623]" />
      </div>
    );
  }

  const running = config.running;
  const placedToday = decisions.filter((d) => d.placed).length;
  const validAccounts = accounts.filter((a) => a.hashValue);

  return (
    <div className="max-w-xl mx-auto space-y-5 pb-8">

      {/* Status bar */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-lg border"
        style={{
          borderColor: running ? "rgba(46,204,113,0.4)" : "#3f3f46",
          background: running ? "rgba(46,204,113,0.08)" : "#0c0c0c",
        }}
      >
        <Activity className={`w-5 h-5 ${running ? "text-[#2ecc71]" : "text-zinc-500"}`} />
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm text-white tracking-wide">
            {running ? "AUTO-TRADER ACTIVE" : "AUTO-TRADER IDLE"}
          </div>
          <div className="text-[10px] font-mono text-zinc-400">
            {running
              ? `Monitoring ${config.tickers.length} symbol(s) · ${placedToday} order(s) placed today`
              : "Configure below, then press START."}
          </div>
        </div>
        {running ? (
          <button
            onClick={handleStop}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-white bg-[#f23645] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />} KILL
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-black bg-[#FFB800] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />} START
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/20 border border-amber-500/30">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <span className="font-mono text-[11px] text-amber-300">{error}</span>
        </div>
      )}

      {/* Account + model */}
      <div className="border border-zinc-800 rounded-lg p-4 space-y-4 bg-zinc-900/30">
        <Field label="Trading Account" hint="Schwab account used for all auto-trader orders.">
          <select
            className={selectCls}
            value={config.accountHash ?? ""}
            onChange={(e) => {
              void immediateSave({ accountHash: e.target.value || null });
            }}
            disabled={running}
          >
            <option value="">
              {validAccounts.length === 0 ? "No accounts available — reconnect Schwab" : "Select an account…"}
            </option>
            {validAccounts.map((a) => (
              <option key={a.hashValue!} value={a.hashValue!}>
                {a.accountNumber} · {a.type}
              </option>
            ))}
          </select>
          {validAccounts.length > 0 && !config.accountHash && (
            <p className="text-[10px] font-mono text-amber-400">
              No account saved — START will auto-select the first available account.
            </p>
          )}
        </Field>

        <Field label="LLM Model" hint="Model that reads price action and makes trading decisions.">
          <select
            className={selectCls}
            value={config.modelId}
            onChange={(e) => void immediateSave({ modelId: e.target.value })}
            disabled={running}
          >
            {AI_MODEL_CATALOG.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Instrument Mode">
          <select
            className={selectCls}
            value={config.instrumentMode}
            onChange={(e) => void immediateSave({ instrumentMode: e.target.value as InstrumentMode })}
            disabled={running}
          >
            {INSTRUMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
      </div>

      {/* Tickers */}
      <div className="border border-zinc-800 rounded-lg p-4 space-y-3 bg-zinc-900/30">
        <Field label="Ticker Universe" hint="Symbols the LLM can trade. Add/remove at any time.">
          <div className="flex gap-2">
            <input
              className={inputCls}
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTicker(); } }}
              placeholder="SYMBOL"
            />
            <button
              onClick={addTicker}
              className="flex items-center gap-1 px-3 rounded-lg border border-zinc-700 text-zinc-300 hover:border-[#f5a623] hover:text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {config.tickers.length === 0 && (
            <span className="font-mono text-[10px] text-zinc-600">No symbols yet.</span>
          )}
          {config.tickers.map((sym) => (
            <span
              key={sym}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#0c0c0c] border border-zinc-700 font-mono text-[11px] text-[#FFB800]"
            >
              {sym}
              <button onClick={() => removeTicker(sym)} className="text-zinc-500 hover:text-[#f23645]">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Risk guards */}
      <div className="border border-zinc-800 rounded-lg p-4 grid grid-cols-2 gap-4 bg-zinc-900/30">
        <Field label="Total Budget ($)" hint="Max open exposure across all positions at once.">
          <input
            type="number"
            className={inputCls}
            value={nums.totalBudget}
            onChange={(e) => setNums((n) => ({ ...n, totalBudget: e.target.value }))}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (!e.target.value || !isFinite(n) || n <= 0) {
                setNums((p) => ({ ...p, totalBudget: String(config.totalBudget) }));
              } else {
                debouncedSave({ totalBudget: n });
              }
            }}
            disabled={running}
          />
        </Field>
        <Field label="Max / Trade ($)" hint="Cap per entry. Lower than Total Budget = multiple positions.">
          <input
            type="number"
            className={inputCls}
            value={nums.maxPerTrade}
            onChange={(e) => setNums((n) => ({ ...n, maxPerTrade: e.target.value }))}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (!e.target.value || !isFinite(n) || n <= 0) {
                setNums((p) => ({ ...p, maxPerTrade: String(config.maxPerTrade) }));
              } else {
                debouncedSave({ maxPerTrade: n });
              }
            }}
            disabled={running}
          />
        </Field>
        <Field label="Daily Max Loss ($)" hint="Bot halts for the day when realized P/L drops this far.">
          <input
            type="number"
            className={inputCls}
            value={nums.dailyMaxLoss}
            onChange={(e) => setNums((n) => ({ ...n, dailyMaxLoss: e.target.value }))}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (!e.target.value || !isFinite(n) || n <= 0) {
                setNums((p) => ({ ...p, dailyMaxLoss: String(config.dailyMaxLoss) }));
              } else {
                debouncedSave({ dailyMaxLoss: n });
              }
            }}
            disabled={running}
          />
        </Field>
        <Field label="Poll Interval (sec)" hint="How often each symbol is re-evaluated (15–900s).">
          <input
            type="number"
            className={inputCls}
            value={nums.pollIntervalSec}
            onChange={(e) => setNums((n) => ({ ...n, pollIntervalSec: e.target.value }))}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (!e.target.value || !isFinite(n) || n < 15) {
                setNums((p) => ({ ...p, pollIntervalSec: String(config.pollIntervalSec) }));
              } else {
                debouncedSave({ pollIntervalSec: n });
              }
            }}
            disabled={running}
          />
        </Field>
      </div>

      {/* Session toggles */}
      <div className="border border-zinc-800 rounded-lg p-4 space-y-4 bg-zinc-900/30">
        <p className="text-xs font-medium text-zinc-300">Session Controls</p>
        <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
          <div>
            <div className="text-xs font-mono text-white">Extended Hours</div>
            <div className="text-[10px] font-mono text-zinc-500">Trade 7 AM–8 PM ET. LIMIT orders used automatically.</div>
          </div>
          <Toggle
            checked={config.enableExtendedHours}
            onChange={() => void immediateSave({ enableExtendedHours: !config.enableExtendedHours })}
            disabled={running}
          />
        </label>
        <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
          <div>
            <div className="text-xs font-mono text-white">Flatten at Close</div>
            <div className="text-[10px] font-mono text-zinc-500">Force-close all positions at 3:50 PM ET. Recommended.</div>
          </div>
          <Toggle
            checked={config.flattenAtClose}
            onChange={() => void immediateSave({ flattenAtClose: !config.flattenAtClose })}
            disabled={running}
          />
        </label>
      </div>

      {/* Decisions log */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-900/60">
          <Power className="w-3.5 h-3.5 text-zinc-400" />
          <span className="font-semibold text-xs text-white tracking-wide">RECENT DECISIONS</span>
        </div>
        <div className="max-h-[40vh] overflow-y-auto divide-y divide-zinc-800/60">
          {decisions.length === 0 && (
            <div className="px-4 py-3 font-mono text-[10px] text-zinc-600">No decisions logged yet.</div>
          )}
          {decisions.map((d) => (
            <div key={d.id} className="px-4 py-2.5 flex items-start gap-3">
              <span
                className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5"
                style={{
                  color: decisionColor(d.decision, d.placed),
                  background: "#0c0c0c",
                  border: `1px solid ${decisionColor(d.decision, d.placed)}33`,
                }}
              >
                {d.decision}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[11px] text-white">
                  {d.ticker}
                  {d.quantity ? ` · ${d.quantity}` : ""}
                  {d.placed ? " · ✓ placed" : d.error ? " · ✗ " + d.error : ""}
                </div>
                {d.reasoning && (
                  <div className="font-mono text-[10px] text-zinc-500 leading-relaxed break-words">{d.reasoning}</div>
                )}
              </div>
              <span className="font-mono text-[9px] text-zinc-600 whitespace-nowrap mt-0.5">
                {new Date(d.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function decisionColor(decision: string, placed: boolean): string {
  if (decision.startsWith("BUY")) return placed ? "#2ecc71" : "#f5a623";
  if (decision === "SELL") return "#f23645";
  if (decision.startsWith("HALT")) return "#f23645";
  return "#71717a";
}

function startErrorLabel(code: string | undefined): string {
  switch (code) {
    case "no_account_selected": return "No Schwab account found — reconnect in Linked Brokerage.";
    case "no_tickers": return "Add at least one ticker before starting.";
    case "no_trader_token": return "Brokerage not connected — link Schwab in Linked Brokerage.";
    default: return "Failed to start.";
  }
}
