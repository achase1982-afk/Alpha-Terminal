import { useTerminalStore } from "@/lib/store";
import type { LiveNewsItem } from "@/lib/store";
import { Newspaper, Zap } from "lucide-react";

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

function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (isNaN(ts)) return "";
  const diff = Math.max(0, (Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function LiveHeadline({ item }: { item: LiveNewsItem }) {
  return (
    <div className="border-b border-zinc-800/50 px-3 py-4">
      <div className="flex items-center gap-2 mb-1">
        <Zap className="w-3 h-3 text-[#FFB800] shrink-0" />
        <span className="text-[#FFB800] text-[10px] uppercase tracking-wider font-mono font-semibold shrink-0">
          {PROVIDER_LABELS[item.providerCode] || item.providerCode}
        </span>
        <span className="text-zinc-500 text-xs font-mono">
          {timeAgo(item.time)}
        </span>
      </div>
      <h3 className="text-sm font-semibold text-zinc-200 leading-snug">
        {item.headline}
      </h3>
    </div>
  );
}

export function NewsTab() {
  const liveNews = useTerminalStore((s) => s.liveNews);

  if (liveNews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2">
        <Newspaper className="w-6 h-6 text-zinc-600" />
        <span className="font-mono text-xs text-zinc-500 uppercase tracking-wider">
          Waiting for live headlines...
        </span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1">
        {liveNews.map((item, i) => (
          <LiveHeadline key={`${item.articleId}-${i}`} item={item} />
        ))}
      </div>
    </div>
  );
}
