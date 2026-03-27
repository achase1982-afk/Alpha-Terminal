import { useEffect, useState } from "react";

export default function OauthSuccess() {
  const [statusText, setStatusText] = useState("Processing...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const flowId = params.get("flowId");
    const message = params.get("message");

    if (status === "success" && flowId) {
      setStatusText("Connected! Closing...");

      try {
        window.opener?.postMessage(
          { type: "schwab-oauth-success", flowId },
          window.location.origin
        );
      } catch {
      }

      setTimeout(() => window.close(), 600);
    } else {
      setStatusText(message || "Authentication failed.");

      try {
        window.opener?.postMessage(
          { type: "schwab-oauth-error", message: message || "Authentication failed." },
          window.location.origin
        );
      } catch {
      }

      setTimeout(() => window.close(), 2000);
    }
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
      <div className="text-center space-y-3 p-8">
        <div className="text-primary text-2xl font-bold font-mono">ALPHA TERMINAL</div>
        <p className="text-sm font-mono text-muted-foreground">{statusText}</p>
      </div>
    </div>
  );
}
