import { useState } from "react";
import { FullPageView } from "@/components/FullPageView";
import { useTerminalStore } from "@/lib/store";
import { Trash2, Star, Plus } from "lucide-react";

interface WatchlistPageProps {
  onClose: () => void;
  onSelectSymbol: (sym: string) => void;
}

export function WatchlistPage({ onClose, onSelectSymbol }: WatchlistPageProps) {
  const { watchlist, removeFromWatchlist, addToWatchlist } = useTerminalStore();
  const [addInput, setAddInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const handleAdd = () => {
    const sym = addInput.trim().toUpperCase();
    if (sym && !watchlist.includes(sym)) {
      addToWatchlist(sym);
      setAddInput("");
      setShowAdd(false);
    }
  };

  return (
    <FullPageView
      title="WATCHLIST"
      onClose={onClose}
      headerRight={
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          aria-label="Add symbol"
        >
          <Plus className="w-5 h-5" />
        </button>
      }
    >
      <div className="p-4 space-y-2">
        {showAdd && (
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={addInput}
              onChange={e => setAddInput(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              placeholder="Enter symbol..."
              className="flex-1 h-9 px-3 rounded-lg font-mono text-xs text-foreground placeholder:text-muted-foreground/40 border border-card-border bg-card focus:border-primary focus:outline-none transition-colors"
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <button
              onClick={handleAdd}
              disabled={!addInput.trim()}
              className="h-9 px-4 rounded-lg font-mono text-[10px] font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: "#FFB800", color: "#000" }}
            >
              ADD
            </button>
          </div>
        )}

        {watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Star className="w-7 h-7 text-primary/50" />
            </div>
            <p className="font-mono text-sm text-muted-foreground">No symbols watched</p>
            <p className="font-mono text-[10px] text-muted-foreground/50 mt-1 max-w-[240px] leading-relaxed">
              Tap the + button above to add a symbol, or search for a ticker on the main screen.
            </p>
          </div>
        ) : (
          watchlist.map(sym => (
            <div
              key={sym}
              className="flex items-center justify-between px-4 py-3 rounded-xl bg-card border border-card-border hover:border-primary/20 transition-colors"
            >
              <button
                onClick={() => {
                  onSelectSymbol(sym);
                  onClose();
                }}
                className="flex-1 text-left"
              >
                <span className="font-mono text-sm font-bold text-foreground tracking-wider">{sym}</span>
              </button>
              <button
                onClick={() => removeFromWatchlist(sym)}
                className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                aria-label={`Remove ${sym}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </FullPageView>
  );
}
