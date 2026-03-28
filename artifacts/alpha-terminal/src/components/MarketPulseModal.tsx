import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { X, Zap, Settings, ArrowLeft, Plus, RotateCcw } from "lucide-react";

export const DEFAULT_PULSE_SYMBOLS = [
  "$ADD", "$ADVN", "$DECN", "$TICK",
  "$TRIN", "$VIX", "$VVIX", "$VIX9D",
  "$VIX3M", "$SKEW", "$TYX", "$TNX", "HYG",
  "LQD", "IEF", "/GC", "/ES", "/NQ", "/YM",
  "/RTY", "/CL", "/BZ", "$NYICDX", "/ZQ",
  "/ZB", "/ZT", "$ADSPD", "$UVOL", "$DVOL",
  "$HYD",
];

interface MarketPulseModalProps {
  isOpen: boolean;
  isLoading: boolean;
  result: string | null;
  symbols: string[];
  onSymbolsChange: (symbols: string[]) => void;
  onClose: () => void;
}

function MarkdownResult({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-primary max-w-none font-sans text-gray-300
      prose-headings:text-white prose-headings:font-bold prose-headings:tracking-wide prose-headings:mt-5 prose-headings:mb-2
      prose-h2:text-base prose-h3:text-sm
      prose-a:text-primary hover:prose-a:text-primary/80
      prose-strong:text-white prose-strong:font-bold
      prose-li:my-0.5
      prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
      prose-pre:bg-card prose-pre:border prose-pre:border-card-border prose-pre:text-xs"
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

function SymbolChip({ symbol, onRemove }: { symbol: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/25 text-primary font-mono text-[10px] font-semibold tracking-wider">
      {symbol}
      <button
        onClick={onRemove}
        className="ml-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-primary/60 hover:text-foreground hover:bg-primary/20 transition-colors"
        aria-label={`Remove ${symbol}`}
      >
        <X className="w-2.5 h-2.5" />
      </button>
    </span>
  );
}

export function MarketPulseModal({
  isOpen, isLoading, result, symbols, onSymbolsChange, onClose,
}: MarketPulseModalProps) {
  const [configView, setConfigView] = useState(false);
  const [newSymbol, setNewSymbol] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setConfigView(false);
      setNewSymbol("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (configView) setConfigView(false);
        else onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, configView, onClose]);

  useEffect(() => {
    if (configView && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [configView]);

  const handleAddSymbol = () => {
    const s = newSymbol.trim().toUpperCase();
    if (!s) return;
    if (symbols.includes(s)) {
      setNewSymbol("");
      return;
    }
    onSymbolsChange([...symbols, s]);
    setNewSymbol("");
  };

  const handleInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSymbol();
    }
  };

  const handleRemove = (sym: string) => {
    onSymbolsChange(symbols.filter(s => s !== sym));
  };

  const handleReset = () => {
    onSymbolsChange([...DEFAULT_PULSE_SYMBOLS]);
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={configView ? undefined : onClose}
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl border border-primary/30 shadow-2xl shadow-primary/10"
        style={{ background: "#0c0c0c" }}
      >
        {/* ── HEADER ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-card-border shrink-0">
          {configView ? (
            <button
              onClick={() => setConfigView(false)}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="font-mono text-xs tracking-wider">BACK TO PULSE</span>
            </button>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-primary" />
              </div>
              <div>
                <h2 className="font-mono font-bold text-sm text-foreground tracking-wider">
                  LIVE MARKET PULSE
                </h2>
                <p className="font-mono text-[9px] text-muted-foreground tracking-widest uppercase">
                  AI Macro Analysis · {symbols.length} indicators
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-1">
            {!configView && (
              <button
                onClick={() => setConfigView(true)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                aria-label="Configure indicators"
                title="Configure Indicators"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── CONTENT ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {configView ? (
            /* ── CONFIG VIEW ── */
            <div className="px-5 py-5 space-y-5">
              <div>
                <p className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-widest mb-3">
                  Active Indicators — {symbols.length} symbols
                </p>
                {symbols.length === 0 ? (
                  <p className="font-mono text-xs text-muted-foreground/50 italic">
                    No indicators configured. Add symbols below.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {symbols.map(sym => (
                      <SymbolChip
                        key={sym}
                        symbol={sym}
                        onRemove={() => handleRemove(sym)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-card-border pt-4">
                <p className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-widest mb-2">
                  Add Symbol
                </p>
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newSymbol}
                    onChange={e => setNewSymbol(e.target.value.toUpperCase())}
                    onKeyDown={handleInputKey}
                    placeholder="e.g. AAPL, /BTC, $TNX"
                    maxLength={12}
                    className="flex-1 h-9 px-3 rounded-lg bg-card border border-card-border font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 uppercase"
                    autoCorrect="off"
                    autoCapitalize="characters"
                  />
                  <button
                    onClick={handleAddSymbol}
                    disabled={!newSymbol.trim()}
                    className="h-9 px-3 rounded-lg bg-primary/20 border border-primary/40 text-primary font-mono text-xs font-semibold flex items-center gap-1.5 hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    ADD
                  </button>
                </div>
                <p className="font-mono text-[9px] text-muted-foreground/40 mt-1.5">
                  Use $ prefix for NYSE internals (e.g. $TICK) · / prefix for futures (e.g. /ES)
                </p>
              </div>

              <div className="border-t border-card-border pt-4 flex items-center justify-between">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors uppercase tracking-wider"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset to Defaults
                </button>
                <button
                  onClick={() => setConfigView(false)}
                  className="font-mono text-[10px] px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 transition-colors tracking-wider uppercase font-semibold"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* ── PULSE VIEW ── */
            <div className="px-5 py-5">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-14 gap-5">
                  <div className="relative">
                    <div className="w-14 h-14 border-4 border-primary/20 rounded-full" />
                    <div className="absolute inset-0 w-14 h-14 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                  <p className="font-mono text-sm text-primary animate-pulse tracking-widest">
                    SCANNING MACRO CONDITIONS...
                  </p>
                </div>
              ) : result ? (
                <MarkdownResult content={result} />
              ) : (
                <div className="flex items-center justify-center py-16 text-muted-foreground font-mono text-xs">
                  No data available.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        {!isLoading && result && !configView && (
          <div className="px-5 py-3 border-t border-card-border shrink-0 flex justify-end">
            <button
              onClick={onClose}
              className="font-mono text-[10px] px-4 py-2 rounded-lg border border-card-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors tracking-wider uppercase"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
