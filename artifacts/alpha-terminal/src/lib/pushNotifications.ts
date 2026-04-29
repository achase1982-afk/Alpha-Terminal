import { fetchWithAuth } from "./fetchWithAuth";

const SW_PATH = "/sw.js";

let swRegistration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    console.warn("[push] Service workers not supported");
    return null;
  }

  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
    swRegistration = reg;
    console.log("[push] Service worker registered");
    return reg;
  } catch (err) {
    console.error("[push] SW registration failed:", err);
    return null;
  }
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function getNotificationPermission(): NotificationPermission {
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) {
    console.warn("[push] Push not supported in this browser");
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    console.warn("[push] Notification permission denied");
    return false;
  }

  let reg = swRegistration;
  if (!reg) {
    reg = await registerServiceWorker();
  }
  if (!reg) return false;

  try {
    const vapidRes = await fetchWithAuth("/api/push/vapid-key");
    if (!vapidRes.ok) {
      console.error("[push] Failed to fetch VAPID key");
      return false;
    }
    const { publicKey } = await vapidRes.json() as { publicKey: string };

    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      const ok = await sendSubscriptionToServer(existing);
      if (!ok) {
        console.error("[push] Failed to register existing subscription with server");
        return false;
      }
      return true;
    }

    const applicationServerKey = urlBase64ToUint8Array(publicKey);
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey.buffer.slice(
        applicationServerKey.byteOffset,
        applicationServerKey.byteOffset + applicationServerKey.byteLength,
      ) as ArrayBuffer,
    });

    const ok = await sendSubscriptionToServer(subscription);
    if (!ok) {
      console.error("[push] Failed to register new subscription with server");
      await subscription.unsubscribe();
      return false;
    }
    console.log("[push] Push subscription created");
    return true;
  } catch (err) {
    console.error("[push] Subscribe failed:", err);
    return false;
  }
}

export async function unsubscribeFromPush(): Promise<boolean> {
  const reg = swRegistration ?? (await navigator.serviceWorker?.getRegistration());
  if (!reg) return false;

  try {
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;

    await fetchWithAuth("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });

    await sub.unsubscribe();
    console.log("[push] Unsubscribed from push");
    return true;
  } catch (err) {
    console.error("[push] Unsubscribe failed:", err);
    return false;
  }
}

export async function isSubscribed(): Promise<boolean> {
  const reg = swRegistration ?? (await navigator.serviceWorker?.getRegistration());
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

export async function reRegisterIfNeeded(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== "granted") return;

  const reg = swRegistration ?? (await navigator.serviceWorker?.getRegistration());
  if (!reg) return;

  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  try {
    const ok = await sendSubscriptionToServer(sub);
    if (ok) {
      console.log("[push] Re-registered existing subscription with server");
    }
  } catch (err) {
    console.warn("[push] Re-registration failed:", err);
  }
}

async function sendSubscriptionToServer(sub: PushSubscription): Promise<boolean> {
  const raw = sub.toJSON();
  const res = await fetchWithAuth("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: {
        p256dh: raw.keys?.p256dh ?? "",
        auth: raw.keys?.auth ?? "",
      },
    }),
  });
  return res.ok;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
