import { describe, it, expect } from "vitest";
import { parseTeeOverrides } from "./useTeeVisibility";

// The persistence codec for the per-game scorecard tee filter. Stored payload
// is a `{ [teeName]: visible }` map; parsing must tolerate absent / garbage
// input and keep only boolean-valued entries.
describe("parseTeeOverrides", () => {
  it("returns {} for null / missing storage", () => {
    expect(parseTeeOverrides(null)).toEqual({});
  });

  it("round-trips a stored overrides map", () => {
    const raw = JSON.stringify({ Blue: false, White: true });
    expect(parseTeeOverrides(raw)).toEqual({ Blue: false, White: true });
  });

  it("drops non-boolean values (defensive against corrupt payloads)", () => {
    const raw = JSON.stringify({ Blue: false, Red: "yes", Gold: 1 });
    expect(parseTeeOverrides(raw)).toEqual({ Blue: false });
  });

  it("tolerates malformed JSON and non-object payloads", () => {
    expect(parseTeeOverrides("not json")).toEqual({});
    expect(parseTeeOverrides(JSON.stringify(["Blue"]))).toEqual({});
    expect(parseTeeOverrides(JSON.stringify("Blue"))).toEqual({});
  });
});
