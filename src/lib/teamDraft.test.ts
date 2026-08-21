import { describe, it, expect } from "vitest";
import { identityDiffers, orderDiffers, hasUnsavedTeamWork } from "./teamDraft";

/**
 * The Edit/Add Team modal's confirm-on-leave gate. `hasUnsavedTeamWork` is the whole
 * mechanism — `requestClose` prompts iff it returns true — so it is asserted directly
 * rather than probed through the DOM (the suite is `environment: "node"`: no jsdom, and
 * DiscardChangesPrompt short-circuits to null without a `document`).
 *
 * WHAT WOULD LEAVE THIS GREEN THAT SHOULDN'T (CLAUDE.md testing rules):
 *   - a predicate stuck at TRUE  → guard nags on every cancelled Add Team, users learn
 *     to dismiss it, and it stops working without anyone noticing. Pinned by the
 *     untouched-form cases below, which must be FALSE.
 *   - a predicate stuck at FALSE → the silent data loss this was written to fix comes
 *     straight back. Pinned by asserting EACH field independently arms it, so a
 *     predicate that only watches `name` cannot pass.
 * Both directions are asserted for every field; neither alone is sufficient.
 */

const team = { name: "Hammer", shortName: "HAM", color: "#f87171" };

describe("identityDiffers", () => {
  it("is false for an untouched form", () => {
    expect(identityDiffers({ ...team }, team)).toBe(false);
  });

  // Each field asserted on its OWN, so a predicate watching only one still fails.
  it.each([
    ["name", { ...team, name: "Whack" }],
    ["short name", { ...team, shortName: "HMR" }],
    ["colour", { ...team, color: "#c084fc" }],
  ])("is true when the %s changes", (_label, draft) => {
    expect(identityDiffers(draft, team)).toBe(true);
  });

  it("ignores short-name CASE — the modal upper-cases on save, so 'ham' is not an edit", () => {
    expect(identityDiffers({ ...team, shortName: "ham" }, team)).toBe(false);
  });

  it("ignores surrounding whitespace on both name and short name", () => {
    expect(identityDiffers({ ...team, name: "  Hammer  ", shortName: " HAM " }, team)).toBe(false);
  });

  it("treats a whitespace-only name as a real change from a named team", () => {
    // Clearing the name IS losable work — the user emptied a field that had content.
    expect(identityDiffers({ ...team, name: "   " }, team)).toBe(true);
  });
});

describe("orderDiffers", () => {
  const server = ["u1", "u2", "u3"];

  it("is false when the draft is null (untouched — the roster follows the server)", () => {
    expect(orderDiffers(null, server)).toBe(false);
  });

  it("is false when the draft matches the server order", () => {
    expect(orderDiffers(["u1", "u2", "u3"], server)).toBe(false);
  });

  it("is true when two rows are swapped", () => {
    expect(orderDiffers(["u2", "u1", "u3"], server)).toBe(true);
  });

  it("is true when the draft has a different length (a teammate added elsewhere)", () => {
    expect(orderDiffers(["u1", "u2"], server)).toBe(true);
  });

  it("is FALSE after a drag and a drag back — the round trip leaves nothing to save", () => {
    // Same property Save relies on: moving a row and returning it disables Save.
    const dragged = ["u2", "u1", "u3"];
    const back = [dragged[1], dragged[0], dragged[2]];
    expect(orderDiffers(back, server)).toBe(false);
  });
});

describe("hasUnsavedTeamWork — EDIT mode (baseline = the saved team)", () => {
  const base = { identity: team, baseline: team, orderDraft: null, serverOrder: ["u1", "u2"] };

  it("is false when nothing has been touched", () => {
    expect(hasUnsavedTeamWork(base)).toBe(false);
  });

  it("is true on an identity edit alone", () => {
    expect(hasUnsavedTeamWork({ ...base, identity: { ...team, name: "Whack" } })).toBe(true);
  });

  it("is true on an order edit alone", () => {
    expect(hasUnsavedTeamWork({ ...base, orderDraft: ["u2", "u1"] })).toBe(true);
  });
});

describe("hasUnsavedTeamWork — CREATE mode (baseline = the form as opened)", () => {
  // Add Team opens empty, with a colour auto-picked from the unused palette. That
  // opening colour is the baseline, so merely OPENING the modal is not "work".
  const opening = { name: "", shortName: "", color: "#34d399" };
  const base = {
    identity: opening,
    baseline: opening,
    orderDraft: null,
    serverOrder: [] as string[],
  };

  it("is FALSE for a form the user never touched", () => {
    // The case that decides whether the guard survives contact with users: prompting
    // on every abandoned Add Team is how a confirm dialog becomes muscle-memory noise.
    expect(hasUnsavedTeamWork(base)).toBe(false);
  });

  it("is true once a name is typed", () => {
    expect(hasUnsavedTeamWork({ ...base, identity: { ...opening, name: "Whack" } })).toBe(true);
  });

  it("is true once the colour is moved off the auto-picked one", () => {
    expect(hasUnsavedTeamWork({ ...base, identity: { ...opening, color: "#c084fc" } })).toBe(true);
  });

  it("is FALSE again after typing a name and clearing it", () => {
    expect(hasUnsavedTeamWork({ ...base, identity: { ...opening, name: "" } })).toBe(false);
  });
});
