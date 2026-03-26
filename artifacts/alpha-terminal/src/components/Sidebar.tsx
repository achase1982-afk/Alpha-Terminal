import { useTerminalStore } from "@/lib/store";
import { AuthPanel } from "./AuthPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Terminal, Search, Settings2, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

const TIMEFRAMES = ["1D", "5D", "1M", "3M", "6M", "1Y", "2Y", "5Y"];

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const {
    symbol, setSymbol,
    timeframe, setTimeframe,
    overlays, toggleOverlay,
    aiModel, setAiModel,
    aiTemp, setAiTemp
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
          <h1 className="font-sans font-bold text-base sm:text-lg tracking-wider text-foreground truncate">
            ALPHA<span className="text-primary">TERM</span>
          </h1>
          <p className="text-[9px] sm:text-[10px] font-mono text-muted-foreground uppercase tracking-widest">System v1.0.4</p>
        </div>
        {/* Close button — mobile only */}
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
              onChange={(e) => setInputVal(e.target.value.toUpperCase())}
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
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`
                  h-8 rounded font-mono text-[10px] sm:text-xs font-semibold transition-all duration-200
                  ${timeframe === tf
                    ? 'bg-primary/20 text-primary border border-primary/50'
                    : 'bg-card text-muted-foreground border border-card-border hover:bg-card-border hover:text-foreground'}
                `}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* CHART OVERLAYS */}
        <div className="space-y-3 pt-1 bg-card p-3 sm:p-4 rounded-xl border border-card-border">
          <Label className="font-mono text-[10px] sm:text-xs text-muted-foreground flex items-center gap-2 pb-2 border-b border-card-border">
            <SlidersHorizontal className="w-3 h-3" /> OVERLAYS
          </Label>
          <div className="space-y-3 sm:space-y-4 pt-1">
            {Object.entries(overlays).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between">
                <Label htmlFor={`overlay-${key}`} className="font-mono text-[10px] sm:text-xs uppercase cursor-pointer">
                  {key === 'bb' ? 'BOLLINGER BANDS' : key.replace(/([A-Z])/g, ' $1').trim()}
                </Label>
                <Switch
                  id={`overlay-${key}`}
                  checked={value}
                  onCheckedChange={() => toggleOverlay(key as keyof typeof overlays)}
                  className="data-[state=checked]:bg-primary scale-90 sm:scale-100"
                />
              </div>
            ))}
          </div>
        </div>

        {/* AI CONFIG */}
        <div className="space-y-3 sm:space-y-4 pt-1">
          <Label className="font-mono text-[10px] sm:text-xs text-muted-foreground flex items-center gap-2">
            <Settings2 className="w-3 h-3" /> AI COGNITION ENGINE
          </Label>
          <div className="space-y-3 sm:space-y-4">
            <div className="space-y-2">
              <Label className="text-[9px] sm:text-[10px] uppercase text-muted-foreground font-mono">Model Selection</Label>
              <Select value={aiModel} onValueChange={setAiModel}>
                <SelectTrigger className="font-mono text-[10px] sm:text-xs bg-card border-card-border h-9 sm:h-10">
                  <SelectValue placeholder="Select model..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-card-border font-mono text-xs">
                  <SelectItem value="gemini-2.0-flash">GEMINI-2.0-FLASH</SelectItem>
                  <SelectItem value="gemini-1.5-pro">GEMINI-1.5-PRO</SelectItem>
                  <SelectItem value="gemini-1.5-flash">GEMINI-1.5-FLASH</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:space-y-3 pt-1">
              <div className="flex justify-between items-center">
                <Label className="text-[9px] sm:text-[10px] uppercase text-muted-foreground font-mono">Temperature</Label>
                <span className="font-mono text-[10px] sm:text-[11px] text-primary">{aiTemp.toFixed(2)}</span>
              </div>
              <Slider
                value={[aiTemp]}
                onValueChange={(v) => setAiTemp(v[0])}
                max={2}
                step={0.1}
                className="py-2"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
