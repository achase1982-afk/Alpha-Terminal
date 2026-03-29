import { useTerminalStore } from "@/lib/store";
import { X, ExternalLink, Globe, AlertTriangle } from "lucide-react";
import { useState, useRef, useCallback, useEffect } from "react";

export function InAppBrowser() {
  const { browserUrl, closeBrowser } = useTerminalStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLoad = useCallback(() => {
    setLoading(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  useEffect(() => {
    if (!browserUrl) return;
    setLoading(true);
    setBlocked(false);
    timeoutRef.current = setTimeout(() => {
      try {
        const doc = iframeRef.current?.contentDocument;
        if (!doc || !doc.body || doc.body.innerHTML === "") {
          setBlocked(true);
        }
      } catch {
        setBlocked(true);
      }
      setLoading(false);
    }, 3000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [browserUrl]);

  const handleError = useCallback(() => {
    setBlocked(true);
    setLoading(false);
  }, []);

  if (!browserUrl) return null;

  const displayUrl = (() => {
    try {
      const u = new URL(browserUrl);
      return u.hostname.replace(/^www\./, "");
    } catch {
      return browserUrl.slice(0, 40);
    }
  })();

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col" style={{ background: "#0a0a0a" }}>
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0"
        style={{ background: "#111113", paddingTop: "env(safe-area-inset-top, 8px)" }}
      >
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
          onClick={closeBrowser}
        >
          <ExternalLink className="w-4.5 h-4.5 text-zinc-400" />
        </a>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {loading && !blocked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10" style={{ background: "#0a0a0a" }}>
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-[#FFB800] rounded-full animate-spin" />
            <span className="text-xs text-zinc-500 font-mono uppercase tracking-wider">Loading...</span>
          </div>
        )}

        {blocked ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8" style={{ background: "#0a0a0a" }}>
            <AlertTriangle className="w-8 h-8 text-zinc-600" />
            <p className="text-sm text-zinc-400 text-center leading-relaxed">
              This site can't be displayed in the embedded browser.
            </p>
            <a
              href={browserUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              style={{ background: "#FFB800", color: "#0a0a0a" }}
              onClick={closeBrowser}
            >
              <ExternalLink className="w-4 h-4" />
              Open in Browser
            </a>
          </div>
        ) : (
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
      </div>
    </div>
  );
}
