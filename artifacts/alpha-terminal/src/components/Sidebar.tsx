import { useTerminalStore } from "@/lib/store";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import { AuthPanel } from "./AuthPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Terminal, SlidersHorizontal, X, LayoutDashboard, ListOrdered, Gauge, BrainCircuit, Zap, MessageCircle, ChevronRight, Settings, Star, Trash2, BarChart2, ShieldCheck, LogOut } from "lucide-react";
import { useState } from "react";
import { useClerk } from "@clerk/clerk-react";
import { useAutoLock } from "@/hooks/useAutoLock";
import { useGetAvailableModels } from "@workspace/api-client-react";

const OVERLAY_LABELS: Record<string, string> = {
  sma20: "SMA 20",
  sma50: "SMA 50",
  bb: "BB",
  rsi: "RSI",
  volume: "VOL",
};

interface SidebarProps {
  onClose?: () => void;
  onOpenChat?: () => void;
}

export function Sidebar({ onClose, onOpenChat }: SidebarProps) {
  const {
    overlays, toggleOverlay,
    macroSymbols, setMacroSymbols,
    tickerTapeSymbols, setTickerTapeSymbols,
    tapeSpeed, setTapeSpeed,
    aiModel, setAiModel, aiTemp, setAiTemp,
    watchlist, removeFromWatchlist, setSymbol,
  } = useTerminalStore();

  const { contractType, setContractType, maxDte, setMaxDte } = useOptionsSettingsStore();
  const { signOut } = useClerk();
  const { minutes: autoLockMinutes, setMinutes: setAutoLockMinutes, timerOptions } = useAutoLock();

  const { data: modelsData } = useGetAvailableModels();
  const availableModels = modelsData?.models ?? ["gemini-2.5-flash", "gemini-2.5-pro"];

  const {
    settings: pulseSettings,
    setAutoRefresh: setPulseAutoRefresh,
    setAutoRefreshInterval: setPulseAutoRefreshInterval,
    setRiskTolerance: setPulseRiskTolerance,
    setShowBiasStrip: setPulseShowBiasStrip,
  } = useMarketPulseStore();

  const [macroInputs, setMacroInputs] = useState<string[]>(macroSymbols);
  const [tapeInput, setTapeInput] = useState(tickerTapeSymbols.join(", "));
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(true);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [pulseSettingsOpen, setPulseSettingsOpen] = useState(false);

  const handleMacroChange = (idx: number, val: string) => {
    const updated = [...macroInputs];
    updated[idx] = val.toUpperCase();
    setMacroInputs(updated);
  };

  const handleSaveSettings = () => {
    const validMacro = macroInputs.map(s => s.trim().toUpperCase()).filter(Boolean);
    setMacroSymbols(validMacro.length > 0 ? validMacro : macroSymbols);

    const tapeParsed = tapeInput
      .split(/[,\s]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    if (tapeParsed.length > 0) setTickerTapeSymbols(tapeParsed);

    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  };

  return (
    <div className="w-72 sm:w-80 h-full bg-[#0c0c0c] border-r border-card-border flex flex-col z-20 shadow-xl overflow-y-auto">
      <div className="p-4 sm:p-6 border-b border-card-border flex items-center gap-3">
        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0">
          <Terminal className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-sans font-black text-base sm:text-lg tracking-wider text-foreground">
            ALPHA<span className="text-primary">TERM</span>
          </h1>
          <p className="text-[9px] sm:text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Command Center v2</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors ml-auto flex-shrink-0"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="p-3 sm:p-4 space-y-3 sm:space-y-4 flex-1">
        <AuthPanel />

        <div className="pt-1">
          <Button
            onClick={() => { onOpenChat?.(); onClose?.(); }}
            className="w-full font-mono text-xs h-9 bg-[#1a1a1a] text-foreground border border-card-border hover:bg-primary/15 hover:border-primary/40 hover:text-primary transition-all tracking-wider"
          >
            <MessageCircle className="w-3.5 h-3.5 mr-2 shrink-0" />
            AI SEARCH
          </Button>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
          <button
            onClick={() => setWatchlistOpen(!watchlistOpen)}
            className="w-full flex items-center justify-between p-3 text-sm font-mono font-bold hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-primary" />
              <span className="text-foreground">WATCHLIST</span>
            </div>
            <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${watchlistOpen ? 'rotate-90' : ''}`} />
          </button>

          {watchlistOpen && (
            <div className="p-3 sm:p-4 border-t border-card-border bg-[#0c0c0c] animate-in fade-in slide-in-from-top-2">
              {watchlist.length === 0 ? (
                <p className="font-mono text-[10px] text-muted-foreground/60 text-center leading-relaxed py-2">
                  No symbols watched. Click the '+' next to a searched ticker to add it.
                </p>
              ) : (
                <div className="space-y-1">
                  {watchlist.map(sym => (
                    <div
                      key={sym}
                      className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-[#1a1a1a] transition-colors group"
                    >
                      <button
                        onClick={() => setSymbol(sym)}
                        className="font-mono text-xs text-foreground hover:text-primary transition-colors tracking-wider"
                      >
                        {sym}
                      </button>
                      <button
                        onClick={() => removeFromWatchlist(sym)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all"
                        aria-label={`Remove ${sym} from watchlist`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="w-full flex items-center justify-between p-3 text-sm font-mono font-bold hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-primary" />
              <span className="text-foreground">SETTINGS</span>
            </div>
            <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${settingsOpen ? 'rotate-90' : ''}`} />
          </button>

          {settingsOpen && (
            <div className="p-3 sm:p-4 border-t border-card-border bg-[#0c0c0c] space-y-4 animate-in fade-in slide-in-from-top-2">
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

              <div className="space-y-2">
                <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
                  <BarChart2 className="w-3 h-3" /> Options Chain
                </Label>
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

              <div className="space-y-2">
                <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
                  <BrainCircuit className="w-3 h-3" /> AI Parameters
                </Label>
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

              <Button
                onClick={handleSaveSettings}
                size="sm"
                className={`w-full font-mono text-xs h-8 transition-all border ${
                  settingsSaved
                    ? "bg-primary/10 text-primary border-primary/50"
                    : "bg-[#0c0c0c] text-primary border-primary hover:bg-primary/10"
                }`}
              >
                {settingsSaved ? "✓ SAVED" : "APPLY SETTINGS"}
              </Button>
            </div>
          )}
        </div>
        <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
          <button
            onClick={() => setPulseSettingsOpen(!pulseSettingsOpen)}
            className="w-full flex items-center justify-between p-3 text-sm font-mono font-bold hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-foreground">MARKET PULSE</span>
            </div>
            <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${pulseSettingsOpen ? 'rotate-90' : ''}`} />
          </button>

          {pulseSettingsOpen && (
            <div className="p-3 sm:p-4 border-t border-card-border bg-[#0c0c0c] space-y-3 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between">
                <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
                  <Zap className="w-3 h-3" /> Show Bias Strip
                </Label>
                <button
                  type="button"
                  onClick={() => setPulseShowBiasStrip(!pulseSettings.showBiasStrip)}
                  className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200"
                  style={{ background: pulseSettings.showBiasStrip ? "#FFB800" : "#2A2A2C" }}
                >
                  <span
                    className="inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200"
                    style={{ transform: pulseSettings.showBiasStrip ? "translateX(16px) translateY(2px)" : "translateX(2px) translateY(2px)" }}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
                  Auto-Refresh
                </Label>
                <button
                  type="button"
                  onClick={() => setPulseAutoRefresh(!pulseSettings.autoRefresh)}
                  className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200"
                  style={{ background: pulseSettings.autoRefresh ? "#FFB800" : "#2A2A2C" }}
                >
                  <span
                    className="inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200"
                    style={{ transform: pulseSettings.autoRefresh ? "translateX(16px) translateY(2px)" : "translateX(2px) translateY(2px)" }}
                  />
                </button>
              </div>

              {pulseSettings.autoRefresh && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-wider">Interval</span>
                    <span className="font-mono text-[10px] text-primary tabular-nums">{pulseSettings.autoRefreshInterval}m</span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={30}
                    step={1}
                    value={pulseSettings.autoRefreshInterval}
                    onChange={e => setPulseAutoRefreshInterval(Number(e.target.value))}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer"
                    style={{ accentColor: "#FFB800", background: "#2A2A2C" }}
                  />
                  <div className="flex justify-between">
                    <span className="font-mono text-[9px] text-gray-600">2m</span>
                    <span className="font-mono text-[9px] text-gray-600">30m</span>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium">
                  Risk Tolerance
                </Label>
                <div className="flex rounded-lg overflow-hidden border border-card-border">
                  {(["conservative", "moderate", "aggressive"] as const).map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setPulseRiskTolerance(v)}
                      className="flex-1 font-mono text-[10px] py-1.5 px-2 transition-colors capitalize"
                      style={{
                        background: pulseSettings.riskTolerance === v ? "#FFB800" : "transparent",
                        color: pulseSettings.riskTolerance === v ? "#0c0c0c" : "#9ca3af",
                      }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden shadow-sm">
          <button
            onClick={() => setSecurityOpen(!securityOpen)}
            className="w-full flex items-center justify-between p-3 text-sm font-mono font-bold hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <span className="text-foreground">SECURITY</span>
            </div>
            <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${securityOpen ? 'rotate-90' : ''}`} />
          </button>

          {securityOpen && (
            <div className="p-3 sm:p-4 border-t border-card-border bg-[#0c0c0c] space-y-3 animate-in fade-in slide-in-from-top-2">
              <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
                <ShieldCheck className="w-3 h-3" /> Auto-Lock Timer
              </Label>
              <div className="space-y-1">
                {timerOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setAutoLockMinutes(opt.value)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-mono text-[11px] transition-all ${
                      autoLockMinutes === opt.value
                        ? "bg-primary/10 text-primary border border-primary/40"
                        : "text-muted-foreground hover:bg-[#1a1a1a] hover:text-foreground border border-transparent"
                    }`}
                  >
                    <span>{opt.label}</span>
                    {autoLockMinutes === opt.value && (
                      <span className="text-[9px] text-primary/70 tracking-wider">ACTIVE</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => signOut()}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-mono text-xs font-semibold tracking-wider text-[#f23645]/80 hover:text-[#f23645] hover:bg-[#f23645]/10 border border-transparent hover:border-[#f23645]/20 transition-all"
        >
          <LogOut className="w-4 h-4" />
          SIGN OUT
        </button>
      </div>

    </div>
  );
}
