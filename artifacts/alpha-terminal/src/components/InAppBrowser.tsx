import { useTerminalStore } from "@/lib/store";
import { X, ExternalLink, Globe } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";

export function InAppBrowser() {
  const { browserUrl, browserTitle, browserSource, closeBrowser } = useTerminalStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [headerH, setHeaderH] = useState(32);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  useEffect(() => {
    if (!browserUrl) { setLoading(true); setBlocked(false); clearTimer(); return; }
    setLoading(true);
    setBlocked(false);

    const el = document.getElementById("terminal-header");
    if (el) setHeaderH(el.offsetHeight);

    timeoutRef.current = setTimeout(() => {
      setBlocked(true);
      setLoading(false);
    }, 5000);

    return clearTimer;
  }, [browserUrl, clearTimer]);

  const handleLoad = useCallback(() => {
    clearTimer();
    setLoading(false);
  }, [clearTimer]);

  const handleError = useCallback(() => {
    clearTimer();
    setBlocked(true);
    setLoading(false);
  }, [clearTimer]);

  if (!browserUrl) return null;

  const displayUrl = (() => {
    try { return new URL(browserUrl).hostname.replace(/^www\./, ""); }
    catch { return browserUrl.slice(0, 40); }
  })();

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-[999] flex flex-col border-t border-zinc-700"
      style={{ top: `${headerH}px`, background: "#0a0a0a" }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0" style={{ background: "#111113" }}>
        <button
          onClick={closeBrowser}
          className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer"
          aria-label="Close browser"
        >
          <X className="w-5 h-5 text-zinc-300" />
        </button>

        <div className="flex-1 flex items-center gap-1.5 bg-zinc-900 rounded-md px-3 py-1.5 min-w-0 border border-zinc-800">
          <Globe className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="text-xs text-zinc-400 font-mono truncate">{displayUrl}</span>
        </div>

        <a
          href={browserUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors"
          aria-label="Open in new tab"
        >
          <ExternalLink className="w-4 h-4 text-zinc-400" />
        </a>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {loading && !blocked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20" style={{ background: "#0a0a0a" }}>
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-[#FFB800] rounded-full animate-spin" />
            <span className="text-xs text-zinc-500 font-mono uppercase tracking-wider">Loading...</span>
          </div>
        )}

        {!blocked && (
          <iframe
            ref={iframeRef}
            src={browserUrl}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            onLoad={handleLoad}
            onError={handleError}
            title="In-app browser"
          />
        )}

        {blocked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 z-10" style={{ background: "#0a0a0a" }}>
            {browserTitle && (
              <div className="text-center max-w-sm">
                {browserSource && (
                  <span className="text-[10px] uppercase tracking-wider font-mono font-semibold text-[#FFB800] mb-2 block">{browserSource}</span>
                )}
                <h2 className="text-base font-semibold text-zinc-200 leading-snug">{browserTitle}</h2>
              </div>
            )}
            <a
              href={browserUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer"
              style={{ background: "#FFB800", color: "#0a0a0a" }}
              onClick={closeBrowser}
            >
              <ExternalLink className="w-4 h-4" />
              Read Full Article
            </a>
            <button
              onClick={closeBrowser}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer font-mono uppercase tracking-wider"
            >
              Go Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
