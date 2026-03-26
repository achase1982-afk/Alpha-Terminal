import { useTerminalStore } from "@/lib/store";
import { AuthPanel } from "./AuthPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Terminal, Search, SlidersHorizontal, X } from "lucide-react";
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
    symbol, setSymbol,
    timeframe, setTimeframe,
    overlays, toggleOverlay,
  } = useTerminalStore();

  const [inputVal, setInputVal] = useState(symbol);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputVal.trim()) {
      setSymbol(inputVal.trim().toUpperCase());
      onClose?.();
    }
  };

  return (
    <div className="w-72 sm:w-80 h-full bg-[#0D1117] border-r border-card-border flex flex-col z-20 shadow-xl overflow-y-auto">
      {/* BRANDING + mobile close */}
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
        {/* TICKER SEARCH */}
        <form onSubmit={handleSearch} className="space-y-2">
          <Label className="font-mono text-[10px] sm:text-xs text-muted-foreground flex items-center gap-2">
            <Search className="w-3 h-3" /> ACTIVE TICKER
          </Label>
          <div className="flex gap-2">
            <Input
              value={inputVal}
              onChange={e => setInputVal(e.target.value.toUpperCase())}
              className="font-mono uppercase text-base sm:text-lg h-11 sm:h-12 bg-card border-card-border focus-visible:ring-primary/50 text-foreground"
              placeholder="AAPL"
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <Button type="submit" className="h-11 sm:h-12 w-14 sm:w-16 bg-primary text-primary-foreground hover:bg-primary/80 font-mono font-bold text-sm">
              GO
            </Button>
          </div>
        </form>

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

        {/* CHART OVERLAYS — compact pills */}
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
      </div>
    </div>
  );
}
