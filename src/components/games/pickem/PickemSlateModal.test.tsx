import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemSlateModal, type SlateDraftGame } from "./PickemSlateModal";

/**
 * The slate modal after the Cadence look.
 *
 * The look's finding was that every row being a live form is what produced the
 * "96 fields" feeling, so the assertions below are mostly about what is NOT in a
 * row. The environment is `node` (no jsdom, no RTL), so this is
 * `renderToStaticMarkup` and nothing here clicks — what rendering can witness is
 * exactly the question "is this row a form or a line of text", which is the one
 * that changed.
 */

const game = (over: Partial<SlateDraftGame> = {}): SlateDraftGame => ({
  id: `s-${over.awayTeam ?? "x"}`,
  awayTeam: "Alabama",
  homeTeam: "Georgia",
  spread: "-3.5",
  kickoff: "Thu 7:30p",
  note: null,
  multiplier: 1,
  ...over,
});

const SLATE = [
  game({ awayTeam: "Alabama", homeTeam: "Georgia", note: "Bama hasn't won in Athens since 2015" }),
  game({ awayTeam: "Ohio St", homeTeam: "Michigan", spread: "+1.5", multiplier: 2 }),
  game({ awayTeam: "Texas", homeTeam: "Oklahoma", spread: null }),
];

const render = (over: Partial<Parameters<typeof PickemSlateModal>[0]> = {}) =>
  renderToStaticMarkup(
    <PickemSlateModal
      open
      onClose={() => {}}
      slate={SLATE}
      settings={{ rollUp: "team_totals", useConfidence: true }}
      editable
      showRollUp
      saving={false}
      onSave={() => {}}
      {...over}
    />
  );

/** Everything between a row's opening tag and the next row / the form. */
function rowsRegion(html: string): string {
  const start = html.indexOf('data-testid="pickem-slate-row"');
  const end = html.indexOf('data-testid="pickem-slate-form"');
  expect(start, "no slate rows rendered").toBeGreaterThan(-1);
  expect(end, "no slate form rendered").toBeGreaterThan(start);
  return html.slice(start, end);
}

describe("the slate list is display rows, not edit rows", () => {
  it("a row renders NO inputs", () => {
    // The whole point of the revision. Counting inputs in the ROW REGION rather
    // than the document, because the form below legitimately has five of them —
    // asserting "no inputs anywhere" would fail for the wrong reason and
    // asserting nothing at all would pass against the old build.
    expect(rowsRegion(render())).not.toContain("<input");
  });

  it("renders every game as one line, with its note underneath", () => {
    const html = render();
    expect(html).toContain("Alabama");
    expect(html).toContain("Georgia");
    expect(html).toContain("Bama hasn&#x27;t won in Athens since 2015");
    // The kickoff and the note share the sub-line.
    expect(html).toContain("Thu 7:30p");
  });

  it("a row is a button that opens the form — one form, two entry points", () => {
    const html = render();
    expect(html).toContain('aria-label="Edit Alabama at Georgia"');
    // ...and there is exactly ONE form, not one per row.
    expect(html.match(/data-testid="pickem-slate-form"/g)).toHaveLength(1);
  });

  it("the form carries the fields, so they exist exactly once", () => {
    const html = render();
    for (const field of ["Away team", "Home team", "Game time", "Spread", "Note"]) {
      expect(html.match(new RegExp(`aria-label="${field}"`, "g")), field).toHaveLength(1);
    }
  });
});

describe("reorder is a mode", () => {
  it("grips do NOT render by default", () => {
    // They are clutter the rest of the time and the second thing (after inputs)
    // that makes a row read as a control panel.
    const html = render();
    expect(html).not.toContain("reorder-grip");
    expect(html).not.toContain("reorder-up");
  });

  it("offers a Reorder toggle once there is more than one game", () => {
    expect(render()).toContain('data-testid="pickem-reorder-toggle"');
  });

  it("does not offer one for a single game — nothing to reorder", () => {
    expect(render({ slate: [SLATE[0]] })).not.toContain("pickem-reorder-toggle");
  });

  it("does not offer one when the slate is frozen", () => {
    expect(render({ editable: false })).not.toContain("pickem-reorder-toggle");
  });
});

describe("the multiplier is the row's treatment, not a control in it", () => {
  it("a weighted game wears the glorious tokens and states the value", () => {
    const html = render();
    expect(html).toContain("var(--color-bt-glorious-faint)");
    expect(html).toContain("var(--color-bt-glorious-border)");
    expect(html).toContain("2×");
  });

  it("an unweighted game renders plain — the treatment MEANS something", () => {
    // Asserted as an exact count, not as presence: if every row wore the
    // treatment it would carry no information, and "contains glorious" would
    // still pass.
    const html = render();
    expect(html.match(/data-testid="pickem-multiplier-badge"/g)).toHaveLength(1);
    expect(html.match(/var\(--color-bt-glorious-faint\)/g)).toHaveLength(1);
  });

  it("no multiplier CONTROL appears in the list — only in the form", () => {
    expect(rowsRegion(render())).not.toContain("pickem-multiplier-stepper");
    expect(render()).toContain('data-testid="pickem-multiplier-stepper"');
  });

  it("the stepper is bounded — a free field invites 25", () => {
    const html = render();
    // The Stepper renders its bounds as disabled arrows at the ends; at the
    // default of 1 the decrement is already at `min`.
    expect(html).toContain("pickem-multiplier-stepper");
    expect(html).toContain("A normal game");
  });
});

describe("what a pick is worth", () => {
  it("reads at the settings-row size, not as a footnote", () => {
    // The look's finding: 12px made a scoring setting read like fine print. It
    // now matches the rows beside it on the settings page (Total Points, Game
    // State), which are 13.
    const html = render();
    const title = html.indexOf("Confidence ranking");
    expect(title).toBeGreaterThan(-1);
    // The row's own title style sits just before the text.
    expect(html.slice(Math.max(0, title - 120), title)).toContain("font-size:13px");
  });

  it("hides the roll-up when the competition makes it unreachable", () => {
    expect(render()).toContain("How it&#x27;s scored");
    expect(render({ showRollUp: false })).not.toContain("How it&#x27;s scored");
  });
});

describe("frozen", () => {
  it("removes every control rather than disabling them", () => {
    const html = render({ editable: false });
    expect(html).toContain("the slate is frozen");
    expect(html).not.toContain("pickem-slate-form");
    expect(html).not.toContain("pickem-add-game");
    expect(html).not.toContain("pickem-save-slate");
    expect(html).not.toContain("pickem-slate-row");
    // ...and the games are still readable, which is why the modal still opens.
    expect(html).toContain("Alabama");
    expect(html).toContain("Ohio St");
  });
});
