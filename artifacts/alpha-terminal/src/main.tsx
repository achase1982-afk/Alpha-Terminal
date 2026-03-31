import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignedIn, SignedOut, useClerk } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { useState, useCallback, useEffect } from "react";
import App from "./App";
import "./index.css";
import { readSecurityPrefs } from "./lib/securityPrefs";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

function PasskeySignInButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { client } = useClerk();

  const prefs = readSecurityPrefs();
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(!!window.PublicKeyCredential && prefs.biometricLogin);
  }, [prefs.biometricLogin]);

  const handlePasskeySignIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const signInAttempt = await (client as any).signIn.create({ strategy: "passkey" });
      if (signInAttempt.status === "complete") {
        await (client as any).setActive({ session: signInAttempt.createdSessionId });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("cancelled") && !msg.includes("canceled")) {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [client]);

  if (!supported) return null;

  return (
    <div style={{ marginTop: 16, textAlign: "center" }}>
      <button
        onClick={() => void handlePasskeySignIn()}
        disabled={loading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 24px",
          borderRadius: 12,
          border: "1px solid rgba(255, 184, 0, 0.3)",
          background: "rgba(255, 184, 0, 0.08)",
          color: "#FFB800",
          fontFamily: "'Inter', monospace",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.05em",
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.6 : 1,
          transition: "all 0.2s",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662" />
          <rect width="18" height="18" x="3" y="3" rx="2" />
        </svg>
        {loading ? "AUTHENTICATING..." : "SIGN IN WITH FACE ID"}
      </button>
      {error && (
        <p style={{ color: "#ef4444", fontSize: 10, fontFamily: "monospace", marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}

function LoginScreen() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#1C1C1E",
      }}
    >
      <SignIn routing="hash" />
      <PasskeySignInButton />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  devBypass ? (
    <App />
  ) : (
    <ClerkProvider publishableKey={clerkPubKey} appearance={{ baseTheme: dark }}>
      <SignedOut>
        <LoginScreen />
      </SignedOut>
      <SignedIn>
        <App />
      </SignedIn>
    </ClerkProvider>
  ),
);
