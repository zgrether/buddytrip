import { describe, it, expect } from "vitest";
import { reconcileOutcomes, outcomeOverwrites } from "./outcomeReconcile";
import { outcomeCellKey, type OutcomeValues } from "@/components/games/types";

/**
 * #1437 — outcome entry's merge and the overwrite decision.
 *
 * `reconcileOutcomes` had no test file at all. What these pin:
 *  - server truth wins over an unprotected local hole — including REMOVAL of a
 *    hole cleared elsewhere, the "deliberate gap" the fork kept after score mode
 *    closed it (red against the old overlay-only merge);
 *  - a protected hole keeps its local value (#15);
 *  - the notice fires only for a hole THIS device entered that now differs —
 *    silent when the two agree, when this device only watched, and while the
 *    hole is protected (which is what stops a stale in-flight snapshot raising a
 *    false notice).
 */

const K = (m: string, h: number) => outcomeCellKey(m, h);
const NONE = new Set<string>();

describe("reconcileOutcomes — server truth, except protected holes", () => {
  it("a confirmed local hole yields to a different server value (the two-phone case)", () => {
    // Zach's reproduction: this phone tapped hole 3 for side A; the other phone's
    // later write made it halved. Unprotected, so the server wins.
    const local: OutcomeValues = { m1: { "3": "side_a" } };
    const server: OutcomeValues = { m1: { "3": "halved" } };
    expect(reconcileOutcomes(local, server, NONE)).toEqual({ m1: { "3": "halved" } });
  });

  it("a hole CLEARED on another device is removed here — the old merge never removed", () => {
    const local: OutcomeValues = { m1: { "2": "side_b", "3": "side_a" } };
    const server: OutcomeValues = { m1: { "2": "side_b" } };
    expect(reconcileOutcomes(local, server, NONE)).toEqual({ m1: { "2": "side_b" } });
  });

  it("a PROTECTED hole keeps its local value — in flight, in the outbox, or just confirmed", () => {
    const local: OutcomeValues = { m1: { "3": "side_a", "4": "side_b" } };
    const server: OutcomeValues = { m1: { "3": "halved" } };
    const prot = new Set([K("m1", 3), K("m1", 4)]);
    // 3 differs on the server and 4 is absent from it; both are kept.
    expect(reconcileOutcomes(local, server, prot)).toEqual({ m1: { "3": "side_a", "4": "side_b" } });
  });

  it("adds holes only the server has — another device's entries appear", () => {
    expect(reconcileOutcomes({}, { m1: { "1": "halved" } }, NONE)).toEqual({ m1: { "1": "halved" } });
  });
});

describe("outcomeOverwrites — when to tell this device its entry was changed", () => {
  const local: OutcomeValues = { m1: { "2": "side_b", "3": "side_a" } };

  it("reports a hole this device entered that the server now holds differently", () => {
    const server: OutcomeValues = { m1: { "2": "side_b", "3": "halved" } };
    expect(outcomeOverwrites(local, server, NONE, new Set([K("m1", 2), K("m1", 3)]))).toEqual([
      { matchId: "m1", hole: 3, to: "halved" },
    ]);
  });

  it("reports a hole this device entered that was CLEARED elsewhere", () => {
    const server: OutcomeValues = { m1: { "2": "side_b" } };
    expect(outcomeOverwrites(local, server, NONE, new Set([K("m1", 3)]))).toEqual([
      { matchId: "m1", hole: 3, to: null },
    ]);
  });

  it("is SILENT when the two agree — the overwhelmingly common case", () => {
    const server: OutcomeValues = { m1: { "2": "side_b", "3": "side_a" } };
    expect(outcomeOverwrites(local, server, NONE, new Set([K("m1", 2), K("m1", 3)]))).toEqual([]);
  });

  it("is SILENT for a hole this device did not enter — it only watched", () => {
    const server: OutcomeValues = { m1: { "2": "side_b", "3": "halved" } };
    expect(outcomeOverwrites(local, server, NONE, new Set())).toEqual([]);
  });

  it("is SILENT while the hole is protected — a stale in-flight snapshot is not an overwrite", () => {
    const server: OutcomeValues = { m1: { "2": "side_b", "3": "halved" } };
    expect(outcomeOverwrites(local, server, new Set([K("m1", 3)]), new Set([K("m1", 3)]))).toEqual([]);
  });
});
