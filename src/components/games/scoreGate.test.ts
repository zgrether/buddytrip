import { describe, it, expect } from "vitest";
import { unconfirmedOnHole, unconfirmedCount, scoreCellKey, type SaveStatusMap } from "./types";

/**
 * Confirmation-gate helpers (Spec 1a — honest advance). The rule: advance/finish
 * is blocked only by `saving`/`error` cells; a cell with NO status entry is a
 * server-loaded / already-confirmed value and must NOT block (the resume-seed
 * case — server scores are seeded without a status).
 */

const key = scoreCellKey;

describe("unconfirmedOnHole", () => {
  const pids = ["a", "b", "c"];

  it("not blocked when all current-hole cells are saved or have no status", () => {
    const s: SaveStatusMap = { [key("a", "3")]: "saved" }; // b, c server-loaded (no status)
    expect(unconfirmedOnHole(s, pids, "3")).toEqual({ blocked: false, saving: 0, errored: 0 });
  });

  it("blocked while a cell is still saving", () => {
    const s: SaveStatusMap = { [key("a", "3")]: "saved", [key("b", "3")]: "saving" };
    expect(unconfirmedOnHole(s, pids, "3")).toEqual({ blocked: true, saving: 1, errored: 0 });
  });

  it("blocked when a cell errored", () => {
    const s: SaveStatusMap = { [key("a", "3")]: "error" };
    expect(unconfirmedOnHole(s, pids, "3")).toEqual({ blocked: true, saving: 0, errored: 1 });
  });

  it("only considers the given hole (a saving cell on another hole doesn't block)", () => {
    const s: SaveStatusMap = { [key("a", "4")]: "saving" };
    expect(unconfirmedOnHole(s, pids, "3").blocked).toBe(false);
  });

  it("empty status → not blocked (nothing entered this session / all server-loaded)", () => {
    expect(unconfirmedOnHole({}, pids, "3").blocked).toBe(false);
  });
});

describe("unconfirmedCount (pre-Finish gate)", () => {
  it("counts saving + errored across the whole game", () => {
    const s: SaveStatusMap = {
      [key("a", "1")]: "saved",
      [key("b", "1")]: "saving",
      [key("a", "2")]: "error",
      [key("b", "2")]: "error",
    };
    expect(unconfirmedCount(s)).toEqual({ saving: 1, errored: 2, total: 3 });
  });

  it("all saved / empty → nothing blocks finish", () => {
    expect(unconfirmedCount({}).total).toBe(0);
    expect(unconfirmedCount({ [key("a", "1")]: "saved" }).total).toBe(0);
  });
});
