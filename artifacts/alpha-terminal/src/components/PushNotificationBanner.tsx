import { useState, useEffect } from "react";
import { Bell, BellOff, X, Check } from "lucide-react";
import {
  isPushSupported,
  getNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  isSubscribed as checkIsSubscribed,
  reRegisterIfNeeded,
} from "@/lib/pushNotifications";

const GOLD = "#FFB800";
const BG = "#111113";
const BORDER = "#1f1f23";
const MUTED = "#71717a";
const WHITE = "#fafafa";
const GREEN = "#00d166";
const RED = "#dc2626";
const DISMISS_KEY = "alpha-terminal:order-alerts-banner-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* private mode */
  }
}

/**
 * In-flow bar. `aboveNav` means the bottom nav sits under this bar, so the
 * nav owns the home-indicator inset. Otherwise the bar pads for safe-area.
 */
export default function PushNotificationBanner({ aboveNav = false }: { aboveNav?: boolean }) {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [loading, setLoading] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    const sup = isPushSupported();
    setSupported(sup);
    if (sup) {
      setPermission(getNotificationPermission());
      checkIsSubscribed().then(setSubscribed);
      reRegisterIfNeeded();
    }
  }, []);

  const dismiss = () => {
    rememberDismissed();
    setDismissed(true);
  };

  if (!supported || dismissed || subscribed) return null;
  if (permission === "denied") return null;

  const handleEnable = async () => {
    setLoading(true);
    const ok = await subscribeToPush();
    setSubscribed(ok);
    setLoading(false);
    if (ok) {
      setTimeout(dismiss, 2000);
    }
  };

  return (
    <div
      role="region"
      aria-label="Enable order alerts"
      style={{
        flexShrink: 0,
        background: BG,
        borderTop: `1px solid ${BORDER}`,
        padding: "10px 12px",
        paddingBottom: aboveNav ? 10 : "max(10px, env(safe-area-inset-bottom, 0px))",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <Bell size={18} color={GOLD} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ color: WHITE, fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
          ENABLE ORDER ALERTS
        </div>
        <div style={{ color: MUTED, fontSize: 11, lineHeight: "15px" }}>
          Get push notifications for fills, cancels, and account activity
        </div>
      </div>
      <button
        onClick={handleEnable}
        disabled={loading}
        style={{
          background: GOLD,
          color: "#000",
          border: "none",
          borderRadius: 4,
          padding: "6px 12px",
          fontSize: 11,
          fontWeight: 700,
          cursor: loading ? "wait" : "pointer",
          letterSpacing: "0.5px",
          flexShrink: 0,
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? "..." : "ENABLE"}
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss order alerts prompt"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 4,
          flexShrink: 0,
        }}
      >
        <X size={14} color={MUTED} />
      </button>
    </div>
  );
}
