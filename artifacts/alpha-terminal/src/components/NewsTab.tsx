import { useQuery } from "@tanstack/react-query";
import { useTerminalStore } from "@/lib/store";
import type { LiveNewsItem } from "@/lib/store";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Loader2, Newspaper, ExternalLink, Zap } from "lucide-react";

interface NewsArticle {
  id: number;
  source: string;
  headline: string;
  summary: string;
  url: string;
  image: string;
  datetime: number;
  related: string;
}

interface NewsResponse {
  articles: NewsArticle[];
  error?: string;
}

interface IBNewsItem {
  time: string;
  providerCode: string;
  articleId: string;
  headline: string;
  source: string;
}

interface IBNewsResponse {
  news: IBNewsItem[];
  error?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  "BRFG": "BRIEFING",
  "BRFUPDN": "BRIEFING",
  "DJ-N": "DOW JONES",
  "DJ-RT": "DJ REALTIME",
  "DJ-RTA": "DJ ALERT",
  "DJ-RTE": "DJ ECON",
  "DJ-RTG": "DJ GLOBAL",
  "DJNL": "DJ NEWSLETTER",
};

function timeAgo(ts: number): string {
  const now = Date.now();
  const diff = Math.max(0, (now - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

interface UnifiedItem {
  key: string;
  source: string;
  headline: string;
  summary?: string;
  url?: string;
  image?: string;
  ts: number;
  isLive: boolean;
}

function toLiveItems(items: LiveNewsItem[]): UnifiedItem[] {
  return items.map((item, i) => ({
    key: `ib-live-${item.articleId}-${i}`,
    source: PROVIDER_LABELS[item.providerCode] || item.providerCode,
    headline: item.headline,
    ts: new Date(item.time).getTime() || Date.now(),
    isLive: true,
  }));
}

function toIBHistItems(items: IBNewsItem[]): UnifiedItem[] {
  return items.map((item, i) => ({
    key: `ib-hist-${item.articleId}-${i}`,
    source: PROVIDER_LABELS[item.providerCode] || item.providerCode,
    headline: item.headline,
    ts: new Date(item.time).getTime() || Date.now(),
    isLive: true,
  }));
}

function toFinnhubItems(articles: NewsArticle[]): UnifiedItem[] {
  return articles.map((a) => ({
    key: `fh-${a.id}`,
    source: a.source,
    headline: a.headline,
    summary: a.summary,
    url: a.url,
    image: a.image,
    ts: a.datetime * 1000,
    isLive: false,
  }));
}

function dedup(items: UnifiedItem[]): UnifiedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const norm = item.headline.toLowerCase().trim().slice(0, 80);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}

export function NewsTab() {
  const { symbol, openBrowser } = useTerminalStore();
  const liveNews = useTerminalStore((s) => s.liveNews);

  const { data: ibData } = useQuery<IBNewsResponse>({
    queryKey: ["ib-news", symbol],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/ib/news/symbol?symbol=${encodeURIComponent(symbol)}&max=30`);
      if (!res.ok) return { news: [] };
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: fhData, isLoading: fhLoading } = useQuery<NewsResponse>({
    queryKey: ["ticker-news", symbol],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/market/news?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const ibHistNews = ibData?.news ?? [];
  const fhArticles = fhData?.articles ?? [];

  const unified = dedup([
    ...toLiveItems(liveNews),
    ...toIBHistItems(ibHistNews),
    ...toFinnhubItems(fhArticles),
  ].sort((a, b) => b.ts - a.ts));

  if (fhLoading && liveNews.length === 0 && ibHistNews.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-[#FFB800]" />
        <span className="ml-2 font-mono text-xs text-zinc-500 uppercase tracking-wider">Loading news...</span>
      </div>
    );
  }

  if (unified.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <Newspaper className="w-6 h-6 text-zinc-600" />
        <span className="font-mono text-xs text-zinc-500 uppercase tracking-wider">
          No news available for {symbol}
        </span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1">
        {unified.map((item) => (
          <button
            key={item.key}
            onClick={() => item.url ? openBrowser(item.url, item.headline, item.source) : undefined}
            className="block w-full text-left border-b border-zinc-800/50 hover:bg-zinc-800/30 px-3 py-4 transition-colors group cursor-pointer"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {item.isLive && <Zap className="w-3 h-3 text-[#FFB800] shrink-0" />}
                  <span className="text-[#FFB800] text-[10px] uppercase tracking-wider font-mono font-semibold shrink-0">
                    {item.source}
                  </span>
                  <span className="text-zinc-500 text-xs font-mono">
                    {timeAgo(item.ts)}
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-zinc-200 mt-1 leading-snug group-hover:text-white transition-colors">
                  {item.headline}
                </h3>

                {item.summary && (
                  <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                    {item.summary}
                  </p>
                )}
              </div>

              {item.image && (
                <div className="shrink-0 w-16 h-16 rounded overflow-hidden bg-zinc-800 mt-1">
                  <img
                    src={item.image}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              )}

              {item.url && (
                <ExternalLink className="w-3 h-3 text-zinc-600 shrink-0 mt-1 group-hover:text-zinc-400 transition-colors" />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
