import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Source guards for the trip page's DATE-LOCK gating.
 *
 * ── Why a source guard and not a render test ────────────────────────────────
 *
 * The defect these pin is not "the wrong value reached a component" — it is
 * "this file combined its two permission axes five different ways with no rule
 * saying which belonged where". That is a property of the FILE, and no render
 * test can see it: each of the five spellings produces correct output for the
 * viewer it was written for, which is exactly why they survived side by side.
 * `TripIdProvider.test.ts` established this pattern here for the same reason.
 *
 * The two axes:
 *   ROLE  — `canEdit` / `isOwner`, from `useTripRole`. Who you are.
 *   LOCK  — `tripIsReadOnly`, whole-trip and date-driven. When it is.
 *
 * They are combined in exactly two places (`effectiveCanEdit`,
 * `effectiveIsOwner`) and consumed everywhere else. A bare `canEdit={canEdit}`
 * reappearing in this file is the regression.
 *
 * ── What made this worth guarding rather than just fixing ───────────────────
 *
 * Both known consequences were invisible until someone combined the sites:
 *
 *   1. The settings gear was gated on `isOwner && !tripIsReadOnly`, so the lock
 *      removed the only surface that could ever govern it — a one-way door,
 *      live in production on a real trip.
 *   2. `TripTabBar` took raw `canEdit` while `canShowLodgingTab` /
 *      `canShowScheduleTab` took `effectiveCanEdit`, so a locked trip RENDERED
 *      the Lodging and Agenda tab buttons and then snapped back to Home when
 *      you tapped one. Dead buttons, also live, and nobody had reported them.
 *
 * Neither is a wrong value. Both are two readers of one question disagreeing.
 */

const PAGE = resolve(__dirname, "page.tsx");

/**
 * Strip comments before matching. This file's gating is now heavily commented —
 * including comments that QUOTE the forbidden spellings to explain why they are
 * forbidden — so a guard reading raw text would fail on its own documentation.
 * (Same reason, same fix, as `TripIdProvider.test.ts`'s `codeOf`.)
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const code = codeOf(PAGE);

/** Occurrences of a literal substring. Backslash-free on purpose — no regex. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("trip page — the date lock is applied in exactly two derivations", () => {
  it("defines both, verbatim", () => {
    expect(code).toContain("const effectiveCanEdit = tripIsReadOnly ? false : canEdit;");
    expect(code).toContain("const effectiveIsOwner = tripIsReadOnly ? false : isOwner;");
  });

  it("combines role and lock NOWHERE else", () => {
    // `tripIsReadOnly ? false : X` is the combination. It may appear exactly
    // twice: once per derivation. A third is an inline re-derivation — which is
    // literally what four tab props used to do.
    expect(count(code, "tripIsReadOnly ? false :")).toBe(2);
    // The old settings-gear spelling. Its return would restore the one-way door.
    expect(code).not.toContain("!tripIsReadOnly");
  });
});

describe("trip page — no consumer takes a RAW role value", () => {
  // The exact JSX shapes that were wrong. Each passed a lock-blind role value
  // to a component whose siblings received the lock-honouring one.
  it.each([
    ["canEdit={canEdit}", "TripHeader x2 + TripTabBar — the dead-tab-button bug"],
    ["isOwner={isOwner}", "HomeTab x2 + DatesSheet"],
    ["onOpenDatesSheet={canEdit ", "the four dates-sheet callbacks"],
  ])("does not pass %s (%s)", (shape) => {
    expect(count(code, shape)).toBe(0);
  });

  it("passes the lock-honouring form instead, and to more than one consumer", () => {
    // Guards against a 'fix' that deletes the raw sites without replacing them:
    // zero raw AND zero effective would pass every assertion above.
    expect(count(code, "canEdit={effectiveCanEdit}")).toBeGreaterThan(1);
    expect(count(code, "isOwner={effectiveIsOwner}")).toBeGreaterThan(1);
    expect(count(code, "onOpenDatesSheet={effectiveCanEdit ")).toBeGreaterThan(1);
  });
});

describe("trip page — the two deliberate lock-INDEPENDENT reads", () => {
  /**
   * A control surface must not be removed by the condition it governs. Settings
   * is where a trip is administered, so the lock must not take it away — that is
   * the whole bug, and it is a rule rather than a special case for old trips.
   *
   * Reachability only: `TripSettingsModal` gates its contents on `viewerRole`
   * and has never read the lock, so an owner sees what an owner always saw and a
   * Member still gets no gear at all.
   */
  it("the settings gear is owner-gated and lock-independent", () => {
    expect(code).toContain("const onSettingsClick = isOwner");
  });

  /**
   * The banner's owner wording. Raw `isOwner` is FORCED here: the block only
   * renders when `tripIsReadOnly`, so `effectiveIsOwner` is false by
   * construction and the owner branch would be dead code.
   */
  it("the read-only banner branches on raw isOwner", () => {
    expect(code).toContain("{isOwner");
  });

  it("and there are only those two — no THIRD raw alias", () => {
    // Assigning a raw role value to a new name is how a sixth spelling would
    // get in: `const x = isOwner` reads as innocuous and then travels.
    //
    // `= isOwner` at end-of-line is allowed EXACTLY ONCE, and it is the gear
    // (`const onSettingsClick = isOwner` + a wrapped ternary) — pinned by the
    // test above, so the two assertions cannot both be satisfied by an
    // accident. This one caught its own first draft, which asserted 0 and so
    // contradicted the exception it sits beside.
    expect(count(code, "= isOwner\n")).toBe(1);
    // `canEdit` has no such exception: every consumer takes the derived form.
    expect(count(code, "= canEdit\n")).toBe(0);
  });
});

describe("trip page — the banner names an action that exists", () => {
  /**
   * CLAUDE.md: a refusal must name an action the reader can take. The owner
   * copy points at the gear restored above it, and deliberately does NOT
   * promise the lock can be lifted — no control lifts it yet
   * (`trips.date_lock_override` is in the schema, unread, pending the October
   * decision). Naming a control that is not there costs more than naming none:
   * the reader goes looking and concludes the app is broken.
   *
   * When the override toggle ships, this assertion is the thing that should
   * fail — it is the reminder that the copy is now understating what is
   * possible. Update it then, deliberately.
   */
  it("tells an owner where they can still act, without promising an unlock", () => {
    expect(code).toContain("trip settings are still available");
    for (const promise of ["lift the lock", "unlock", "lifted in settings"]) {
      expect(code.toLowerCase()).not.toContain(promise);
    }
  });

  it("leaves the non-owner sentence alone", () => {
    expect(code).toContain('"This trip is read-only"');
  });
});
