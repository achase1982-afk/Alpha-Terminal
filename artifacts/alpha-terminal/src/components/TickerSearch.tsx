import { useState } from "react";
import { useTerminalStore } from "@/lib/store";
import { Search, Clock } from "lucide-react";

export function TickerSearch() {
  const { symbol, setSymbol, recentSymbols } = useTerminalStore();
  const [inputVal, setInputVal] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputVal.trim().toUpperCase();
    if (trimmed) {
      setSymbol(trimmed);
      setInputVal("");
    }
  };

  const handleQuickSelect = (sym: string) => {
    setSymbol(sym);
  };

  return (
    <div className="px-3 sm:px-4 py-2 border-b border-card-border bg-[#0D1117]/95 shrink-0 flex flex-col sm:flex-row items-start sm:items-center gap-2">
      {/* Recent symbols */}
      <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
        {recentSymbols.length === 0 ? (
          <span className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground/50 italic">
            <Clock className="w-2.5 h-2.5" />
            Search a ticker to build history
          </span>
        ) : (
          recentSymbols.map(sym => (
            <button
              key={sym}
              onClick={() => handleQuickSelect(sym)}
              className={`font-mono text-[9px] sm:text-[10px] px-2 py-0.5 rounded border transition-all duration-150
                ${symbol === sym
                  ? "bg-primary/20 text-primary border-primary/50"
                  : "bg-transparent text-muted-foreground border-card-border hover:border-primary/40 hover:text-foreground"
                }`}
            >
              {sym}
            </button>
          ))
        )}
      </div>

      {/* Custom search */}
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          <input
            value={inputVal}
            onChange={e => setInputVal(e.target.value.toUpperCase())}
            placeholder="SEARCH..."
            className="w-32 sm:w-36 h-7 pl-7 pr-2 rounded border border-card-border bg-card font-mono text-base sm:text-[10px] text-foreground
              placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 focus:bg-primary/5 transition-colors uppercase"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <button
          type="submit"
          className="h-7 px-3 rounded bg-primary text-primary-foreground font-mono text-[10px] font-bold hover:bg-primary/80 transition-colors shrink-0"
        >
          GO
        </button>
      </form>
    </div>
  );
}
