import { describe, it, expect } from "vitest";
import { transformCourse, type RawGolfApiCourse } from "./route";

/**
 * The provider-swap mapping: golfcourseapi's male/female tee arrays + positional
 * per-hole data → the normalized CourseDetail the picker imports. The per-hole
 * `handicap` (stroke index) is the load-bearing scoring field; the ratings are
 * the Phase-1 data that the old golfapi.io path discarded.
 */

const RAW: RawGolfApiCourse = {
  id: 1234,
  club_name: "Pebble Creek",
  course_name: "Pebble Creek Championship",
  location: { city: "Phoenix", state: "Arizona", country: "United States" },
  tees: {
    male: [
      {
        tee_name: "Blue",
        course_rating: 72.3,
        slope_rating: 131,
        bogey_rating: 95.1,
        total_yards: 6800,
        holes: [
          { par: 4, yardage: 410, handicap: 5 },
          { par: 3, yardage: 180, handicap: 17 },
          { par: 5, yardage: 540, handicap: 1 },
        ],
      },
      {
        tee_name: "White",
        course_rating: 70.1,
        slope_rating: 124,
        bogey_rating: 92.0,
        total_yards: 6300,
        holes: [
          { par: 4, yardage: 380, handicap: 5 },
          { par: 3, yardage: 160, handicap: 17 },
          { par: 5, yardage: 500, handicap: 1 },
        ],
      },
    ],
    female: [
      {
        tee_name: "Red",
        course_rating: 71.5,
        slope_rating: 119,
        bogey_rating: 96.2,
        total_yards: 5400,
        holes: [
          { par: 4, yardage: 330, handicap: 5 },
          { par: 3, yardage: 130, handicap: 17 },
          { par: 5, yardage: 440, handicap: 1 },
        ],
      },
    ],
  },
};

describe("transformCourse — golfcourseapi → CourseDetail", () => {
  const detail = transformCourse("1234", RAW);

  it("carries identity + location", () => {
    expect(detail).toMatchObject({
      externalId: "1234",
      name: "Pebble Creek Championship",
      clubName: "Pebble Creek",
      location: "Phoenix, Arizona",
    });
  });

  it("flattens male then female tees, each WITH ratings (the Phase-1 gap)", () => {
    expect(detail.teeBoxes.map((t) => t.name)).toEqual(["Blue", "White", "Red"]);
    expect(detail.teeBoxes[0]).toMatchObject({
      name: "Blue",
      rating: 72.3,
      slope: 131,
      bogeyRating: 95.1,
      totalYardage: 6800,
    });
    expect(detail.teeBoxes[2]).toMatchObject({ name: "Red", rating: 71.5, bogeyRating: 96.2 });
  });

  it("derives hole numbers positionally and captures every tee's yardage", () => {
    expect(detail.holes).toHaveLength(3);
    expect(detail.holes[0]).toMatchObject({
      number: 1,
      par: 4,
      handicapIndex: 5, // the stroke index — load-bearing
      tees: { Blue: { yardage: 410 }, White: { yardage: 380 }, Red: { yardage: 330 } },
    });
    expect(detail.holes[2]).toMatchObject({ number: 3, par: 5, handicapIndex: 1 });
  });

  it("disambiguates colliding tee names across genders", () => {
    const collide = transformCourse("9", {
      id: 9,
      tees: {
        male: [{ tee_name: "Red", holes: [{ par: 4, yardage: 400, handicap: 1 }] }],
        female: [{ tee_name: "Red", holes: [{ par: 4, yardage: 320, handicap: 1 }] }],
      },
    });
    expect(collide.teeBoxes.map((t) => t.name)).toEqual(["Red", "Red (W)"]);
    expect(collide.holes[0].tees).toMatchObject({ Red: { yardage: 400 }, "Red (W)": { yardage: 320 } });
  });

  it("tolerates an unwrapped/empty course (no tees) without throwing", () => {
    const empty = transformCourse("0", { id: 0 });
    expect(empty.teeBoxes).toEqual([]);
    expect(empty.holes).toEqual([]);
    expect(empty.name).toBe("Unknown course");
  });
});
