import type { ReactNode } from "react";
import { GripVertical, Repeat2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Chrome around every dashboard widget: title bar doubles as the grid drag
 * handle (react-grid-layout `draggableHandle=".widget-drag-handle"`), with
 * swap/remove controls excluded via `draggableCancel=".widget-no-drag"`.
 */
export function WidgetFrame({
  title,
  swapOptions,
  onSwap,
  onRemove,
  children,
}: {
  title: string;
  swapOptions: { id: string; title: string }[];
  onSwap: (widgetId: string) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-zinc-800/70 bg-[#0c0c0c]">
      <div className="widget-drag-handle flex shrink-0 cursor-grab select-none items-center gap-1.5 border-b border-zinc-800/60 bg-[#121214] px-2.5 py-1.5 active:cursor-grabbing">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden />
        <span className="truncate font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-300">
          {title}
        </span>
        <div className="widget-no-drag ml-auto flex shrink-0 cursor-default items-center gap-0.5">
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
