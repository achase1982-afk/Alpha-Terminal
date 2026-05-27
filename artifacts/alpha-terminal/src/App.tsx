import { useEffect, useRef, useState, type ReactNode } from "react";
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
import PushNotificationBanner from "@/components/PushNotificationBanner";
import AuthSessionBanner from "@/components/AuthSessionBanner";
import { registerServiceWorker } from "@/lib/pushNotifications";
import OrderAlertWatcher from "@/components/OrderAlertWatcher";
import SchwabSessionExpiredDialog from "@/components/SchwabSessionExpiredDialog";
import StrategistJobBackgroundSync from "@/components/StrategistJobBackgroundSync";
import { installBrowserTelemetryCapture } from "@/lib/browserTelemetry";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchIntervalInBackground: false,
      refetchOnReconnect: false,
      retry: 1,
      staleTime: 30 * 60 * 1000,
      gcTime: 60 * 60 * 1000,
    }
  }
});

// Debounce to prevent rapid-fire polling if visibilitychange fires multiple
// times in quick succession (some browsers do this on tab/app switches).
const VISIBILITY_DEBOUNCE_MS = 1_500;

function PendingSessionLoader() {
  const { accessToken, setTokens } = useTerminalStore();
  const { traderAccessToken, setTraderTokens } = useTerminalStore();
  const lastCheckRef = useRef(0);

  useEffect(() => {
    if (accessToken || traderAccessToken) return;

    let cancelled = false;

    const checkServerTokens = async () => {
      try {
        const res = await fetchWithAuth("/api/auth/server-tokens");
        if (!res.ok || cancelled) return;
        const data = await res.json() as {
          market?: { accessToken: string; refreshToken: string } | null;
          trader?: { accessToken: string; refreshToken: string } | null;
        };
        // Use whichever token is available — both slots get the same token
        const tok = data.trader ?? data.market;
        if (!cancelled && tok?.accessToken) {
          setTokens(tok.accessToken, tok.refreshToken || "");
          setTraderTokens(tok.accessToken, tok.refreshToken || "");
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
          setTraderTokens(data.accessToken, data.refreshToken || "");
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
          setTokens(data.accessToken, data.refreshToken || "");
        }
      } catch {}
    };

    // Always run all three checks. The previous 30s cooldown was silently
    // suppressing the post-OAuth poll \u2014 OAuth round-trips finish well
    // under 30s, so visibilitychange after returning from Schwab would be
    // gated out and the new trader token would sit on the server unclaimed.
    const doCheck = async () => {
      lastCheckRef.current = Date.now();
      await checkServerTokens();
      if (!cancelled) await checkPending();
      if (!cancelled) await checkTraderPending();
    };

    // Initial mount check.
    doCheck();

    const handleVisibility = () => {
      if (document.hidden || cancelled) return;
      // Tiny debounce: only skip if we just polled in the last ~1.5s.
      // This protects against duplicate visibilitychange bursts but does NOT
      // block the legitimate "user came back from OAuth tab" case.
      const now = Date.now();
      if (now - lastCheckRef.current < VISIBILITY_DEBOUNCE_MS) return;
      doCheck();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    // Also catch focus and pageshow \u2014 mobile browsers sometimes fire these
    // instead of (or in addition to) visibilitychange when returning from
    // another tab or back-forward navigation.
    window.addEventListener("focus", handleVisibility);
    window.addEventListener("pageshow", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
      window.removeEventListener("pageshow", handleVisibility);
    };
  }, [accessToken, traderAccessToken, setTokens, setTraderTokens]);

  return null;
}

const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

function AuthReadyGate({ children }: { children: ReactNode }) {
  if (devBypass) return <>{children}</>;
  return <AuthReadyGateInner>{children}</AuthReadyGateInner>;
}

function AuthHydratingScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1C1C1E",
        color: "#FFB800",
        fontSize: 12,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      Loading...
    </div>
  );
}

function AuthReadyGateInner({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setClerkTokenGetter((opts) => getToken(opts));
    setAuthTokenGetter((opts) => getToken(opts));
    setReady(true);
    return () => {
      setClerkTokenGetter(async () => null);
      setAuthTokenGetter(null);
      setReady(false);
    };
  }, [getToken]);

  return ready ? <>{children}</> : <AuthHydratingScreen />;
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


function BrowserTelemetryInstaller() {
  useEffect(() => {
    return installBrowserTelemetryCapture();
  }, []);
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
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AutoLockProvider>
          <AuthReadyGate>
            <InactivityWarning />
            <AuthSessionBanner />
            <PendingSessionLoader />
            <StrategistJobBackgroundSync />
            <BrowserTelemetryInstaller />
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <Toaster />
            <PushNotificationBanner />
            <OrderAlertWatcher />
            <SchwabSessionExpiredDialog />
          </AuthReadyGate>
        </AutoLockProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
