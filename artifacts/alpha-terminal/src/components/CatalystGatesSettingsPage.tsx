import { useCallback, useEffect, useRef, useState } from "react";
import {
  CATALYST_GATE_LIMITS,
  DEFAULT_CATALYST_GATE_SETTINGS,
  formatMarketCapFloorLabel,
  formatVolumeFloorLabel,
  normalizeCatalystGateSettings,
  type CatalystGateSettings,
} from "@workspace/catalysts-types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTerminalStore } from "@/lib/store";

const MIN_FONT_PX = 12;
const TEXT = "#fafafa";
const MUTED = "#a1a1aa";
const GOLD = "#FFB800";
const BORDER = "#3f3f46";

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

function GateSlider({
  label,
  hint,
  valueLabel,
  min,
  max,
  step,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
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
        <span
          className="font-mono font-bold tabular-nums shrink-0"
          style={{ color: GOLD, fontSize: MIN_FONT_PX }}
        >
          {valueLabel}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#FFB800]"
        style={{ height: 20 }}
      />
    </div>
  );
}

export function CatalystGatesSettingsPage() {
  const { catalystGateSettings, setCatalystGateSettings } = useTerminalStore();
  const [savedHint, setSavedHint] = useState("");
  const syncRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchWithAuth("/api/catalysts/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { settings?: Partial<CatalystGateSettings> } | null) => {
        if (data?.settings) {
          setCatalystGateSettings(normalizeCatalystGateSettings(data.settings));
        }
      })
      .catch(() => {});
  }, [setCatalystGateSettings]);

  const syncToServer = useCallback((settings: CatalystGateSettings) => {
    if (syncRef.current) clearTimeout(syncRef.current);
    syncRef.current = setTimeout(() => {
      fetchWithAuth("/api/catalysts/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      })
        .then(() => {
          setSavedHint("Saved");
          setTimeout(() => setSavedHint(""), 2000);
        })
        .catch(() => setSavedHint("Save failed"));
    }, 300);
  }, []);

  const patch = useCallback(
    (next: Partial<CatalystGateSettings>) => {
      const merged = normalizeCatalystGateSettings({ ...catalystGateSettings, ...next });
      setCatalystGateSettings(merged);
      syncToServer(merged);
    },
    [catalystGateSettings, setCatalystGateSettings, syncToServer],
  );

  const toggle = (key: keyof CatalystGateSettings) => {
    const v = catalystGateSettings[key];
    if (typeof v === "boolean") {
      patch({ [key]: !v } as Partial<CatalystGateSettings>);
    }
  };

  const lim = CATALYST_GATE_LIMITS;

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <p className="font-mono leading-relaxed" style={{ color: MUTED, fontSize: MIN_FONT_PX }}>
        Controls which names appear on the Catalysts tab after the earnings harvest. Change gates here,
        then tap <strong style={{ color: TEXT, fontWeight: 600 }}>Refresh</strong> on Catalysts to rebuild the list.
        {savedHint ? (
          <span style={{ color: GOLD, marginLeft: 8 }}>{savedHint}</span>
        ) : null}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="font-mono px-3 py-1.5 rounded-lg border"
          style={{ fontSize: MIN_FONT_PX, borderColor: GOLD, color: GOLD }}
          onClick={() => patch({ gatesEnabled: false })}
        >
          ALL GATES OFF
        </button>
        <button
          type="button"
          className="font-mono px-3 py-1.5 rounded-lg border"
          style={{ fontSize: MIN_FONT_PX, borderColor: BORDER, color: MUTED }}
          onClick={() => patch({ ...DEFAULT_CATALYST_GATE_SETTINGS })}
        >
          RESET DEFAULTS
        </button>
      </div>

      <div className="border border-card-border rounded-lg px-3 divide-y divide-card-border">
        <SidebarToggle
          label="Tradeability gates (master)"
          hint="Off = every harvested name in the 10-day window is eligible (still needs refresh)."
          checked={catalystGateSettings.gatesEnabled}
          onChange={() => toggle("gatesEnabled")}
        />
        <SidebarToggle
          label="Require options chain"
          hint="Usually the largest filter. Turn off to include names without a detected chain."
          checked={catalystGateSettings.requireOptionsChain}
          onChange={() => toggle("requireOptionsChain")}
        />
        <SidebarToggle
          label="Require 10-day session drift"
          hint="Off = show names even without full price history (vs S&P may be blank)."
          checked={catalystGateSettings.requireSessionSnapshot}
          onChange={() => toggle("requireSessionSnapshot")}
        />
        <SidebarToggle
          label="Strip leveraged / inverse ETFs"
          checked={catalystGateSettings.stripLeveragedEtfs}
          onChange={() => toggle("stripLeveragedEtfs")}
        />
        <SidebarToggle
          label="Minimum price floor"
          checked={catalystGateSettings.requirePriceFloor}
          onChange={() => toggle("requirePriceFloor")}
        />
        <GateSlider
          label="Price floor"
          valueLabel={
            !catalystGateSettings.requirePriceFloor || catalystGateSettings.priceFloorUsd <= 0
              ? "Off"
              : `$${catalystGateSettings.priceFloorUsd}+`
          }
          min={lim.priceFloorUsd.min}
          max={lim.priceFloorUsd.max}
          step={lim.priceFloorUsd.step}
          value={catalystGateSettings.priceFloorUsd}
          disabled={!catalystGateSettings.requirePriceFloor}
          onChange={(v) => patch({ priceFloorUsd: v, requirePriceFloor: v > 0 })}
        />
        <SidebarToggle
          label="Market cap floor"
          checked={catalystGateSettings.requireMicroCapFloor}
          onChange={() => toggle("requireMicroCapFloor")}
        />
        <GateSlider
          label="Market cap minimum"
          hint="Off, or $1B steps up to $2T (e.g. $500B–$1T for mega-cap-only weeks)."
          valueLabel={formatMarketCapFloorLabel(
            catalystGateSettings.requireMicroCapFloor ? catalystGateSettings.marketCapFloorUsd : 0,
          )}
          min={lim.marketCapFloorUsd.min}
          max={lim.marketCapFloorUsd.max}
          step={lim.marketCapFloorUsd.step}
          value={catalystGateSettings.marketCapFloorUsd}
          disabled={!catalystGateSettings.requireMicroCapFloor}
          onChange={(v) => patch({ marketCapFloorUsd: v, requireMicroCapFloor: v > 0 })}
        />
        <SidebarToggle
          label="Average volume floor"
          checked={catalystGateSettings.requireVolumeFloor}
          onChange={() => toggle("requireVolumeFloor")}
        />
        <GateSlider
          label="Average volume minimum"
          valueLabel={formatVolumeFloorLabel(
            catalystGateSettings.requireVolumeFloor ? catalystGateSettings.avgVolumeFloor : 0,
          )}
          min={lim.avgVolumeFloor.min}
          max={lim.avgVolumeFloor.max}
          step={lim.avgVolumeFloor.step}
          value={catalystGateSettings.avgVolumeFloor}
          disabled={!catalystGateSettings.requireVolumeFloor}
          onChange={(v) => patch({ avgVolumeFloor: v, requireVolumeFloor: v > 0 })}
        />
      </div>
    </div>
  );
}
