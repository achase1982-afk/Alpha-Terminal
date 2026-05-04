import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors in the scanner subtree so a failed mount does not blank the whole tab.
 */
export class ScannerErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ScannerErrorBoundary]", error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const msg = this.state.error.message || String(this.state.error);
      return (
        <div className="max-w-4xl mx-auto p-6 rounded-xl border border-red-500/40 bg-red-950/40 space-y-4">
          <p className="text-sm font-bold text-red-300 uppercase tracking-wide">
            Scanner crashed: <span className="font-mono normal-case text-red-200/95">{msg}</span>
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="text-sm font-bold px-4 py-2 rounded-lg bg-[#FFB800] text-black active:scale-[0.98]"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
