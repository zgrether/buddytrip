import { describe, it, expect, beforeEach } from "vitest";
import {
  draftOutboxPut,
  draftOutboxRecover,
  draftOutboxClear,
  draftOutboxPeek,
} from "./draftOutbox";

/**
 * The outbox key's SCOPE — whose draft this is.
 *
 * ── The collision the fingerprint cannot see ───────────────────────────────
 *
 * Pick'em proxy entry lets a captain draft a sheet for a teammate, so one game
 * can hold more than one draft at a time. Keyed on `(view, gameId)` alone they
 * share a slot.
 *
 * `draftOutboxRecover` exists to catch exactly that kind of mix-up: a draft
 * whose `base` fingerprint no longer matches the server is dropped rather than
 * restored. It cannot catch this one. The pick'em fingerprint is
 * `JSON.stringify(server.picks)`, and two people who have never submitted have
 * identical empty sheets — so identical fingerprints. The guard's whole
 * discriminator is blind here, and the failure is silent and below the surface:
 * no banner on the sheet can report a draft that was restored into it by
 * localStorage.
 *
 * The first case below is that scenario exactly, and it is the reason the scope
 * parameter exists.
 */

const EMPTY = [
  { slateGameId: "g1", pick: null, confidence: null },
  { slateGameId: "g2", pick: null, confidence: null },
];
/** What both sheets legitimately fingerprint to before either is submitted. */
const SAME_FINGERPRINT = JSON.stringify(EMPTY);

const CAPTAIN = "user-captain";
const TEAMMATE = "user-teammate";
const GAME = "game-1";

/**
 * The suite runs `environment: "node"` and jsdom is not a dependency, so the
 * one browser API this module touches is stubbed rather than imported. Kept
 * deliberately literal — a Map-backed store with the four methods used — so it
 * cannot quietly diverge from real localStorage in a way that makes the
 * assertions below mean something different.
 */
const store = new Map<string, string>();
const ls = () =>
  (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;
beforeEach(() => {
  store.clear();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  };
});

describe("draft outbox scope", () => {
  it("does NOT restore a draft made for someone else into your own sheet", () => {
    // The captain drafts for the teammate and the app is torn down.
    draftOutboxPut(
      "pickem",
      GAME,
      [{ slateGameId: "g1", pick: "away", confidence: 1 }],
      SAME_FINGERPRINT,
      Date.now(),
      TEAMMATE
    );

    // They come back and open THEIR OWN sheet — same game, same view, and
    // crucially the same fingerprint, because neither of them has submitted.
    const mine = draftOutboxRecover("pickem", GAME, SAME_FINGERPRINT, CAPTAIN);
    expect(mine).toBeNull();

    // ...and the teammate's draft is still there, unharmed. A fix that simply
    // dropped colliding entries would pass the assertion above and quietly lose
    // the work this whole outbox exists to protect.
    const theirs = draftOutboxRecover("pickem", GAME, SAME_FINGERPRINT, TEAMMATE);
    expect(theirs).toEqual([{ slateGameId: "g1", pick: "away", confidence: 1 }]);
  });

  it("proves the fingerprint alone CANNOT separate them — the reason scope exists", () => {
    // Non-vacuity, stated as an assertion rather than as a comment: if these two
    // ever stopped being equal, the case above would pass for a reason that has
    // nothing to do with scope, and nobody would notice.
    const captainsEmptySheet = JSON.stringify(EMPTY);
    const teammatesEmptySheet = JSON.stringify(EMPTY);
    expect(captainsEmptySheet).toBe(teammatesEmptySheet);

    // Unscoped, the same two writes collide — the pre-fix behaviour, kept as the
    // control so the fix is measured against something real.
    draftOutboxPut("pickem", GAME, ["theirs"], SAME_FINGERPRINT, Date.now());
    draftOutboxPut("pickem", GAME, ["mine"], SAME_FINGERPRINT, Date.now());
    expect(draftOutboxRecover("pickem", GAME, SAME_FINGERPRINT)).toEqual(["mine"]);
  });

  it("keeps the key BYTE-IDENTICAL for every other view when scope is omitted", () => {
    // No in-flight match/rack/stroke/nongolf draft may be orphaned by this
    // change. Asserting the literal key, because that is the compatibility
    // contract — a passing round-trip would not notice a renamed namespace.
    draftOutboxPut("match", GAME, ["pairs"], "fp", Date.now());
    expect(ls().getItem("bt.setupDraft.v1:match:game-1")).not.toBeNull();
    expect(draftOutboxRecover("match", GAME, "fp")).toEqual(["pairs"]);
  });

  it("scopes the key without disturbing the unscoped one", () => {
    draftOutboxPut("pickem", GAME, ["unscoped"], "fp", Date.now());
    draftOutboxPut("pickem", GAME, ["scoped"], "fp", Date.now(), TEAMMATE);

    expect(ls().getItem("bt.setupDraft.v1:pickem:game-1")).not.toBeNull();
    expect(
      ls().getItem(`bt.setupDraft.v1:pickem:game-1:${TEAMMATE}`)
    ).not.toBeNull();
    expect(draftOutboxRecover("pickem", GAME, "fp")).toEqual(["unscoped"]);
    expect(draftOutboxRecover("pickem", GAME, "fp", TEAMMATE)).toEqual(["scoped"]);
  });

  it("clears only the scope it was given", () => {
    draftOutboxPut("pickem", GAME, ["mine"], "fp", Date.now(), CAPTAIN);
    draftOutboxPut("pickem", GAME, ["theirs"], "fp", Date.now(), TEAMMATE);

    draftOutboxClear("pickem", GAME, CAPTAIN);

    expect(draftOutboxPeek("pickem", GAME, CAPTAIN)).toBeNull();
    // Saving your own sheet must not discard the one you were part-way through
    // entering for somebody else.
    expect(draftOutboxPeek("pickem", GAME, TEAMMATE)?.draft).toEqual(["theirs"]);
  });

  it("still drops a genuinely STALE draft within a scope", () => {
    // Scope narrows the slot; it must not weaken the staleness check that was
    // already there.
    draftOutboxPut("pickem", GAME, ["old"], "fingerprint-A", Date.now(), TEAMMATE);
    expect(draftOutboxRecover("pickem", GAME, "fingerprint-B", TEAMMATE)).toBeNull();
    expect(draftOutboxPeek("pickem", GAME, TEAMMATE)).toBeNull();
  });
});
