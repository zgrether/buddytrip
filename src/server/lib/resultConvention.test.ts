import { describe, it, expect, vi, afterEach } from "vitest";
import {
  rowConvention,
  declaredConvention,
  resolveConvention,
} from "./competitionLeaderboard";

/**
 * THE ROW SAYS WHAT IT CARRIES (#826, migration 191).
 *
 * `game_results` holds two currencies in two nullable columns. Until 191 the
 * only way to tell them apart was to look at which column was null, and the
 * codebase held TWO different versions of that look — `rowConvention` here and
 * a second, incompatible one in `gameFinishNotify`. #1245 and #1381 were each
 * one arm of the board picking a direction on its own; the second shipped
 * because the first fix patched one arm.
 *
 * These are the pure halves: what the columns CONTAIN, what the row DECLARES,
 * and what happens when those two disagree. No database — `competitionLeaderboard`'s
 * integration tests cover the read, and this file covers the decision.
 *
 * ── Why the disagreement case exists at all ────────────────────────────────
 *
 * It cannot fire today, and that is asserted rather than assumed elsewhere:
 * every writer stamps the kind its own columns take, and 191's backfill derived
 * the kind FROM those columns, so declared and contained agree on every
 * production row by construction. What `resolveConvention` guards is the writer
 * added next — the one that copies a row builder, changes the columns, and
 * leaves the declaration behind. The table has a history here: it has two
 * writers, each of whose doc comments calls itself the only one.
 */

const spy = () => ({
  warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
});
afterEach(() => vi.restoreAllMocks());

/** A row as the leaderboard reads it. `both` is the COMMON shape, not an edge
 *  case: `writeManualResults` and pick'em's placement arm mirror the rank into
 *  `raw_score`, and 26 of production's 30 non-golf team rows carry both. */
const rank = (valueKind: string | null = "rank") => ({ position: 1, valueKind });
const points = (valueKind: string | null = "points") => ({ position: null, valueKind });

describe("what the columns CONTAIN", () => {
  it("reads `position` and nothing else", () => {
    expect(rowConvention([{ position: 1 }, { position: 2 }])).toBe("positions");
    expect(rowConvention([{ position: null }, { position: null }])).toBe("points");
    expect(rowConvention([{ position: 1 }, { position: null }])).toBe("mixed");
  });

  it("is NOT confused by a rank mirrored into raw_score — the common shape", () => {
    // The decisive case for keying on `position` alone. If this reading ever
    // involves `raw_score`, every manual placement in the database reads as
    // points and the board pays the wrong way round — which is #1381.
    const mirrored = [{ position: 1, raw_score: 1 }, { position: 2, raw_score: 2 }];
    expect(rowConvention(mirrored)).toBe("positions");
  });
});

describe("what the row DECLARES", () => {
  it("maps the stored kind onto the board's convention", () => {
    expect(declaredConvention([rank(), rank()])).toBe("positions");
    expect(declaredConvention([points(), points()])).toBe("points");
  });

  it("calls rows that declare DIFFERENT kinds mixed", () => {
    expect(declaredConvention([rank(), points()])).toBe("mixed");
  });

  it("distinguishes UNDECLARED from every real convention", () => {
    // Not folded into "mixed": "the schema says this is impossible" is a claim
    // about the schema, not about the row in front of you. A hand-edited row or
    // a restored backup produces it, and it must not be silently ranked.
    expect(declaredConvention([rank(null), rank(null)])).toBe("undeclared");
    expect(declaredConvention([rank("RANK")])).toBe("undeclared");
    expect(declaredConvention([])).toBe("undeclared");
  });

  // NO TEST THAT IT IGNORES THE COLUMNS, deliberately. `declaredConvention`
  // takes `{ valueKind }` and nothing else, so a row carrying `position` does
  // not type-check as an argument — the separation is held by the signature,
  // and a runtime assertion of it could not fail on a tree that compiles.
  // (CLAUDE.md: ask what would have to be true for a guard to fail.) The
  // separation that CAN break is the one `resolveConvention` decides, below.
});

describe("resolveConvention — the declaration wins, and disagreement ranks nothing", () => {
  it("takes the declaration when the two agree", () => {
    const s = spy();
    expect(resolveConvention("g1", "positions", "positions")).toBe("positions");
    expect(resolveConvention("g1", "points", "points")).toBe("points");
    // Silence is part of the contract: the agreeing case is every real row, and
    // a log line per game per poll would bury the one that matters.
    expect(s.warn).not.toHaveBeenCalled();
    expect(s.error).not.toHaveBeenCalled();
  });

  it("falls back to the columns when there is no declaration — and says so", () => {
    const s = spy();
    expect(resolveConvention("g2", "undeclared", "positions")).toBe("positions");
    expect(s.warn).toHaveBeenCalledTimes(1);
    // The message has to name the game and point at the writer, because the
    // reader's next move is finding which one skipped the column.
    const msg = String(s.warn.mock.calls[0][0]);
    expect(msg).toContain("g2");
    expect(msg).toContain("value_kind");
    expect(msg).toContain("writeManualResults");
  });

  it("refuses to rank a row that contradicts itself", () => {
    const s = spy();
    expect(resolveConvention("g3", "points", "positions")).toBe("conflicted");
    expect(resolveConvention("g3", "positions", "points")).toBe("conflicted");
    expect(s.error).toHaveBeenCalledTimes(2);
  });

  it("keeps `conflicted` and `mixed` APART, both as a value and in the message", () => {
    // Same outcome, different fact, and the two send a reader to different
    // places: `mixed` is rows disagreeing with EACH OTHER (a configuration or a
    // half-rewritten game), `conflicted` is a row disagreeing with ITSELF (a
    // writer bug). A widened condition under an unchanged message is how a
    // refusal starts naming the wrong object — CLAUDE.md's refusal rule.
    const s = spy();
    expect(resolveConvention("g4", "mixed", "mixed")).toBe("mixed");
    expect(s.error).not.toHaveBeenCalled();

    expect(resolveConvention("g4", "mixed", "positions")).toBe("conflicted");
    const msg = String(s.error.mock.calls[0][0]);
    expect(msg).toContain("contradict");
    expect(msg).not.toContain("BOTH positions and raw_score");
  });
});
