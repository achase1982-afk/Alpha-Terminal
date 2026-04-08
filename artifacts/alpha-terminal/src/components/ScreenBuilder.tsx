import { useState } from "react";
import { X, Eye, Save, Loader2 } from "lucide-react";
import type { ScreenEntry } from "@/hooks/useScannerUniverses";

const GICS_SECTORS = [
  "Technology", "Healthcare", "Financial Services", "Consumer Cyclical",
  "Communication Services", "Industrials", "Consumer Defensive", "Energy",
  "Basic Materials", "Real Estate", "Utilities",
];

const MCAP_OPTIONS = [
  { label: "1B", value: 1_000_000_000 },
  { label: "2B", value: 2_000_000_000 },
  { label: "5B", value: 5_000_000_000 },
  { label: "10B", value: 10_000_000_000 },
  { label: "50B", value: 50_000_000_000 },
  { label: "100B", value: 100_000_000_000 },
];

interface ScreenBuilderProps {
  onClose: () => void;
  onSave: (name: string, filters: Record<string, any>) => Promise<any>;
  onPreview: (filters: Record<string, any>) => Promise<{ count: number; symbols: string[]; error?: string } | null>;
  editScreen?: ScreenEntry | null;
  onUpdate?: (id: number, data: { name?: string; filters?: Record<string, any> }) => Promise<any>;
}

export function ScreenBuilder({ onClose, onSave, onPreview, editScreen, onUpdate }: ScreenBuilderProps) {
  const isEditing = !!editScreen;
  const ef = (editScreen?.filters ?? {}) as Record<string, any>;

  const [name, setName] = useState(editScreen?.name ?? "");
  const [marketCapMin, setMarketCapMin] = useState<number | "">(ef.marketCapMin ?? "");
  const [marketCapMax, setMarketCapMax] = useState<number | "">(ef.marketCapMax ?? "");
  const [volumeMin, setVolumeMin] = useState<number | "">(ef.volumeMin ?? "");
  const [priceMin, setPriceMin] = useState<number | "">(ef.priceMin ?? "");
  const [priceMax, setPriceMax] = useState<number | "">(ef.priceMax ?? "");
  const [sectors, setSectors] = useState<string[]>(ef.sectors ?? []);
  const [sectorsExclude, setSectorsExclude] = useState<string[]>(ef.sectorsExclude ?? []);
  const [exchange, setExchange] = useState<string>(ef.exchange ?? "");
  const [optionsVolumeMin, setOptionsVolumeMin] = useState<number | "">(ef.optionsVolumeMin ?? "");
  const [maxResults, setMaxResults] = useState<number>(ef.maxResults ?? 200);

  const [enabledFilters, setEnabledFilters] = useState<Record<string, boolean>>({
    marketCapMin: !!ef.marketCapMin,
    marketCapMax: !!ef.marketCapMax,
    volumeMin: !!ef.volumeMin,
    priceMin: !!ef.priceMin,
    priceMax: !!ef.priceMax,
    sectors: (ef.sectors ?? []).length > 0,
    sectorsExclude: (ef.sectorsExclude ?? []).length > 0,
    exchange: !!ef.exchange,
    optionsVolumeMin: !!ef.optionsVolumeMin,
  });

  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<{ count: number; symbols: string[]; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) => setEnabledFilters(prev => ({ ...prev, [key]: !prev[key] }));

  const buildFilters = () => {
    const f: Record<string, any> = { country: "US", maxResults };
    if (enabledFilters.marketCapMin && marketCapMin) f.marketCapMin = marketCapMin;
    if (enabledFilters.marketCapMax && marketCapMax) f.marketCapMax = marketCapMax;
    if (enabledFilters.volumeMin && volumeMin) f.volumeMin = volumeMin;
    if (enabledFilters.priceMin && priceMin) f.priceMin = priceMin;
    if (enabledFilters.priceMax && priceMax) f.priceMax = priceMax;
    if (enabledFilters.sectors && sectors.length > 0) f.sectors = sectors;
    if (enabledFilters.sectorsExclude && sectorsExclude.length > 0) f.sectorsExclude = sectorsExclude;
    if (enabledFilters.exchange && exchange) f.exchange = exchange;
    if (enabledFilters.optionsVolumeMin && optionsVolumeMin) f.optionsVolumeMin = optionsVolumeMin;
    return f;
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setPreviewResult(null);
    const result = await onPreview(buildFilters());
    setPreviewResult(result);
    setPreviewing(false);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    if (isEditing && onUpdate && editScreen) {
      await onUpdate(editScreen.id, { name: name.trim(), filters: buildFilters() });
    } else {
      await onSave(name.trim(), buildFilters());
    }
    setSaving(false);
    onClose();
  };

  const toggleSector = (sector: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(sector) ? list.filter(s => s !== sector) : [...list, sector]);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#141414] border border-zinc-700/80 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700/50">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
            {isEditing ? "Edit Screen" : "Create Dynamic Screen"}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-[11px] text-zinc-500 uppercase font-bold block mb-1.5">Screen Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Large Cap Liquid"
              className="w-full bg-[#0c0c0c] border border-zinc-700/60 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#FFB800]/50"
            />
          </div>

          <FilterRow label="Min Market Cap" enabled={enabledFilters.marketCapMin} onToggle={() => toggle("marketCapMin")}>
            <div className="flex gap-2 flex-wrap">
              {MCAP_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setMarketCapMin(o.value)}
                  className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${marketCapMin === o.value ? "bg-[#FFB800]/15 border-[#FFB800]/40 text-[#FFB800]" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}>
                  ${o.label}
                </button>
              ))}
              <input type="number" value={marketCapMin} onChange={e => setMarketCapMin(e.target.value ? Number(e.target.value) : "")}
                placeholder="Custom"
                className="w-24 bg-[#0c0c0c] border border-zinc-700/60 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none" />
            </div>
          </FilterRow>

          <FilterRow label="Max Market Cap" enabled={enabledFilters.marketCapMax} onToggle={() => toggle("marketCapMax")}>
            <div className="flex gap-2 flex-wrap">
              {MCAP_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setMarketCapMax(o.value)}
                  className={`px-2.5 py-1 text-[11px] rounded border transition-colors ${marketCapMax === o.value ? "bg-[#FFB800]/15 border-[#FFB800]/40 text-[#FFB800]" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}>
                  ${o.label}
                </button>
              ))}
              <input type="number" value={marketCapMax} onChange={e => setMarketCapMax(e.target.value ? Number(e.target.value) : "")}
                placeholder="Custom"
                className="w-24 bg-[#0c0c0c] border border-zinc-700/60 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none" />
            </div>
          </FilterRow>

          <FilterRow label="Min Avg Daily Volume" enabled={enabledFilters.volumeMin} onToggle={() => toggle("volumeMin")}>
            <input type="number" value={volumeMin} onChange={e => setVolumeMin(e.target.value ? Number(e.target.value) : "")}
              placeholder="e.g. 2000000"
              className="w-full bg-[#0c0c0c] border border-zinc-700/60 rounded px-3 py-2 text-sm text-zinc-300 focus:outline-none" />
            {volumeMin && <span className="text-[10px] text-zinc-500 mt-1">{(Number(volumeMin) / 1e6).toFixed(1)}M shares/day</span>}
          </FilterRow>

          <FilterRow label="Min Price" enabled={enabledFilters.priceMin} onToggle={() => toggle("priceMin")}>
            <input type="number" value={priceMin} onChange={e => setPriceMin(e.target.value ? Number(e.target.value) : "")}
              placeholder="e.g. 20"
              className="w-full bg-[#0c0c0c] border border-zinc-700/60 rounded px-3 py-2 text-sm text-zinc-300 focus:outline-none" />
          </FilterRow>

          <FilterRow label="Max Price" enabled={enabledFilters.priceMax} onToggle={() => toggle("priceMax")}>
            <input type="number" value={priceMax} onChange={e => setPriceMax(e.target.value ? Number(e.target.value) : "")}
              placeholder="e.g. 500"
              className="w-full bg-[#0c0c0c] border border-zinc-700/60 rounded px-3 py-2 text-sm text-zinc-300 focus:outline-none" />
          </FilterRow>

          <FilterRow label="Include Sectors" enabled={enabledFilters.sectors} onToggle={() => toggle("sectors")}>
            <div className="flex flex-wrap gap-1.5">
              {GICS_SECTORS.map(s => (
                <button key={s} onClick={() => toggleSector(s, sectors, setSectors)}
                  className={`px-2 py-1 text-[10px] rounded border transition-colors ${sectors.includes(s) ? "bg-[#26a69a]/15 border-[#26a69a]/40 text-[#26a69a]" : "border-zinc-700/60 text-zinc-500 hover:border-zinc-500"}`}>
                  {s}
                </button>
              ))}
            </div>
          </FilterRow>

          <FilterRow label="Exclude Sectors" enabled={enabledFilters.sectorsExclude} onToggle={() => toggle("sectorsExclude")}>
            <div className="flex flex-wrap gap-1.5">
              {GICS_SECTORS.map(s => (
                <button key={s} onClick={() => toggleSector(s, sectorsExclude, setSectorsExclude)}
                  className={`px-2 py-1 text-[10px] rounded border transition-colors ${sectorsExclude.includes(s) ? "bg-[#f23645]/15 border-[#f23645]/40 text-[#f23645]" : "border-zinc-700/60 text-zinc-500 hover:border-zinc-500"}`}>
                  {s}
                </button>
              ))}
            </div>
          </FilterRow>

          <FilterRow label="Exchange" enabled={enabledFilters.exchange} onToggle={() => toggle("exchange")}>
            <div className="flex gap-2">
              {["NYSE", "NASDAQ"].map(ex => (
                <button key={ex} onClick={() => setExchange(exchange === ex ? "" : ex)}
                  className={`px-3 py-1.5 text-[11px] rounded border font-bold transition-colors ${exchange === ex ? "bg-[#FFB800]/15 border-[#FFB800]/40 text-[#FFB800]" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}>
                  {ex}
                </button>
              ))}
            </div>
          </FilterRow>

          <FilterRow label="Min Options Volume" enabled={enabledFilters.optionsVolumeMin} onToggle={() => toggle("optionsVolumeMin")}>
            <input type="number" value={optionsVolumeMin} onChange={e => setOptionsVolumeMin(e.target.value ? Number(e.target.value) : "")}
              placeholder="e.g. 500 contracts/day"
              className="w-full bg-[#0c0c0c] border border-zinc-700/60 rounded px-3 py-2 text-sm text-zinc-300 focus:outline-none" />
          </FilterRow>

          <div>
            <label className="text-[11px] text-zinc-500 uppercase font-bold block mb-1.5">Max Results</label>
            <input type="number" value={maxResults} onChange={e => setMaxResults(Math.min(500, Math.max(1, Number(e.target.value) || 200)))}
              className="w-24 bg-[#0c0c0c] border border-zinc-700/60 rounded px-3 py-2 text-sm text-zinc-300 focus:outline-none" />
          </div>

          {previewResult && (
            <div className="rounded-lg border border-zinc-700/50 bg-[#0c0c0c] p-3">
              {previewResult.error ? (
                <p className="text-[11px] text-red-400">{previewResult.error}</p>
              ) : (
                <>
                  <p className="text-sm font-bold" style={{ color: "#FFB800" }}>{previewResult.count} stocks matched</p>
                  {previewResult.symbols.length > 0 && (
                    <p className="text-[10px] text-zinc-500 mt-1">
                      Preview: {previewResult.symbols.join(", ")}{previewResult.count > 20 ? "..." : ""}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-zinc-700/50">
          <button onClick={handlePreview} disabled={previewing}
            className="flex items-center gap-1.5 text-[11px] font-bold px-4 py-2 rounded border border-zinc-600 text-zinc-300 hover:border-zinc-400 transition-colors disabled:opacity-50">
            {previewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
            PREVIEW
          </button>
          <div className="flex-1" />
          <button onClick={onClose}
            className="text-[11px] font-bold px-4 py-2 rounded text-zinc-500 hover:text-zinc-300 transition-colors">
            CANCEL
          </button>
          <button onClick={handleSave} disabled={saving || !name.trim()}
            className="flex items-center gap-1.5 text-[11px] font-bold px-4 py-2 rounded transition-colors disabled:opacity-30"
            style={{ background: "#FFB800", color: "#000" }}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {isEditing ? "UPDATE" : "SAVE SCREEN"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterRow({ label, enabled, onToggle, children }: {
  label: string; enabled: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border p-3 transition-colors ${enabled ? "border-zinc-600/60 bg-[#0c0c0c]" : "border-zinc-800/40 bg-transparent opacity-50"}`}>
      <div className="flex items-center gap-2 mb-2">
        <button onClick={onToggle}
          className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${enabled ? "bg-[#FFB800] border-[#FFB800]" : "border-zinc-600 bg-transparent"}`}>
          {enabled && <span className="text-black text-[10px] font-bold">✓</span>}
        </button>
        <span className="text-[11px] text-zinc-400 uppercase font-bold tracking-wider">{label}</span>
      </div>
      {enabled && <div className="ml-6">{children}</div>}
    </div>
  );
}
