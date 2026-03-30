import { useTerminalStore } from "@/lib/store";
import { X, ExternalLink, Globe, RefreshCw, Shield } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

function proxyUrl(url: string, title?: string | null, source?: string | null, sourceUrl?: string | null) {
  let qs = `url=${encodeURIComponent(url)}`;
  if (title) qs += `&title=${encodeURIComponent(title)}`;
  if (source) qs += `&source=${encodeURIComponent(source)}`;
  if (sourceUrl) qs += `&sourceUrl=${encodeURIComponent(sourceUrl)}`;
  return `${API_BASE}/market/proxy-article?${qs}`;
}

export function InAppBrowser() {
  const { browserUrl, browserTitle, browserSource, browserSourceUrl, closeBrowser } = useTerminalStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [headerH, setHeaderH] = useState(32);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!browserUrl) { setLoading(true); setError(false); setCurrentUrl(null); return; }
    setLoading(true);
    setError(false);
    setCurrentUrl(browserUrl);
    const el = document.getElementById("terminal-header");
    if (el) setHeaderH(el.offsetHeight);
  }, [browserUrl]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "proxy-navigate" && e.data.url) {
        setCurrentUrl(e.data.url);
        setLoading(true);
        setError(false);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleError = useCallback(() => {
    setError(true);
    setLoading(false);
  }, []);

  const handleReload = useCallback(() => {
    setLoading(true);
    setError(false);
    if (iframeRef.current && currentUrl) {
      iframeRef.current.src = proxyUrl(currentUrl, browserTitle, browserSource, browserSourceUrl);
    }
  }, [currentUrl, browserTitle, browserSource, browserSourceUrl]);

  if (!browserUrl || !currentUrl) return null;

  const displayUrl = (() => {
    try { return new URL(currentUrl).hostname.replace(/^www\./, ""); }
    catch { return currentUrl.slice(0, 40); }
  })();

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-[999] flex flex-col"
      style={{
        top: `${headerH}px`,
        background: "#1C1C1E",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 border-b shrink-0"
        style={{
          background: "#111113",
          borderColor: "#2A2A2C",
          paddingLeft: "max(12px, env(safe-area-inset-left))",
          paddingRight: "max(12px, env(safe-area-inset-right))",
        }}
      >
        <button
          onClick={closeBrowser}
          className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer active:scale-95"
          aria-label="Close browser"
          style={{ WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}
        >
          <X className="w-5 h-5 text-zinc-300" />
        </button>

        <div className="flex-1 flex items-center gap-1.5 bg-zinc-900 rounded-md px-3 py-1.5 min-w-0 border border-zinc-800">
          <Shield className="w-3 h-3 text-emerald-500 shrink-0" />
          <Globe className="w-3 h-3 text-zinc-500 shrink-0" />
          <span className="text-xs text-zinc-400 font-mono truncate">{displayUrl}</span>
        </div>

        <button
          onClick={handleReload}
          className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer active:scale-95"
          aria-label="Reload"
          style={{ WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}
        >
          <RefreshCw className={`w-4 h-4 text-zinc-400 ${loading ? "animate-spin" : ""}`} />
        </button>

        <a
          href={currentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors active:scale-95"
          aria-label="Open in new tab"
          style={{ WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}
        >
          <ExternalLink className="w-4 h-4 text-zinc-400" />
        </a>
      </div>

      <div
        className="flex-1 relative"
        style={{
          overflow: "hidden",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
        }}
      >
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20" style={{ background: "#1C1C1E" }}>
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-[#FFB800] rounded-full animate-spin" />
            <div className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-emerald-500" />
              <span className="text-xs text-zinc-500 font-mono uppercase tracking-wider">Secure reader loading...</span>
            </div>
          </div>
        )}

        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 z-10" style={{ background: "#1C1C1E" }}>
            {browserTitle && (
              <div className="text-center max-w-sm">
                {browserSource && (
                  <span className="text-[10px] uppercase tracking-wider font-mono font-semibold text-[#FFB800] mb-2 block">{browserSource}</span>
                )}
                <h2 className="text-base font-semibold text-zinc-200 leading-snug">{browserTitle}</h2>
              </div>
            )}
            <p className="text-xs text-zinc-500 text-center">Could not load this article.</p>
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer active:scale-95"
              style={{ background: "#FFB800", color: "#0a0a0a", WebkitTapHighlightColor: "transparent" }}
            >
              <ExternalLink className="w-4 h-4" />
              Read Full Article
            </a>
            <button
              onClick={closeBrowser}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer font-mono uppercase tracking-wider active:scale-95"
              style={{ WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}
            >
              Go Back
            </button>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={proxyUrl(currentUrl, browserTitle, browserSource, browserSourceUrl)}
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            loading="eager"
            allow="encrypted-media"
            onLoad={handleLoad}
            onError={handleError}
            title="Secure article reader"
            style={{
              colorScheme: "dark",
              WebkitOverflowScrolling: "touch",
              overscrollBehavior: "contain",
            }}
          />
        )}
      </div>
    </div>
  );
}
