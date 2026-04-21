import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignedIn, SignedOut, ClerkLoaded, ClerkLoading } from "@clerk/clerk-react";
import { Loader2 } from "lucide-react";
import { dark } from "@clerk/themes";
import { useEffect } from "react";
import App from "./App";
import "./index.css";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

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
      }}
    >
      {children}
    </div>
  );
}

function LoginScreen() {
  return (
    <CenteredScreen>
      <SignIn routing="hash" />
    </CenteredScreen>
  );
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
          <App />
        </SignedIn>
      </ClerkLoaded>
    </ClerkProvider>
  ),
);
