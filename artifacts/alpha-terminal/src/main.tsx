import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignedIn, SignedOut, ClerkLoaded, ClerkLoading } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";
import { dark } from "@clerk/themes";
import { useEffect, useState } from "react";
import App from "./App";
import "./index.css";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

const SCHWAB_LINKED_FLAG = "alpha_terminal_schwab_just_linked";

// Capture the schwab_linked marker as early as possible (before Clerk mounts
// and potentially navigates the URL away). Persist it in sessionStorage so
// the LoginScreen can show a "linked successfully — please sign in" banner
// even if Clerk replaces the URL while booting its sign-in widget.
(function captureSchwabLinkedFlag() {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("schwab_linked") === "1") {
      sessionStorage.setItem(SCHWAB_LINKED_FLAG, "1");
      url.searchParams.delete("schwab_linked");
      const cleaned = url.pathname + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "") + url.hash;
      window.history.replaceState({}, "", cleaned);
    }
  } catch {
    // sessionStorage / URL APIs unavailable — silently degrade.
  }
})();

function CenteredScreen({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#1C1C1E",
        padding: "24px 16px",
      }}
    >
      {children}
    </div>
  );
}

function SchwabLinkedBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      style={{
        maxWidth: 400,
        width: "100%",
        marginBottom: 20,
        padding: "16px 18px",
        borderRadius: 12,
        background: "rgba(255, 184, 0, 0.10)",
        border: "1px solid rgba(255, 184, 0, 0.45)",
        color: "#FFE9A8",
        fontFamily: "-apple-system, system-ui, sans-serif",
        position: "relative",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: "#FFB800" }}>
        Schwab brokerage linked
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        Your Schwab account was connected successfully. Please sign in to Alpha
        Terminal one more time to finish — your link is already saved on the
        server, so you won&#39;t need to repeat the Schwab step.
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          background: "transparent",
          border: "none",
          color: "#FFE9A8",
          fontSize: 18,
          lineHeight: 1,
          cursor: "pointer",
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

function LoginScreen() {
  const [showBanner, setShowBanner] = useState(() => {
    try {
      return sessionStorage.getItem(SCHWAB_LINKED_FLAG) === "1";
    } catch {
      return false;
    }
  });

  const dismissBanner = () => {
    try {
      sessionStorage.removeItem(SCHWAB_LINKED_FLAG);
    } catch {
      // ignore
    }
    setShowBanner(false);
  };

  return (
    <CenteredScreen>
      {showBanner && <SchwabLinkedBanner onDismiss={dismissBanner} />}
      <SignIn routing="hash" />
    </CenteredScreen>
  );
}

function ClearSchwabLinkedFlag() {
  // Once Clerk reports the user is signed in, the post-Schwab banner is no
  // longer relevant — clear it so it doesn't reappear on a future sign-out
  // within the same tab.
  useEffect(() => {
    try {
      sessionStorage.removeItem(SCHWAB_LINKED_FLAG);
    } catch {
      // ignore
    }
  }, []);
  return null;
}

function HydratingScreen() {
  // Shown while Clerk's session check is in flight. Without this, the
  // SignedOut branch flashes the SignIn widget on every cold-mount —
  // which is what looked like "looping back to Clerk" after the Schwab
  // OAuth redirect landed back on the SPA root.
  return (
    <CenteredScreen>
      <Loader2 style={{ width: 28, height: 28, color: "#FFB800" }} className="animate-spin" />
    </CenteredScreen>
  );
}

createRoot(document.getElementById("root")!).render(
  devBypass ? (
    <App />
  ) : (
    <ClerkProvider publishableKey={clerkPubKey} appearance={{ baseTheme: dark }}>
      <ClerkLoading>
        <HydratingScreen />
      </ClerkLoading>
      <ClerkLoaded>
        <SignedOut>
          <LoginScreen />
        </SignedOut>
        <SignedIn>
          <ClearSchwabLinkedFlag />
          <App />
        </SignedIn>
      </ClerkLoaded>
    </ClerkProvider>
  ),
);
