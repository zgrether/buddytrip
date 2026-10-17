import { describe, it, expect } from "vitest";
import { isLodgingUrl, LODGING_DOMAINS } from "./lodgingDomains";

/**
 * Previews are fetched for listed lodging domains only: the exact domain or a
 * subdomain of it, never a lookalike. Every case goes through `new URL(...)`,
 * the form the route and the sheet both judge.
 */

const listed = (u: string) => isLodgingUrl(new URL(u));

describe("isLodgingUrl", () => {
  it.each(LODGING_DOMAINS.map((d) => [d]))("admits %s itself", (d) => {
    expect(listed(`https://${d}/x`)).toBe(true);
  });

  it.each([
    "https://www.airbnb.com/rooms/123",
    "https://es.airbnb.com/rooms/123",
    "https://abnb.me/AbC123",
    "https://www.vrbo.com/1234567",
    "https://www.booking.com/hotel/us/lake.html",
    "https://www.hotels.com/ho123/",
    "https://www.expedia.com/Lake-Hotel.h1.Hotel-Information",
    "https://WWW.AIRBNB.COM./rooms/1",
    "http://www.airbnb.com/rooms/1",
  ])("admits %s", (u) => {
    expect(listed(u)).toBe(true);
  });

  it.each([
    ["a lookalike prefix", "https://notairbnb.com/rooms/1"],
    ["the domain as a subdomain of someone else's", "https://airbnb.com.example.net/rooms/1"],
    ["a different TLD", "https://airbnb.co/rooms/1"],
    ["an unrelated site", "https://example.com/listing"],
    ["a domain that merely contains one", "https://mybooking.com/x"],
    ["a listed name in the path, not the host", "https://example.com/www.airbnb.com"],
    ["a listed name in the credentials", "https://www.airbnb.com@example.com/"],
    ["a non-http scheme", "ftp://www.airbnb.com/"],
  ])("refuses %s (%s)", (_label, u) => {
    expect(listed(u)).toBe(false);
  });
});
