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
 * Share-link domains: only Airbnb's `abnb.me` is listed, because it is the only
 * one confirmed. Add the others from a real share link out of each app, not
 * from memory.
 */
export const LODGING_DOMAINS = [
  "airbnb.com",
  "abnb.me", // Airbnb's share links
  "vrbo.com",
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
