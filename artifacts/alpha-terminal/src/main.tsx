import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignedIn, SignedOut } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { useEffect } from "react";
import App from "./App";
import "./index.css";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
const devBypass = import.meta.env.VITE_DEV_BYPASS_AUTH === "true";

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
