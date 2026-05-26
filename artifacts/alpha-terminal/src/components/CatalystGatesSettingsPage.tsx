import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_CATALYST_GATE_SETTINGS,
  normalizeCatalystGateSettings,
  type CatalystGateSettings,
} from "@workspace/catalysts-types";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTerminalStore } from "@/lib/store";

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
        <span className="font-mono text-[11px] text-[#e4e4e7] tracking-wide">{label}</span>
        {hint ? (
          <p className="font-mono text-[9px] text-[#71717a] mt-1 leading-relaxed">{hint}</p>
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

  return (
    <div className="space-y-5 max-w-xl mx-auto">
      <p className="font-mono text-[10px] text-muted-foreground/70 leading-relaxed">
        Controls which names appear on the Catalysts tab after the earnings harvest. Change gates here,
        then tap <strong className="text-[#e4e4e7] font-normal">Refresh</strong> on Catalysts to rebuild the list.
        {savedHint ? (
          <span className="text-[#FFB800] ml-2">{savedHint}</span>
        ) : null}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="font-mono text-[10px] px-3 py-1.5 rounded-lg border border-[#FFB800] text-[#FFB800]"
          onClick={() => patch({ gatesEnabled: false })}
        >
          ALL GATES OFF
        </button>
        <button
          type="button"
          className="font-mono text-[10px] px-3 py-1.5 rounded-lg border border-card-border text-zinc-400"
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
          label="Require 5-day session drift"
          hint="Off = show names even without equity_daily history (vs S&P may be blank)."
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
        {catalystGateSettings.requirePriceFloor && (
          <div className="py-2 pl-1 flex flex-wrap gap-2">
            {[0, 5, 10].map((usd) => (
              <button
                key={usd}
                type="button"
                className="font-mono text-[10px] px-2 py-1 rounded border"
                style={{
                  borderColor: catalystGateSettings.priceFloorUsd === usd ? "#FFB800" : "#3f3f46",
                  color: catalystGateSettings.priceFloorUsd === usd ? "#FFB800" : "#a1a1aa",
                }}
                onClick={() => patch({ priceFloorUsd: usd })}
              >
                {usd === 0 ? "OFF" : `$${usd}+`}
              </button>
            ))}
          </div>
        )}
        <SidebarToggle
          label="Market cap floor ($500M default)"
          checked={catalystGateSettings.requireMicroCapFloor}
          onChange={() => toggle("requireMicroCapFloor")}
        />
        <SidebarToggle
          label="Average volume floor (500k default)"
          checked={catalystGateSettings.requireVolumeFloor}
          onChange={() => toggle("requireVolumeFloor")}
        />
      </div>
    </div>
  );
}
