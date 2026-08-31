import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
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
    // "Spread Home" since r7 §3 — the number is the home team's line, and the
    // form was the one place a runner had to remember that rather than read it.
    for (const field of ["Away team", "Home team", "Game time", "Spread Home", "Note"]) {
      expect(html.match(new RegExp(`aria-label="${field}"`, "g")), field).toHaveLength(1);
    }
  });

  it("every field's title is VISIBLE, not only a placeholder", () => {
    /**
     * The titles used to be placeholders, which vanish the moment there is a
     * value — so the one time you need to know what a box holds is the one time
     * nothing says. Each field now renders a real `<label>` above the input.
     *
     * Asserted as LABEL ELEMENTS, not as "the page contains the word". Every one
     * of these strings is also an `aria-label` on the input beside it, so a
     * substring check over the markup passes with the labels deleted — it would
     * be reading the attribute it is meant to be independent of.
     */
    const html = render();
    const labels = html.match(/<label[^>]*>([^<]*)<\/label>/g) ?? [];
    const text = labels.map((l) => l.replace(/<[^>]*>/g, "").trim());

    for (const field of ["Away team", "Home team", "Game time", "Spread Home", "Note"]) {
      expect(text, `${field} has no visible label`).toContain(field);
    }
  });

  it("placeholders are EXAMPLES now, and never repeat the label", () => {
    // The split is what fixed the width: "Spread Home" in a 96px box rendered
    // as "Spread Ho". A placeholder that restates its label is the old shape
    // coming back, and it sets the field width by the longer of two jobs.
    const html = render();
    const placeholders = [...html.matchAll(/placeholder="([^"]*)"/g)].map((m) => m[1]);
    expect(placeholders.length, "the form renders no placeholders at all").toBeGreaterThan(0);
    for (const field of ["Away team", "Home team", "Game time", "Spread Home", "Note"]) {
      expect(placeholders, `${field} is still named by its placeholder`).not.toContain(field);
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
    expect(html).toContain('aria-label="Spread Home"');
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
    // The footer goes with the controls: there is nothing to save and nothing
    // to close that the sheet's own X does not already close.
    expect(html).not.toContain("pickem-slate-footer");
    expect(html).not.toContain("pickem-slate-row");
    // ...and the games are still readable, which is why the modal still opens.
    expect(html).toContain("Alabama");
    expect(html).toContain("Ohio St");
  });
});

describe("the slate modal carries ONE banner, and it is about the lock", () => {
  /**
   * ── The ranking warning is GONE, and its absence is the assertion ────────
   *
   * There were two banners. The post-lock one told the runner that adding or
   * removing a contest clears everyone's ranking and they would need to put
   * them back in order. Migration 174 falsified the first half — an add costs
   * nothing — and 175 answered the second: a removal that would destroy
   * rankings is now REFUSED at the tap (`SLATE_RANKED`), and that refusal names
   * its own way out.
   *
   * So the warning had nothing left to warn about, and it was deleted rather
   * than reworded. A standing caution read on the way in cannot be more
   * accurate than a refusal delivered at the moment of the action, and keeping
   * both is how two statements about one rule drift apart — which is exactly
   * what happened to these two strings across 174.
   *
   * These cases assert the DELETION, in both states, because a component test
   * cannot see a banner that is no longer rendered and would otherwise pass
   * vacuously for the wrong reason.
   */

  it("renders no ranking warning while the slate is editable", () => {
    expect(render({ editable: true })).not.toContain(
      'data-testid="pickem-slate-clears-rankings"'
    );
  });

  it("renders no ranking warning while the slate is frozen either", () => {
    expect(render({ editable: false })).not.toContain(
      'data-testid="pickem-slate-clears-rankings"'
    );
  });

  it("no longer claims an ADD costs anyone their ranking", () => {
    // The exact clause 174 falsified, in either banner. Asserted as text rather
    // than by testid: the testid could be reused, the claim is the defect.
    for (const editable of [true, false]) {
      const html = render({ editable });
      expect(html).not.toContain("Adding or removing");
      expect(html).not.toContain("clears everyone");
      expect(html).not.toContain("put them back in order");
    }
  });

  it("the frozen banner names the lock and stops there", () => {
    const html = render({ editable: false });
    expect(html).toContain("Picks are open, the slate is locked.");
    expect(html).toContain("Close picking on the game");
    // It used to carry a second rule — what a slate change costs — which is
    // now the RPC's to state, and only when it actually refuses.
    expect(html).not.toContain("Nothing is lost");
  });

  it("says nothing about the lock while the slate IS editable", () => {
    // The banner is the frozen state's, not a permanent header.
    expect(render({ editable: true })).not.toContain("the slate is locked");
  });

  it("shows no stale reopen affordance anywhere in the modal", () => {
    // The action is gone from the server (BAD_ACTION) — a button still offering
    // it here would be an error the runner can only discover by tapping it.
    const html = render({ editable: true });
    expect(html).not.toContain("Reopen the slate");
    expect(html).not.toContain('data-testid="pickem-reopen-slate"');
  });
});

/**
 * ── ONE BUTTON, AND IT ALWAYS WORKS (critique-3 §1, closed by option A) ────
 *
 * Opening the modal to LOOK at the slate used to present a disabled Save, which
 * is what a person saw first. A screen whose only affordance is greyed out reads
 * as broken, and it read that way for four rounds.
 *
 * Every change persists now. `save_pickem_config` already replaced the whole
 * slate in one statement, so this needed no new endpoint and no migration — each
 * edit sends the payload the Save button used to send.
 *
 * These render only; nothing clicks in a node suite. What can be asserted is
 * what is ON the screen, which is exactly what the complaint was about.
 */
describe("the slate saves as you go", () => {
  it("offers no Save at all — there is nothing to commit", () => {
    const html = render();
    expect(html).not.toContain("pickem-save-slate");
    expect(html).not.toContain(">Save<");
  });

  it("its one control is a way OUT, and is never disabled", () => {
    /**
     * The specific complaint: a disabled control as the only affordance. Done
     * carries no `disabled` attribute in any state, which is the assertion that
     * would fail against a build that kept the gate and renamed the button.
     */
    const html = render();
    const at = html.indexOf('data-testid="pickem-slate-done"');
    expect(at).toBeGreaterThan(-1);
    const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
    expect(tag).not.toContain("disabled");
  });

  it("says the changes save themselves, rather than reporting them unsaved", () => {
    // "Unsaved changes" was true of a draft and is a lie about a write that has
    // already landed.
    const html = render();
    expect(html).toContain("Changes save as you make them");
    expect(html).not.toContain("Unsaved changes");
  });

  it("shows the write in flight without taking the exit away", () => {
    // Saving is a status, not a mode: the way out stays available while a write
    // is in the air, because the write is not something the runner is waiting on.
    const html = render({ saving: true });
    expect(html).toContain("Saving…");
    const at = html.indexOf('data-testid="pickem-slate-done"');
    const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
    expect(tag).not.toContain("disabled");
  });
});

const COMMENT_BLOCK = new RegExp(String.raw`/\*[\s\S]*?\*/`, "g");
const ON_SAVE_CALL = new RegExp(String.raw`onSave\(`, "g");

/**
 * SOURCE GUARD — every change actually WRITES.
 *
 * Written because a mutation exposed a hole rather than because the shape felt
 * worth pinning. Deleting the `onSave` call out of `mutate` — so edits change the
 * screen and never persist — broke NOTHING above. Every case here is a static
 * render, nothing clicks, and the whole point of option A is what happens on a
 * tap.
 *
 * That failure is silent in the worst way: the runner sees their edit, closes
 * the modal, and the slate is unchanged. With the Save button gone there is no
 * second chance to notice.
 *
 * What this proves: `mutate` is the single funnel and it calls `onSave`. What it
 * does not prove: that a tap reaches `mutate`. That is what a Playwright spec
 * would add.
 */
describe("write-on-change is wired (source)", () => {
  const SRC = readFileSync(resolve(__dirname, "PickemSlateModal.tsx"), "utf8");
  const CODE = SRC.replace(COMMENT_BLOCK, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("the scan can see the funnel — not passing vacuously", () => {
    expect(CODE).toContain("const mutate = (");
    expect(CODE).toContain("onSave");
    // ...and the stripping happened: the paragraph above `mutate` names both.
    expect(CODE).not.toContain("four rounds");
  });

  it("mutate persists what it changes", () => {
    const at = CODE.indexOf("const mutate = (");
    const body = CODE.slice(at, CODE.indexOf("};", at));
    expect(
      body.includes("onSave({ slate: next })"),
      "mutate no longer writes. Every slate edit goes through it, so without the " +
        "write an edit changes the screen and is silently discarded — and with " +
        "the Save button gone there is nothing to notice it by."
    ).toBe(true);
  });

  it("nothing else writes the slate — one funnel, not two", () => {
    // A second onSave call site would be a second way to persist, which is how
    // one of them ends up missing a step the other has.
    expect((CODE.match(ON_SAVE_CALL) ?? []).length).toBe(1);
  });
});

/**
 * ── THE DONE BAR IS OUTSIDE THE SCROLLING BODY ────────────────────────────
 *
 * Reported from the running app: "when you scroll down, the done bar is not
 * completely pinned to the bottom". Measured at 390px, scrolled to the end —
 * footer bottom 811, scroller bottom 843, a 32px gap with a strip of the
 * add-game form sitting visibly below the bar.
 *
 * The cause was `sticky bottom-0` inside the scroller: `bottom: 0` pins to the
 * containing block's CONTENT box, and two paddings sat under it (the inner
 * column's `pb-4` and the sheet body's `p-4`), both part of the scrollable
 * region, so the list scrolled THROUGH them.
 *
 * The fix is structural — `Sheet`'s `footer` prop, a flex sibling after the
 * body — so the assertion is structural too. A class check would pass against a
 * build that merely swapped one sticky offset for another.
 */
describe("the Done bar is pinned, not sticky inside the list", () => {
  /** Does `needle` fall inside the element that opens at `openIdx`? */
  const isInside = (html: string, openIdx: number, needle: number) => {
    let depth = 0;
    let i = openIdx;
    while (i > -1 && i < html.length) {
      const nextOpen = html.indexOf("<div", i + 1);
      const nextClose = html.indexOf("</div>", i + 1);
      if (nextClose === -1) return false;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        i = nextOpen;
      } else if (depth === 0) {
        return needle < nextClose;
      } else {
        depth -= 1;
        i = nextClose;
      }
    }
    return false;
  };

  it("renders OUTSIDE the scrolling body", () => {
    const html = render();
    const scroller = html.indexOf("overflow-y-auto");
    const footer = html.indexOf('data-testid="pickem-slate-footer"');
    expect(scroller, "no scroll container").toBeGreaterThan(-1);
    expect(footer, "no footer").toBeGreaterThan(-1);

    // The scroller's own opening tag, walked to its close.
    const open = html.lastIndexOf("<div", scroller);
    expect(
      isInside(html, open, footer),
      "the Done bar is INSIDE the scroll container — content will scroll under it"
    ).toBe(false);
  });

  it("carries no sticky positioning of its own", () => {
    /**
     * Not the primary assertion — the structural one above is — but a build
     * that put it back inside would almost certainly bring `sticky` with it,
     * and this names the mechanism in the failure message.
     */
    const html = render();
    const at = html.indexOf('data-testid="pickem-slate-footer"');
    const tag = html.slice(html.lastIndexOf("<div", at), html.indexOf(">", at));
    expect(tag).not.toContain("sticky");
    // ...and the negative inset that existed only to cancel the body padding.
    expect(tag).not.toContain("-mx-4");
  });

  it("still says what it said, and still closes", () => {
    // The move is presentational. Losing the status line or the button while
    // relocating them would be a silent regression the geometry checks cannot
    // see — the same "extraction leaves the message behind" shape.
    const html = render();
    expect(html).toContain("Changes save as you make them");
    expect(html).toContain('data-testid="pickem-slate-done"');
    expect(html).toContain(">Done</button>");
  });

  it("is absent on a read-only slate — nothing to be done", () => {
    // The footer slot must not render an empty bar when picks are open and the
    // slate is frozen. Already asserted elsewhere in this file; repeated here
    // because the move changed WHERE the conditional lives.
    expect(render({ editable: false })).not.toContain("pickem-slate-footer");
  });
});
