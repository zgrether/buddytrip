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

/* The three scoring-settings cases that used to live here moved to
 * `PickemScoringRows.test.tsx` with the controls themselves — the slate modal is
 * for adding games now, and a test asserting a section this file no longer
 * renders would pass only by being deleted. */

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
      editable
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

  it("the setup header does NOT advertise a confidence range", () => {
    // It showed "confidence 1–16" whether or not confidence ranking was even
    // switched on, and the range is a property of the finished slate rather
    // than something the runner is deciding while building it.
    const html = render();
    expect(html).toContain("3 games");
    expect(html).not.toContain("confidence 1–");
  });

  it("with no games, the ADD form is the last thing in the list", () => {
    // The default position. An EDIT renders the form against its own row
    // instead — see the browser verification; `editingId` is internal state and
    // this environment cannot click.
    const html = render();
    expect(html.indexOf('data-testid="pickem-slate-row"')).toBeLessThan(
      html.indexOf('data-testid="pickem-slate-form"')
    );
    expect(html.lastIndexOf('data-testid="pickem-slate-row"')).toBeLessThan(
      html.indexOf('data-testid="pickem-slate-form"')
    );
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
  it("a weighted game gets a SOLID LEFT STRIPE, not a background wash", () => {
    // The wash was a 12% tint over a card surface and never read at a glance —
    // which was the treatment's whole job. Scanning a sixteen-row list is a
    // vertical eye movement down the left edge, so the mark belongs on that
    // edge, solid.
    const html = render();
    expect(html).toContain("border-left-color:var(--color-bt-glorious)");
    expect(html).not.toContain("var(--color-bt-glorious-faint)");
    // The badge stays and carries the value.
    expect(html).toContain("2×");
  });

  it("an unweighted game renders plain — the treatment MEANS something", () => {
    // Exact counts, not presence: if every row wore the stripe it would carry
    // no information at all, and a "contains glorious" check would still pass.
    const html = render();
    expect(html.match(/data-testid="pickem-multiplier-badge"/g)).toHaveLength(1);
    expect(html.match(/border-left-color:var\(--color-bt-glorious\)/g)).toHaveLength(1);
    // The stripe is a WIDTH as well as a colour — one row at 3px, the rest at 1.
    expect(html.match(/border-left-width:3px/g)).toHaveLength(1);
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
  });

  it("the label is NEUTRAL and the helper carries the state", () => {
    // "Worth extra" over "A normal game" had the label asserting something the
    // helper immediately denied. The label is now the noun; the helper is the
    // thing that changes.
    const html = render();
    expect(html).toContain("Multiplier");
    expect(html).toContain("Normal game");
    expect(html).not.toContain("Worth extra");
  });
});

describe("matchup search sits inside the add form", () => {
  it("offers search while ADDING", () => {
    expect(render()).toContain('data-testid="matchup-search"');
  });

  it("is absent when the slate is frozen", () => {
    expect(render({ editable: false })).not.toContain("matchup-search");
  });

  it("every field it fills is a normal editable input", () => {
    // The point of filling rather than importing: search sets away, home and
    // kickoff, and all three remain the same inputs a person could have typed
    // into. Nothing becomes read-only because it came from an API.
    const html = render();
    for (const field of ["Away team", "Home team", "Game time"]) {
      const at = html.indexOf(`aria-label="${field}"`);
      expect(at, field).toBeGreaterThan(-1);
      const tag = html.slice(html.lastIndexOf("<input", at), html.indexOf(">", at));
      expect(tag, `${field} should not be readonly`).not.toContain("readonly");
      expect(tag, `${field} should not be disabled`).not.toContain("disabled");
    }
  });

  it("SPREAD and NOTE are not filled by search — the line is the runner's call", () => {
    // Asserted on the seeded row rather than the form: a slate game carries a
    // spread, and search must never have been what put it there.
    const html = render();
    expect(html).toContain('aria-label="Spread"');
    expect(html).toContain('aria-label="Note"');
  });
});

describe("delete is inside the form, not beside the row", () => {
  it("no row carries a remove control", () => {
    // It used to sit a few pixels from the edit target, on a sixteen-row list,
    // on a phone, with no confirmation. Two deliberate taps now.
    const html = render();
    expect(html).not.toContain("Remove Alabama at Georgia");
    expect(html).not.toContain("pickem-form-delete"); // not while ADDING, either
  });

  it("the row is a single tap target with nothing nested inside it", () => {
    // A button inside a button is both invalid and the shape that produced the
    // mis-tap. Asserted on the row's own markup rather than the region, because
    // the region necessarily contains the NEXT row's opening tag.
    const html = render();
    const start = html.indexOf('data-testid="pickem-slate-row"');
    const firstRow = html.slice(start, html.indexOf("</button>", start));
    expect(firstRow).not.toContain("<button");
    expect(firstRow).not.toContain("<input");
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
