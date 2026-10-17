import { normalizeHost } from "./ssrfGuard";

/**
 * The lodging sites a link preview is fetched for. Any other link still saves
 * and opens; it just gets no preview pulled (Zach, 2026-10-17).
 *
 * A host matches a domain exactly or as a subdomain of it (`www.airbnb.com`,
 * `es.airbnb.com`), never as a lookalike (`notairbnb.com`,
 * `airbnb.com.example.net`). A redirect must also land on a listed domain, or
 * the fetch stops: see `/api/lodging-meta`.
 *
 * Share-link domains are added only from a real share link out of each app,
 * never from memory: a wrong entry on an allow-list is the hole it closes.
 * Confirmed so far: Airbnb `abnb.me`, Vrbo `vrbo.onelink.me`.
 */
export const LODGING_DOMAINS = [
  "airbnb.com",
  "abnb.me", // Airbnb's share links
  "vrbo.com",
  // Vrbo's share links: AppsFlyer OneLink, one 301 to www.vrbo.com. This exact
  // host only. onelink.me itself is shared by every app that uses AppsFlyer.
  // Confirmed from a real share link (BBMI 2026, 2026-10-17).
  "vrbo.onelink.me",
  "booking.com",
  "hotels.com",
  "expedia.com",
] as const;

export function isLodgingHost(hostname: string): boolean {
  const h = normalizeHost(hostname);
  return LODGING_DOMAINS.some((d) => h === d || h.endsWith("." + d));
}

/** An http(s) URL on a listed lodging domain. */
export function isLodgingUrl(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:") && isLodgingHost(url.hostname);
}
