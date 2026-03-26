import { useEffect } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { X, Zap } from "lucide-react";

interface MarketPulseModalProps {
  isOpen: boolean;
  isLoading: boolean;
  result: string | null;
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

export function MarketPulseModal({ isOpen, isLoading, result, onClose }: MarketPulseModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

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
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-primary/30 shadow-2xl shadow-primary/10"
        style={{ background: "#0A0F16" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-card-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-primary" />
            </div>
            <div>
              <h2 className="font-mono font-bold text-sm text-foreground tracking-wider">
                LIVE MARKET PULSE
              </h2>
              <p className="font-mono text-[9px] text-muted-foreground tracking-widest uppercase">
                AI Macro Analysis
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 min-h-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-5">
              <div className="relative">
                <div className="w-14 h-14 border-4 border-primary/20 rounded-full" />
                <div className="absolute inset-0 w-14 h-14 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-mono text-sm text-primary animate-pulse tracking-widest">
                  SCANNING MACRO CONDITIONS...
                </p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  Evaluating SPY · QQQ · IWM · VIX
                </p>
              </div>
            </div>
          ) : result ? (
            <MarkdownResult content={result} />
          ) : (
            <div className="flex items-center justify-center py-16 text-muted-foreground font-mono text-xs">
              No data available.
            </div>
          )}
        </div>

        {/* Footer */}
        {!isLoading && result && (
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
