import React, { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { createPortal } from "react-dom";
import { useTerminalStore, useActiveWatchlist, type TerminalState, type NotificationEventType } from "@/lib/store";
import { useOptionsSettingsStore } from "@/lib/options-store";
import { useMarketPulseStore } from "@/stores/marketPulseStore";
import type { MarketPulseSettings, AllowedStrategy } from "@/types/marketPulse";
import { STRATEGY_LABELS, ALL_STRATEGIES, ALL_PULSE_INDICATORS } from "@/types/marketPulse";
import { useAutoLock, TIMEOUT_OPTIONS, type SessionTimeoutMinutes } from "@/hooks/useAutoLock";
import { useUICustomizationStore, ACCENT_COLORS, type ThemeAccent, type FontSize, type ChartStyle, type GridDensity, type HeaderMode, type BiasScrollSpeed } from "@/lib/ui-customization-store";
import { readSecurityPrefs, updateSecurityPref, type SecurityPrefs } from "@/lib/securityPrefs";
import { useBiometricRegistration, useWebAuthnSupported } from "@/hooks/useBiometric";
import { AuthPanel } from "./AuthPanel";
import { StrategySettings } from "./AiIntelligenceTab";
import { StrategistSettingsPanel } from "./StrategistSettingsPanel";
import { StrategistTelemetryPanel } from "./StrategistTelemetryPanel";
import { SystemSettingsPage } from "./SystemSettingsPage";
import { SidebarChat } from "./SidebarChat";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { queryClient } from "@/App";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  X, Shield, Link, Fingerprint, Power, Menu,
  Star, Activity, Briefcase, Bell,
  Zap, LineChart, LayoutDashboard, BrainCircuit,
  ChevronLeft, ChevronRight, Trash2, Plus, RotateCcw, BarChart2,
  SlidersHorizontal, Gauge, ListOrdered, CalendarDays, Palette,
  AlertTriangle, Settings2,
} from "lucide-react";
import { MarketCalendar } from "@/components/MarketCalendar";
import { TelemetryPage, useTelemetryCount } from "@/components/TelemetryPage";
import { useClerk } from "@clerk/clerk-react";

const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

function useClerkSafe() {
  if (devBypass) return { signOut: () => Promise.resolve() };
  return useClerk();
}

type SidebarPage =
  | null
  | "Watchlist"
  | "Calendar"
  | "Linked Brokerage"
  | "Market Pulse"
  | "Strategist Settings"
  | "Strategist Telemetry"
  | "Chart & Options"
  | "Display & Marquee"
  | "AI Parameters"
  | "UI Customization"
  | "Security & Privacy"
  | "Telemetry"
  | "Notifications"
  | "System";

export interface SidebarHandle {
  clearActivePage: () => void;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenChat?: () => void;
  onNavigate?: (dest: "markets" | "portfolio") => void;
  onToggle?: () => void;
}

function MenuRow({ icon, label, onClick, badge }: { icon: React.ReactNode; label: string; onClick: () => void; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-card/50 transition-colors text-left group"
    >
      <div className="text-white group-hover:text-primary transition-colors">
        {React.cloneElement(icon as React.ReactElement<any>, { className: "w-5 h-5" })}
      </div>
      <span className="font-bold text-[15px] text-white tracking-wide">{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          marginLeft: "auto",
          background: "#f23645",
          color: "#fff",
          fontSize: 10,
          fontWeight: 800,
          padding: "1px 6px",
          borderRadius: 8,
          minWidth: 18,
          textAlign: "center",
          lineHeight: "16px",
        }}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}

export const Sidebar = forwardRef<SidebarHandle, SidebarProps>(function Sidebar({ isOpen, onClose, onOpenChat, onNavigate }, ref) {
  const { signOut } = useClerkSafe();
  const [activePage, setActivePage] = useState<SidebarPage>(null);
  const telemetryCount = useTelemetryCount();

  useImperativeHandle(ref, () => ({ clearActivePage: () => setActivePage(null) }), []);

  const handleCloseAll = () => {
    setActivePage(null);
    onClose();
  };

  const [headerHeight, setHeaderHeight] = useState(80);
  useEffect(() => {
    const el = document.getElementById("terminal-header");
    if (!el) return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().bottom);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      {activePage && createPortal(
        <div
          className="fixed left-0 right-0 z-[100] bg-background animate-in slide-in-from-bottom-8 duration-300 flex flex-col shadow-2xl border-t border-card-border"
          style={{ top: `${headerHeight}px`, bottom: "80px" }}
        >
          {activePage !== "Calendar" && (
            <div className="flex items-center justify-between p-3 border-b border-card-border bg-[#141414]">
              <h2 className="font-bold text-sm tracking-widest text-white uppercase ml-2">{activePage}</h2>
              <button
                onClick={() => setActivePage(null)}
                className="p-1.5 text-muted-foreground hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}

          <div className={`flex-1 overflow-y-auto pb-4 ${activePage === "Calendar" ? "px-3 pt-1 pb-3" : "p-4 sm:p-6"}`}>
            {activePage === "Watchlist" && <WatchlistPage onClose={handleCloseAll} />}
            {activePage === "Calendar" && <MarketCalendar onClose={() => setActivePage(null)} />}
            {activePage === "Linked Brokerage" && <LinkedBrokeragePage />}
            {activePage === "Market Pulse" && <MarketPulsePage />}
            {activePage === "Strategist Settings" && <StrategistSettingsPage />}
            {activePage === "Strategist Telemetry" && <StrategistTelemetryPanel />}
            {activePage === "Chart & Options" && <ChartOptionsPage />}
            {activePage === "Display & Marquee" && <DisplayMarqueePage />}
            {activePage === "AI Parameters" && <AiParametersPage />}
            {activePage === "UI Customization" && <UICustomizationPage />}
            {activePage === "Security & Privacy" && <SecurityPrivacyPage />}
            {activePage === "Telemetry" && <TelemetryPage />}
            {activePage === "Notifications" && <NotificationsPage />}
            {activePage === "System" && <SystemSettingsPage />}
          </div>
        </div>,
        document.body
      )}

      {createPortal(
        <>
          <div
            className={`fixed inset-0 bg-black/60 z-[110] transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            onClick={activePage ? onClose : handleCloseAll}
          />

          <div className={`fixed top-0 left-0 h-full w-[280px] sm:w-[320px] bg-[#0c0c0c] border-r border-card-border z-[120] transform transition-transform duration-300 flex flex-col ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>

            <div className="h-12 bg-card shrink-0 border-b border-card-border flex items-center px-4">
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors"
                aria-label="Close menu"
              >
                <Menu className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              <div className="flex flex-col pb-2">
                <MenuRow icon={<CalendarDays />} label="Calendar" onClick={() => { setActivePage("Calendar"); onClose(); }} />
                <MenuRow icon={<Briefcase />} label="Portfolio" onClick={() => { onNavigate?.("portfolio"); handleCloseAll(); }} />
              </div>

              <div className="mx-5 border-b border-card-border/50" />

              <div className="flex flex-col pt-2 pb-2">
                <MenuRow icon={<Link />} label="Linked Brokerage" onClick={() => { setActivePage("Linked Brokerage"); onClose(); }} />
                <MenuRow icon={<Zap />} label="Market Pulse" onClick={() => { setActivePage("Market Pulse"); onClose(); }} />
                <MenuRow icon={<SlidersHorizontal />} label="Options Strategist" onClick={() => { setActivePage("Strategist Settings"); onClose(); }} />
                <MenuRow icon={<Activity />} label="Strategist Telemetry" onClick={() => { setActivePage("Strategist Telemetry"); onClose(); }} />
                <MenuRow icon={<LineChart />} label="Chart & Options" onClick={() => { setActivePage("Chart & Options"); onClose(); }} />
                <MenuRow icon={<LayoutDashboard />} label="Display & Marquee" onClick={() => { setActivePage("Display & Marquee"); onClose(); }} />
                <MenuRow icon={<BrainCircuit />} label="AI Parameters" onClick={() => { setActivePage("AI Parameters"); onClose(); }} />
                <MenuRow icon={<Palette />} label="UI Customization" onClick={() => { setActivePage("UI Customization"); onClose(); }} />
                <MenuRow icon={<Bell />} label="Notifications" onClick={() => { setActivePage("Notifications"); onClose(); }} />
                <MenuRow icon={<AlertTriangle />} label="Telemetry" badge={telemetryCount} onClick={() => { setActivePage("Telemetry"); onClose(); }} />
                <MenuRow icon={<Settings2 />} label="System" onClick={() => { setActivePage("System"); onClose(); }} />
                <MenuRow icon={<Shield />} label="Security & Privacy" onClick={() => { setActivePage("Security & Privacy"); onClose(); }} />
              </div>

              <div className="mx-5 border-b border-card-border/50 mt-2" />

              <div className="px-3 pt-3">
                <SidebarChat />
              </div>

              <div className="pt-6 pb-10 pl-5">
                <button
                  onClick={() => { queryClient.clear(); void signOut(); }}
                  className="flex items-center gap-3 transition-opacity hover:opacity-70 active:opacity-50"
                >
                  <Power className="w-[22px] h-[22px] text-white/80" strokeWidth={2.5} />
                  <span className="font-extrabold text-[17px] tracking-[0.15em] uppercase text-white/90">Logout</span>
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  );
});

function WatchlistPage({ onClose }: { onClose: () => void }) {
  const { removeFromWatchlist, setSymbol, streamPrices } = useTerminalStore();
  const watchlist = useActiveWatchlist();

  return (
    <div className="space-y-3 max-w-xl mx-auto">
      <h3 className="text-xs font-bold text-primary uppercase tracking-widest">Saved Symbols</h3>
      {watchlist.length === 0 ? (
        <p className="font-mono text-[10px] text-muted-foreground/60 text-center leading-relaxed py-6">
          No symbols watched. Click the '+' next to a searched ticker to add it.
        </p>
      ) : (
        <div className="space-y-1">
          {watchlist.map((sym) => {
            const q = streamPrices[sym];
            const cColor = q?.change != null ? (q.change > 0 ? "#22c55e" : q.change < 0 ? "#ef4444" : "#71717a") : "#71717a";
            return (
              <div key={sym} className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-[#1a1a1a] transition-colors group">
                <button
                  onClick={() => { setSymbol(sym); onClose(); }}
                  className="flex items-center gap-3 font-mono text-sm text-foreground hover:text-primary transition-colors tracking-wider font-bold"
                >
                  <span>{sym}</span>
                  {q?.last != null && (
                    <span className="text-[10px] font-normal tabular-nums" style={{ color: cColor }}>
                      ${q.last.toFixed(2)}
                      {q.changePct != null && ` (${q.changePct > 0 ? "+" : ""}${q.changePct.toFixed(2)}%)`}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => removeFromWatchlist(sym)}
                  className="p-1.5 rounded text-muted-foreground hover:text-destructive active:text-destructive transition-all"
                  aria-label={`Remove ${sym}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LinkedBrokeragePage() {
  return (
    <div className="max-w-xl mx-auto">
      <div className="rounded-lg border border-zinc-800/50 bg-[#0c0c0c] p-4">
        <AuthPanel />
      </div>
    </div>
  );
}

function MarketPulsePage() {
  const {
    settings,
    updateSetting,
    toggleStrategy,
    toggleIndicator,
    resetIndicators,
  } = useMarketPulseStore();

  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const activeIndicators = settings.pulseIndicators ?? ALL_PULSE_INDICATORS.map((i) => i.symbol);
  const catalogMap = Object.fromEntries(ALL_PULSE_INDICATORS.map((i) => [i.symbol, i.label]));
  const getLabel = (sym: string) => catalogMap[sym] ?? sym;

  const inactiveFromCatalog = ALL_PULSE_INDICATORS.filter((i) => !activeIndicators.includes(i.symbol));
  const suggestions =
    addQuery.length > 0
      ? inactiveFromCatalog.filter(
          (i) => i.symbol.toLowerCase().includes(addQuery.toLowerCase()) || i.label.toLowerCase().includes(addQuery.toLowerCase())
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
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="space-y-3">
        <SidebarToggle label="Show Bias Strip" icon={<Zap className="w-3 h-3" />} checked={settings.showBiasStrip} onChange={() => updateSetting("showBiasStrip", !settings.showBiasStrip)} />
        <SidebarToggle label="Auto-Refresh" checked={settings.autoRefresh} onChange={() => updateSetting("autoRefresh", !settings.autoRefresh)} />
        {settings.autoRefresh && (
          <div className="space-y-1.5 pl-1">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-wider">Interval</span>
              <span className="font-mono text-[10px] text-primary tabular-nums">{settings.autoRefreshInterval}m</span>
            </div>
            <input type="range" min={2} max={30} step={1} value={settings.autoRefreshInterval} onChange={(e) => updateSetting("autoRefreshInterval", Number(e.target.value))} className="w-full h-1 rounded-full appearance-none cursor-pointer" style={{ accentColor: "#FFB800", background: "#2A2A2C" }} />
          </div>
        )}
      </div>

      <div className="border-t border-card-border pt-4">
        <button onClick={() => setIndicatorsOpen(!indicatorsOpen)} className="w-full flex items-center justify-between mb-2">
          <span className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-bold flex items-center gap-1.5">
            <BarChart2 className="w-3 h-3" /> Indicators <span className="text-primary tabular-nums ml-1">{activeIndicators.length}</span>
          </span>
          <ChevronLeft className={`w-3 h-3 text-[#71717a] transition-transform duration-200 ${indicatorsOpen ? "-rotate-90" : "rotate-180"}`} />
        </button>

        {indicatorsOpen && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
            <div className="flex items-center justify-between pb-1">
              <span className="font-mono text-[9px] text-[#52525b] tabular-nums">{activeIndicators.length} active</span>
              <button onClick={resetIndicators} className="flex items-center gap-1 font-mono text-[9px] text-[#52525b] hover:text-[#71717a] transition-colors">
                <RotateCcw className="w-2.5 h-2.5" /> Reset
              </button>
            </div>
            <div className="space-y-0.5 max-h-[240px] overflow-y-auto pr-0.5">
              {activeIndicators.map((sym) => (
                <div key={sym} className="flex items-center justify-between px-2 py-1.5 rounded-md group">
                  <div className="flex flex-col min-w-0">
                    <span className="font-mono text-[10px] text-primary font-bold tabular-nums leading-none">{sym.replace(/^\$/, "")}</span>
                    <span className="font-mono text-[9px] text-[#52525b] leading-tight truncate mt-0.5">{getLabel(sym)}</span>
                  </div>
                  <button onClick={() => toggleIndicator(sym)} className="flex-shrink-0 ml-2 p-1 rounded hover:bg-[#f23645]/10 text-[#3f3f46] hover:text-[#f23645] transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="pt-1 relative">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={addQuery}
                  onChange={(e) => { setAddQuery(e.target.value); setShowSuggestions(true); }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { if (suggestions.length > 0) handleAdd(suggestions[0].symbol); else if (addQuery.length > 0) handleAdd(addQuery); }
                    if (e.key === "Escape") setShowSuggestions(false);
                  }}
                  placeholder="Search or type symbol..."
                  className="w-full h-7 px-2 rounded-md font-mono text-[11px] text-[#e4e4e7] placeholder:text-[#3f3f46] border border-[#2A2A2C] focus:border-primary focus:outline-none transition-colors"
                  style={{ background: "#111113" }}
                />
                <button
                  onClick={() => { if (suggestions.length > 0 && addQuery.length > 0) handleAdd(suggestions[0].symbol); else if (addQuery.length > 0) handleAdd(addQuery); }}
                  disabled={!addQuery.trim()}
                  className="flex items-center gap-1 h-7 px-2.5 rounded-md font-mono text-[10px] font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{ background: "#FFB800", color: "#000" }}
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 right-10 top-8 z-50 rounded-md border border-[#2A2A2C] overflow-y-auto max-h-[180px] shadow-xl" style={{ background: "#111113" }}>
                  {suggestions.map((ind) => (
                    <button key={ind.symbol} onMouseDown={() => handleAdd(ind.symbol)} className="w-full text-left px-3 py-2 flex flex-col hover:bg-[#1a1a1c] transition-colors border-b border-[#1a1a1c] last:border-0">
                      <span className="font-mono text-[10px] text-primary font-bold tabular-nums">{ind.symbol.replace(/^\$/, "")}</span>
                      <span className="font-mono text-[9px] text-[#52525b] leading-tight">{ind.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-card-border pt-4">
        <span className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-bold block mb-2">Display Preferences</span>
        <div className="space-y-2">
          <SidebarToggle label="Show Cluster Details" checked={settings.showClusterDetails} onChange={() => updateSetting("showClusterDetails", !settings.showClusterDetails)} />
          <SidebarToggle label="Show Action Plan" checked={settings.showActionPlan} onChange={() => updateSetting("showActionPlan", !settings.showActionPlan)} />
          <SidebarToggle label="Compact Mode" checked={settings.compactMode} onChange={() => updateSetting("compactMode", !settings.compactMode)} />
        </div>
      </div>

      <div className="border-t border-card-border pt-4">
        <span className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-bold block mb-2">Allowed Strategies</span>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {ALL_STRATEGIES.map((s) => (
            <label key={s} className="flex items-center gap-2 cursor-pointer group">
              <input type="checkbox" checked={settings.allowedStrategies.includes(s)} onChange={() => toggleStrategy(s)} className="rounded border-card-border bg-transparent accent-[#FFB800] w-3.5 h-3.5" />
              <span className="font-mono text-[10px] text-[#a1a1aa] group-hover:text-[#e4e4e7] transition-colors">{STRATEGY_LABELS[s]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="border-t border-card-border pt-4 space-y-3">
        <span className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-bold block">Strategy Preferences</span>
        <SettingInput label="Default Spread Width" value={settings.defaultSpreadWidth} onChange={(v) => updateSetting("defaultSpreadWidth", v)} placeholder="e.g. $5" />
        <SettingInput label="Account Size Tier" value={settings.accountSizeTier} onChange={(v) => updateSetting("accountSizeTier", v)} placeholder="e.g. $10k, $25k, $100k+" />
        <SettingInput label="Preferred Tickers" value={settings.preferredTickers} onChange={(v) => updateSetting("preferredTickers", v)} placeholder="e.g. SPY, QQQ, AAPL" />
        <SettingInput label="Max Risk Per Trade" value={settings.maxRiskPerTrade} onChange={(v) => updateSetting("maxRiskPerTrade", v)} placeholder="e.g. 2% or $500" />
      </div>
    </div>
  );
}

function StrategistSettingsPage() {
  return (
    <div className="space-y-8">
      <StrategistSettingsPanel />
      <div className="border-t border-zinc-800 pt-6 space-y-4">
        <h3 className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest font-medium">Legacy AI Parameters</h3>
        <StrategySettings />
      </div>
    </div>
  );
}

function ChartOptionsPage() {
  const { overlays, toggleOverlay } = useTerminalStore();
  const { contractType, setContractType, maxDte, setMaxDte } = useOptionsSettingsStore();

  const OVERLAY_LABELS: Record<string, string> = { sma20: "SMA 20", sma50: "SMA 50", bb: "BB", rsi: "RSI", volume: "VOL" };

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="space-y-3">
        <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
          <SlidersHorizontal className="w-3 h-3" /> Chart Overlays
        </Label>
        <div className="flex flex-wrap gap-2">
          {(Object.entries(overlays) as [keyof typeof overlays, boolean][]).map(([key, active]) => (
            <button
              key={key}
              onClick={() => toggleOverlay(key)}
              className={`px-3 py-1.5 rounded-full font-mono text-[10px] font-semibold border transition-all duration-200 ${active ? "bg-[#1a1a1a] text-[#FFB800] border-[#FFB800]" : "bg-[#1a1a1a] text-[#71717a] border-[#262626] hover:border-[#404040] hover:text-foreground"}`}
            >
              {OVERLAY_LABELS[key] ?? key.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-card-border pt-4 space-y-3">
        <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
          <BarChart2 className="w-3 h-3" /> Options Chain
        </Label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap">Type</span>
          <Select value={contractType} onValueChange={(v) => setContractType(v as "ALL" | "CALL" | "PUT")}>
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
            onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v > 0) setMaxDte(v); }}
            className="font-mono text-[10px] bg-card border-card-border h-8 w-20"
          />
        </div>
      </div>
    </div>
  );
}

function DisplayMarqueePage() {
  const { macroSymbols, setMacroSymbols, tickerTapeSymbols, setTickerTapeSymbols, tapeSpeed, setTapeSpeed } = useTerminalStore();
  const [macroInputs, setMacroInputs] = useState<string[]>(macroSymbols);
  const [tapeInput, setTapeInput] = useState(tickerTapeSymbols.join(", "));
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    const validMacro = macroInputs.map((s) => s.trim().toUpperCase()).filter(Boolean);
    setMacroSymbols(validMacro.length > 0 ? validMacro : macroSymbols);
    const tapeParsed = tapeInput.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (tapeParsed.length > 0) setTickerTapeSymbols(tapeParsed);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div className="space-y-2">
        <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
          <LayoutDashboard className="w-3 h-3" /> Macro Tickers
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((idx) => (
            <Input
              key={idx}
              value={macroInputs[idx] ?? ""}
              onChange={(e) => { const u = [...macroInputs]; u[idx] = e.target.value.toUpperCase(); setMacroInputs(u); }}
              placeholder={["SPY", "QQQ", "IWM", "VIX"][idx]}
              className="font-mono uppercase text-xs h-8 bg-card border-card-border focus-visible:ring-primary/50 text-foreground"
              autoCapitalize="characters"
              autoCorrect="off"
              maxLength={8}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-card-border pt-4 space-y-2">
        <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
          <ListOrdered className="w-3 h-3" /> Marquee Setup
        </Label>
        <Input
          value={tapeInput}
          onChange={(e) => setTapeInput(e.target.value.toUpperCase())}
          placeholder="SPY, QQQ, AAPL, TSLA..."
          className="font-mono uppercase text-xs h-8 bg-card border-card-border focus-visible:ring-primary/50 text-foreground"
          autoCorrect="off"
        />
        <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2 mt-1">
          <Gauge className="w-3 h-3" /> Scroll Speed
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground/60">Fast</span>
          <input type="range" min={5} max={60} step={1} value={tapeSpeed} onChange={(e) => setTapeSpeed(Number(e.target.value))} className="flex-1 h-1.5 accent-primary cursor-pointer" />
          <span className="text-[9px] text-muted-foreground/60">Slow</span>
          <span className="font-mono text-[10px] text-primary w-6 text-right tabular-nums">{tapeSpeed}s</span>
        </div>
      </div>

      <button
        onClick={handleSave}
        className={`w-full font-mono text-xs h-8 rounded-md transition-all border ${saved ? "text-primary border-primary/50" : "bg-[#0c0c0c] text-primary border-primary hover:border-primary/70"}`}
      >
        {saved ? "✓ SAVED" : "APPLY SETTINGS"}
      </button>
    </div>
  );
}

const ALL_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-20250514",
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
];

const ANALYST_MODELS: Record<string, string[]> = {
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-20250514", "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219"],
  google: ["gemini-3.1-pro-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
};

const SKEPTIC_MODELS: Record<string, string[]> = {
  google: ["gemini-3.1-pro-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
  anthropic: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-20250514", "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219"],
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "ANTHROPIC (CLAUDE)",
  google: "GOOGLE (GEMINI)",
};

type AiFeatureKey = keyof TerminalState['aiFeatureSettings'];

const AI_FEATURES: Array<{
  key: AiFeatureKey;
  label: string;
  icon: string;
}> = [
  { key: 'marketPulse', label: 'MARKET PULSE', icon: '⚡' },
  { key: 'technicals',  label: 'TECHNICAL ANALYSIS', icon: '📊' },
  { key: 'strategist',  label: 'OPTIONS STRATEGIST', icon: '🎯' },
  { key: 'chat',        label: 'AI CHAT', icon: '💬' },
  { key: 'scanner',     label: 'MARKET SCANNER', icon: '🔍' },
];

function AiFeatureControl({ featureKey, label, icon }: {
  featureKey: AiFeatureKey;
  label: string;
  icon: string;
}) {
  const { aiFeatureSettings, setAiFeatureSetting } = useTerminalStore();
  const settings = aiFeatureSettings[featureKey];
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-card-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-card cursor-pointer active:bg-zinc-800/60 transition-colors"
      >
        <span className="flex items-center gap-2 font-mono text-[10px] text-white tracking-wide">
          <span>{icon}</span>
          {label}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[8px] text-zinc-500 tracking-wider">
            {settings.model.replace('claude-', '').toUpperCase()}
          </span>
          <ChevronRight className={`w-3 h-3 text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </span>
      </button>

      {expanded && (
        <div className="px-3 py-3 space-y-3 bg-[#0a0a0a] border-t border-card-border">
          <div className="space-y-1.5">
            <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Model</span>
            <select
              value={settings.model}
              onChange={(e) => setAiFeatureSetting(featureKey, 'model', e.target.value)}
              className="w-full bg-card border border-card-border rounded-md px-2 py-2 font-mono text-[10px] text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
            >
              {ALL_MODELS.map((m) => (
                <option key={m} value={m}>{m.toUpperCase()}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Temperature</span>
              <span className="font-mono text-[10px] text-primary tabular-nums">{settings.temperature.toFixed(1)}</span>
            </div>
            <Slider
              value={[settings.temperature]}
              onValueChange={(v) => setAiFeatureSetting(featureKey, 'temperature', v[0])}
              max={2}
              step={0.1}
              className="py-1"
            />
            <div className="flex justify-between">
              <span className="font-mono text-[8px] text-zinc-600">Precise</span>
              <span className="font-mono text-[8px] text-zinc-600">Creative</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AiLabStrategistControl() {
  const { aiLabStrategistConfig, setAiLabStrategistConfig } = useTerminalStore();
  const [expanded, setExpanded] = useState(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncToBackend = useCallback((cfg: typeof aiLabStrategistConfig) => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      fetch("/api/ai-lab/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }).catch(() => {});
    }, 300);
  }, []);

  const update = useCallback((key: string, value: string | number | boolean) => {
    setAiLabStrategistConfig(key, value);
    const next = { ...aiLabStrategistConfig, [key]: value };

    if (key === "analystModelProvider") {
      const models = ANALYST_MODELS[value as string] ?? [];
      if (models.length > 0 && !models.includes(aiLabStrategistConfig.analystModelName)) {
        setAiLabStrategistConfig("analystModelName", models[0]);
        next.analystModelName = models[0];
      }
    }
    if (key === "skepticModelProvider") {
      const models = SKEPTIC_MODELS[value as string] ?? [];
      if (models.length > 0 && !models.includes(aiLabStrategistConfig.skepticModelName)) {
        setAiLabStrategistConfig("skepticModelName", models[0]);
        next.skepticModelName = models[0];
      }
    }

    syncToBackend(next);
  }, [aiLabStrategistConfig, setAiLabStrategistConfig, syncToBackend]);

  const analystModels = ANALYST_MODELS[aiLabStrategistConfig.analystModelProvider] ?? [];
  const skepticModels = SKEPTIC_MODELS[aiLabStrategistConfig.skepticModelProvider] ?? [];

  const selectStyle = {
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat' as const,
    backgroundPosition: 'right 8px center',
  };

  return (
    <div className="border border-card-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-card cursor-pointer active:bg-zinc-800/60 transition-colors"
      >
        <span className="flex items-center gap-2 font-mono text-[10px] text-white tracking-wide">
          <span>🧪</span>
          AI LAB STRATEGIST
        </span>
        <span className="flex items-center gap-2">
          <span className={`font-mono text-[8px] tracking-wider ${aiLabStrategistConfig.enabled ? 'text-[#2ecc71]' : 'text-zinc-500'}`}>
            {aiLabStrategistConfig.enabled ? 'LIVE' : 'OFF'}
          </span>
          <ChevronRight className={`w-3 h-3 text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </span>
      </button>

      {expanded && (
        <div className="px-3 py-3 space-y-4 bg-[#0a0a0a] border-t border-card-border">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Enabled</span>
            <Switch
              checked={aiLabStrategistConfig.enabled}
              onCheckedChange={(v) => update('enabled', v)}
            />
          </div>

          <div className="h-px bg-zinc-800" />

          <div className="space-y-2">
            <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-widest font-medium">Analyst Model</span>

            <div className="space-y-1.5">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Provider</span>
              <select
                value={aiLabStrategistConfig.analystModelProvider}
                onChange={(e) => update('analystModelProvider', e.target.value)}
                className="w-full bg-card border border-card-border rounded-md px-2 py-2 font-mono text-[10px] text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                style={selectStyle}
              >
                {Object.entries(PROVIDER_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Model</span>
              <select
                value={aiLabStrategistConfig.analystModelName}
                onChange={(e) => update('analystModelName', e.target.value)}
                className="w-full bg-card border border-card-border rounded-md px-2 py-2 font-mono text-[10px] text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                style={selectStyle}
              >
                {analystModels.map((m) => (
                  <option key={m} value={m}>{m.toUpperCase()}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Temperature</span>
                <span className="font-mono text-[10px] text-primary tabular-nums">{aiLabStrategistConfig.analystTemperature.toFixed(1)}</span>
              </div>
              <Slider
                value={[aiLabStrategistConfig.analystTemperature]}
                onValueChange={(v) => update('analystTemperature', v[0])}
                max={1}
                step={0.1}
                className="py-1"
              />
              <div className="flex justify-between">
                <span className="font-mono text-[8px] text-zinc-600">Precise</span>
                <span className="font-mono text-[8px] text-zinc-600">Creative</span>
              </div>
            </div>
          </div>

          <div className="h-px bg-zinc-800" />

          <div className="space-y-2">
            <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-widest font-medium">Skeptic Model</span>

            <div className="space-y-1.5">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Provider</span>
              <select
                value={aiLabStrategistConfig.skepticModelProvider}
                onChange={(e) => update('skepticModelProvider', e.target.value)}
                className="w-full bg-card border border-card-border rounded-md px-2 py-2 font-mono text-[10px] text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                style={selectStyle}
              >
                {Object.entries(PROVIDER_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Model</span>
              <select
                value={aiLabStrategistConfig.skepticModelName}
                onChange={(e) => update('skepticModelName', e.target.value)}
                className="w-full bg-card border border-card-border rounded-md px-2 py-2 font-mono text-[10px] text-white focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
                style={selectStyle}
              >
                {skepticModels.map((m) => (
                  <option key={m} value={m}>{m.toUpperCase()}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest">Temperature</span>
                <span className="font-mono text-[10px] text-primary tabular-nums">{aiLabStrategistConfig.skepticTemperature.toFixed(1)}</span>
              </div>
              <Slider
                value={[aiLabStrategistConfig.skepticTemperature]}
                onValueChange={(v) => update('skepticTemperature', v[0])}
                max={1}
                step={0.1}
                className="py-1"
              />
              <div className="flex justify-between">
                <span className="font-mono text-[8px] text-zinc-600">Precise</span>
                <span className="font-mono text-[8px] text-zinc-600">Creative</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AiParametersPage() {
  const { aiFeatureSettings, setAiFeatureSetting } = useTerminalStore();

  const [globalTemp, setGlobalTemp] = useState(0);

  const setAllModels = (model: string) => {
    for (const f of AI_FEATURES) {
      setAiFeatureSetting(f.key, 'model', model);
    }
  };

  const setAllTemps = (temp: number) => {
    setGlobalTemp(temp);
    for (const f of AI_FEATURES) {
      setAiFeatureSetting(f.key, 'temperature', temp);
    }
  };

  return (
    <div className="space-y-4 max-w-xl mx-auto">
      <div className="space-y-1.5">
        <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
          <BrainCircuit className="w-3 h-3" /> Set All Models
        </Label>
        <select
          value=""
          onChange={(e) => { if (e.target.value) setAllModels(e.target.value); }}
          className="w-full bg-card border border-card-border rounded-md px-2 py-2 font-mono text-[10px] text-zinc-400 focus:outline-none focus:border-primary/50 appearance-none cursor-pointer"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
        >
          <option value="" disabled>Apply one model to all features...</option>
          {ALL_MODELS.map((m) => (
            <option key={m} value={m}>{m.toUpperCase()}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest font-medium flex items-center gap-2">
          <Gauge className="w-3 h-3" /> Set All Temperatures
        </Label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={globalTemp}
            onChange={(e) => setAllTemps(parseFloat(e.target.value))}
            className="flex-1 h-1.5 accent-[#FFB800] cursor-pointer"
          />
          <span className="font-mono text-[10px] text-zinc-400 w-7 text-right">{globalTemp.toFixed(1)}</span>
        </div>
      </div>

      <div className="h-px bg-zinc-800" />

      <div className="space-y-2">
        {AI_FEATURES.map((f) => (
          <AiFeatureControl key={f.key} featureKey={f.key} label={f.label} icon={f.icon} />
        ))}
        <AiLabStrategistControl />
      </div>
    </div>
  );
}

function UICustomizationPage() {
  const {
    accentColor, fontSize, defaultChartStyle, gridDensity,
    showTickerTape, showAiBiasStrip, showMiniCards, animatePriceChanges, hapticFeedback, reducedMotion,
    headerMode, biasScrollSpeed,
    setAccentColor, setFontSize, setDefaultChartStyle, setGridDensity,
    setHeaderMode,
    setShowTickerTape, setShowAiBiasStrip, setShowMiniCards, setAnimatePriceChanges, setHapticFeedback, setReducedMotion,
    setBiasScrollSpeed, resetDefaults,
  } = useUICustomizationStore();

  const accents: { key: ThemeAccent; label: string }[] = [
    { key: "gold", label: "Gold" },
    { key: "blue", label: "Blue" },
    { key: "green", label: "Green" },
    { key: "orange", label: "Orange" },
    { key: "purple", label: "Purple" },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label className="text-[11px] font-bold tracking-[0.15em] text-muted-foreground uppercase">Accent Color</Label>
        <div className="flex gap-2">
          {accents.map(a => (
            <button
              key={a.key}
              onClick={() => setAccentColor(a.key)}
              className="flex flex-col items-center gap-1"
            >
              <div
                className="w-9 h-9 rounded-full border-2 transition-all"
                style={{
                  background: ACCENT_COLORS[a.key],
                  borderColor: accentColor === a.key ? "#fff" : "transparent",
                  boxShadow: accentColor === a.key ? `0 0 12px ${ACCENT_COLORS[a.key]}60` : "none",
                }}
              />
              <span className="text-[9px] font-medium" style={{ color: accentColor === a.key ? "#fff" : "#71717a" }}>{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-[11px] font-bold tracking-[0.15em] text-muted-foreground uppercase">Header Behavior</Label>
        <div className="flex gap-1.5">
          {([
            { key: "auto" as HeaderMode, label: "Auto", desc: "Collapses on scroll" },
            { key: "collapsed" as HeaderMode, label: "Compact", desc: "Always collapsed" },
            { key: "expanded" as HeaderMode, label: "Full", desc: "Always expanded" },
          ]).map(opt => (
            <button
              key={opt.key}
              onClick={() => setHeaderMode(opt.key)}
              className="flex-1 flex flex-col items-center gap-0.5 py-2.5 px-1 rounded-lg border transition-all"
              style={{
                borderColor: headerMode === opt.key ? "#fbbf24" : "#1a1a1a",
                background: headerMode === opt.key ? "rgba(251,191,36,0.08)" : "transparent",
              }}
            >
              <span className="text-[11px] font-bold" style={{ color: headerMode === opt.key ? "#fbbf24" : "#fff" }}>{opt.label}</span>
              <span className="text-[8px] leading-tight text-center" style={{ color: "#71717a" }}>{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-[11px] font-bold tracking-[0.15em] text-muted-foreground uppercase">Font Size</Label>
        <Select value={fontSize} onValueChange={(v) => setFontSize(v as FontSize)}>
          <SelectTrigger className="bg-card border-card-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="compact">Compact</SelectItem>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="large">Large</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <Label className="text-[11px] font-bold tracking-[0.15em] text-muted-foreground uppercase">Default Chart Style</Label>
        <Select value={defaultChartStyle} onValueChange={(v) => setDefaultChartStyle(v as ChartStyle)}>
          <SelectTrigger className="bg-card border-card-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="candles">Candlestick</SelectItem>
            <SelectItem value="bars">OHLC Bars</SelectItem>
            <SelectItem value="line">Line</SelectItem>
            <SelectItem value="area">Area</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <Label className="text-[11px] font-bold tracking-[0.15em] text-muted-foreground uppercase">Grid Density</Label>
        <Select value={gridDensity} onValueChange={(v) => setGridDensity(v as GridDensity)}>
          <SelectTrigger className="bg-card border-card-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tight">Tight</SelectItem>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="relaxed">Relaxed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border-t border-card-border pt-4 space-y-4">
        <Label className="text-[11px] font-bold tracking-[0.15em] text-muted-foreground uppercase">Display</Label>

        <div className="flex items-center justify-between">
          <span className="text-sm text-white">Ticker Tape</span>
          <Switch checked={showTickerTape} onCheckedChange={setShowTickerTape} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-white">AI Bias Bar</span>
          <Switch checked={showAiBiasStrip} onCheckedChange={setShowAiBiasStrip} />
        </div>

        {showAiBiasStrip && (
          <div className="flex items-center justify-between pl-4">
            <span className="text-sm text-zinc-400">Bias Scroll Speed</span>
            <div className="flex gap-1">
              {(["off", "slow", "normal", "fast"] as BiasScrollSpeed[]).map((speed) => (
                <button
                  key={speed}
                  onClick={() => setBiasScrollSpeed(speed)}
                  className="px-2 py-1 rounded text-[10px] font-mono font-semibold uppercase tracking-wider transition-colors"
                  style={{
                    background: biasScrollSpeed === speed ? "#FFB800" : "transparent",
                    color: biasScrollSpeed === speed ? "#000" : "#71717a",
                    border: biasScrollSpeed === speed ? "none" : "1px solid #2A2A2C",
                  }}
                >
                  {speed}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm text-white">Index Mini Cards</span>
          <Switch checked={showMiniCards} onCheckedChange={setShowMiniCards} />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-white">Price Change Animations</span>
          <Switch checked={animatePriceChanges} onCheckedChange={setAnimatePriceChanges} />
        </div>
      </div>

      <div className="border-t border-card-border pt-4 space-y-4">
        <Label className="text-[11px] font-bold tracking-[0.15em] text-muted-foreground uppercase">Accessibility</Label>

        <div className="flex items-center justify-between">
          <span className="text-sm text-white">Haptic Feedback</span>
          <Switch checked={hapticFeedback} onCheckedChange={setHapticFeedback} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-white">Reduced Motion</span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Minimize animations throughout the app</p>
          </div>
          <Switch checked={reducedMotion} onCheckedChange={setReducedMotion} />
        </div>
      </div>

      <div className="border-t border-card-border pt-4">
        <button
          onClick={resetDefaults}
          className="flex items-center gap-2 text-sm font-semibold transition-colors hover:opacity-80"
          style={{ color: "#fbbf24" }}
        >
          <RotateCcw className="w-4 h-4" />
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}

function SecurityPrivacyPage() {
  const { minutes: autoLock, setMinutes: setAutoLock } = useAutoLock();
  const [secPrefs, setSecPrefs] = useState<SecurityPrefs>(readSecurityPrefs);
  const handleToggle = (key: keyof SecurityPrefs, value: boolean) => {
    const updated = updateSecurityPref(key, value);
    setSecPrefs(updated);
  };

  return (
    <div className="space-y-8 max-w-xl mx-auto">
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-primary uppercase tracking-widest">Session Timeout</h3>
        <div className="flex flex-wrap gap-2">
          {TIMEOUT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAutoLock(opt.value as SessionTimeoutMinutes)}
              className={`px-3 py-2 rounded text-xs font-bold border transition-all ${autoLock === opt.value ? "bg-primary text-black border-primary" : "bg-card text-muted-foreground border-card-border hover:border-primary/30"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="font-mono text-[9px] text-muted-foreground/50 leading-relaxed">Signs you out after inactivity.</p>
      </div>

    </div>
  );
}

function SettingInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="space-y-1">
      <Label className="font-mono text-[9px] text-[#71717a] uppercase tracking-widest">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="font-mono text-xs h-8 bg-background border-card-border" />
    </div>
  );
}

const NOTIFICATION_EVENTS: { key: NotificationEventType; label: string; description: string }[] = [
  { key: "ExecutionCreated", label: "Order Filled", description: "When an order executes and fills" },
  { key: "OrderCreated", label: "Order Created", description: "When a new order is submitted" },
  { key: "OrderAccepted", label: "Order Accepted", description: "When Schwab accepts an order" },
  { key: "OrderModified", label: "Order Modified", description: "When an order is changed" },
  { key: "OrderRejected", label: "Order Rejected", description: "When Schwab rejects an order" },
  { key: "OrderExpired", label: "Order Expired", description: "When an order expires unfilled" },
  { key: "CancelAccepted", label: "Cancel Accepted", description: "When an order cancellation succeeds" },
  { key: "CancelRejected", label: "Cancel Rejected", description: "When a cancellation is rejected" },
  { key: "OrderUROutCompleted", label: "Order Closed", description: "When an order is fully closed out" },
];

function NotificationsPage() {
  const { notificationPrefs, setNotificationPref, setNotificationChannelPref, setAllNotificationPrefs } = useTerminalStore();
  const allInApp = Object.values(notificationPrefs.inApp).every(Boolean);
  const noneInApp = Object.values(notificationPrefs.inApp).every(v => !v);
  const allPush = Object.values(notificationPrefs.push).every(Boolean);
  const nonePush = Object.values(notificationPrefs.push).every(v => !v);

  const [systemAlertsEnabled, setSystemAlertsEnabled] = useState(true);
  const [systemAlertsLoading, setSystemAlertsLoading] = useState(true);

  useEffect(() => {
    fetchWithAuth("/api/push/system-alerts")
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: { enabled: boolean }) => { setSystemAlertsEnabled(d.enabled); setSystemAlertsLoading(false); })
      .catch(() => setSystemAlertsLoading(false));
  }, []);

  const toggleSystemAlerts = useCallback((v: boolean) => {
    const prev = systemAlertsEnabled;
    setSystemAlertsEnabled(v);
    fetchWithAuth("/api/push/system-alerts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: v }),
    }).then(r => {
      if (!r.ok) throw new Error();
      return r.json();
    }).then((d: { enabled: boolean }) => {
      setSystemAlertsEnabled(d.enabled);
    }).catch(() => {
      setSystemAlertsEnabled(prev);
    });
  }, [systemAlertsEnabled]);

  return (
    <div className="space-y-6 max-w-lg">
      <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: "#1a1a1c", border: "1px solid #2a2a2c" }}>
        <div>
          <div className="font-bold text-sm text-white">Master Switch</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Turn off all notifications at once</div>
        </div>
        <Switch
          checked={notificationPrefs.masterEnabled}
          onCheckedChange={(v) => setNotificationPref("masterEnabled", v)}
        />
      </div>

      <div style={{ opacity: notificationPrefs.masterEnabled ? 1 : 0.4, pointerEvents: notificationPrefs.masterEnabled ? "auto" : "none" }}>
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-xs text-white uppercase tracking-widest">System Alerts</h3>
          </div>
          <div className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-zinc-900/50 transition-colors">
            <div>
              <div className="text-[12px] font-semibold text-white">Critical System Alerts</div>
              <div className="text-[10px] text-zinc-500">OAuth failures, stream outages, regime shocks (throttled to 1 per 5 min per system)</div>
            </div>
            <Switch
              checked={systemAlertsEnabled}
              disabled={systemAlertsLoading}
              onCheckedChange={toggleSystemAlerts}
            />
          </div>
        </div>

        <div className="h-px bg-zinc-800 my-4" />

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-xs text-white uppercase tracking-widest">In-App Alerts</h3>
            <button
              onClick={() => setAllNotificationPrefs("inApp", noneInApp || !allInApp)}
              className="text-[10px] font-mono text-primary hover:underline"
            >
              {allInApp ? "Disable All" : "Enable All"}
            </button>
          </div>
          <div className="space-y-1">
            {NOTIFICATION_EVENTS.map(evt => (
              <div key={`inApp-${evt.key}`} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-zinc-900/50 transition-colors">
                <div>
                  <div className="text-[12px] font-semibold text-white">{evt.label}</div>
                  <div className="text-[10px] text-zinc-500">{evt.description}</div>
                </div>
                <Switch
                  checked={notificationPrefs.inApp[evt.key] ?? true}
                  onCheckedChange={(v) => setNotificationChannelPref("inApp", evt.key, v)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="h-px bg-zinc-800 my-4" />

        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-xs text-white uppercase tracking-widest">Push Notifications</h3>
            <button
              onClick={() => setAllNotificationPrefs("push", nonePush || !allPush)}
              className="text-[10px] font-mono text-primary hover:underline"
            >
              {allPush ? "Disable All" : "Enable All"}
            </button>
          </div>
          <div className="text-[10px] text-zinc-500 mb-3">Sent to your device even when the app is in the background</div>
          <div className="space-y-1">
            {NOTIFICATION_EVENTS.map(evt => (
              <div key={`push-${evt.key}`} className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-zinc-900/50 transition-colors">
                <div>
                  <div className="text-[12px] font-semibold text-white">{evt.label}</div>
                  <div className="text-[10px] text-zinc-500">{evt.description}</div>
                </div>
                <Switch
                  checked={notificationPrefs.push[evt.key] ?? false}
                  onCheckedChange={(v) => setNotificationChannelPref("push", evt.key, v)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarToggle({ label, icon, checked, onChange }: { label: string; icon?: React.ReactNode; checked: boolean; onChange: () => void }) {
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
        <span className="inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform duration-200" style={{ transform: checked ? "translateX(16px) translateY(2px)" : "translateX(2px) translateY(2px)" }} />
      </button>
    </div>
  );
}
