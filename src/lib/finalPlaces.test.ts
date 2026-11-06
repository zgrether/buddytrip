import { describe, expect, it } from "vitest";
import { finalPlaces, finalTies, namesWholeTies, sharedPlaces, winnersOf } from "./finalPlaces";

const ids = ["a", "b", "c", "d"];
const place = (m: Map<string, { place: number; shared: boolean }>) => Object.fromEntries([...m].map(([k, v]) => [k, `${v.place}${v.shared ? "=" : ""}`]));

describe("finalPlaces", () => {
  it("a tie shares its place and the next unit skips it", () => {
    expect(place(finalPlaces(ids, { a: 9, b: 5, c: 5, d: 1 }, null))).toEqual({ a: "1", b: "2=", c: "2=", d: "4" });
  });

  it("1st can be shared", () => {
    expect(place(finalPlaces(ids, { a: 9, b: 9, c: 5, d: 1 }, null))).toEqual({ a: "1=", b: "1=", c: "3", d: "4" });
    expect(winnersOf(ids, { a: 9, b: 9, c: 5, d: 1 }, null).sort()).toEqual(["a", "b"]);
  });

  it("an order that names the whole tie breaks it, in that order", () => {
    expect(place(finalPlaces(ids, { a: 9, b: 5, c: 5, d: 1 }, ["c", "b"]))).toEqual({ a: "1", c: "2", b: "3", d: "4" });
  });

  it("an order breaking 1st makes one winner", () => {
    expect(winnersOf(ids, { a: 9, b: 9, c: 5, d: 1 }, ["b", "a"])).toEqual(["b"]);
  });

  it("an order missing someone in the tie leaves it shared: a correction changed who is level", () => {
    const totals = { a: 5, b: 5, c: 5, d: 1 };
    expect(place(finalPlaces(ids, totals, ["b", "a"]))).toEqual({ a: "1=", b: "1=", c: "1=", d: "4" });
  });

  it("one order holds two ties, and each reads only its own units", () => {
    const totals = { a: 9, b: 9, c: 2, d: 2 };
    expect(place(finalPlaces(ids, totals, ["d", "c", "b", "a"]))).toEqual({ b: "1", a: "2", d: "3", c: "4" });
  });

  it("an order never moves a unit that is not tied", () => {
    expect(place(finalPlaces(ids, { a: 9, b: 7, c: 5, d: 1 }, ["d", "c", "b", "a"]))).toEqual({ a: "1", b: "2", c: "3", d: "4" });
  });

  it("level means level through float noise, not two places a hair apart", () => {
    expect(place(finalPlaces(["a", "b"], { a: 0.1 + 0.2, b: 0.3 }, null))).toEqual({ a: "1=", b: "1=" });
  });
});

describe("sharedPlaces", () => {
  it("lists what is still shared, best first, and drops what was broken", () => {
    const totals = { a: 9, b: 9, c: 2, d: 2 };
    expect(sharedPlaces(ids, totals, null).map((s) => s.place)).toEqual([1, 3]);
    expect(sharedPlaces(ids, totals, ["b", "a"])).toEqual([{ place: 3, unitIds: expect.arrayContaining(["c", "d"]) }]);
  });
});

describe("the column as a decision (spec §5)", () => {
  const totals = { a: 9, b: 9, c: 5, d: 5 };
  it("[] is a decision that changes no place: every tie stays shared", () => {
    expect(place(finalPlaces(ids, totals, []))).toEqual(place(finalPlaces(ids, totals, null)));
    expect(sharedPlaces(ids, totals, []).map((s) => s.place)).toEqual([1, 3]);
  });
  it("a tie the order leaves out stays shared beside one it names", () => {
    expect(place(finalPlaces(ids, totals, ["d", "c"]))).toEqual({ a: "1=", b: "1=", d: "3", c: "4" });
  });
});

describe("finalTies", () => {
  const totals = { a: 9, b: 9, c: 5, d: 5 };
  it("lists every tie, broken or not, best first, and says which were ordered", () => {
    expect(finalTies(ids, totals, ["d", "c"])).toEqual([
      { place: 1, ordered: false, unitIds: expect.arrayContaining(["a", "b"]) },
      { place: 3, ordered: true, unitIds: ["d", "c"] },
    ]);
  });
  it("a tie stands in the owner's order, whichever way it was saved", () => {
    expect(finalTies(ids, totals, ["b", "a"])[0].unitIds).toEqual(["b", "a"]);
    expect(finalTies(ids, totals, ["a", "b"])[0].unitIds).toEqual(["a", "b"]);
  });
  it("an order naming part of a tie orders nothing", () => {
    expect(finalTies(ids, { a: 9, b: 5, c: 5, d: 5 }, ["c", "b"])[0].ordered).toBe(false);
  });
  it("no ties, no list", () => {
    expect(finalTies(ids, { a: 4, b: 3, c: 2, d: 1 }, null)).toEqual([]);
  });
});

describe("namesWholeTies", () => {
  const totals = { a: 9, b: 5, c: 5, d: 5 };
  it("is true of a whole tie, in any order", () => {
    expect(namesWholeTies(ids, totals, ["b", "c", "d"])).toBe(true);
    expect(namesWholeTies(ids, totals, ["d", "b", "c"])).toBe(true);
  });
  it("[] names nothing, and that is a valid answer", () => {
    expect(namesWholeTies(ids, totals, [])).toBe(true);
  });
  it("is false of part of a tie", () => {
    expect(namesWholeTies(ids, totals, ["b", "c"])).toBe(false);
  });
  it("is false of a unit in no tie, alone or beside a whole one", () => {
    expect(namesWholeTies(ids, totals, ["a", "b"])).toBe(false);
    expect(namesWholeTies(ids, totals, ["b", "c", "d", "a"])).toBe(false);
  });
  it("is false of a unit named twice", () => {
    expect(namesWholeTies(ids, totals, ["b", "c", "d", "b"])).toBe(false);
  });
  it("takes two whole ties together, and refuses one whole and one part", () => {
    const two = { a: 9, b: 9, c: 5, d: 5 };
    expect(namesWholeTies(ids, two, ["b", "a", "d", "c"])).toBe(true);
    expect(namesWholeTies(ids, two, ["b", "a", "d"])).toBe(false);
  });
});
