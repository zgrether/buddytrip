import { describe, expect, it } from "vitest";
import { finalPlaces, isExactTie, sharedPlaces, winnersOf } from "./finalPlaces";

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

describe("isExactTie", () => {
  const totals = { a: 9, b: 5, c: 5, d: 5 };
  it("is true only of the whole tie", () => {
    expect(isExactTie(ids, ["b", "c", "d"], totals)).toBe(true);
    expect(isExactTie(ids, ["b", "c"], totals)).toBe(false);
    expect(isExactTie(ids, ["a", "b"], totals)).toBe(false);
  });
  it("still sees a tie an order has broken", () => {
    expect(isExactTie(ids, ["d", "b", "c"], totals)).toBe(true);
  });
});
