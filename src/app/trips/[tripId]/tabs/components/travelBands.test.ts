import { describe, it, expect } from "vitest";
import { bandOf, buildTravelBands, travelGroupMeta, type TravelPerson } from "./travelBands";

// The pure half of the travel summary — banding, chip merging, and the header
// meta line. Everything here is a function of the ArrivalEvent list, so the
// cases are the ones the design spec calls out plus the boundaries.

function p(
  memberId: string,
  displayName: string,
  time: string | null,
  mode: TravelPerson["mode"] = "flying",
  subtitle: string | null = null
): TravelPerson {
  return { memberId, displayName, time, mode, subtitle };
}

/** The 16-crew arrivals fixture from the design canvas (option 3a). */
const CREW: TravelPerson[] = [
  p("m1", "Zach Grether", "09:00", "driving"),
  p("m2", "Kev Miller", "09:00", "driving"),
  p("m3", "Brad Nolan", "09:30", "flying"),
  p("m4", "Rob Ellis", "09:30", "flying"),
  p("m5", "Jason Pike", "09:30", "flying"),
  p("m6", "JD Marks", "10:00", "driving"),
  p("m7", "Tajar Osei", "11:46", "flying"),
  p("m8", "Mike Doyle", "12:15", "flying"),
  p("m9", "Dan Rhodes", "13:00", "driving"),
  p("m10", "Luke Ferris", "13:00", "driving"),
  p("m11", "Bo Tran", "13:40", "flying"),
  p("m12", "Ryan Cobb", "14:05", "flying"),
  p("m13", "Marty Shaw", "15:15", "driving"),
  p("m14", "Pat Quinn", "18:55", "flying"),
  p("m15", "Buddy Vance", "19:45", "driving"),
  p("m16", "Sean Byrne", null, "flying"),
];

describe("bandOf", () => {
  it("puts a time in the band its window covers, boundaries included", () => {
    expect(bandOf("00:00")).toBe("morning");
    expect(bandOf("11:59")).toBe("morning");
    expect(bandOf("12:00")).toBe("midday");
    expect(bandOf("13:59")).toBe("midday");
    expect(bandOf("14:00")).toBe("afternoon");
    expect(bandOf("17:59")).toBe("afternoon");
    expect(bandOf("18:00")).toBe("evening");
    expect(bandOf("23:59")).toBe("evening");
  });

  it("bands an untimed leg as Not set", () => {
    expect(bandOf(null)).toBe("unset");
  });
});

describe("buildTravelBands", () => {
  it("bands 16 crew into 12 chips with people-counts of 7/4/2/2/1", () => {
    const bands = buildTravelBands(CREW);
    expect(bands.map((b) => b.key)).toEqual([
      "morning",
      "midday",
      "afternoon",
      "evening",
      "unset",
    ]);
    // The count on the band header is PEOPLE...
    expect(bands.map((b) => b.count)).toEqual([7, 4, 2, 2, 1]);
    // ...while the merge collapses 16 people into 12 chips.
    expect(bands.reduce((n, b) => n + b.chips.length, 0)).toBe(12);
    expect(bands.map((b) => b.chips.length)).toEqual([4, 3, 2, 2, 1]);
    // Morning's second chip is the 9:30 merge, named ascending.
    expect(bands[0].chips[1].names).toEqual(["Brad", "Jason", "Rob"]);
    expect(bands[0].chips[1].personCount).toBe(3);
  });

  it("renders only bands that have people, Not set always last", () => {
    const bands = buildTravelBands([p("a", "Ann Lee", "19:00"), p("b", "Bo Tran", null)]);
    expect(bands.map((b) => b.key)).toEqual(["evening", "unset"]);
  });

  it("labels the Not set band with a bare count and no window text", () => {
    const bands = buildTravelBands([p("a", "Ann Lee", null)]);
    expect(bands[0].label).toBe("Not set");
    expect(bands[0].window).toBeNull();
    expect(bands[0].count).toBe(1);
  });

  it("sorts chips ascending by time inside a band", () => {
    const bands = buildTravelBands([
      p("a", "Ann Lee", "11:30"),
      p("b", "Bo Tran", "07:05"),
      p("c", "Cara Diaz", "09:45"),
    ]);
    expect(bands[0].chips.map((c) => c.time)).toEqual(["07:05", "09:45", "11:30"]);
  });

  it("merges same time + same mode + empty subtitles into ONE chip", () => {
    const bands = buildTravelBands([
      p("a", "Brad Nolan", "09:30", "flying"),
      p("b", "Rob Ellis", "09:30", "flying", "   "),
      p("c", "Jason Pike", "09:30", "flying", null),
    ]);
    expect(bands[0].chips).toHaveLength(1);
    expect(bands[0].chips[0].names).toEqual(["Brad", "Jason", "Rob"]);
    expect(bands[0].chips[0].personCount).toBe(3);
    expect(bands[0].chips[0].detail).toBeNull();
  });

  it("keeps three chips when the same time + mode carry DIFFERENT details", () => {
    const bands = buildTravelBands([
      p("a", "Brad Nolan", "09:30", "flying", "SW 1403 from BNA"),
      p("b", "Rob Ellis", "09:30", "flying", "riding with Brad"),
      p("c", "Jason Pike", "09:30", "flying", "DL 88 from ATL"),
    ]);
    expect(bands[0].chips).toHaveLength(3);
    expect(bands[0].chips.map((c) => c.detail).sort()).toEqual([
      "DL 88 from ATL",
      "SW 1403 from BNA",
      "riding with Brad",
    ]);
  });

  it("does not merge across modes at the same time", () => {
    const bands = buildTravelBands([
      p("a", "Ann Lee", "09:30", "flying"),
      p("b", "Bo Tran", "09:30", "driving"),
    ]);
    expect(bands[0].chips).toHaveLength(2);
  });

  it("never merges untimed people — they would collapse into one blob", () => {
    const untimed = Array.from({ length: 16 }, (_, i) =>
      p(`m${i}`, `Person${i} Smith`, null, "flying")
    );
    const bands = buildTravelBands(untimed);
    expect(bands).toHaveLength(1);
    expect(bands[0].key).toBe("unset");
    expect(bands[0].chips).toHaveLength(16);
    expect(bands[0].chips.every((c) => c.personCount === 1)).toBe(true);
  });

  it("falls back to 'First L.' for BOTH people when two first names collide in one chip", () => {
    const bands = buildTravelBands([
      p("a", "Sean Byrne", "09:30", "flying"),
      p("b", "Sean Kelly", "09:30", "flying"),
      p("c", "Rob Ellis", "09:30", "flying"),
    ]);
    // Not just the second instance — an un-disambiguated "Sean" next to a
    // "Sean K." would read as though only one of them were ambiguous.
    expect(bands[0].chips[0].names).toEqual(["Rob", "Sean B.", "Sean K."]);
  });

  it("leaves a shared first name alone when the two are in DIFFERENT chips", () => {
    const bands = buildTravelBands([
      p("a", "Sean Byrne", "09:30", "flying"),
      p("b", "Sean Kelly", "10:30", "flying"),
    ]);
    expect(bands[0].chips.map((c) => c.names)).toEqual([["Sean"], ["Sean"]]);
  });
});

describe("travelGroupMeta", () => {
  it("counts people and spans first to last time", () => {
    const meta = travelGroupMeta(CREW);
    expect(meta.count).toBe(16);
    expect(meta.range).toBe("9:00 AM – 7:45 PM");
    expect(meta.modes).toEqual(["flying", "driving"]);
  });

  it("omits the range for a single person", () => {
    const meta = travelGroupMeta([p("a", "Ann Lee", "09:00", "driving")]);
    expect(meta.count).toBe(1);
    expect(meta.range).toBeNull();
    expect(meta.modes).toEqual(["driving"]);
  });

  it("omits the range when nobody has a time", () => {
    const untimed = Array.from({ length: 16 }, (_, i) => p(`m${i}`, `P${i} Smith`, null));
    expect(travelGroupMeta(untimed).range).toBeNull();
    expect(travelGroupMeta(untimed).count).toBe(16);
  });

  it("omits the range when everyone lands at the same minute", () => {
    const meta = travelGroupMeta([p("a", "Ann Lee", "09:00"), p("b", "Bo Tran", "09:00")]);
    expect(meta.range).toBeNull();
  });

  it("reports modes in legend order and only the ones present", () => {
    expect(travelGroupMeta([p("a", "Ann Lee", "09:00", "other")]).modes).toEqual(["other"]);
    expect(
      travelGroupMeta([
        p("a", "Ann Lee", "09:00", "driving"),
        p("b", "Bo Tran", "10:00", "other"),
        p("c", "Cara Diaz", "11:00", "flying"),
      ]).modes
    ).toEqual(["flying", "driving", "other"]);
  });
});
