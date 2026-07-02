import type { ReactNode } from "react";
import { GripVertical, Pin, PinOff, Repeat2, X } from "lucide-react";
import { useTerminalStore } from "@/lib/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Chrome around every dashboard widget: title bar doubles as the grid drag
 * handle (react-grid-layout `draggableHandle=".widget-drag-handle"`), with
 * swap/remove/pin controls excluded via `draggableCancel=".widget-no-drag"`.
 */
export function WidgetFrame({
  title,
  swapOptions,
  onSwap,
  onRemove,
  pinnable = false,
  pinnedSymbol = null,
  onPin,
  children,
}: {
  title: string;
  swapOptions: { id: string; title: string }[];
  onSwap: (widgetId: string) => void;
  onRemove: () => void;
  /** Widget follows the active symbol, so it can be locked to one. */
  pinnable?: boolean;
  pinnedSymbol?: string | null;
  onPin?: (symbol: string | null) => void;
  children: ReactNode;
}) {
  const globalSymbol = useTerminalStore((s) => s.symbol);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800/70 bg-[#0c0c0c]">
      <div className="widget-drag-handle flex shrink-0 cursor-grab select-none items-center gap-1.5 border-b border-zinc-800/60 bg-[#121214] px-2.5 py-1.5 active:cursor-grabbing">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden />
        <span className="truncate font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
          {title}
        </span>
        {pinnable && pinnedSymbol && (
          <button
            type="button"
            onClick={() => onPin?.(null)}
            title={`Pinned to ${pinnedSymbol} — click to follow the app symbol again`}
            className="widget-no-drag flex shrink-0 cursor-pointer items-center gap-1 rounded border border-[#FFB800]/40 bg-[#FFB800]/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-[#FFB800] transition-colors hover:bg-[#FFB800]/20"
          >
            <Pin className="h-3 w-3" />
            {pinnedSymbol}
          </button>
        )}
        <div className="widget-no-drag ml-auto flex shrink-0 cursor-default items-center gap-0.5">
          {pinnable &&
            (pinnedSymbol ? (
              <button
                type="button"
                aria-label={`Unpin ${title} from ${pinnedSymbol}`}
                title={`Unpin — follow the app symbol (${globalSymbol})`}
                onClick={() => onPin?.(null)}
                className="rounded p-1 text-[#FFB800] transition-colors hover:bg-zinc-800"
              >
                <PinOff className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Pin ${title} to ${globalSymbol}`}
                title={`Pin to ${globalSymbol} — keeps this widget on ${globalSymbol} while the rest of the app changes symbols`}
                onClick={() => onPin?.(globalSymbol)}
                className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
            ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Swap ${title} for another widget`}
                title="Swap widget"
                className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <Repeat2 className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-zinc-800 bg-[#121214]">
              {swapOptions.map((opt) => (
                <DropdownMenuItem
                  key={opt.id}
                  onClick={() => onSwap(opt.id)}
                  className="font-mono text-xs text-zinc-300"
                >
                  {opt.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-label={`Remove ${title}`}
            title="Remove widget"
            onClick={onRemove}
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</div>
    </div>
  );
}
