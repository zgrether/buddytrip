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
