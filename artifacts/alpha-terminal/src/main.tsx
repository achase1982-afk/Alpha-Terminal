import { createRoot } from "react-dom/client";
import { ClerkProvider, SignedIn, SignedOut, SignIn, useAuth } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { useEffect } from "react";
import App from "./App";
import { setClerkTokenGetter } from "@/lib/fetchWithAuth";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import "./index.css";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

function AuthBridge({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();

  useEffect(() => {
    const getter = () => getToken();
    setClerkTokenGetter(getter);
    setAuthTokenGetter(getter);
  }, [getToken]);

  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <ClerkProvider publishableKey={clerkPubKey} appearance={{ baseTheme: dark }}>
    <SignedOut>
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "#0c0c0c",
      }}>
        <SignIn routing="hash" />
      </div>
    </SignedOut>
    <SignedIn>
      <AuthBridge>
        <App />
      </AuthBridge>
    </SignedIn>
  </ClerkProvider>
);
