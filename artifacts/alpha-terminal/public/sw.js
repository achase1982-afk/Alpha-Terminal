self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

const STRATEGIST_PUSH_CACHE = "alpha-strategist-push-v1";
const PENDING_JOB_KEY = "https://alpha-terminal.local/pending-strategist-job";

async function stashStrategistPushJob(jobId, ticker) {
  try {
    const cache = await caches.open(STRATEGIST_PUSH_CACHE);
    await cache.put(
      PENDING_JOB_KEY,
      new Response(
        JSON.stringify({
          jobId,
          ticker: typeof ticker === "string" ? ticker : undefined,
          at: Date.now(),
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
  } catch {
    // best-effort
  }
}

function postStrategistReadyToClients(clients, jobId, ticker) {
  const msg = {
    type: "STRATEGIST_PUSH_READY",
    jobId,
    ticker: typeof ticker === "string" ? ticker : undefined,
  };
  for (const client of clients) {
    try {
      client.postMessage(msg);
    } catch {
      // ignore
    }
  }
}

async function openStrategistFromNotification(clients, jobId, ticker, openPath) {
  const origin = self.location.origin;
  const url = `${origin}${openPath}`;
  await stashStrategistPushJob(jobId, ticker);
  postStrategistReadyToClients(clients, jobId, ticker);

  for (const client of clients) {
    if (!client.url.includes(origin)) continue;
    client.postMessage({
      type: "STRATEGIST_PUSH_NAV",
      jobId,
      ticker: typeof ticker === "string" ? ticker : undefined,
    });
    if (typeof client.navigate === "function") {
      try {
        await client.navigate(url);
      } catch {
        // fall through to focus-only
      }
    }
    return client.focus();
  }
  return self.clients.openWindow(url);
}

self.addEventListener("push", (e) => {
  if (!e.data) return;

  let payload;
  try {
    payload = e.data.json();
  } catch {
    payload = { title: "Alpha Terminal", body: e.data.text() };
  }

  const data = payload.data || {};
  const jobId = typeof data.jobId === "string" ? data.jobId : "";
  const isStrategist = data.type === "strategist" && jobId.length > 0;

  const title = payload.title || "Alpha Terminal";
  const options = {
    body: payload.body || "",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.tag || "order-alert",
    renotify: !isStrategist,
    vibrate: [200, 100, 200],
    data,
    requireInteraction: true,
    actions: [{ action: "open", title: "Open Terminal" }],
  };

  e.waitUntil(
    (async () => {
      if (isStrategist) {
        await stashStrategistPushJob(jobId, data.ticker);
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        postStrategistReadyToClients(clients, jobId, data.ticker);
      }
      await self.registration.showNotification(title, options);
    })(),
  );
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
      if (isStrategist) {
        return openStrategistFromNotification(clients, jobId, data.ticker, openPath);
      }
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          return client.focus();
        }
      }
      return self.clients.openWindow(`${self.location.origin}${openPath}`);
    }),
  );
});
