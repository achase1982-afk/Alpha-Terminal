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

function providerLabel(code: string): string {
  return PROVIDER_LABELS[code] || code;
}

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return "";
  const diff = Math.max(0, (Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function timeAgoUnix(unixSeconds: number): string {
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function LiveHeadline({ item }: { item: LiveNewsItem }) {
  return (
    <div className="border-b border-zinc-800/50 px-3 py-3">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="w-3 h-3 text-[#FFB800] shrink-0" />
        <span className="text-[#FFB800] text-[10px] uppercase tracking-wider font-mono font-semibold shrink-0">
          {providerLabel(item.providerCode)}
        </span>
        <span className="text-zinc-500 text-[10px] font-mono">
          {timeAgo(item.time)}
        </span>
      </div>
      <p className="text-[13px] font-semibold text-zinc-200 leading-snug">
        {item.headline}
      </p>
    </div>
  );
}

function FinnhubArticle({ article, onOpen }: { article: NewsArticle; onOpen: (url: string, title: string, source: string) => void }) {
  return (
    <button
      onClick={() => onOpen(article.url, article.headline, article.source)}
      className="block w-full text-left border-b border-zinc-800/50 hover:bg-zinc-800/30 px-3 py-4 transition-colors group cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-zinc-500 text-[10px] uppercase tracking-wider font-mono font-semibold shrink-0">
              {article.source}
            </span>
            <span className="text-zinc-600 text-xs font-mono">
              {timeAgoUnix(article.datetime)}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-zinc-300 mt-1 leading-snug group-hover:text-white transition-colors">
            {article.headline}
          </h3>
          {article.summary && (
            <p className="text-xs text-zinc-500 mt-1 line-clamp-2 leading-relaxed">
              {article.summary}
            </p>
          )}
        </div>
        {article.image && (
          <div className="shrink-0 w-14 h-14 rounded overflow-hidden bg-zinc-800 mt-1">
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
  );
}

export function NewsTab() {
  const { symbol, openBrowser } = useTerminalStore();
  const liveNews = useTerminalStore((s) => s.liveNews);

  const { data, isLoading } = useQuery<NewsResponse>({
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

  const articles = data?.articles ?? [];
  const hasLive = liveNews.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {hasLive && (
        <div>
          <div className="sticky top-0 z-10 bg-[#1C1C1E] border-b border-zinc-700/50 px-3 py-2 flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#FFB800] animate-pulse" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#FFB800] font-semibold">
              Live Feed
            </span>
            <span className="text-[10px] font-mono text-zinc-600 ml-auto">
              {liveNews.length} headlines
            </span>
          </div>
          {liveNews.slice(0, 50).map((item, i) => (
            <LiveHeadline key={`${item.articleId}-${i}`} item={item} />
          ))}
        </div>
      )}

      <div>
        <div className="sticky top-0 z-10 bg-[#1C1C1E] border-b border-zinc-700/50 px-3 py-2 flex items-center gap-2">
          <Newspaper className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 font-semibold">
            {symbol} News
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
          </div>
        ) : articles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <span className="font-mono text-xs text-zinc-600 uppercase tracking-wider">
              No articles for {symbol}
            </span>
          </div>
        ) : (
          articles.map((article) => (
            <FinnhubArticle key={article.id} article={article} onOpen={openBrowser} />
          ))
        )}
      </div>
    </div>
  );
}
