import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemSlateRow, SLATE_BLOCKED_WHILE_DIRTY } from "./PickemGameView";
import { PickemScoringRows } from "./pickem/PickemScoringRows";
import { configToPickemDraft, pickemDraftsEqual } from "@/lib/configDraft";

/**
 * ── STOPGAP (#1263): THE SLATE IS UNREACHABLE WHILE THE SETTINGS DRAFT IS DIRTY ──
 *
 * The ordering #1264 left behind: change a settings field, save the slate, press
 * Save -> refused. `save_pickem_config` creates the `pickem_games` row (migration
 * 176), which is hashed, so the slate save moves the config fingerprint. #1264
 * refreshes it — enough while the baseline is still tracking. Once the draft is
 * dirty the baseline is FROZEN, and a frozen baseline cannot adopt the new hash
 * however promptly it arrives.
 *
 * ── THE BUILD THIS MUST RULE OUT ───────────────────────────────────────────
 *
 * The tempting build keys the block on the ROLL-UP — block when the individual
 * matches builder is in play, since that is where the reproduction lived. It is
 * wrong in both directions: it blocks a runner who has changed nothing, and it
 * lets through a dirty team-totals page, which is at exactly the same risk
 * because the hash does not care which fields moved.
 *
 * The decisive fact is a draft whose ONLY change is the points total — a field
 * with nothing to do with Matches. It is dirty, and NO format signal can see it.
 *
 * WHICH CASE ACTUALLY SEPARATES THE TWO BUILDS, stated because the obvious
 * reading is wrong and this file was written with it: running the bad build
 * against these cases fails **only the source guard at the bottom**. The
 * points-only case passes under it, because it asserts a fact about DRAFTS and
 * never reads the call site — nothing in a node suite can, since the value is
 * computed inside a component this environment cannot mount.
 *
 * So the two halves do different jobs and neither is the guarantee alone:
 * the source guard pins that the call site keys on the save state and names no
 * format signal, and the points-only case is what makes that forbidden list
 * mean something — it establishes that a format check genuinely cannot see the
 * change, rather than leaving the list as a hunch. (Mutating `pickemDraftsEqual`
 * to ignore the points total fails that case, which is how it is known not to be
 * decorative.)
 *
 * ── What each section can and cannot prove ─────────────────────────────────
 *
 *  1. the ROW renders the block — real components, assembled the way the page
 *     assembles them (`PickemScoringRows` wrapping the slate row)
 *  2. the PREDICATE is dirty-shaped — the real draft builder and the real
 *     equality function, not a hand-rolled pair
 *  3. the WIRING passes (2) into (1) — a SOURCE guard, because the value is
 *     computed inside a 2,000-line client component this node suite cannot
 *     mount. It proves the expression at the call site; it does NOT prove the
 *     assembled page behaves. That needs a person, or a Playwright spec.
 */

const SRC = readFileSync(join(__dirname, "PickemGameView.tsx"), "utf8");

/** The slate row inside the rows component that owns it, as the page renders it. */
const settingsRows = (settingsDirty: boolean) =>
  renderToStaticMarkup(
    <PickemScoringRows
      settings={{ rollUp: "team_totals", useConfidence: true }}
      editable
      frozenReason={null}
      showRollUp
      slateCount={4}
      onChange={() => {}}
      slateRow={
        <PickemSlateRow
          slateCount={4}
          weightedCount={0}
          useConfidence
          settingsDirty={settingsDirty}
          onOpenSlate={() => {}}
        />
      }
    />
  );

describe("the slate row is blocked while the settings draft is dirty", () => {
  it("a dirty page covers the row and names the action", () => {
    const html = settingsRows(true);
    // The scrim, by the testid only the blocked branch emits — not by the copy,
    // which a subtitle could also carry.
    expect(html).toContain('data-testid="row-the-picks-scrim"');
    expect(html).toContain(SLATE_BLOCKED_WHILE_DIRTY);
  });

  it("a clean page leaves the row reachable", () => {
    const html = settingsRows(false);
    expect(html).not.toContain('data-testid="row-the-picks-scrim"');
    expect(html).not.toContain(SLATE_BLOCKED_WHILE_DIRTY);
    // Vacuity: the row is present in BOTH states, so the case above is testing a
    // scrim over a row and not a row that failed to render at all.
    expect(html).toContain('data-testid="row-the-picks"');
    expect(settingsRows(true)).toContain('data-testid="row-the-picks"');
  });

  it("saving clears the block — the same row, the two states of one input", () => {
    // `settingsDirty` goes false when the draft commits; nothing else about the
    // row changes. Asserting the pair together is what pins that the block is a
    // function of this one input rather than of anything else in the fixture.
    expect(settingsRows(true)).not.toEqual(settingsRows(false));
    expect(settingsRows(false)).not.toContain("row-the-picks-scrim");
  });

  it("the copy names an action AND why, in the string the row actually renders", () => {
    // Imported, not re-typed: a copy of the sentence would pass while the row
    // said something else.
    expect(SLATE_BLOCKED_WHILE_DIRTY).toMatch(/^Save your settings first/);
    expect(SLATE_BLOCKED_WHILE_DIRTY).toContain("save immediately");
    expect(settingsRows(true)).toContain(SLATE_BLOCKED_WHILE_DIRTY);
  });
});

describe("the predicate is DIRTY — not the roll-up, and not any proxy for it", () => {
  const game = {
    game_type_id: "pickem",
    name: "Picks",
    rules_for_today: null,
    competition_format: null,
    bracket_config: null,
    scoring_enabled: false,
    points_total: 100,
    points_distribution: null,
  };
  const settings = { rollUp: "team_totals" as const, useConfidence: true };
  const baseline = configToPickemDraft(game, [], settings);

  it("an unchanged draft is clean — so `dirty` is not trivially true", () => {
    expect(pickemDraftsEqual(configToPickemDraft(game, [], settings), baseline)).toBe(true);
  });

  it("a points-only change is dirty AND invisible to every format signal", () => {
    // Built through the app's own builder, and changed the way the page changes
    // it — `configDraft` is the server mirror with the touched slice laid over.
    const pointsChanged = { ...baseline, pointsTotal: 250 };
    expect(pickemDraftsEqual(pointsChanged, baseline)).toBe(false);

    // …and NOTHING a format-keyed build looks at has moved. A block keyed on the
    // roll-up, on `competitionFormat`, or on the matches list would see these two
    // drafts as identical and let the save through to a refusal.
    expect(pointsChanged.rollUp).toBe(baseline.rollUp);
    expect(pointsChanged.competitionFormat).toBe(baseline.competitionFormat);
    expect(pointsChanged.matches).toEqual(baseline.matches);
  });

  it("a team-totals page is equally at risk — the hash does not care which field moved", () => {
    // The other direction of the same mistake: `rollUp: "team_totals"` has no
    // matches builder at all, and a dirty one still freezes its baseline.
    const renamed = { ...baseline, name: "Picks, renamed" };
    expect(renamed.rollUp).toBe("team_totals");
    expect(pickemDraftsEqual(renamed, baseline)).toBe(false);
  });
});

describe("the call site passes dirty, and nothing else", () => {
  /**
   * A source guard, and it says what it is: the value is computed inside
   * `PickemGameView`, which this `environment: "node"` suite cannot mount. It
   * pins the EXPRESSION. It does not prove the rendered page blocks.
   */
  const attr = /settingsDirty=\{([^}]*)\}/.exec(
    SRC.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n")
  );

  it("the scan can see the call site at all", () => {
    // Vacuity: a renamed prop or a moved row must fail this file, not quietly
    // satisfy it.
    expect(attr, "no `settingsDirty={…}` in PickemGameView").not.toBeNull();
    expect(SRC).toContain("<PickemSlateRow");
  });

  it("keys on the draft's save state and on no format signal", () => {
    const expr = attr![1];
    // `saveState === "ready"` IS dirty — `useConfigDraft` computes
    // `saveState = dirty ? "ready" : …`.
    expect(expr).toContain("saveState");
    expect(expr).toContain('"ready"');
    for (const proxy of ["rollUp", "competitionFormat", "matches", "slateOpen", "pointsMode"]) {
      expect(expr, `keyed on ${proxy}, which is not dirty`).not.toContain(proxy);
    }
  });
});
