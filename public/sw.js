// BuddyTrip service worker — PWA Phase 1: DELIBERATELY minimal.
//
// This file exists so Web Push can attach to it in a later phase. It does
// NOTHING else. In particular there is NO fetch handler and NO caching:
// a service worker is sticky software — a caching SW shipped to 30 phones
// can serve stale content until forcibly replaced, and users won't know
// why. Offline support is a separate feature with its own spec; do not
// add caching here as a side quest.
//
// skipWaiting + clients.claim make a future SW update (e.g. the push
// phase) take effect on the next load instead of idling in "waiting"
// until every tab closes.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // tag coalesces: a newer push with the same tag replaces the old one
    // instead of stacking (e.g. repeated score updates).
    tag: data.tag || undefined,
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
