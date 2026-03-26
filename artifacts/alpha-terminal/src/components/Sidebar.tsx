import { useTerminalStore } from "@/lib/store";
import { AuthPanel } from "./AuthPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Terminal, SlidersHorizontal, X, LayoutDashboard, ListOrdered, Gauge } from "lucide-react";
import { useState } from "react";

const TIMEFRAMES = ["1D", "5D", "1M", "3M", "6M", "1Y", "2Y", "5Y"];

const OVERLAY_LABELS: Record<string, string> = {
  sma20: "SMA 20",
  sma50: "SMA 50",
  bb: "BB",
  rsi: "RSI",
  volume: "VOL",
};

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const {
    timeframe, setTimeframe,
    overlays, toggleOverlay,
    macroSymbols, setMacroSymbols,
    tickerTapeSymbols, setTickerTapeSymbols,
    tapeSpeed, setTapeSpeed,
  } = useTerminalStore();

  const [macroInputs, setMacroInputs] = useState<string[]>(macroSymbols);
  const [tapeInput, setTapeInput] = useState(tickerTapeSymbols.join(", "));
  const [settingsSaved, setSettingsSaved] = useState(false);

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
    <div className="w-72 sm:w-80 h-full bg-[#0D1117] border-r border-card-border flex flex-col z-20 shadow-xl overflow-y-auto">
      {/* BRANDING */}
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

      <div className="p-3 sm:p-4 space-y-5 sm:space-y-6 flex-1">
        {/* AUTH */}
        <AuthPanel />

        {/* TIMEFRAME */}
        <div className="space-y-3 pt-1">
          <Label className="font-mono text-[10px] sm:text-xs text-muted-foreground flex items-center gap-2">
            <SlidersHorizontal className="w-3 h-3" /> TIMEFRAME
          </Label>
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`
                  h-8 rounded font-mono text-[10px] sm:text-xs font-semibold transition-all duration-200
                  ${timeframe === tf
                    ? "bg-primary/20 text-primary border border-primary/50"
                    : "bg-card text-muted-foreground border border-card-border hover:bg-card-border hover:text-foreground"}
                `}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* CHART OVERLAYS */}
        <div className="space-y-2 pt-1">
          <Label className="font-mono text-[10px] sm:text-xs text-muted-foreground flex items-center gap-2">
            <SlidersHorizontal className="w-3 h-3" /> OVERLAYS
          </Label>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(overlays) as [keyof typeof overlays, boolean][]).map(([key, active]) => (
              <button
                key={key}
                onClick={() => toggleOverlay(key)}
                className={`
                  px-3 py-1.5 rounded-full font-mono text-[10px] font-semibold border transition-all duration-200
                  ${active
                    ? "bg-primary/20 text-primary border-primary/50"
                    : "bg-card text-muted-foreground border-card-border hover:border-primary/30 hover:text-foreground"}
                `}
              >
                {OVERLAY_LABELS[key] ?? key.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* DASHBOARD SETTINGS */}
        <div className="space-y-3 pt-1 border-t border-card-border">
          <Label className="font-mono text-[10px] sm:text-xs text-muted-foreground flex items-center gap-2 pt-3">
            <LayoutDashboard className="w-3 h-3" /> MACRO CARD SYMBOLS
          </Label>
          <p className="font-mono text-[9px] text-muted-foreground/60">
            Set up to 4 custom cards (e.g. SPY, SPX, VIX, NDX)
          </p>
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

          <Label className="font-mono text-[10px] sm:text-xs text-muted-foreground flex items-center gap-2 mt-2">
            <ListOrdered className="w-3 h-3" /> SCROLLING TICKER STRIP
          </Label>
          <p className="font-mono text-[9px] text-muted-foreground/60">
            Comma-separated symbols for the marquee
          </p>
          <Input
            value={tapeInput}
            onChange={e => setTapeInput(e.target.value.toUpperCase())}
            placeholder="SPY, QQQ, AAPL, TSLA..."
            className="font-mono uppercase text-xs h-8 bg-card border-card-border focus-visible:ring-primary/50 text-foreground"
            autoCorrect="off"
          />

          <Label className="font-mono text-[10px] sm:text-xs text-muted-foreground flex items-center gap-2 mt-2">
            <Gauge className="w-3 h-3" /> SCROLL SPEED
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

          <Button
            onClick={handleSaveSettings}
            size="sm"
            className={`w-full font-mono text-xs h-8 transition-all ${
              settingsSaved
                ? "bg-primary/30 text-primary border border-primary/50"
                : "bg-primary text-primary-foreground hover:bg-primary/80"
            }`}
          >
            {settingsSaved ? "✓ SAVED" : "APPLY SETTINGS"}
          </Button>
        </div>
      </div>
    </div>
  );
}
