import { describe, it, expect } from "vitest";
import { slugifyTitle, tripSlugCode, buildTripSlug } from "./slug";

describe("slugifyTitle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyTitle("BBMI 2027")).toBe("bbmi-2027");
    expect(slugifyTitle("Cancún Trip!")).toBe("canc-n-trip");
  });

  it("collapses runs of non-alphanumerics and trims edges", () => {
    expect(slugifyTitle("  --Lads' Weekend--  ")).toBe("lads-weekend");
  });

  it("falls back to 'trip' for empty / symbol-only titles", () => {
    expect(slugifyTitle("")).toBe("trip");
    expect(slugifyTitle("!!!")).toBe("trip");
  });

  it("caps length at 40 chars (then re-trims a trailing hyphen)", () => {
    expect(slugifyTitle("a".repeat(60)).length).toBe(40);
  });
});

describe("tripSlugCode", () => {
  it("is a stable 6-char hex code derived from the id", () => {
    const code = tripSlugCode("trip-123");
    expect(code).toMatch(/^[0-9a-f]{6}$/);
    expect(tripSlugCode("trip-123")).toBe(code); // deterministic
  });
});

describe("buildTripSlug", () => {
  it("is `slugify(title)-<code>`", () => {
    expect(buildTripSlug("BBMI 2027", "trip-abc")).toMatch(/^bbmi-2027-[0-9a-f]{6}$/);
  });

  it("disambiguates same-title trips by id — the collision the title alone can't", () => {
    const a = buildTripSlug("Cancun", "id-one");
    const b = buildTripSlug("Cancun", "id-two");
    expect(a).not.toBe(b);
    expect(a.startsWith("cancun-")).toBe(true);
    expect(b.startsWith("cancun-")).toBe(true);
  });

  it("is stable for a given (title, id)", () => {
    expect(buildTripSlug("Lads Weekend", "x9")).toBe(buildTripSlug("Lads Weekend", "x9"));
  });
});
