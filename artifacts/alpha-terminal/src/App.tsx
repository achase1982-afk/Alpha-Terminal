import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTerminalStore } from "@/lib/store";
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

function PendingSessionLoader() {
  const { accessToken, setTokens } = useTerminalStore();
  const { traderAccessToken, setTraderTokens } = useTerminalStore();

  useEffect(() => {
    if (accessToken) return;

    let cancelled = false;

    const checkPending = async () => {
      try {
        const res = await fetch("/api/auth/pending-session");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.found && data.accessToken) {
          setTokens(data.accessToken, data.refreshToken || "");
        }
      } catch {}
    };

    checkPending();

    const handleVisibility = () => {
      if (!document.hidden && !cancelled) {
        checkPending();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [accessToken, setTokens]);

  useEffect(() => {
    if (traderAccessToken) return;

    let cancelled = false;

    const checkTraderPending = async () => {
      try {
        const res = await fetch("/api/auth/trader-pending-session");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data.found && data.accessToken) {
          setTraderTokens(data.accessToken, data.refreshToken || "");
        }
      } catch {}
    };

    checkTraderPending();

    const handleVisibility = () => {
      if (!document.hidden && !cancelled) {
        checkTraderPending();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [traderAccessToken, setTraderTokens]);

  return null;
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
        <PendingSessionLoader />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
