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
    expect(html).not.toContain("result locked");
  });

  it("LOCKED → accent-toned 'All in · result locked' (rack's wording, kept)", () => {
    const html = render("complete", false);
    expect(html).toContain('data-testid="banner-locked"');
    expect(html).toContain("All in");
    expect(html).toContain("result locked");
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
    // Encoded as a type-level fact rather than a runtime one: the component's
    // props are exactly the two lifecycle columns. If someone adds `canEdit`,
    // this call stops compiling, which is the point — a member can correct their
    // own scores in this mode, so gating the banner would hide a state they
    // participate in.
    const props: Parameters<typeof ScoringStateBanner>[0] = { status: "complete", correctionsOpen: true };
    expect(Object.keys(props).sort()).toEqual(["correctionsOpen", "status"]);
  });
});
