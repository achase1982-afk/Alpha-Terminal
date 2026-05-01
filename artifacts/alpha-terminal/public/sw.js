self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("push", (e) => {
  if (!e.data) return;

  let payload;
  try {
    payload = e.data.json();
  } catch {
    payload = { title: "Alpha Terminal", body: e.data.text() };
  }

  const title = payload.title || "Alpha Terminal";
  const options = {
    body: payload.body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.tag || "order-alert",
    renotify: true,
    vibrate: [200, 100, 200],
    data: payload.data || {},
    requireInteraction: true,
    actions: [{ action: "open", title: "Open Terminal" }],
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();

  const data = e.notification.data || {};
  const jobId = typeof data.jobId === "string" ? data.jobId : "";
  const isStrategist = data.type === "strategist" && jobId.length > 0;
  const openPath = isStrategist
    ? `/?sb=strategist&strategistJob=${encodeURIComponent(jobId)}`
    : "/";

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          if (isStrategist) {
            client.postMessage({
              type: "STRATEGIST_PUSH_NAV",
              jobId,
              ticker: typeof data.ticker === "string" ? data.ticker : undefined,
            });
          }
          return client.focus();
        }
      }
      const url = `${self.location.origin}${openPath}`;
      return self.clients.openWindow(url);
    })
  );
});
