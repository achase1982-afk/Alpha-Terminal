import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import {
  hasUnsavedTradingState,
  isChunkLoadError,
  tryGuardedFullReload,
} from "@/lib/lazyChunkRecovery";

export type LazyViewErrorBoundaryProps = {
  children: ReactNode;
  /** Label in the fallback UI, e.g. Portfolio, News */
  viewName: string;
  /** Bumped by parent when user taps Retry — triggers remount of lazy child */
  remountKey: number;
  onRemount: () => void;
};

type State = {
  error: Error | null;
  showReloadOffer: boolean;
  unsavedBlocked: boolean;
};

/**
 * Scoped chunk / render failure UI for React.lazy routes. Keeps shell chrome mounted.
 */
export class LazyViewErrorBoundary extends Component<LazyViewErrorBoundaryProps, State> {
  state: State = { error: null, showReloadOffer: false, unsavedBlocked: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidUpdate(prevProps: LazyViewErrorBoundaryProps) {
    if (prevProps.remountKey !== this.props.remountKey && this.state.error) {
      this.setState({ error: null, showReloadOffer: false, unsavedBlocked: false });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[LazyView:${this.props.viewName}]`, error, info.componentStack);
    if (isChunkLoadError(error) && this.props.remountKey > 0) {
      const result = tryGuardedFullReload(`lazy:${this.props.viewName}`);
      if (result === "blocked-unsaved" || result === "blocked-loop") {
        this.setState({ showReloadOffer: true, unsavedBlocked: result === "blocked-unsaved" });
      }
    }
  }

  handleRetry = () => {
    this.setState({ error: null, showReloadOffer: false, unsavedBlocked: false });
    this.props.onRemount();
  };

  handleReloadAnyway = () => {
    if (hasUnsavedTradingState()) {
      const ok = window.confirm(
        "Reloading will discard in-progress orders or drafts on this tab. Continue?",
      );
      if (!ok) return;
    }
    tryGuardedFullReload(`manual:${this.props.viewName}`, { force: true });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const chunk = isChunkLoadError(this.state.error);

    return (
      <div
        data-lazy-view-error
        data-lazy-view-name={this.props.viewName}
        data-lazy-chunk-error={chunk ? "1" : "0"}
        className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 min-h-[200px] text-center"
        style={{ background: "#0a0a0a" }}
      >
        <p className="text-sm font-semibold text-zinc-200">Couldn&apos;t load this view</p>
        <p className="text-xs text-zinc-500 max-w-[280px] leading-relaxed">
          {chunk
            ? "This panel failed to load after an update. Retry loads the module again; reload the app if the build changed."
            : this.state.error.message || "Something went wrong."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            data-lazy-view-retry
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-lg bg-[#1b1d21] border border-zinc-700 text-zinc-100 active:scale-[0.98]"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden />
            Retry
          </button>
          {this.state.showReloadOffer || chunk ? (
            <button
              type="button"
              data-lazy-view-reload
              onClick={this.handleReloadAnyway}
              className="text-sm font-semibold px-4 py-2 rounded-lg bg-[#FFB800] text-black active:scale-[0.98]"
            >
              Reload app
            </button>
          ) : null}
        </div>
        {this.state.unsavedBlocked ? (
          <p className="text-[11px] text-amber-400/90 max-w-[300px]" data-lazy-view-unsaved-hint>
            Finish or clear your open order draft before reloading.
          </p>
        ) : null}
      </div>
    );
  }
}