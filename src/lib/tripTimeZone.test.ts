import { describe, it, expect } from "vitest";
import {
  TRIP_TIME_ZONE,
  wallClockInZone,
  instantFromWallClock,
  zoneAbbrev,
  formatInTripZone,
  tripZoneNote,
} from "./tripTimeZone";

/**
 * ── Why these cases are shaped the way they are ────────────────────────────
 *
 * The build this guards against is the one that was here before: every helper
 * reading the DEVICE's zone. On a UTC runner that build gives visibly different
 * answers and the literals below catch it. On a machine already set to Eastern
 * it gives IDENTICAL answers, and every such literal would pass both builds —
 * a green run that means nothing, on the one machine most likely to be running
 * it by hand.
 *
 * So the load-bearing cases pass an EXPLICIT zone that is not Eastern and not
 * the machine's. A device-local implementation ignores that argument, so those
 * fail everywhere, on any runner, in any zone. The Eastern literals then only
 * have to pin which zone the app chose — which is what `TRIP_TIME_ZONE` is.
 *
 * Verified by mutation, not by reading: reverting `formatInTripZone` to
 * `toLocaleString(undefined, …)` fails "honours an explicitly passed zone" and
 * "renders Eastern regardless of the device"; reverting `instantFromWallClock`
 * to `setHours` fails the round-trip and the DST pair.
 */

describe("the zone the app is pinned to", () => {
  it("is Eastern — the frame the frozen kickoff strings are already in", () => {
    // The kickoffs in `pickem_slate_games.kickoff` are text, produced in the
    // runner's zone at slate-build time. Pinning to anything else would put the
    // deadline back in a second frame, which is the bug being fixed.
    expect(TRIP_TIME_ZONE).toBe("America/New_York");
  });
});

describe("formatting an instant", () => {
  it("honours an explicitly passed zone", () => {
    // THE decisive case, and the only one that is machine-independent: a
    // device-local build ignores this argument entirely, so it fails here
    // whatever zone the runner is in — including Eastern.
    const iso = "2026-09-09T00:10:00.000Z";
    expect(formatInTripZone(iso, "Asia/Tokyo")).toContain("9:10 AM");
    expect(formatInTripZone(iso, "Asia/Tokyo")).toContain("Sep 9");
    expect(formatInTripZone(iso, "America/Los_Angeles")).toContain("5:10 PM");
    expect(formatInTripZone(iso, "America/Los_Angeles")).toContain("Sep 8");
  });

  it("renders Eastern regardless of the device, and labels it", () => {
    // The real deadline from the incident: Wednesday 8:10 PM Eastern, ten
    // minutes before an 8:20 kickoff. Read in Central it showed 7:10 PM beside
    // an unmoved "8:20p", which reads as 70 minutes early rather than 10.
    expect(formatInTripZone("2026-09-10T00:10:00.000Z")).toBe("Wed, Sep 9, 8:10 PM EDT");
  });

  it("crosses the DATE boundary in the pinned zone, not the device's", () => {
    // 3:30am UTC on the 9th is still the EVENING OF THE 8TH in Eastern. A
    // device-local build on a UTC runner says "Wed, Sep 9, 3:30 AM" — a
    // different day, which is the failure that actually confuses a reader.
    expect(formatInTripZone("2026-09-09T03:30:00.000Z")).toBe("Tue, Sep 8, 11:30 PM EDT");
  });

  it("says EST in winter and EDT in summer — the abbreviation is DERIVED", () => {
    // A hardcoded "EDT" (or a fixed -4 offset) is wrong for five months of the
    // year, and the trip week is close enough to the November change that this
    // is not hypothetical.
    expect(zoneAbbrev("2026-09-09T00:10:00.000Z")).toBe("EDT");
    expect(zoneAbbrev("2026-12-09T00:10:00.000Z")).toBe("EST");
    expect(tripZoneNote("2026-09-09T00:10:00.000Z")).toBe("All times EDT");
    expect(tripZoneNote("2026-12-09T00:10:00.000Z")).toBe("All times EST");
  });

  it("treats a missing or unparseable instant as nothing to show", () => {
    // A deadline that throws on render is worse than one that does not display.
    expect(formatInTripZone(null)).toBe("");
    expect(formatInTripZone("not-a-date")).toBe("");
    expect(zoneAbbrev("not-a-date")).toBe("");
    expect(wallClockInZone("not-a-date")).toBeNull();
  });
});

describe("wall clock ↔ instant", () => {
  it("reads the pinned zone's clock, not the device's", () => {
    expect(wallClockInZone("2026-09-10T00:10:00.000Z")).toEqual({
      year: 2026,
      month: 9,
      day: 9,
      hour: 20,
      minute: 10,
    });
    // Explicit-zone case again, so this is decisive on an Eastern machine too.
    expect(wallClockInZone("2026-09-09T00:10:00.000Z", "Europe/London")).toEqual({
      year: 2026,
      month: 9,
      day: 9,
      hour: 1,
      minute: 10,
    });
  });

  it("builds the instant a runner MEANT when they typed 8:10 PM", () => {
    // The exact write the editor performs. A `setHours` build on a UTC runner
    // produces 2026-09-09T20:10:00Z — four hours and a whole evening wrong.
    expect(
      instantFromWallClock({ year: 2026, month: 9, day: 9, hour: 20, minute: 10 }),
    ).toBe(Date.parse("2026-09-10T00:10:00.000Z"));
  });

  it("ROUND-TRIPS — set a time, reload, see the same time", () => {
    // The property that matters on the settings surface, and the one where a
    // zone slip is silent: the runner sets 11:00 and the picker reads back
    // 06:00 with nothing erroring.
    for (const iso of [
      "2026-09-10T00:10:00.000Z",
      "2026-01-15T18:45:00.000Z",
      "2026-07-04T23:59:00.000Z",
    ]) {
      const wall = wallClockInZone(iso);
      expect(wall).not.toBeNull();
      expect(new Date(instantFromWallClock(wall!)).toISOString()).toBe(iso);
    }
  });

  it("puts the SAME wall clock on either side of the DST change", () => {
    // This is what the two-pass offset solve is for. DST ends at 2am on Sunday
    // Nov 1 2026, so Oct 31 at 8:10 PM is EDT (-4) and Nov 1 at 8:10 PM is EST
    // (-5). Both read "8:10 PM" to a person, so the INSTANTS must be 25 hours
    // apart, not 24 — which is exactly what a fixed-offset implementation gets
    // wrong, and what a one-pass solve gets wrong for the second of the pair.
    const before = instantFromWallClock({ year: 2026, month: 10, day: 31, hour: 20, minute: 10 });
    const after = instantFromWallClock({ year: 2026, month: 11, day: 1, hour: 20, minute: 10 });
    expect(new Date(before).toISOString()).toBe("2026-11-01T00:10:00.000Z");
    expect(new Date(after).toISOString()).toBe("2026-11-02T01:10:00.000Z");
    expect(after - before).toBe(25 * 60 * 60 * 1000);
  });

  it("still returns a real instant for a wall clock spring-forward deletes", () => {
    // 2:30 AM on 2026-03-08 does not occur in Eastern — the clock jumps 1:59:59
    // to 3:00:00. A runner can still type it, and refusing to set any deadline
    // would be worse than resolving it. The two-pass solve lands on 1:30 AM EST,
    // the last real minute BEFORE the gap. Asserted as the exact instant rather
    // than merely `isFinite` so the resolution is pinned and deterministic
    // rather than whatever the arithmetic happens to do next time.
    const ms = instantFromWallClock({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
    expect(new Date(ms).toISOString()).toBe("2026-03-08T06:30:00.000Z");
    expect(wallClockInZone(ms)).toEqual({ year: 2026, month: 3, day: 8, hour: 1, minute: 30 });
  });
});
