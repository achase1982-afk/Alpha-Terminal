import { useAuthNoticeStore } from "@/lib/authNoticeStore";
import { useBrokerConnect } from "@/hooks/useBrokerConnect";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import type { MouseEvent } from "react";

/**
 * Global, dismissible banner for Clerk vs Schwab auth problems.
 * Schwab: reconnect via the same OAuth anchor flow as AuthPanel (PWA-safe).
 * Clerk: full reload revalidates the session (common fix after deploy / stale bundle).
 */
export default function AuthSessionBanner() {
  const notice = useAuthNoticeStore((s) => s.notice);
  const dismiss = useAuthNoticeStore((s) => s.dismiss);
  const { oauthUrl, isNavigating, onClick } = useBrokerConnect();

  if (!notice) return null;

  const loginDisabled = !oauthUrl || isNavigating;
  const handleSchwabClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (loginDisabled) {
      event.preventDefault();
      return;
    }
    onClick();
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9990] flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pointer-events-none"
      role="alert"
    >
      <div
        className="pointer-events-auto flex w-full max-w-2xl flex-col gap-2 rounded-lg border border-[#FFB800]/35 bg-[#141416]/98 px-3 py-2.5 shadow-xl backdrop-blur-md sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 flex-1 gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FFB800]" aria-hidden />
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#FFB800]">
              {notice.kind === "schwab" ? "Schwab session" : "Account session"}
            </p>
            <p className="font-mono text-xs text-zinc-200">{notice.message}</p>
            {notice.detail ? (
              <p className="mt-1 font-mono text-[10px] leading-snug text-zinc-500">{notice.detail}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:pl-2">
          {notice.kind === "schwab" ? (
            <a
              href={oauthUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleSchwabClick}
              aria-disabled={loginDisabled}
              className="inline-flex items-center justify-center gap-1.5 rounded border border-[#FFB800]/40 bg-[#FFB800]/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#FFB800] transition-colors hover:bg-[#FFB800]/20 disabled:opacity-50"
              style={{
                pointerEvents: loginDisabled ? "none" : "auto",
                opacity: loginDisabled && !isNavigating ? 0.5 : 1,
                textDecoration: "none",
              }}
            >
              {isNavigating ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Opening…
                </>
              ) : (
                <>
                  Reconnect Schwab
                  <ExternalLink className="h-3 w-3" />
                </>
              )}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                dismiss();
                window.location.reload();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded border border-zinc-600 bg-zinc-800/80 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-100 transition-colors hover:bg-zinc-700"
            >
              <RefreshCw className="h-3 w-3" />
              Reload app
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex items-center justify-center rounded p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
