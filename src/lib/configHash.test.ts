import { describe, it, expect } from "vitest";
import { computeConfigHash, canonicalize } from "./configHash";

describe("computeConfigHash — deterministic fingerprint", () => {
  it("is stable across object key ordering (jsonb/JS key order must not churn it)", () => {
    expect(computeConfigHash({ a: 1, b: 2 })).toBe(computeConfigHash({ b: 2, a: 1 }));
    expect(computeConfigHash({ x: { p: 1, q: 2 } })).toBe(computeConfigHash({ x: { q: 2, p: 1 } }));
  });

  it("returns the SAME hash for identical config (no false 'changed')", () => {
    const cfg = { modifiers: { glorious: true }, groups: [{ id: "g1", members: ["u1", "u2"] }] };
    expect(computeConfigHash(cfg)).toBe(computeConfigHash(structuredClone(cfg)));
  });

  it("CHANGES when a modifier toggles (the danger case)", () => {
    const before = { modifiers: { glorious: false } };
    const after = { modifiers: { glorious: true } };
    expect(computeConfigHash(before)).not.toBe(computeConfigHash(after));
  });

  it("CHANGES when a grouping swaps players (the reproduced bug)", () => {
    const before = { groups: [{ id: "g1", members: ["u1", "u2"] }, { id: "g2", members: ["u3", "u4"] }] };
    const after = { groups: [{ id: "g1", members: ["u1", "u3"] }, { id: "g2", members: ["u2", "u4"] }] };
    expect(computeConfigHash(before)).not.toBe(computeConfigHash(after));
  });

  it("CHANGES when a matchup handicap changes", () => {
    const before = { matches: [{ id: "m1", sideA: "u1", sideB: "u2", handicap: 0 }] };
    const after = { matches: [{ id: "m1", sideA: "u1", sideB: "u2", handicap: 3 }] };
    expect(computeConfigHash(before)).not.toBe(computeConfigHash(after));
  });

  it("CHANGES when rules / status / scoring_enabled change", () => {
    const base = { rules: "std", status: "active", scoringEnabled: true };
    expect(computeConfigHash(base)).not.toBe(computeConfigHash({ ...base, rules: "double last 3" }));
    expect(computeConfigHash(base)).not.toBe(computeConfigHash({ ...base, status: "complete" }));
    expect(computeConfigHash(base)).not.toBe(computeConfigHash({ ...base, scoringEnabled: false }));
  });

  it("distinguishes null / absent / falsey (a dropped field must move the hash)", () => {
    expect(computeConfigHash({ course: null })).not.toBe(computeConfigHash({ course: "c1" }));
    expect(computeConfigHash({ course: null })).not.toBe(computeConfigHash({}));
    expect(computeConfigHash({ a: 0 })).not.toBe(computeConfigHash({ a: false }));
  });

  it("produces an 8-char hex string", () => {
    expect(computeConfigHash({ any: "thing" })).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("canonicalize", () => {
  it("sorts keys recursively and preserves array order", () => {
    expect(canonicalize({ b: 1, a: [3, 1, 2] })).toBe('{"a":[3,1,2],"b":1}');
  });
});
