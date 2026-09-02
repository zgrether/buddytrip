import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoringStateBanner } from "./ScoringStateBanner";

/**
 * The shared lifecycle banner — one state, one component, four formats.
 *
 * The interesting assertions here are the NEGATIVE ones. Before this component
 * existed, rack's banner was gated on `final` alone, so a re-opened game lost
 * the only signal it had at exactly the moment there was something to say; and
 * three of the four formats rendered nothing in either state. So "renders while
 * correcting" and "renders nothing on an unfinished game" are the two properties
 * that actually distinguish this from what it replaced.
 *
 * Rendering the banner directly (rather than through a view) is deliberate: it
 * takes only the two lifecycle columns, so a per-format test would be testing
 * the same function four times through four thousand-line components. What the
 * views owe is that they PASS those columns, which `tsc` checks.
 */

const render = (status: string | null | undefined, correctionsOpen: boolean) =>
  renderToStaticMarkup(<ScoringStateBanner status={status} correctionsOpen={correctionsOpen} />);

describe("ScoringStateBanner", () => {
  it("CORRECTING → warning-toned 'Scoring changes permitted'", () => {
    const html = render("complete", true);
    expect(html).toContain('data-testid="banner-correcting"');
    expect(html).toContain("Scoring changes permitted");
    expect(html).toContain("var(--color-bt-warning-faint)");
    expect(html).toContain("var(--color-bt-warning-border)");
    expect(html).not.toContain("results are final");
  });

  it("FINAL → accent-toned 'Game results are final'", () => {
    // Reworded from rack's original "All in · result locked" when the banner
    // gained its third state, so the three read as one set — "worth N" /
    // "results are final" / "changes permitted" — rather than one of them
    // carrying an older surface's phrasing.
    const html = render("complete", false);
    expect(html).toContain('data-testid="banner-locked"');
    expect(html).toContain("Game results are final");
    expect(html).toContain("var(--color-bt-accent-faint)");
    expect(html).not.toContain("Scoring changes permitted");
  });

  it("renders NOTHING before a game is finalized", () => {
    // The banner is a statement about a recorded result. An active or pending
    // game has not got one, so it must stay out of the way entirely — no empty
    // box, no reserved space.
    expect(render("active", false)).toBe("");
    expect(render("pending", false)).toBe("");
    expect(render(null, false)).toBe("");
    expect(render(undefined, false)).toBe("");
  });

  it("a stray corrections_open on an unfinished game renders nothing", () => {
    // `gameLockState` requires complete for either arm. This guards the
    // predicate, not the markup — the column is only meaningful once posted.
    expect(render("active", true)).toBe("");
  });

  it("never emits a hex literal — tokens only", () => {
    expect(render("complete", true)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(render("complete", false)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("takes no role input — the same banner for every viewer", () => {
    // The guard is about ROLE, not about prop count. The banner now also takes
    // `pointsTotal` (the in-progress state's content), which is a fact about the
    // GAME — the same for every viewer, so it does not weaken this.
    //
    // What must never appear is a viewer-dependent input: a member can correct
    // their own scores in this mode, so gating the banner on `canEdit` would
    // hide a state they participate in. Asserted as a type-level fact — a
    // `canEdit` prop makes this call stop compiling.
    const props: Parameters<typeof ScoringStateBanner>[0] = {
      status: "complete",
      correctionsOpen: true,
      pointsTotal: 8,
    };
    expect(Object.keys(props).sort()).toEqual(["correctionsOpen", "pointsTotal", "status"]);
    // No role input, spelled out so the intent survives the next prop addition.
    expect(Object.keys(props)).not.toContain("canEdit");
  });
});

/**
 * THE THIRD STATE — in progress.
 *
 * New here, and it is where the value that used to float loose in the bracket's
 * top right lands. The banner is now the ONE place a game says what it is worth,
 * in every format: two homes for one number is how they come to disagree.
 */
describe("IN PROGRESS — what the game is worth", () => {
  const render = (status: string | null, correctionsOpen: boolean, pointsTotal?: number | null) =>
    renderToStaticMarkup(
      <ScoringStateBanner status={status} correctionsOpen={correctionsOpen} pointsTotal={pointsTotal} />
    );

  it("names the value, in a neutral tone, on the DARKER surface", () => {
    const html = render("active", false, 8);
    expect(html).toContain('data-testid="banner-in-progress"');
    // SPLIT per STYLE_GUIDE §2c — the lead-in and the unit are labels, 8 is the
    // value. Asserted as PARTS, because a contiguous "This game is worth 8 pts"
    // is exactly what passes against a build that never split them.
    expect(html).toContain("This game is worth");
    expect(html).toContain(">8<");
    expect(html).toContain(">pts<");
    // #14 — darker than the match rows, not lighter. `--color-bt-base` is the
    // page background (STYLE_GUIDE §1 Level 0), so the strip reads as cut into
    // the page rather than as another card in the same stack. A lighter surface
    // would have been another raised card, which is the same confusion.
    expect(html).toContain("var(--color-bt-base)");
    expect(html).not.toContain("background:var(--color-bt-card)");
    // Still NEUTRAL — borrowing accent or warning would spend the meaning the
    // other two states rely on.
    expect(html).not.toContain("var(--color-bt-accent-faint)");
    expect(html).not.toContain("var(--color-bt-warning-faint)");
  });

  it("uses the app's half formatter, so 4½ is not 4.5", () => {
    // The value is its own node now, so the half glyph is asserted there.
    expect(render("active", false, 4.5)).toContain(">4½<");
  });

  it("stays ABSENT when the game is worth nothing", () => {
    // Unchanged from before this state existed: a game with nothing at stake has
    // nothing to announce, so an unconfigured game gains no empty band.
    expect(render("active", false, 0)).toBe("");
    expect(render("active", false, null)).toBe("");
    expect(render("active", false)).toBe("");
  });

  it("FINAL and CORRECTING outrank it — the value never overwrites a verdict", () => {
    // A finished game is worth the same number, but "results are final" is the
    // thing to say. Passing the value must not change which state renders.
    expect(render("complete", false, 8)).toContain('data-testid="banner-locked"');
    expect(render("complete", false, 8)).not.toContain("This game is worth");
    expect(render("complete", true, 8)).toContain('data-testid="banner-correcting"');
    expect(render("complete", true, 8)).not.toContain("This game is worth");
  });

  it("the CORRECTING copy and tone are byte-identical to #867's", () => {
    // The one state with a warning tone, and the one this change must not touch.
    const html = render("complete", true, 8);
    expect(html).toContain("Scoring changes permitted");
    expect(html).toContain("var(--color-bt-warning-faint)");
    expect(html).toContain("var(--color-bt-warning-border)");
  });
});
