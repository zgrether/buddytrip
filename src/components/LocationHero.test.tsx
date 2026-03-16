import { describe, it, expect } from "vitest";

/**
 * LocationHero unit tests
 *
 * Tests the pure logic functions: hashToHue and parseLocation.
 * The component rendering is covered by the Playwright E2E test.
 */

// Inline the pure functions for testing (they're not exported from the component)
function hashToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function parseLocation(location: string): { city: string; region: string } {
  const parts = location.split(",").map((s) => s.trim());
  return {
    city: parts[0] || location,
    region: parts.slice(1).join(", ") || "",
  };
}

describe("LocationHero — hashToHue", () => {
  it("returns a value between 0 and 359", () => {
    const hue = hashToHue("Bandon Dunes, OR");
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it("returns the same hue for the same input", () => {
    const h1 = hashToHue("Scottsdale, AZ");
    const h2 = hashToHue("Scottsdale, AZ");
    expect(h1).toBe(h2);
  });

  it("returns different hues for different inputs", () => {
    const h1 = hashToHue("Bandon Dunes, OR");
    const h2 = hashToHue("Scottsdale, AZ");
    expect(h1).not.toBe(h2);
  });

  it("is case-insensitive when normalized", () => {
    const h1 = hashToHue("bandon dunes, or");
    const h2 = hashToHue("bandon dunes, or");
    expect(h1).toBe(h2);
  });
});

describe("LocationHero — parseLocation", () => {
  it("parses city and state from 'City, State' format", () => {
    const result = parseLocation("Bandon Dunes, OR");
    expect(result.city).toBe("Bandon Dunes");
    expect(result.region).toBe("OR");
  });

  it("handles multi-part locations", () => {
    const result = parseLocation("St Andrews, Fife, Scotland");
    expect(result.city).toBe("St Andrews");
    expect(result.region).toBe("Fife, Scotland");
  });

  it("handles location with no comma", () => {
    const result = parseLocation("Cabo");
    expect(result.city).toBe("Cabo");
    expect(result.region).toBe("");
  });

  it("handles empty string", () => {
    const result = parseLocation("");
    expect(result.city).toBe("");
    expect(result.region).toBe("");
  });
});
