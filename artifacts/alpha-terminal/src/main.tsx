import { createRoot } from "react-dom/client";
import { ClerkProvider, SignIn, SignedIn, SignedOut } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import App from "./App";
import "./index.css";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

createRoot(document.getElementById("root")!).render(
  <ClerkProvider publishableKey={clerkPubKey} appearance={{ baseTheme: dark }}>
    <SignedOut>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1C1C1E",
        }}
      >
        <SignIn routing="hash" />
      </div>
    </SignedOut>
    <SignedIn>
      <App />
    </SignedIn>
  </ClerkProvider>,
);
