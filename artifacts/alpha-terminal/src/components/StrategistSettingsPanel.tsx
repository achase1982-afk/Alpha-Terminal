import { useState, useEffect, useCallback } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { RotateCcw, AlertTriangle, Check } from "lucide-react";

interface SettingMeta {
  key: string;
  label: string;
  group: string;
  default: number;
  min: number;
  max: number;
  step: number;
  description: string;
  // When present, the UI renders a dropdown of these choices instead of the
  // numeric range slider. Used for enum-like settings such as strategist mode,
  // convergence strategy, and per-strategist model selection.
  options?: Array<{ value: number; label: string }>;
}

// Pin "Strategist" to the top so users see the mode/model controls first.
const GROUP_ORDER = ["Strategist"];
function sortedGroups<T>(groups: Map<string, T>): Array<[string, T]> {
  const all = Array.from(groups.keys());
  const ordered: string[] = [];
  for (const g of GROUP_ORDER) if (all.includes(g)) ordered.push(g);
  for (const g of all) if (!ordered.includes(g)) ordered.push(g);
  return ordered.map((g) => [g, groups.get(g)!] as [string, T]);
}

interface SettingsData {
  current: Record<string, number>;
  meta: SettingMeta[];
  defaults: Record<string, number>;
}

export function StrategistSettingsPanel() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);

  const loadSettings = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      setLoading(true);
      setLoadError(null);
      const res = await fetchWithAuth("/api/strategist/settings", { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Settings request failed (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setData(null);
      setLoadError(err instanceof Error && err.name === "AbortError" ? "Settings request timed out" : "Failed to load settings");
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const handleChange = useCallback(async (key: string, value: number) => {
    if (!data) return;
    setData({ ...data, current: { ...data.current, [key]: value } });
    setSaving(key);
    try {
      const res = await fetchWithAuth("/api/strategist/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) {
        const json = await res.json();
        setData((prev) => prev ? { ...prev, current: json.current } : prev);
        setSaved(key);
        setTimeout(() => setSaved(null), 1500);
      }
    } catch {}
    setSaving(null);
  }, [data]);

  const handleReset = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/strategist/settings/reset", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        setData((prev) => prev ? { ...prev, current: json.current } : prev);
        setResetConfirm(false);
      }
    } catch {}
  }, []);

  if (loading) return <div className="text-center text-zinc-500 font-mono text-xs py-8">Loading settings...</div>;
  if (!data) return <div className="text-center text-zinc-500 font-mono text-xs py-8">{loadError ?? "Failed to load settings"}</div>;

  const currentMode = data.current["strategistMode"] ?? 1;
  const isDeskMode = currentMode === 3 || currentMode === 4;
  const isSoloDeskMode = currentMode === 4;

  const DESK_LABELS: Record<string, string> = {
    strategistSoloModelIdx: "Desk — Vol Analyst Model",
    strategistDebateAModelIdx: "Desk — Flow Analyst Model",
    strategistDebateBModelIdx: "Desk — Catalyst Analyst Model",
    strategistArbitratorModelIdx: "Desk — PM Model",
  };

  /** Row titles when Solo Desk is selected: first slot = same model as Solo; others unused. */
  const SOLO_DESK_LABELS: Record<string, string> = {
    strategistSoloModelIdx: "Solo Model & Solo Desk",
    strategistDebateAModelIdx: "Bull / Flow — unused in Solo Desk",
    strategistDebateBModelIdx: "Bear / Catalyst — unused in Solo Desk",
    strategistArbitratorModelIdx: "Arbitrator / PM — unused in Solo Desk",
  };

  const HIDDEN_IN_DESK = new Set(["strategistConvergence", "strategistTieBand"]);

  const groups = new Map<string, SettingMeta[]>();
  for (const m of data.meta) {
    if (isDeskMode && HIDDEN_IN_DESK.has(m.key)) continue;
    const arr = groups.get(m.group) ?? [];
    const adjusted =
      isSoloDeskMode && SOLO_DESK_LABELS[m.key]
        ? { ...m, label: SOLO_DESK_LABELS[m.key] }
        : isDeskMode && DESK_LABELS[m.key]
          ? { ...m, label: DESK_LABELS[m.key] }
          : m;
    arr.push(adjusted);
    groups.set(m.group, arr);
  }

  const ioWeightKeys = ["ioWeightR2", "ioWeightResidual", "ioWeightCatalyst", "ioWeightFlow"];
  const ioSum = ioWeightKeys.reduce((acc, k) => acc + (data.current[k] ?? 0), 0);
  const ioWarning = Math.abs(ioSum - 1.0) > 0.01;

  // Scanner Default + Idiosyncratic weight groups must sum to 100. The engine
  // sums the raw category contributions additively (no auto-normalization), so
  // a sub-100 sum quietly caps the maximum possible score (e.g. 85 max instead
  // of 100), shifting tickers below the minScore threshold.
  const scannerDefaultKeys = [
    "scannerDefaultTrend", "scannerDefaultRS", "scannerDefaultVolume",
    "scannerDefaultIVR", "scannerDefaultLiquidity",
  ];
  const scannerIdioKeys = [
    "scannerIdioTrend", "scannerIdioRS", "scannerIdioVolume",
    "scannerIdioIVR", "scannerIdioLiquidity",
  ];
  const scannerDefaultSum = scannerDefaultKeys.reduce((a, k) => a + (data.current[k] ?? 0), 0);
  const scannerIdioSum = scannerIdioKeys.reduce((a, k) => a + (data.current[k] ?? 0), 0);
  const scannerDefaultWarning = Math.abs(scannerDefaultSum - 100) > 0.5;
  const scannerIdioWarning = Math.abs(scannerIdioSum - 100) > 0.5;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-mono text-sm font-bold text-white tracking-wider uppercase">Scanner & Strategist Tuning</h2>
        {resetConfirm ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 font-mono">Reset all?</span>
            <button onClick={handleReset} className="text-xs text-red-400 font-mono px-2 py-1 rounded border border-red-400/30 hover:bg-red-400/10">Yes</button>
            <button onClick={() => setResetConfirm(false)} className="text-xs text-zinc-400 font-mono px-2 py-1 rounded border border-zinc-600 hover:bg-zinc-800">No</button>
          </div>
        ) : (
          <button onClick={() => setResetConfirm(true)} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-white font-mono">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        )}
      </div>

      {ioWarning && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/20 border border-amber-500/30">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <span className="font-mono text-[11px] text-amber-300">IOScore weights sum to {ioSum.toFixed(2)} — should be 1.00</span>
        </div>
      )}
      {scannerDefaultWarning && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-900/20 border border-blue-500/30">
          <AlertTriangle className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" />
          <span className="font-mono text-[11px] text-blue-200">
            Scanner Default weights sum to {scannerDefaultSum} (defaults sum to 100). Engine normalizes by total so the score range is unaffected — this is informational only, showing your weights have drifted from defaults.
          </span>
        </div>
      )}
      {scannerIdioWarning && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-900/20 border border-blue-500/30">
          <AlertTriangle className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" />
          <span className="font-mono text-[11px] text-blue-200">
            Scanner Idiosyncratic weights sum to {scannerIdioSum} (defaults sum to 100). Engine normalizes by total so the score range is unaffected — this is informational only, showing your weights have drifted from defaults.
          </span>
        </div>
      )}

      {sortedGroups(groups).map(([group, items]) => (
        <div key={group} className="space-y-3">
          <h3 className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest font-medium border-b border-zinc-800 pb-1">{group}</h3>
          {items.map((m) => {
            const val = data.current[m.key] ?? m.default;
            let effectiveOptions = m.options;
            if (isDeskMode && m.key === "strategistArbitratorModelIdx" && Array.isArray(m.options)) {
              effectiveOptions = m.options.filter(o => o.value >= 0);
            }
            const isDropdown = Array.isArray(effectiveOptions) && effectiveOptions.length > 0;
            const isToggle = !isDropdown && m.min === 0 && m.max === 1 && m.step === 1;
            // The Spread Width slider is overridden when "Spread Width — Unlimited"
            // is on. When overridden, we disable the slider, dim the row, and
            // show "Unlimited" in place of the numeric value so the user sees
            // exactly what the agents will receive.
            const overriddenByUnlimited =
              m.key === "spreadWidth" && (data.current["spreadWidthUnlimited"] ?? 1) === 1;
            return (
              <div key={m.key} className={`space-y-1 ${overriddenByUnlimited ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between">
                  <label className="font-mono text-[11px] text-white">{m.label}</label>
                  <div className="flex items-center gap-2">
                    {saving === m.key && <span className="text-[10px] text-zinc-500 font-mono">saving...</span>}
                    {saved === m.key && <Check className="w-3 h-3 text-green-400" />}
                    {isDropdown ? (
                      <select
                        value={val}
                        onChange={(e) => handleChange(m.key, Number(e.target.value))}
                        className="font-mono text-[11px] text-white bg-zinc-900 border border-zinc-700 rounded px-2 py-1 hover:border-[#f5a623] focus:border-[#f5a623] focus:outline-none"
                      >
                        {effectiveOptions!.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    ) : isToggle ? (
                      <button
                        onClick={() => handleChange(m.key, val === 1 ? 0 : 1)}
                        className={`relative w-9 h-5 rounded-full transition-colors ${val === 1 ? "bg-[#f5a623]" : "bg-zinc-700"}`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${val === 1 ? "translate-x-4" : "translate-x-0.5"}`} />
                      </button>
                    ) : overriddenByUnlimited ? (
                      <span className="font-mono text-[11px] text-[#26a69a] tabular-nums text-right italic">Unlimited</span>
                    ) : (
                      <span className="font-mono text-[11px] text-[#f5a623] tabular-nums w-12 text-right">{val}</span>
                    )}
                  </div>
                </div>
                {!isToggle && !isDropdown && (
                  <input
                    type="range"
                    min={m.min}
                    max={m.max}
                    step={m.step}
                    value={val}
                    disabled={overriddenByUnlimited}
                    onChange={(e) => handleChange(m.key, Number(e.target.value))}
                    className={`w-full h-1 rounded-full appearance-none ${overriddenByUnlimited ? "cursor-not-allowed" : "cursor-pointer"}`}
                    style={{ accentColor: "#f5a623", background: "#2A2A2C" }}
                  />
                )}
                <p className="font-mono text-[9px] text-zinc-600 leading-tight">{m.description}</p>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
