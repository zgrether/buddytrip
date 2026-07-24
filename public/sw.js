// BuddyTrip service worker — DELIBERATELY minimal.
//
// STILL NO CACHING. A caching SW is sticky software that can serve stale
// content to 30 phones until forcibly replaced — that risk is what the
// "no caching" rule guards against, and it stays. Offline support is a
// separate feature with its own spec; do not add caching here.
//
// The `fetch` handler below is a NO-OP pass-through — it registers the event
// (required) but NEVER calls respondWith, so every request goes straight to
// the network unchanged. Zero caching, zero stale-content risk. It exists ONLY
// because Chrome's Android install-as-app (WebAPK) criteria require the SW to
// have a fetch handler; without it, Chrome downgrades "Install" to a dumb
// "Create shortcut" bookmark (which isn't standalone and breaks push). Verified
// on prod: manifest + icons + active SW were all correct and Chrome still
// offered only a shortcut — the missing fetch handler was the sole cause.
//
// skipWaiting + clients.claim make an SW update take effect on the next load
// instead of idling in "waiting" until every tab closes.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// No-op fetch handler — see the header. Do NOT add caching / respondWith here.
self.addEventListener("fetch", () => {
  // Intentionally empty: request falls through to the network untouched.
});

// ── Web Push (Phase 2) ──────────────────────────────────────────────────────
// Still NO fetch handler / NO caching. These two listeners are all push needs:
// render the notification, and route a tap. Payload shape is set by the server
// send helper (src/server/lib/sendPush.ts): { title, body, url?, tag? }.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "BuddyTrip", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "BuddyTrip";
  const options = {
    body: data.body || "",
    // Large icon in the notification body — full colour is fine here.
    icon: "/icon-192.png",
    // Status-bar icon — Android uses ONLY the alpha channel and tints it white,
    // so this MUST be a transparent silhouette. An opaque icon renders as a
    // solid white square. badge-96.png is the flag on a transparent field.
    badge: "/badge-96.png",
    // tag coalesces: a newer push with the same tag replaces the old one
    // instead of stacking (e.g. repeated score updates). renotify makes the
    // replacement RE-ALERT — without it a same-tag push replaces silently, so
    // repeated pushes (incl. the test notification, tag "bt-test") show nothing
    // after the first. renotify requires a tag, so only set it alongside one.
    tag: data.tag || undefined,
    renotify: data.tag ? true : undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus an existing tab if one is open; otherwise open a new one.
        for (const client of clients) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      })
  );
});
