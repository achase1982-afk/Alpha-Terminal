import { useTerminalStore } from "@/lib/store";
import { X, ExternalLink, Globe, RefreshCw, Shield, ChevronLeft } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

function isInternalUrl(url: string) {
  return url.startsWith(API_BASE + "/") || url.startsWith("/api/");
}

function isSecFilingUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.sec.gov" && parsed.pathname.startsWith("/Archives/edgar/data/");
  } catch {
    return false;
  }
}

function proxyUrl(url: string, title?: string | null, source?: string | null, summary?: string | null) {
  if (isInternalUrl(url)) return url;
  if (isSecFilingUrl(url)) {
    return `${API_BASE}/sec/filing-content?url=${encodeURIComponent(url)}`;
  }
  let qs = `url=${encodeURIComponent(url)}`;
  if (title) qs += `&title=${encodeURIComponent(title)}`;
  if (source) qs += `&source=${encodeURIComponent(source)}`;
  if (summary) qs += `&summary=${encodeURIComponent(summary)}`;
  return `${API_BASE}/market/proxy-article?${qs}`;
}

/**
 * Polygon (and others) often link to Yahoo Finance. Our server-side reader
 * cannot scrape those pages reliably (403/consent), and Yahoo blocks iframe
 * embedding — so the iframe showed blank or gray “extract failed” HTML.
 * For these hosts we show headline + summary inline and link out to the live URL.
 */
export function prefersExternalArticleView(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith("yahoo.com") || host.endsWith("yahoo.co.jp") || host.endsWith("yahoo.co.uk")) {
      return true;
    }
    if (host.endsWith("aol.com")) return true;
    return false;
  } catch {
    return false;
  }
}

export function InAppBrowser() {
  const { browserUrl, browserTitle, browserSource, browserSummary, closeBrowser } = useTerminalStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [headerH, setHeaderH] = useState(32);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    if (!browserUrl) { setLoading(true); setError(false); setCurrentUrl(null); setHistory([]); return; }
    setError(false);
    setCurrentUrl(browserUrl);
    setHistory([]);
    setLoading(prefersExternalArticleView(browserUrl) ? false : true);
    const el = document.getElementById("terminal-header");
    if (el) setHeaderH(el.offsetHeight);
  }, [browserUrl]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "proxy-navigate" && e.data.url) {
        if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return;
        const newUrl = String(e.data.url);
        if (!/^https?:\/\//i.test(newUrl)) return;
        setHistory((prev) => currentUrl ? [...prev, currentUrl] : prev);
        setCurrentUrl(newUrl);
        setLoading(prefersExternalArticleView(newUrl) ? false : true);
        setError(false);
        if (iframeRef.current && !prefersExternalArticleView(newUrl)) {
          iframeRef.current.src = proxyUrl(newUrl, browserTitle, browserSource, browserSummary);
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [currentUrl, browserTitle, browserSource, browserSummary]);

  const handleLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleError = useCallback(() => {
    setError(true);
    setLoading(false);
  }, []);

  const handleReload = useCallback(() => {
    if (!currentUrl || prefersExternalArticleView(currentUrl)) return;
    setLoading(true);
    setError(false);
    if (iframeRef.current) {
      iframeRef.current.src = proxyUrl(currentUrl, browserTitle, browserSource, browserSummary);
    }
  }, [currentUrl, browserTitle, browserSource, browserSummary]);

  const handleBack = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setCurrentUrl(prev);
    setLoading(prefersExternalArticleView(prev) ? false : true);
    setError(false);
    if (iframeRef.current && !prefersExternalArticleView(prev)) {
      iframeRef.current.src = proxyUrl(prev, browserTitle, browserSource, browserSummary);
    }
  }, [history, browserTitle, browserSource, browserSummary]);

  if (!browserUrl || !currentUrl) return null;

  const useExternalSummaryPane = prefersExternalArticleView(currentUrl);

  const displayUrl = (() => {
    try { return new URL(currentUrl).hostname.replace(/^www\./, ""); }
    catch { return currentUrl.slice(0, 40); }
  })();

  const canGoBack = history.length > 0;

  return (
    <div
      className="fixed left-0 right-0 bottom-0 z-[999] flex flex-col"
      style={{
        top: `${headerH}px`,
        background: "#1C1C1E",
      }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2 border-b shrink-0"
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

        <button
          onClick={handleBack}
          disabled={!canGoBack}
          className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer active:scale-95 disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent"
          aria-label="Go back"
          style={{ WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}
        >
          <ChevronLeft className="w-4.5 h-4.5 text-zinc-300" />
        </button>

        <div className="flex-1 flex items-center gap-1.5 bg-zinc-900 rounded-md px-3 py-1.5 min-w-0 border border-zinc-800">
          <Shield className={`w-3 h-3 shrink-0 ${useExternalSummaryPane ? "text-zinc-500" : "text-emerald-500"}`} />
          <Globe className="w-3 h-3 text-zinc-500 shrink-0" />
          <span className="text-xs text-zinc-400 font-mono truncate">{displayUrl}</span>
        </div>

        <button
          onClick={handleReload}
          disabled={useExternalSummaryPane}
          className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors cursor-pointer active:scale-95 disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent"
          aria-label="Reload"
          style={{ WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}
        >
          <RefreshCw className={`w-4 h-4 text-zinc-400 ${loading && !useExternalSummaryPane ? "animate-spin" : ""}`} />
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
          overscrollBehavior: "none",
        }}
      >
        {loading && !useExternalSummaryPane && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20" style={{ background: "#1C1C1E" }}>
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-[#FFB800] rounded-full animate-spin" />
            <div className="flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-emerald-500" />
              <span className="text-xs text-zinc-500 font-mono tracking-wider">Secure Reader Loading...</span>
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
        ) : useExternalSummaryPane ? (
          <div
            className="absolute inset-0 overflow-y-auto z-10 px-5 py-6"
            style={{ background: "#1C1C1E", WebkitOverflowScrolling: "touch" }}
          >
            {browserSource && (
              <span className="text-[10px] uppercase tracking-wider font-mono font-semibold text-[#FFB800] block mb-2">
                {browserSource}
              </span>
            )}
            {browserTitle && (
              <h2 className="text-lg font-semibold text-zinc-100 leading-snug mb-4">{browserTitle}</h2>
            )}
            <p className="text-xs text-zinc-500 leading-relaxed mb-5">
              This publisher blocks embedded reading in the app. Open the story in your browser for the full article and layout.
            </p>
            {browserSummary ? (
              <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap mb-8 border-t border-zinc-800 pt-5">
                {browserSummary}
              </div>
            ) : (
              <p className="text-sm text-zinc-500 mb-8 italic">No preview text was provided with this story.</p>
            )}
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 w-full max-w-md mx-auto px-5 py-3 rounded-lg text-sm font-semibold transition-colors active:scale-[0.98]"
              style={{ background: "#FFB800", color: "#0a0a0a", WebkitTapHighlightColor: "transparent" }}
            >
              <ExternalLink className="w-4 h-4 shrink-0" />
              Open full article
            </a>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={proxyUrl(currentUrl, browserTitle, browserSource, browserSummary)}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            loading="eager"
            allow="encrypted-media"
            onLoad={handleLoad}
            onError={handleError}
            title="Secure article reader"
            style={{
              colorScheme: "dark",
              overscrollBehavior: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}
