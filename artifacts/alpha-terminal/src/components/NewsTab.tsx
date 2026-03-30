import { useQuery } from "@tanstack/react-query";
import { useTerminalStore } from "@/lib/store";
import { Loader2, Newspaper, ExternalLink } from "lucide-react";

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

function timeAgo(unixSeconds: number): string {
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

export function NewsTab() {
  const { symbol, openBrowser } = useTerminalStore();

  const { data, isLoading, error } = useQuery<NewsResponse>({
    queryKey: ["ticker-news", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/market/news?symbol=${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });

  const articles = data?.articles ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-5 h-5 animate-spin text-[#FFB800]" />
        <span className="ml-2 font-mono text-xs text-zinc-500 uppercase tracking-wider">Loading news...</span>
      </div>
    );
  }

  if (error || data?.error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <Newspaper className="w-6 h-6 text-zinc-600" />
        <span className="font-mono text-xs text-zinc-500 uppercase tracking-wider">
          Failed to load news
        </span>
      </div>
    );
  }

  if (articles.length === 0) {
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
        {articles.map((article) => (
          <button
            key={article.id}
            onClick={() => openBrowser(article.url, article.headline, article.source)}
            className="block w-full text-left border-b border-zinc-800/50 hover:bg-zinc-800/30 px-2 py-4 transition-colors group cursor-pointer"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[#FFB800] text-[10px] uppercase tracking-wider font-mono font-semibold shrink-0">
                    {article.source}
                  </span>
                  <span className="text-zinc-500 text-xs font-mono">
                    {timeAgo(article.datetime)}
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-zinc-200 mt-1 leading-snug group-hover:text-white transition-colors">
                  {article.headline}
                </h3>

                {article.summary && (
                  <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                    {article.summary}
                  </p>
                )}
              </div>

              {article.image && (
                <div className="shrink-0 w-16 h-16 rounded overflow-hidden bg-zinc-800 mt-1">
                  <img
                    src={article.image}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </div>
              )}

              <ExternalLink className="w-3 h-3 text-zinc-600 shrink-0 mt-1 group-hover:text-zinc-400 transition-colors" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
