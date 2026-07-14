import { describe, it, expect } from "vitest";
import { parseHiddenFilters } from "./useItineraryFilters";

// The persistence codec for the itinerary filter preference. We store the set
// of HIDDEN categories; parsing must tolerate absent / garbage payloads and
// drop unknown categories (forward-compat if the category list ever changes).
describe("parseHiddenFilters", () => {
  it("returns an empty set for null / missing storage", () => {
    expect(parseHiddenFilters(null).size).toBe(0);
  });

  it("round-trips a stored array of hidden categories", () => {
    const set = parseHiddenFilters(JSON.stringify(["departures", "lodging"]));
    expect([...set].sort()).toEqual(["departures", "lodging"]);
  });

  it("drops unknown / stale categories (e.g. the retired 'travel')", () => {
    const set = parseHiddenFilters(JSON.stringify(["travel", "arrivals", "bogus"]));
    expect([...set]).toEqual(["arrivals"]);
  });

  it("tolerates malformed JSON and non-array payloads", () => {
    expect(parseHiddenFilters("not json").size).toBe(0);
    expect(parseHiddenFilters(JSON.stringify({ nope: true })).size).toBe(0);
  });
});
