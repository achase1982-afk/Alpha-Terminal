import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTerminalStore } from "@/lib/store";
import { fetchWithAuth, setClerkTokenGetter } from "@/lib/fetchWithAuth";
import { useAutoLock, AutoLockProvider } from "@/hooks/useAutoLock";
import TerminalPage from "@/pages/Terminal";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchIntervalInBackground: false,
      retry: 1,
      staleTime: 5 * 60 * 1000,
    }
  }
});

const SESSION_CHECK_COOLDOWN_MS = 30_000;

function PendingSessionLoader() {
  const { accessToken, setTokens } = useTerminalStore();
  const { traderAccessToken, setTraderTokens } = useTerminalStore();
  const lastCheckRef = useRef(0);
  const didInitialCheck = useRef(false);

  useEffect(() => {
    if (accessToken && traderAccessToken) return;

    let cancelled = false;

    const checkServerTokens = async () => {
      try {
        const res = await fetchWithAuth("/api/auth/server-tokens");
        if (!res.ok || cancelled) return;
        const data = await res.json() as {
          market?: { accessToken: string; refreshToken: string } | null;
          trader?: { accessToken: string; refreshToken: string } | null;
        };
        if (!cancelled && data.market?.accessToken && !accessToken) {
          setTokens(data.market.accessToken, data.market.refreshToken || "");
        }
        if (!cancelled && data.trader?.accessToken && !traderAccessToken) {
          setTraderTokens(data.trader.accessToken, data.trader.refreshToken || "");
        }
      } catch {}
    };

    const checkPending = async () => {
      try {
        const res = await fetchWithAuth("/api/auth/pending-session");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.found && data.accessToken) {
          setTokens(data.accessToken, data.refreshToken || "");
        }
      } catch {}
    };

    const checkTraderPending = async () => {
      try {
        const res = await fetchWithAuth("/api/auth/trader-pending-session");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.found && data.accessToken) {
          setTraderTokens(data.accessToken, data.refreshToken || "");
        }
      } catch {}
    };

    const doCheck = async () => {
      const now = Date.now();
      if (didInitialCheck.current && now - lastCheckRef.current < SESSION_CHECK_COOLDOWN_MS) {
        return;
      }
      lastCheckRef.current = now;
      didInitialCheck.current = true;
      await checkServerTokens();
      if (!cancelled) await checkPending();
      if (!cancelled) await checkTraderPending();
    };

    doCheck();

    const handleVisibility = () => {
      if (!document.hidden && !cancelled) {
        doCheck();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [accessToken, traderAccessToken, setTokens, setTraderTokens]);

  return null;
}

function ClerkTokenBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    setClerkTokenGetter(() => getToken());
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  return null;
}

function InactivityWarning() {
  const { warning, countdown } = useAutoLock();

  if (!warning) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center px-4 py-2 bg-amber-600/95 backdrop-blur-sm animate-in fade-in slide-in-from-top-2">
      <p className="font-mono text-xs text-white text-center">
        Session expiring in <span className="font-bold tabular-nums">{countdown}s</span> due to inactivity. Tap anywhere to stay signed in.
      </p>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={TerminalPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AutoLockProvider>
          <ClerkTokenBridge />
          <InactivityWarning />
          <PendingSessionLoader />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AutoLockProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
