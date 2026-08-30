import fs from "node:fs";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PickemProxyBanner,
  sheetAuthor,
  sortTargets,
  targetStatusLabel,
  type ProxyTarget,
} from "./PickemProxyPanel";

/**
 * The proxy surface — entering a sheet for someone who cannot, or did not.
 *
 * The copy IS the deliverable here, so the assertions read it. The one way this
 * feature goes badly is a captain editing what they think is their own sheet,
 * and the sheet is POPULATED in proxy mode, so nothing but the words
 * distinguishes the two states.
 */

const t = (over: Partial<ProxyTarget> & { userId: string; name: string }): ProxyTarget => ({
  submitted: false,
  picked: 0,
  total: 16,
  isGuest: false,
  ...over,
});

describe("sortTargets — who needs chasing, in order", () => {
  it("puts GUESTS WITHOUT A SHEET first", () => {
    // They can never enter their own, so nobody else will do it if the runner
    // does not. Everyone else at least might.
    const sorted = sortTargets([
      t({ userId: "1", name: "Zach" }),
      t({ userId: "2", name: "Ghost", isGuest: true }),
      t({ userId: "3", name: "Done", submitted: true }),
    ]);
    expect(sorted.map((x) => x.name)).toEqual(["Ghost", "Zach", "Done"]);
  });

  it("does NOT lift a guest who already has a sheet", () => {
    // The ordering is about who still needs doing, not about being a guest.
    // Ranking on `isGuest` alone would float a finished sheet to the top of the
    // chase list, which is the opposite of useful.
    const sorted = sortTargets([
      t({ userId: "1", name: "Alice" }),
      t({ userId: "2", name: "Ghost", isGuest: true, submitted: true }),
    ]);
    expect(sorted.map((x) => x.name)).toEqual(["Alice", "Ghost"]);
  });

  it("breaks ties by name, so the list does not reshuffle between renders", () => {
    const sorted = sortTargets([
      t({ userId: "1", name: "Wes" }),
      t({ userId: "2", name: "Brad" }),
      t({ userId: "3", name: "Matt" }),
    ]);
    expect(sorted.map((x) => x.name)).toEqual(["Brad", "Matt", "Wes"]);
  });
});

describe("targetStatusLabel — a guest reads differently on purpose", () => {
  it("says a guest HASN'T SIGNED UP, not that they have not submitted", () => {
    // "Nothing submitted" is what happened, and it is what everyone else reads. It
    // `auth.uid()`, so `pickem_picks_write` can never match them — chasing them
    // is wasted effort, and the honest label says so.
    expect(targetStatusLabel(t({ userId: "1", name: "G", isGuest: true }))).toBe(
      "Hasn’t signed up"
    );
    expect(targetStatusLabel(t({ userId: "2", name: "R" }))).toBe("Nothing submitted");
  });

  it("says SHEET IN once there is one — guest or not", () => {
    expect(
      targetStatusLabel(t({ userId: "1", name: "G", isGuest: true, submitted: true }))
    ).toBe("Sheet in");
    expect(targetStatusLabel(t({ userId: "2", name: "R", submitted: true }))).toBe("Sheet in");
  });
});

/**
 * ── r7 §7 · WHO TYPED IT ───────────────────────────────────────────────────
 *
 * `sheetAuthor` is the whole of the fix; the banner just renders its answer. The
 * ranking is by what the reader would REGRET, so the cases that matter are the
 * mixed ones — a rule that merely reported the majority, or the first row,
 * passes every single-author case in this file.
 */
describe("sheetAuthor", () => {
  const row = (enteredBy: string | null) => ({ enteredBy });

  it("says NONE for an empty sheet", () => {
    expect(sheetAuthor([], "ty", "me")).toBe("none");
  });

  it("says SELF when they typed it", () => {
    expect(sheetAuthor([row("ty"), row("ty")], "ty", "me")).toBe("self");
  });

  it("says YOU when the reader typed all of it", () => {
    // The reported bug: this said "Ty submitted their own sheet" over a sheet
    // the reader had entered themselves.
    expect(sheetAuthor([row("me"), row("me")], "ty", "me")).toBe("you");
  });

  it("says SOMEONE for a third party", () => {
    expect(sheetAuthor([row("cap"), row("cap")], "ty", "me")).toBe("someone");
  });

  it("calls a MIXED sheet self even when one row of five is theirs", () => {
    /**
     * The case the ranking exists for, and the one a majority rule gets wrong.
     * Four rows the reader typed and one the target did still contains the
     * target's own work, which is the thing this banner exists to protect.
     */
    expect(sheetAuthor([row("me"), row("me"), row("me"), row("me"), row("ty")], "ty", "me")).toBe(
      "self"
    );
  });

  it("does not call a mixed you/someone sheet YOU", () => {
    // "every" rather than "some" on the you arm — a `some` build reports YOU
    // here and tells the reader they are only overwriting themselves.
    expect(sheetAuthor([row("me"), row("cap")], "ty", "me")).toBe("someone");
  });

  it("treats NULL as unknown, never as self-entry", () => {
    /**
     * `entered_by` is null on every row written before migration 163, and that
     * migration refused to spell self-entry as null for exactly this reason. A
     * build reading null as "the owner did it" attributes ancient rows to the
     * target and gets the one attribution that matters most wrong.
     */
    expect(sheetAuthor([row(null), row(null)], "ty", "me")).toBe("unknown");
    // ...and a null among the reader's own rows still poisons it, rather than
    // being outvoted.
    expect(sheetAuthor([row("me"), row(null)], "ty", "me")).toBe("unknown");
  });

  it("still says SELF when a self-entered row sits beside a null one", () => {
    // Self outranks unknown: one certain fact beats an absent one, and it is
    // the fact that argues for caution.
    expect(sheetAuthor([row(null), row("ty")], "ty", "me")).toBe("self");
  });

  it("does not call an anonymous reader YOU", () => {
    // `myUserId` null must not match a null `enteredBy` — the two nulls mean
    // completely different things and == would conflate them.
    expect(sheetAuthor([row(null)], "ty", null)).toBe("unknown");
  });
});

describe("PickemProxyBanner — whose sheet this is", () => {
  const render = (over: Partial<Parameters<typeof PickemProxyBanner>[0]> = {}) =>
    renderToStaticMarkup(
      <PickemProxyBanner
        name="Ty"
        isGuest={false}
        author="none"
        onBack={() => {}}
        {...over}
      />
    );

  it("names the subject in the second person, unmissably", () => {
    expect(render()).toContain("You’re entering Ty’s sheet");
  });

  it("WARNS when the target submitted their own sheet", () => {
    // Overwriting someone's actual picks is different from filling an empty
    // one, and the proxy should be told which they are doing.
    expect(render({ author: "self" })).toContain(
      "Ty submitted their own sheet — saving replaces it."
    );
  });

  it("does not put THEIR name on a sheet the reader typed", () => {
    /**
     * The §7 bug, at the surface. The old banner had only a boolean, so every
     * populated sheet got the sentence above — including one the reader had
     * entered ninety seconds earlier.
     */
    const html = render({ author: "you" });
    expect(html).toContain("You entered this sheet — saving replaces it.");
    expect(html).not.toContain("Ty submitted");
  });

  it("names neither party when nobody knows who typed it", () => {
    // The warning is the certain half and survives; the attribution is the
    // uncertain half and is dropped rather than guessed.
    const html = render({ author: "unknown" });
    expect(html).toContain("Ty already has a sheet — saving replaces it.");
    expect(html).not.toContain("Ty submitted");
    expect(html).not.toContain("You entered");
  });

  it("says a third party typed it", () => {
    expect(render({ author: "someone" })).toContain(
      "Someone else entered this sheet — saving replaces it."
    );
  });

  it("does NOT warn when there is nothing to replace — the common case", () => {
    // Friction here is noise, and noise is what teaches people to ignore the
    // banner that matters.
    expect(render({ author: "none" })).not.toContain("replaces it");
  });

  it("explains a GUEST rather than warning about them", () => {
    const html = render({ isGuest: true });
    expect(html).toContain("Ty has no account, so this is the only way they get a sheet.");
    expect(html).not.toContain("replaces it");
  });

  it("prefers the OVERWRITE warning when a guest has a sheet", () => {
    /**
     * Reachable, and now says something TRUE about it: a guest's sheet is
     * always proxy-entered — they have no `auth.uid()` to stamp — so it can
     * never be "self", and the old copy calling it "someone else's work" was
     * wrong whenever the someone was the reader.
     */
    const html = render({ isGuest: true, author: "you" });
    expect(html).toContain("You entered this sheet — saving replaces it.");
    expect(html).not.toContain("no account");
  });
});

/**
 * ── THE WIRING, WHICH NO RENDER TEST ABOVE CAN SEE ─────────────────────────
 *
 * Every case above hands `author` in directly, so all of them pass against a
 * build where the column is never selected and the view never derives it — the
 * banner would then say "Ty already has a sheet" forever, which is the
 * attribution-free sentence and looks entirely reasonable on screen.
 *
 * That is the fixture-fidelity failure this file would otherwise have: a
 * confident, well-formed measurement of a path the app does not take. The read
 * crosses tRPC and a 1500-line view, neither reachable from a node suite, so
 * the honest instrument is the SOURCE — narrow, and stated as what it is.
 *
 * Comments are stripped first, and the stripping is itself asserted: a guard
 * that matched its own explanatory prose has already happened here once.
 */
describe("the enteredBy wiring (source guard)", () => {
  const strip = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

  const read = (p: string) => {
    const src = fs.readFileSync(p, "utf8");
    const out = strip(src);
    // The stripper ran and removed something. Without this the whole guard
    // degrades to reading the raw file, prose and all.
    expect(out.length, p + ": nothing was stripped").toBeLessThan(src.length);
    expect(out).not.toContain("──");
    return out;
  };

  it("the router SELECTS entered_by on the all-sheets read", () => {
    const src = read("src/server/routers/pickem.ts");
    expect(src).toContain('"user_id, slate_game_id, pick, confidence, entered_by"');
    expect(src).toContain("enteredBy: r.entered_by,");
  });

  it("the view derives the author from the ROWS, not from a count", () => {
    const src = read("src/components/games/PickemGameView.tsx");
    expect(src).toContain("author={sheetAuthor(");
    // `submitted` is a count of rows and cannot say who typed them. Its
    // presence on this component is the bug, not merely a leftover.
    expect(src).not.toContain("submitted={proxyTarget.submitted}");
  });
});
