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

function SchwabSessionReceiver() {
  const setTokens = useTerminalStore((s) => s.setTokens);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("schwab") !== "connected") return;

    window.history.replaceState({}, "", window.location.pathname);

    (async () => {
      try {
        const res = await fetch("/api/auth/pending-session");
        if (!res.ok) return;
        const data = await res.json();
        if (data.found && data.accessToken) {
          setTokens(data.accessToken, data.refreshToken || "");
        }
      } catch {}
    })();
  }, [setTokens]);

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
        <SchwabSessionReceiver />
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
