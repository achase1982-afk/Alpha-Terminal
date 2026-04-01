import { useState } from "react";
import { FullPageView } from "@/components/FullPageView";
import { AuthPanel } from "@/components/AuthPanel";
import { useTerminalStore } from "@/lib/store";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import type { MarketPulseSettings, AllowedStrategy } from "@/types/marketPulse";
import { STRATEGY_LABELS, ALL_STRATEGIES, ALL_PULSE_INDICATORS } from "@/types/marketPulse";
import { useGetAvailableModels } from "@workspace/api-client-react";
import { useAutoLock, TIMEOUT_OPTIONS, type SessionTimeoutMinutes } from "@/hooks/useAutoLock";
import { readSecurityPrefs, updateSecurityPref, type SecurityPrefs } from "@/lib/securityPrefs";
import { useBiometricRegistration } from "@/hooks/useBiometric";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useClerk } from "@clerk/clerk-react";
import {
  SlidersHorizontal, LayoutDashboard, ListOrdered, Gauge, BrainCircuit,
  Zap, ChevronRight, BarChart2, Plus, RotateCcw, Shield, LogOut,
  Fingerprint, Link2, Monitor, X,
} from "lucide-react";

const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

function useClerkSafe() {
  if (devBypass) return { signOut: () => Promise.resolve() };
  return useClerk();
}

const OVERLAY_LABELS: Record<string, string> = {
  sma20: "SMA 20",
  sma50: "SMA 50",
  bb: "BB",
  rsi: "RSI",
  volume: "VOL",
};

interface SettingsPageProps {
  onClose: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { signOut } = useClerkSafe();
  const { minutes: autoLockMinutes, setMinutes: setAutoLockMinutes } = useAutoLock();
  const [secPrefs, setSecPrefs] = useState<SecurityPrefs>(readSecurityPrefs);
  const { registerPasskey, loading: passkeyLoading, error: passkeyError, hasPasskey, webAuthnSupported } = useBiometricRegistration();

  const handleSecPrefToggle = (key: keyof SecurityPrefs, value: boolean) => {
    const updated = updateSecurityPref(key, value);
    setSecPrefs(updated);
  };

  const {
    overlays, toggleOverlay,
    macroSymbols, setMacroSymbols,
    tickerTapeSymbols, setTickerTapeSymbols,
    tapeSpeed, setTapeSpeed,
    aiModel, setAiModel, aiTemp, setAiTemp,
  } = useTerminalStore();

  const { contractType, setContractType, maxDte, setMaxDte } = useOptionsSettingsStore();

  const { data: modelsData } = useGetAvailableModels();
  const availableModels = modelsData?.models ?? ["gemini-2.5-flash", "gemini-2.5-pro"];

  const {
    settings: pulseSettings,
    updateSetting: updatePulseSetting,
    toggleStrategy,
    toggleIndicator,
    resetIndicators,
  } = useMarketPulseStore();

  const [macroInputs, setMacroInputs] = useState<string[]>(macroSymbols);
  const [tapeInput, setTapeInput] = useState(tickerTapeSymbols.join(", "));
  const [displaySaved, setDisplaySaved] = useState(false);

  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [pulseOpen, setPulseOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);

  const handleMacroChange = (idx: number, val: string) => {
    const updated = [...macroInputs];
    updated[idx] = val.toUpperCase();
    setMacroInputs(updated);
  };

  const handleSaveDisplay = () => {
    const validMacro = macroInputs.map(s => s.trim().toUpperCase()).filter(Boolean);
    setMacroSymbols(validMacro.length > 0 ? validMacro : macroSymbols);

    const tapeParsed = tapeInput
      .split(/[,\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    if (tapeParsed.length > 0) setTickerTapeSymbols(tapeParsed);

    setDisplaySaved(true);
    setTimeout(() => setDisplaySaved(false), 2000);
  };

  return (
    <FullPageView title="SETTINGS" onClose={onClose}>
      <div className="p-4 space-y-3">

        <SettingsSection
          title="CONNECTIONS"
          icon={<Link2 className="w-4 h-4 text-primary" />}
          open={connectionsOpen}
          onToggle={() => setConnectionsOpen(!connectionsOpen)}
        >
          <AuthPanel />
        </SettingsSection>

        <SettingsSection
          title="DISPLAY"
          icon={<Monitor className="w-4 h-4 text-primary" />}
          open={displayOpen}
          onToggle={() => setDisplayOpen(!displayOpen)}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
                <LayoutDashboard className="w-3 h-3" /> Macro Tickers
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map(idx => (
                  <Input
                    key={idx}
                    value={macroInputs[idx] ?? ""}
                    onChange={e => handleMacroChange(idx, e.target.value)}
                    placeholder={["SPY", "QQQ", "IWM", "VIX"][idx]}
                    className="font-mono uppercase text-xs h-8 bg-card border-card-border focus-visible:ring-primary/50 text-foreground"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    maxLength={8}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
                <ListOrdered className="w-3 h-3" /> Marquee Setup
              </Label>
              <Input
                value={tapeInput}
                onChange={e => setTapeInput(e.target.value.toUpperCase())}
                placeholder="SPY, QQQ, AAPL, TSLA..."
                className="font-mono uppercase text-xs h-8 bg-card border-card-border focus-visible:ring-primary/50 text-foreground"
                autoCorrect="off"
              />
              <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2 mt-1">
                <Gauge className="w-3 h-3" /> Scroll Speed
              </Label>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground/60">Fast</span>
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={1}
                  value={tapeSpeed}
                  onChange={e => setTapeSpeed(Number(e.target.value))}
                  className="flex-1 h-1.5 accent-primary cursor-pointer"
                />
                <span className="text-[9px] text-muted-foreground/60">Slow</span>
                <span className="font-mono text-[10px] text-primary w-6 text-right">{tapeSpeed}s</span>
              </div>
            </div>

            <Button
              onClick={handleSaveDisplay}
              size="sm"
              className={`w-full font-mono text-xs h-8 transition-all border ${
                displaySaved
                  ? "bg-primary/10 text-primary border-primary/50"
                  : "bg-[#0c0c0c] text-primary border-primary hover:bg-primary/10"
              }`}
            >
              {displaySaved ? "✓ SAVED" : "APPLY DISPLAY SETTINGS"}
            </Button>
          </div>
        </SettingsSection>

        <SettingsSection
          title="CHART"
          icon={<SlidersHorizontal className="w-4 h-4 text-primary" />}
          open={chartOpen}
          onToggle={() => setChartOpen(!chartOpen)}
        >
          <div className="space-y-2">
            <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
              <SlidersHorizontal className="w-3 h-3" /> Chart Overlays
            </Label>
            <div className="flex flex-wrap gap-2">
              {(Object.entries(overlays) as [keyof typeof overlays, boolean][]).map(([key, active]) => (
                <button
                  key={key}
                  onClick={() => toggleOverlay(key)}
                  className={`
                    px-3 py-1.5 rounded-full font-mono text-[10px] font-semibold border transition-all duration-200
                    ${active
                      ? "bg-[#1a1a1a] text-[#FFB800] border-[#FFB800]"
                      : "bg-[#1a1a1a] text-[#71717a] border-[#262626] hover:border-[#404040] hover:text-foreground"}
                  `}
                >
                  {OVERLAY_LABELS[key] ?? key.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="OPTIONS"
          icon={<BarChart2 className="w-4 h-4 text-primary" />}
          open={optionsOpen}
          onToggle={() => setOptionsOpen(!optionsOpen)}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap">Type</span>
              <Select value={contractType} onValueChange={(v) => setContractType(v as 'ALL' | 'CALL' | 'PUT')}>
                <SelectTrigger className="font-mono text-[10px] bg-card border-card-border h-8 focus:ring-primary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-card-border font-mono text-[10px]">
                  <SelectItem value="ALL" className="text-[10px]">ALL</SelectItem>
                  <SelectItem value="CALL" className="text-[10px]">CALLS</SelectItem>
                  <SelectItem value="PUT" className="text-[10px]">PUTS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap">Max DTE</span>
              <Input
                type="number"
                value={maxDte}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v) && v > 0) setMaxDte(v);
                }}
                className="font-mono text-[10px] bg-card border-card-border h-8 w-20"
              />
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="AI"
          icon={<BrainCircuit className="w-4 h-4 text-primary" />}
          open={aiOpen}
          onToggle={() => setAiOpen(!aiOpen)}
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <span className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-wider">Model</span>
              <Select value={aiModel} onValueChange={setAiModel}>
                <SelectTrigger className="font-mono text-[10px] bg-card border-card-border h-8 focus:ring-primary/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-card-border font-mono text-[10px]">
                  {availableModels.map(m => (
                    <SelectItem key={m} value={m} className="text-[10px]">{m.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-wider">Temperature</span>
                <span className="font-mono text-[10px] text-primary tabular-nums">{aiTemp.toFixed(1)}</span>
              </div>
              <Slider
                value={[aiTemp]}
                onValueChange={v => setAiTemp(v[0])}
                max={2}
                step={0.1}
                className="py-1"
              />
              <div className="flex justify-between">
                <span className="font-mono text-[9px] text-muted-foreground/40">Precise</span>
                <span className="font-mono text-[9px] text-muted-foreground/40">Creative</span>
              </div>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="MARKET PULSE"
          icon={<Zap className="w-4 h-4 text-primary" />}
          open={pulseOpen}
          onToggle={() => setPulseOpen(!pulseOpen)}
        >
          <PulseSettingsContent
            settings={pulseSettings}
            updateSetting={updatePulseSetting}
            toggleStrategy={toggleStrategy}
            toggleIndicator={toggleIndicator}
            resetIndicators={resetIndicators}
          />
        </SettingsSection>

        <SettingsSection
          title="SECURITY"
          icon={<Shield className="w-4 h-4 text-primary" />}
          open={securityOpen}
          onToggle={() => setSecurityOpen(!securityOpen)}
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
                <Shield className="w-3 h-3" /> Session Timeout
              </Label>
              <div className="flex flex-wrap gap-1">
                {TIMEOUT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setAutoLockMinutes(opt.value as SessionTimeoutMinutes)}
                    className={`px-2.5 py-1.5 rounded-md font-mono text-[10px] font-bold tracking-wide transition-all border ${
                      autoLockMinutes === opt.value
                        ? "bg-primary/20 border-primary text-primary"
                        : "bg-card border-card-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="font-mono text-[9px] text-muted-foreground/50 leading-relaxed">
                Signs you out after inactivity. A warning appears 60s before.
              </p>
            </div>

            <div className="border-t border-card-border pt-3 space-y-3">
              <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
                <Fingerprint className="w-3 h-3" /> Face ID / Biometrics
              </Label>

              {!webAuthnSupported && (
                <p className="font-mono text-[9px] text-red-400/70 leading-relaxed">
                  WebAuthn is not supported on this device.
                </p>
              )}

              {webAuthnSupported && !hasPasskey && (
                <button
                  onClick={() => void registerPasskey()}
                  disabled={passkeyLoading}
                  className="w-full flex items-center justify-center gap-2 p-2.5 rounded-lg font-mono text-[10px] font-bold tracking-wide text-primary bg-primary/10 border border-primary/20 hover:bg-primary/20 transition-all disabled:opacity-50"
                >
                  <Fingerprint className="w-3.5 h-3.5" />
                  {passkeyLoading ? "REGISTERING..." : "REGISTER FACE ID / PASSKEY"}
                </button>
              )}

              {passkeyError && (
                <p className="font-mono text-[9px] text-red-400 leading-relaxed">{passkeyError}</p>
              )}

              {webAuthnSupported && hasPasskey && (
                <p className="font-mono text-[9px] text-green-400/70 leading-relaxed flex items-center gap-1">
                  ✓ Passkey registered
                </p>
              )}

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-foreground/80">App Login</span>
                  <Switch
                    checked={secPrefs.biometricLogin}
                    onCheckedChange={(v) => handleSecPrefToggle("biometricLogin", v)}
                    disabled={!webAuthnSupported || !hasPasskey}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-foreground/80">Sensitive Data</span>
                  <Switch
                    checked={secPrefs.biometricSensitiveData}
                    onCheckedChange={(v) => handleSecPrefToggle("biometricSensitiveData", v)}
                    disabled={!webAuthnSupported || !hasPasskey}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-foreground/80">Trade Confirmation</span>
                  <Switch
                    checked={secPrefs.biometricTradeConfirmation}
                    onCheckedChange={(v) => handleSecPrefToggle("biometricTradeConfirmation", v)}
                    disabled={!webAuthnSupported || !hasPasskey}
                  />
                </div>
              </div>

              <p className="font-mono text-[9px] text-muted-foreground/50 leading-relaxed">
                Requires a registered passkey. Toggles are disabled until one is set up.
              </p>
            </div>
          </div>
        </SettingsSection>

        <div className="pt-4">
          <button
            onClick={() => void signOut()}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl font-mono text-xs font-bold tracking-wider text-red-400/80 bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all"
          >
            <LogOut className="w-4 h-4" />
            SIGN OUT
          </button>
        </div>
      </div>
    </FullPageView>
  );
}

function SettingsSection({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 text-sm font-mono font-bold hover:bg-secondary/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-foreground">{title}</span>
        </div>
        <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="p-3 sm:p-4 border-t border-card-border bg-[#0c0c0c] animate-in fade-in slide-in-from-top-2">
          {children}
        </div>
      )}
    </div>
  );
}

function SettingsToggle({
  label,
  icon,
  checked,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
        {icon} {label}
      </Label>
      <button
        type="button"
        onClick={onChange}
        className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200"
        style={{ background: checked ? "#FFB800" : "#2A2A2C" }}
      >
        <span
          className="inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200"
          style={{ transform: checked ? "translateX(16px) translateY(2px)" : "translateX(2px) translateY(2px)" }}
        />
      </button>
    </div>
  );
}

function PulseSettingsContent({
  settings,
  updateSetting,
  toggleStrategy,
  toggleIndicator,
  resetIndicators,
}: {
  settings: MarketPulseSettings;
  updateSetting: <K extends keyof MarketPulseSettings>(key: K, value: MarketPulseSettings[K]) => void;
  toggleStrategy: (s: AllowedStrategy) => void;
  toggleIndicator: (symbol: string) => void;
  resetIndicators: () => void;
}) {
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const activeIndicators = settings.pulseIndicators ?? ALL_PULSE_INDICATORS.map(i => i.symbol);
  const catalogMap = Object.fromEntries(ALL_PULSE_INDICATORS.map(i => [i.symbol, i.label]));
  const getLabel = (sym: string) => catalogMap[sym] ?? sym;

  const inactiveFromCatalog = ALL_PULSE_INDICATORS.filter(i => !activeIndicators.includes(i.symbol));
  const suggestions = addQuery.length > 0
    ? inactiveFromCatalog.filter(i =>
        i.symbol.toLowerCase().includes(addQuery.toLowerCase()) ||
        i.label.toLowerCase().includes(addQuery.toLowerCase())
      )
    : inactiveFromCatalog;

  const handleAdd = (sym: string) => {
    const clean = sym.trim().toUpperCase();
    if (!clean || activeIndicators.includes(clean)) return;
    toggleIndicator(clean);
    setAddQuery("");
    setShowSuggestions(false);
  };

  return (
    <div className="space-y-4">
      <SettingsToggle
        label="Show Bias Strip"
        icon={<Zap className="w-3 h-3" />}
        checked={settings.showBiasStrip}
        onChange={() => updateSetting("showBiasStrip", !settings.showBiasStrip)}
      />
      <SettingsToggle
        label="Auto-Refresh"
        checked={settings.autoRefresh}
        onChange={() => updateSetting("autoRefresh", !settings.autoRefresh)}
      />
      {settings.autoRefresh && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-wider">Interval</span>
            <span className="font-mono text-[10px] text-primary tabular-nums">{settings.autoRefreshInterval}m</span>
          </div>
          <input
            type="range"
            min={2}
            max={30}
            step={1}
            value={settings.autoRefreshInterval}
            onChange={e => updateSetting("autoRefreshInterval", Number(e.target.value))}
            className="w-full h-1 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: "#FFB800", background: "#2A2A2C" }}
          />
        </div>
      )}

      <div className="border-t border-card-border pt-3">
        <button
          onClick={() => setIndicatorsOpen(!indicatorsOpen)}
          className="w-full flex items-center justify-between mb-2"
        >
          <span className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-bold flex items-center gap-1.5">
            <BarChart2 className="w-3 h-3" />
            Indicators
            <span className="text-primary tabular-nums ml-1">{activeIndicators.length}</span>
          </span>
          <ChevronRight className={`w-3 h-3 text-[#71717a] transition-transform duration-200 ${indicatorsOpen ? 'rotate-90' : ''}`} />
        </button>

        {indicatorsOpen && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center justify-between pb-1">
              <span className="font-mono text-[9px] text-[#52525b] tabular-nums">{activeIndicators.length} active</span>
              <button
                onClick={resetIndicators}
                className="flex items-center gap-1 font-mono text-[9px] text-[#52525b] hover:text-[#71717a] transition-colors"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                Reset to defaults
              </button>
            </div>

            <div className="space-y-0.5 max-h-[240px] overflow-y-auto pr-0.5">
              {activeIndicators.length === 0 && (
                <div className="font-mono text-[10px] text-[#3f3f46] text-center py-3">
                  No indicators — add at least one below
                </div>
              )}
              {activeIndicators.map(sym => (
                <div
                  key={sym}
                  className="flex items-center justify-between px-2 py-1.5 rounded-md group"
                  style={{ background: "rgba(255,184,0,0.04)" }}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-mono text-[10px] text-primary font-bold tabular-nums leading-none">{sym.replace(/^\$/, '')}</span>
                    <span className="font-mono text-[9px] text-[#52525b] leading-tight truncate mt-0.5">{getLabel(sym)}</span>
                  </div>
                  <button
                    onClick={() => toggleIndicator(sym)}
                    className="flex-shrink-0 ml-2 p-1 rounded hover:bg-[#f23645]/10 text-[#3f3f46] hover:text-[#f23645] transition-colors"
                    aria-label={`Remove ${sym}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-1 relative">
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={addQuery}
                    onChange={e => { setAddQuery(e.target.value); setShowSuggestions(true); }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        if (suggestions.length > 0 && addQuery.length > 0) {
                          handleAdd(suggestions[0].symbol);
                        } else if (addQuery.length > 0) {
                          handleAdd(addQuery);
                        }
                      }
                      if (e.key === "Escape") setShowSuggestions(false);
                    }}
                    placeholder="Search or type symbol..."
                    className="w-full h-7 px-2 rounded-md font-mono text-[11px] text-[#e4e4e7] placeholder:text-[#3f3f46] border border-[#2A2A2C] focus:border-primary focus:outline-none transition-colors"
                    style={{ background: "#111113" }}
                  />
                </div>
                <button
                  onClick={() => {
                    if (suggestions.length > 0 && addQuery.length > 0) {
                      handleAdd(suggestions[0].symbol);
                    } else if (addQuery.length > 0) {
                      handleAdd(addQuery);
                    }
                  }}
                  disabled={!addQuery.trim()}
                  className="flex items-center gap-1 h-7 px-2.5 rounded-md font-mono text-[10px] font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ background: "#FFB800", color: "#000" }}
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </div>

              {showSuggestions && suggestions.length > 0 && (
                <div
                  className="absolute left-0 right-10 top-8 z-50 rounded-md border border-[#2A2A2C] overflow-y-auto max-h-[180px] shadow-xl"
                  style={{ background: "#111113" }}
                >
                  {suggestions.map(ind => (
                    <button
                      key={ind.symbol}
                      onMouseDown={() => handleAdd(ind.symbol)}
                      className="w-full text-left px-3 py-2 flex flex-col hover:bg-[#1a1a1c] transition-colors border-b border-[#1a1a1c] last:border-0"
                    >
                      <span className="font-mono text-[10px] text-primary font-bold tabular-nums">{ind.symbol.replace(/^\$/, '')}</span>
                      <span className="font-mono text-[9px] text-[#52525b] leading-tight">{ind.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-card-border pt-3">
        <span className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-bold block mb-2">Display Preferences</span>
        <div className="space-y-2">
          <SettingsToggle
            label="Show Cluster Details"
            checked={settings.showClusterDetails}
            onChange={() => updateSetting("showClusterDetails", !settings.showClusterDetails)}
          />
          <SettingsToggle
            label="Show Action Plan"
            checked={settings.showActionPlan}
            onChange={() => updateSetting("showActionPlan", !settings.showActionPlan)}
          />
          <SettingsToggle
            label="Compact Mode"
            checked={settings.compactMode}
            onChange={() => updateSetting("compactMode", !settings.compactMode)}
          />
        </div>
      </div>

      <div className="border-t border-card-border pt-3">
        <span className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-bold block mb-2">Allowed Strategies</span>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {ALL_STRATEGIES.map(s => (
            <label key={s} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={settings.allowedStrategies.includes(s)}
                onChange={() => toggleStrategy(s)}
                className="rounded border-card-border bg-transparent accent-[#FFB800] w-3.5 h-3.5"
              />
              <span className="font-mono text-[10px] text-[#a1a1aa] group-hover:text-[#e4e4e7] transition-colors">
                {STRATEGY_LABELS[s]}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-card-border pt-3 space-y-3">
        <span className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-bold block">Strategy Preferences</span>

        <div className="space-y-1">
          <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest">Default Spread Width</Label>
          <Input
            value={settings.defaultSpreadWidth}
            onChange={e => updateSetting("defaultSpreadWidth", e.target.value)}
            placeholder="e.g. $5"
            className="font-mono text-xs h-8 bg-background border-card-border"
          />
        </div>

        <div className="space-y-1">
          <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest">Account Size Tier</Label>
          <Input
            value={settings.accountSizeTier}
            onChange={e => updateSetting("accountSizeTier", e.target.value)}
            placeholder="e.g. $10k, $25k, $100k+"
            className="font-mono text-xs h-8 bg-background border-card-border"
          />
        </div>

        <div className="space-y-1">
          <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest">Preferred Tickers</Label>
          <Input
            value={settings.preferredTickers}
            onChange={e => updateSetting("preferredTickers", e.target.value)}
            placeholder="e.g. SPY, QQQ, AAPL"
            className="font-mono text-xs h-8 bg-background border-card-border"
          />
        </div>

        <div className="space-y-1">
          <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest">Max Risk Per Trade</Label>
          <Input
            value={settings.maxRiskPerTrade}
            onChange={e => updateSetting("maxRiskPerTrade", e.target.value)}
            placeholder="e.g. 2% or $500"
            className="font-mono text-xs h-8 bg-background border-card-border"
          />
        </div>
      </div>
    </div>
  );
}
