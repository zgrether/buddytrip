import { describe, it, expect } from "vitest";
import { nextScoreSeed } from "./PickemRunView";

/**
 * THE SECOND SCORE DISAPPEARED IF YOU WERE QUICK.
 *
 * Reported from a device the day #1325 merged: type the away score, tap the
 * home box, type the home score — and the home score sometimes vanished.
 * Slowly it was fine. Quickly it was not.
 *
 * ── The sequence, which is what these cases replay ────────────────────────
 *
 *   1. away box holds "17", tap away from it   -> commit sends {17, null}
 *   2. type "24" into the home box             -> local pair is 17|24
 *   3. the write's refetch lands               -> server pair is 17|
 *   4. the re-seed adopted it                  -> BOTH boxes repainted, 24 gone
 *
 * Step 4 is the whole bug, and note what it is NOT: the write was always
 * correct. `commit` sends both numbers out of local state, so {17, 24} reached
 * the database every time. What was wrong is that the answer to an EARLIER
 * write was allowed to repaint a box holding a LATER edit — the display lied
 * about what had been stored.
 *
 * The shipped comment claimed this could not happen: "while somebody is typing
 * — server unchanged — this does nothing and cannot fight them." The server was
 * not unchanged. It had been changed by the typing itself, one field earlier.
 *
 * ── Why the guard is here and not on the component ───────────────────────
 *
 * `environment: "node"`, so there is no DOM: no typing, no blur, no re-render
 * with new props. A component test could assert the boxes render — which is
 * exactly what stayed green while this shipped. The decision is where the
 * failure modes are, so the decision is what is tested.
 */

const step = (server: string, seeded: string, sent: string | null) =>
  nextScoreSeed({ server, seeded, sent });

describe("an older answer may not repaint a box being typed in", () => {
  it("does not repaint on the confirmation of our own write", () => {
    /**
     * THE BUG, EXACTLY, and it is the CONFIRMATION case rather than an
     * in-flight one — which is the part worth being precise about, because
     * the first version of this test asserted the wrong scenario.
     *
     * We sent 17|. The person then typed 24, which is local and changes
     * nothing we have sent. The answer to our write arrives carrying 17| —
     * so the server pair EQUALS what we sent. It is our own write coming
     * home, not news, and there is nothing in it to repaint with.
     *
     * THE MUTATION: `adopt: true` here. That is the shipped build — the
     * server pair differs from `seeded`, so it followed it and wrote both
     * boxes, blanking the 24. Every other case in this file passes against
     * it, which is why it shipped.
     *
     * Confirmation releases the hold; it never repaints.
     */
    expect(step("17|", "|", "17|")).toEqual({ adopt: false, seeded: "17|", sent: null });
  });

  it("ignores an out-of-order answer, which a per-field fix would not", () => {
    /**
     * The case that decides the SHAPE of the fix. The obvious repair is to
     * re-seed each box independently, so away's answer only touches the away
     * box. That is still wrong here: away's {17, null} can land AFTER home's
     * {17, 24} — two independent requests, no ordering guarantee — and a
     * per-field rule would then blank the home box from a response that is
     * simply old.
     *
     * Holding on the PAIR we last sent covers both, because "not what I sent"
     * and "older than what I sent" are the same condition.
     */
    expect(step("17|", "|", "17|24")).toEqual({ adopt: false, seeded: "|", sent: "17|24" });
  });
});

describe("and it still follows the server when nothing of ours is outstanding", () => {
  it("adopts a correction made on another device", () => {
    /**
     * The other half, and the one that makes the assertions above mean
     * something: a build that NEVER adopted would pass all three of them and
     * leave a corrected score stale on screen until the page was reloaded.
     */
    expect(step("21|20", "17|24", null)).toEqual({ adopt: true, seeded: "21|20", sent: null });
  });

  it("does nothing when the server says what the boxes already say", () => {
    expect(step("17|24", "17|24", null)).toEqual({ adopt: false, seeded: "17|24", sent: null });
  });

  it("adopts a score CLEARED elsewhere, which is not the same as no news", () => {
    // Empty is not unknown, at the one place the two are one keystroke apart:
    // somebody wiping a wrong score must reach this screen, and "the pair is
    // empty" must not be mistaken for "there is nothing to report".
    expect(step("|", "17|24", null)).toEqual({ adopt: true, seeded: "|", sent: null });
  });

  it("treats a scoreless final as a real pair, never as an absence", () => {
    // `0|0` is a score. A build testing truthiness rather than equality would
    // read this as empty and refuse to adopt it.
    expect(step("0|0", "|", null)).toEqual({ adopt: true, seeded: "0|0", sent: null });
    expect(step("0|0", "0|0", null).adopt).toBe(false);
  });
});

describe("the hold cannot strand a box forever", () => {
  it("clears on the confirmation of the LAST write, not the first", () => {
    /**
     * Two blurs in quick succession, so `sent` is overwritten before the first
     * answer arrives. The first answer must not release the hold — releasing it
     * would let the second answer, or any refetch in between, repaint a box
     * whose newer write is still in flight.
     */
    const inFlight = step("17|", "|", "17|24");
    expect(inFlight.sent).toBe("17|24");
    expect(step("17|24", inFlight.seeded, inFlight.sent)).toEqual({
      adopt: false,
      seeded: "17|24",
      sent: null,
    });
  });
});
