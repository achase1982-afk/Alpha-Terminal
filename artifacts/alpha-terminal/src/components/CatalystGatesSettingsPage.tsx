import { useCallback, useEffect, useState } from "react";
import {
  CATALYST_GATE_LIMITS,
  DEFAULT_CATALYST_GATE_SETTINGS,
  formatMarketCapFloorLabel,
  formatVolumeFloorLabel,
  marketCapUsdToBillionsInput,
  normalizeCatalystGateSettings,
  parseMarketCapBillionsInput,
  parsePriceFloorInput,
  parseVolumeFloorInput,
  volumeFloorToInput,
  type CatalystGateSettings,
} from "@workspace/catalysts-types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTerminalStore } from "@/lib/store";

const MIN_FONT_PX = 12;
const TEXT = "#fafafa";
const MUTED = "#a1a1aa";
const GOLD = "#FFB800";
const BORDER = "#3f3f46";
const BLUE = "#0064FF";

function SidebarToggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  hint?: string;
}) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer py-2">
      <div className="min-w-0">
        <span className="font-mono tracking-wide" style={{ color: TEXT, fontSize: MIN_FONT_PX }}>
          {label}
        </span>
        {hint ? (
          <p className="font-mono mt-1 leading-relaxed" style={{ color: MUTED, fontSize: MIN_FONT_PX }}>
            {hint}
          </p>
        ) : null}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="rounded border-card-border bg-transparent accent-[#FFB800] w-4 h-4 mt-0.5 shrink-0"
      />
    </label>
  );
}

function GateAmountField({
  label,
  hint,
  disabled,
  inputValue,
  onInputChange,
  onCommit,
  unitHint,
  formatted,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  inputValue: string;
  onInputChange: (v: string) => void;
  onCommit: () => void;
  unitHint: string;
  formatted: string;
}) {
  return (
    <div className="py-2 pl-1 space-y-1.5" style={{ opacity: disabled ? 0.45 : 1 }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono" style={{ color: TEXT, fontSize: MIN_FONT_PX }}>
            {label}
          </span>
          {hint ? (
            <p className="font-mono mt-1 leading-relaxed" style={{ color: MUTED, fontSize: MIN_FONT_PX }}>
              {hint}
            </p>
          ) : null}
        </div>
        <span className="font-mono font-bold tabular-nums shrink-0" style={{ color: GOLD, fontSize: MIN_FONT_PX }}>
          {formatted}
        </span>
      </div>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={inputValue}
        onChange={(e) => onInputChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        placeholder={unitHint}
        className="w-full font-mono rounded-lg border px-2 py-1.5 tabular-nums"
        style={{
          fontSize: MIN_FONT_PX,
          color: TEXT,
          background: "#0c0c0c",
          borderColor: BORDER,
        }}
      />
    </div>
  );
}

export function CatalystGatesSettingsPage() {
  const setCatalystGateSettings = useTerminalStore((s) => s.setCatalystGateSettings);
  const [draft, setDraft] = useState<CatalystGateSettings>(() => ({
    ...DEFAULT_CATALYST_GATE_SETTINGS,
  }));
  const [priceInput, setPriceInput] = useState("5");
  const [marketCapInput, setMarketCapInput] = useState("0.5");
  const [volumeInput, setVolumeInput] = useState("500K");
  const [savedHint, setSavedHint] = useState("");
  const [dirty, setDirty] = useState(false);

  const applyDraftToInputs = useCallback((settings: CatalystGateSettings) => {
    setPriceInput(settings.priceFloorUsd > 0 ? String(settings.priceFloorUsd) : "0");
    setMarketCapInput(marketCapUsdToBillionsInput(settings.marketCapFloorUsd));
    setVolumeInput(volumeFloorToInput(settings.avgVolumeFloor));
  }, []);

  useEffect(() => {
    fetchWithAuth("/api/catalysts/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { settings?: Partial<CatalystGateSettings> } | null) => {
        if (data?.settings) {
          const merged = normalizeCatalystGateSettings(data.settings);
          setDraft(merged);
          setCatalystGateSettings(merged);
          applyDraftToInputs(merged);
        }
      })
      .catch(() => {});
  }, [applyDraftToInputs, setCatalystGateSettings]);

  const markDirty = () => setDirty(true);

  const updateDraft = (next: Partial<CatalystGateSettings>) => {
    setDraft((prev) => normalizeCatalystGateSettings({ ...prev, ...next }));
    markDirty();
  };

  const commitPrice = () => {
    const usd = parsePriceFloorInput(priceInput);
    updateDraft({ priceFloorUsd: usd, requirePriceFloor: usd > 0 });
    setPriceInput(usd > 0 ? String(usd) : "0");
  };

  const commitMarketCap = () => {
    const usd = parseMarketCapBillionsInput(marketCapInput);
    updateDraft({ marketCapFloorUsd: usd, requireMicroCapFloor: usd > 0 });
    setMarketCapInput(marketCapUsdToBillionsInput(usd));
  };

  const commitVolume = () => {
    const n = parseVolumeFloorInput(volumeInput);
    updateDraft({ avgVolumeFloor: n, requireVolumeFloor: n > 0 });
    setVolumeInput(volumeFloorToInput(n));
  };

  const save = useCallback(async () => {
    const merged = normalizeCatalystGateSettings(draft);
    setCatalystGateSettings(merged);
    applyDraftToInputs(merged);
    try {
      const res = await fetchWithAuth("/api/catalysts/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: merged }),
      });
      if (!res.ok) throw new Error("save failed");
      setSavedHint("Saved");
      setDirty(false);
      setTimeout(() => setSavedHint(""), 2000);
    } catch {
      setSavedHint("Save failed");
    }
  }, [applyDraftToInputs, draft, setCatalystGateSettings]);

  const toggle = (key: keyof CatalystGateSettings) => {
    const v = draft[key];
    if (typeof v === "boolean") {
      updateDraft({ [key]: !v } as Partial<CatalystGateSettings>);
    }
  };

  const lim = CATALYST_GATE_LIMITS;

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <p className="font-mono leading-relaxed" style={{ color: MUTED, fontSize: MIN_FONT_PX }}>
        Type exact values below, then tap <strong style={{ color: TEXT, fontWeight: 600 }}>Save gates</strong>.
        Refresh Catalysts after saving to rebuild the list.
        {savedHint ? <span style={{ color: GOLD, marginLeft: 8 }}>{savedHint}</span> : null}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="font-mono px-3 py-1.5 rounded-lg border"
          style={{ fontSize: MIN_FONT_PX, borderColor: GOLD, color: GOLD }}
          onClick={() => {
            const off = normalizeCatalystGateSettings({ ...draft, gatesEnabled: false });
            setDraft(off);
            applyDraftToInputs(off);
            markDirty();
          }}
        >
          ALL GATES OFF
        </button>
        <button
          type="button"
          className="font-mono px-3 py-1.5 rounded-lg border"
          style={{ fontSize: MIN_FONT_PX, borderColor: BORDER, color: MUTED }}
          onClick={() => {
            const d = { ...DEFAULT_CATALYST_GATE_SETTINGS };
            setDraft(d);
            applyDraftToInputs(d);
            markDirty();
          }}
        >
          RESET DEFAULTS
        </button>
        <button
          type="button"
          className="font-mono px-3 py-1.5 rounded-lg border font-bold"
          style={{
            fontSize: MIN_FONT_PX,
            borderColor: dirty ? BLUE : BORDER,
            background: dirty ? BLUE : "transparent",
            color: dirty ? TEXT : MUTED,
          }}
          onClick={() => void save()}
        >
          Save gates
        </button>
      </div>

      <div className="border border-card-border rounded-lg px-3 divide-y divide-card-border">
        <SidebarToggle
          label="Tradeability gates (master)"
          hint="Off = every harvested name in the 10-day window is eligible (still needs refresh)."
          checked={draft.gatesEnabled}
          onChange={() => toggle("gatesEnabled")}
        />
        <SidebarToggle
          label="Require options chain"
          hint="Usually the largest filter. Turn off to include names without a detected chain."
          checked={draft.requireOptionsChain}
          onChange={() => toggle("requireOptionsChain")}
        />
        <SidebarToggle
          label="Require 10-day session drift"
          hint="Off = show names even without full price history (vs S&P may be blank)."
          checked={draft.requireSessionSnapshot}
          onChange={() => toggle("requireSessionSnapshot")}
        />
        <SidebarToggle
          label="Strip leveraged / inverse ETFs"
          checked={draft.stripLeveragedEtfs}
          onChange={() => toggle("stripLeveragedEtfs")}
        />
        <SidebarToggle
          label="Minimum price floor"
          checked={draft.requirePriceFloor}
          onChange={() => toggle("requirePriceFloor")}
        />
        <GateAmountField
          label="Price floor (USD)"
          unitHint="0 = off, or e.g. 5"
          disabled={!draft.requirePriceFloor}
          inputValue={priceInput}
          onInputChange={setPriceInput}
          onCommit={commitPrice}
          formatted={
            !draft.requirePriceFloor || draft.priceFloorUsd <= 0
              ? "Off"
              : `$${draft.priceFloorUsd}+`
          }
        />
        <input
          type="range"
          min={lim.priceFloorUsd.min}
          max={lim.priceFloorUsd.max}
          step={1}
          value={draft.requirePriceFloor ? draft.priceFloorUsd : 0}
          disabled={!draft.requirePriceFloor}
          onChange={(e) => {
            const v = Number(e.target.value);
            setPriceInput(String(v));
            updateDraft({ priceFloorUsd: v, requirePriceFloor: v > 0 });
          }}
          className="w-full accent-[#FFB800] mb-2"
          style={{ height: 16, opacity: draft.requirePriceFloor ? 1 : 0.4 }}
        />
        <SidebarToggle
          label="Market cap floor"
          checked={draft.requireMicroCapFloor}
          onChange={() => toggle("requireMicroCapFloor")}
        />
        <GateAmountField
          label="Market cap minimum"
          hint="Enter billions: 0 = off, 500 = $500B, 1000 = $1T. Optional suffix B or T."
          unitHint="Billions, e.g. 500"
          disabled={!draft.requireMicroCapFloor}
          inputValue={marketCapInput}
          onInputChange={setMarketCapInput}
          onCommit={commitMarketCap}
          formatted={formatMarketCapFloorLabel(
            draft.requireMicroCapFloor ? draft.marketCapFloorUsd : 0,
          )}
        />
        <SidebarToggle
          label="Average volume floor"
          checked={draft.requireVolumeFloor}
          onChange={() => toggle("requireVolumeFloor")}
        />
        <GateAmountField
          label="Average volume minimum"
          hint="Shares/day: 0 = off, or 500K, 1.5M, 20000000"
          unitHint="e.g. 500K"
          disabled={!draft.requireVolumeFloor}
          inputValue={volumeInput}
          onInputChange={setVolumeInput}
          onCommit={commitVolume}
          formatted={formatVolumeFloorLabel(
            draft.requireVolumeFloor ? draft.avgVolumeFloor : 0,
          )}
        />
        <input
          type="range"
          min={lim.avgVolumeFloor.min}
          max={Math.min(lim.avgVolumeFloor.max, 5_000_000)}
          step={50_000}
          value={draft.requireVolumeFloor ? Math.min(draft.avgVolumeFloor, 5_000_000) : 0}
          disabled={!draft.requireVolumeFloor}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVolumeInput(volumeFloorToInput(v));
            updateDraft({ avgVolumeFloor: v, requireVolumeFloor: v > 0 });
          }}
          className="w-full accent-[#FFB800] mb-2"
          style={{ height: 16, opacity: draft.requireVolumeFloor ? 1 : 0.4 }}
        />
      </div>
    </div>
  );
}
