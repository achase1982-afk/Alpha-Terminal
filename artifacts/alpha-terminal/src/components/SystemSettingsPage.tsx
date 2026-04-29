import { useState, useEffect, useCallback, useRef } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  ChevronDown, ChevronRight, RotateCcw, Save, History,
  Check, AlertTriangle, Loader2, Settings2,
} from "lucide-react";

const API = "/api/ai-lab";

interface SettingMeta {
  key: string;
  label: string;
  group: string;
  type: "slider" | "number";
  min: number;
  max: number;
  step: number;
  description: string;
}

interface PromptHistoryEntry {
  id: number;
  role: string;
  promptText: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
}

interface FullSettings {
  config: Record<string, any>;
  defaults: Record<string, any>;
  meta: SettingMeta[];
  promptRoles: string[];
  activePrompts: Record<string, string | null>;
  defaultPrompts: Record<string, string>;
}

const ROLE_LABELS: Record<string, string> = {
  shared_context: "Shared Context (Master Prompt)",
  analyst: "Analyst",
  analyst_rebuttal: "Analyst Rebuttal",
  skeptic: "Skeptic",
  skeptic_reeval: "Skeptic Re-evaluation",
  universe_screener: "Universe Screener",
};

const SCHEDULE_KEYS: { key: string; label: string; time: string }[] = [
  { key: "scheduleOvernightDigest", label: "Overnight Digest", time: "4:00 AM ET" },
  { key: "schedulePremarketPlan", label: "Premarket Plan", time: "8:30 AM ET" },
  { key: "schedulePostOpenCheck", label: "Post-Open Check", time: "10:00 AM ET" },
  { key: "scheduleMidMorningScan", label: "Mid-Morning Scan", time: "11:00 AM ET" },
  { key: "scheduleMiddayRotation", label: "Midday Rotation", time: "12:30 PM ET" },
  { key: "schedulePowerHourPrep", label: "Power Hour Prep", time: "3:00 PM ET" },
  { key: "schedulePostMarketReflection", label: "Post-Market Reflection", time: "4:30 PM ET" },
];

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-zinc-900/60 hover:bg-zinc-800/60 transition-colors text-left"
      >
        {open ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
        <span className="font-semibold text-sm text-white tracking-wide">{title}</span>
      </button>
      {open && <div className="px-4 py-3 space-y-4">{children}</div>}
    </div>
  );
}

function SliderRow({
  meta, value, defaultValue, onChange,
}: {
  meta: SettingMeta; value: number; defaultValue: number; onChange: (v: number) => void;
}) {
  const isDefault = value === defaultValue;
  const pct = ((value - meta.min) / (meta.max - meta.min)) * 100;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-300">{meta.label}</label>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-[#f5a623]">{value}</span>
          {!isDefault && (
            <button onClick={() => onChange(defaultValue)} className="text-zinc-500 hover:text-white" title="Reset to default">
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <input
        type="range"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #f5a623 0%, #f5a623 ${pct}%, #3f3f46 ${pct}%, #3f3f46 100%)`,
        }}
      />
      <p className="text-[10px] text-zinc-500">{meta.description}</p>
    </div>
  );
}

function NumberRow({
  meta, value, defaultValue, onChange,
}: {
  meta: SettingMeta; value: number; defaultValue: number; onChange: (v: number) => void;
}) {
  const isDefault = value === defaultValue;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-300">{meta.label}</label>
        <div className="flex items-center gap-2">
          {!isDefault && (
            <button onClick={() => onChange(defaultValue)} className="text-zinc-500 hover:text-white" title="Reset to default">
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <input
        type="number"
        min={meta.min}
        max={meta.max}
        step={meta.step}
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v) && v >= meta.min && v <= meta.max) onChange(v);
        }}
        className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:border-[#f5a623] focus:outline-none"
      />
      <p className="text-[10px] text-zinc-500">{meta.description}</p>
    </div>
  );
}

function PromptEditor({
  role, activeText, defaultText, onSave, onReset,
}: {
  role: string; activeText: string | null; defaultText: string; onSave: (text: string) => Promise<void>; onReset: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<PromptHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const displayText = activeText ?? defaultText;
  const isCustom = activeText !== null && activeText !== defaultText;

  const startEdit = () => {
    setDraft(displayText);
    setEditing(true);
    setTimeout(() => textRef.current?.focus(), 50);
  };

  const handleSave = async () => {
    if (draft.trim() === displayText) { setEditing(false); return; }
    setSaving(true);
    await onSave(draft.trim());
    setSaving(false);
    setEditing(false);
  };

  const loadHistory = async () => {
    if (showHistory) { setShowHistory(false); return; }
    setHistoryLoading(true);
    try {
      const res = await fetchWithAuth(`${API}/prompts/${role}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history || []);
      }
    } catch {}
    setHistoryLoading(false);
    setShowHistory(true);
  };

  const restoreVersion = async (id: number) => {
    try {
      const res = await fetchWithAuth(`${API}/prompts/restore/${id}`, { method: "POST" });
      if (res.ok) {
        setShowHistory(false);
        window.location.reload();
      }
    } catch {}
  };

  return (
    <div className="border border-zinc-800 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-200">{ROLE_LABELS[role] || role}</span>
          {isCustom && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#f5a623]/20 text-[#f5a623] font-bold">CUSTOM</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={loadHistory} className="text-zinc-500 hover:text-white p-1" title="History">
            <History className="w-3.5 h-3.5" />
          </button>
          {isCustom && (
            <button onClick={onReset} className="text-zinc-500 hover:text-white p-1" title="Reset to default">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          {!editing && (
            <button onClick={startEdit} className="text-zinc-500 hover:text-[#f5a623] p-1 text-[10px] font-bold">EDIT</button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            ref={textRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-[11px] font-mono text-zinc-300 leading-relaxed focus:border-[#f5a623] focus:outline-none resize-y"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setEditing(false)} className="px-3 py-1 text-[10px] font-bold text-zinc-400 hover:text-white border border-zinc-700 rounded">
              CANCEL
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 text-[10px] font-bold bg-[#f5a623] text-black rounded hover:bg-[#e6951a] disabled:opacity-50 flex items-center gap-1"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              SAVE
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-zinc-950/50 rounded p-2 max-h-32 overflow-y-auto">
          <pre className="text-[10px] font-mono text-zinc-400 leading-relaxed whitespace-pre-wrap break-words">
            {displayText || <span className="italic text-zinc-600">(empty)</span>}
          </pre>
        </div>
      )}

      {showHistory && (
        <div className="border-t border-zinc-800 pt-2 mt-2 space-y-1.5 max-h-48 overflow-y-auto">
          <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Version History</p>
          {historyLoading ? (
            <Loader2 className="w-3 h-3 animate-spin text-zinc-500 mx-auto" />
          ) : history.length === 0 ? (
            <p className="text-[10px] text-zinc-600 italic">No history — using default prompt</p>
          ) : (
            history.map((h) => (
              <div key={h.id} className="flex items-center justify-between bg-zinc-900/50 rounded px-2 py-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-zinc-400 truncate font-mono">{h.promptText.slice(0, 80)}...</p>
                  <p className="text-[9px] text-zinc-600">{new Date(h.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  {h.isActive && <span className="text-[8px] px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">ACTIVE</span>}
                  <button
                    onClick={() => restoreVersion(h.id)}
                    className="text-[9px] text-zinc-500 hover:text-[#f5a623] font-bold px-1"
                  >
                    RESTORE
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function SystemSettingsPage() {
  const [data, setData] = useState<FullSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [universes, setUniverses] = useState<{ id: string; name: string; symbolCount: number; source: string }[]>([]);
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsRes, univRes] = await Promise.all([
        fetchWithAuth(`${API}/settings/full`),
        fetchWithAuth(`${API}/universes`),
      ]);
      if (settingsRes.ok) setData(await settingsRes.json());
      if (univRes.ok) {
        const u = await univRes.json();
        setUniverses(u.universes || []);
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const updateSetting = useCallback(async (key: string, value: any) => {
    if (!data) return;
    setData((prev) => prev ? { ...prev, config: { ...prev.config, [key]: value } } : prev);

    if (debounceRef.current[key]) clearTimeout(debounceRef.current[key]);
    debounceRef.current[key] = setTimeout(async () => {
      setSaving(key);
      try {
        const res = await fetchWithAuth(`${API}/settings/update`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        });
        if (res.ok) {
          const json = await res.json();
          setData((prev) => prev ? { ...prev, config: { ...prev.config, ...json.config } } : prev);
          setSaved(key);
          setTimeout(() => setSaved(null), 1200);
        }
      } catch {}
      setSaving(null);
    }, 400);
  }, [data]);

  const handlePromptSave = useCallback(async (role: string, text: string) => {
    try {
      await fetchWithAuth(`${API}/prompts/${role}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptText: text }),
      });
      await loadAll();
    } catch {}
  }, [loadAll]);

  const handlePromptReset = useCallback(async (role: string) => {
    try {
      await fetchWithAuth(`${API}/prompts/${role}/reset`, { method: "POST" });
      await loadAll();
    } catch {}
  }, [loadAll]);

  const handleResetAll = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API}/settings/reset`, { method: "POST" });
      if (res.ok) await loadAll();
    } catch {}
  }, [loadAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-[#f5a623]" />
        <span className="ml-2 text-xs text-zinc-500 font-mono">Loading system settings...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-2">
        <AlertTriangle className="w-5 h-5 text-red-400" />
        <p className="text-xs text-zinc-400 font-mono">{error || "Failed to load settings"}</p>
        <button onClick={loadAll} className="text-[10px] text-[#f5a623] hover:underline">Retry</button>
      </div>
    );
  }

  const groups = new Map<string, SettingMeta[]>();
  for (const m of data.meta) {
    const arr = groups.get(m.group) ?? [];
    arr.push(m);
    groups.set(m.group, arr);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-[#f5a623]" />
          <h2 className="font-bold text-lg text-white tracking-wide">System Settings</h2>
        </div>
        <button
          onClick={handleResetAll}
          className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-zinc-400 hover:text-white border border-zinc-700 rounded hover:border-zinc-500 transition-colors"
        >
          <RotateCcw className="w-3 h-3" /> RESET ALL
        </button>
      </div>

      <Section title="AI Lab — Master Toggle" defaultOpen>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-zinc-300">AI Lab Enabled</p>
            <p className="text-[10px] text-zinc-500">Master switch — disables all automated analysis when off</p>
          </div>
          <button
            onClick={() => updateSetting("enabled", !data.config.enabled)}
            className={`w-11 h-6 rounded-full transition-colors relative ${data.config.enabled ? "bg-[#2ecc71]" : "bg-zinc-700"}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-all ${data.config.enabled ? "left-6" : "left-1"}`} />
          </button>
        </div>
      </Section>

      <Section title="Models" defaultOpen>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Analyst Provider</label>
            <select
              value={data.config.analystModelProvider}
              onChange={(e) => updateSetting("analystModelProvider", e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:border-[#f5a623] focus:outline-none"
            >
              <option value="google">Google (Gemini)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (ChatGPT)</option>
              <option value="xai">xAI (Grok)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Analyst Model</label>
            <input
              type="text"
              value={data.config.analystModelName}
              onChange={(e) => updateSetting("analystModelName", e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:border-[#f5a623] focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Skeptic Provider</label>
            <select
              value={data.config.skepticModelProvider}
              onChange={(e) => updateSetting("skepticModelProvider", e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:border-[#f5a623] focus:outline-none"
            >
              <option value="google">Google (Gemini)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (ChatGPT)</option>
              <option value="xai">xAI (Grok)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Skeptic Model</label>
            <input
              type="text"
              value={data.config.skepticModelName}
              onChange={(e) => updateSetting("skepticModelName", e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:border-[#f5a623] focus:outline-none"
            />
          </div>
        </div>
        {data.meta.filter(m => m.group === "Models").map((m) => {
          const val = data.config[m.key] ?? data.defaults[m.key];
          const def = data.defaults[m.key];
          return m.type === "slider" ? (
            <SliderRow key={m.key} meta={m} value={val} defaultValue={def} onChange={(v) => updateSetting(m.key, v)} />
          ) : (
            <NumberRow key={m.key} meta={m} value={val} defaultValue={def} onChange={(v) => updateSetting(m.key, v)} />
          );
        })}
      </Section>

      <Section title="Universe Selection">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-300">Active Universe</label>
          <select
            value={data.config.universe}
            onChange={(e) => updateSetting("universe", e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-xs font-mono text-white focus:border-[#f5a623] focus:outline-none"
          >
            {universes.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.symbolCount} symbols){u.source === "preset" ? "" : " — Watchlist"}</option>
            ))}
          </select>
          <p className="text-[10px] text-zinc-500">Selects which stock universe the AI Lab scans for anomalies</p>
        </div>
      </Section>

      <Section title="System Prompts">
        <p className="text-[10px] text-zinc-500 mb-3">
          Shared Context is prepended to every LLM call. Individual role prompts fine-tune each agent.
        </p>
        {(data.promptRoles || []).map((role: string) => (
          <PromptEditor
            key={role}
            role={role}
            activeText={data.activePrompts[role] ?? null}
            defaultText={data.defaultPrompts[role] ?? ""}
            onSave={(text) => handlePromptSave(role, text)}
            onReset={() => handlePromptReset(role)}
          />
        ))}
      </Section>

      {Array.from(groups.entries())
        .filter(([g]) => g !== "Models")
        .map(([group, metas]) => (
          <Section key={group} title={group}>
            {metas.map((m) => {
              const val = data.config[m.key] ?? data.defaults[m.key];
              const def = data.defaults[m.key];
              return m.type === "slider" ? (
                <SliderRow key={m.key} meta={m} value={val} defaultValue={def} onChange={(v) => updateSetting(m.key, v)} />
              ) : (
                <NumberRow key={m.key} meta={m} value={val} defaultValue={def} onChange={(v) => updateSetting(m.key, v)} />
              );
            })}
          </Section>
        ))}

      <Section title="Schedule">
        <p className="text-[10px] text-zinc-500 mb-2">Enable or disable individual scheduled analysis passes.</p>
        {SCHEDULE_KEYS.map(({ key, label, time }) => (
          <div key={key} className="flex items-center justify-between py-1.5">
            <div>
              <p className="text-xs font-medium text-zinc-300">{label}</p>
              <p className="text-[10px] text-zinc-500">{time}</p>
            </div>
            <button
              onClick={() => updateSetting(key, !data.config[key])}
              className={`w-9 h-5 rounded-full transition-colors relative ${data.config[key] ? "bg-[#2ecc71]" : "bg-zinc-700"}`}
            >
              <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all ${data.config[key] ? "left-[18px]" : "left-[3px]"}`} />
            </button>
          </div>
        ))}
      </Section>

      {saving && (
        <div className="fixed bottom-4 right-4 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 flex items-center gap-2 shadow-lg z-50">
          <Loader2 className="w-3 h-3 animate-spin text-[#f5a623]" />
          <span className="text-[10px] font-mono text-zinc-400">Saving {saving}...</span>
        </div>
      )}
      {saved && !saving && (
        <div className="fixed bottom-4 right-4 bg-zinc-900 border border-emerald-800 rounded-lg px-3 py-2 flex items-center gap-2 shadow-lg z-50">
          <Check className="w-3 h-3 text-[#2ecc71]" />
          <span className="text-[10px] font-mono text-[#2ecc71]">Saved {saved}</span>
        </div>
      )}
    </div>
  );
}
