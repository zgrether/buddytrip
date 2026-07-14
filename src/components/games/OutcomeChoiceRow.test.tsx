import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OutcomeChoiceRow } from "./OutcomeChoiceRow";

// The shared match-outcome choice row — used by BOTH the golf hole-outcome
// entry and the non-golf head-to-head control, so the two can't drift.
describe("OutcomeChoiceRow", () => {
  it("renders the label and, when selected, a team-colored wash + border", () => {
    const html = renderToStaticMarkup(
      <OutcomeChoiceRow selected dim={false} color="#4ade80" avatarName="Team A" label="Team A" onClick={() => {}} testId="row-a" />
    );
    expect(html).toContain("Team A");
    expect(html).toContain("row-a");
    // Selected → the 1.5px team-color border (same treatment golf's rows use).
    expect(html).toContain("1.5px solid #4ade80");
  });

  it("renders a neutral Halved row (Equal glyph, no avatar/team color)", () => {
    const html = renderToStaticMarkup(
      <OutcomeChoiceRow selected={false} dim label="Halved" neutral onClick={() => {}} testId="row-halved" />
    );
    expect(html).toContain("Halved");
    // Unselected + neutral → the accent border/check is teal, not a team color.
    expect(html).not.toContain("1.5px solid #4ade80");
  });

  it("dims a non-selected row once another is picked", () => {
    const html = renderToStaticMarkup(
      <OutcomeChoiceRow selected={false} dim color="#fb923c" avatarName="Team B" label="Team B" onClick={() => {}} testId="row-b" />
    );
    expect(html).toContain("opacity:0.5");
  });

  it("is full opacity when nothing is selected yet (no premature dimming)", () => {
    const html = renderToStaticMarkup(
      <OutcomeChoiceRow selected={false} dim={false} color="#fb923c" avatarName="Team B" label="Team B" onClick={() => {}} testId="row-b" />
    );
    expect(html).toContain("opacity:1");
  });
});
