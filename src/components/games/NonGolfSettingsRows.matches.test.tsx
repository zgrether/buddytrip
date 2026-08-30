import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NonGolfSettingsRows, NonGolfTotalPointsRow } from "./NonGolfSettingsRows";
import { MatchPointsRow, type PointsMatch } from "./MatchPointsRow";
import { MatchesAccordionRow } from "./MatchesAccordionRow";
import type { NonGolfConfigDraft, DraftMatchConfig } from "@/lib/configDraft";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

/**
 * Settings-parity handoff — Matches gets golf's OWN rows, not a placement UI
 * dressed up as one.
 *
 * `renderToStaticMarkup` (no jsdom/RTL in this repo — see
 * `gamePanelView.test.tsx`'s header for why): render the real component tree,
 * assert on the HTML it produces.
 *
 * ── Why the Point Distribution tests check the SUBTITLE, not the panel body ──
 * `ChecklistRow`'s body is a `Collapse`, which only MOUNTS children while
 * `expanded` — confirmed by reading it before writing these, not assumed —
 * and `NonGolfSettingsRows` owns that expand state internally with no prop to
 * force it open, so a body-content assertion here would silently pass or fail
 * on whichever collapsed-by-default state happened to apply, not on which
 * branch was chosen. The SUBTITLE renders unconditionally (it's the row
 * header, not the body) and the two branches' subtitle vocabularies never
 * overlap — Matches always says "per match", placement never does — so it is
 * the reliable signal, and the tests below use `MatchPointsRow` directly
 * (with `expanded` set explicitly) wherever a body assertion is genuinely
 * needed (the redistribution math).
 */

const GAME: GameRow = {
  id: "g1",
  competition_id: "comp1",
  game_type_id: "gtt_generic_yard",
  name: "Cornhole",
  status: "pending",
  points_distribution: null,
  points_total: 8,
  competition_format: "matches",
  rules_for_today: null,
  modifiers: null,
  scorecard_schema: null,
  course_id: null,
  back_course_id: null,
  schedule_item_id: null,
  corrections_open: false,
};

const baseDraft: NonGolfConfigDraft = {
  gameTypeId: "gtt_generic_yard",
  name: "Cornhole",
  rulesForToday: null,
  competitionFormat: "matches",
  bracketConfig: null,
  scoringEnabled: false,
  pointsTotal: 8,
  pointsDistribution: null,
  delegates: [],
  bracketEntrants: [],
  matches: [],
};

function pointsMatch(id: string, pointValue: number | null): PointsMatch {
  return {
    id,
    number: Number(id) + 1,
    aPlayers: [{ id: `a${id}`, name: `A${id}`, teamColor: "#ef4444" }],
    bPlayers: [{ id: `b${id}`, name: `B${id}`, teamColor: "#3b82f6" }],
    pointValue,
  };
}

describe("Point Distribution — Matches vs Simple (§1)", () => {
  const rows = (draft: NonGolfConfigDraft, matches: PointsMatch[] = []) =>
    renderToStaticMarkup(
      <NonGolfSettingsRows
        game={GAME}
        scoringModel="match_play"
        draft={draft}
        canEdit
        capacity={{ count: 2, source: "teams" }}
        pointsMatches={matches}
        onFormatChange={() => {}}
        onPointsTotalChange={() => {}}
        onPointsDistChange={() => {}}
        onPointsOverrideChange={() => {}}
      />
    );

  it("Matches renders the per-match override row (subtitle names a per-match share)", () => {
    const html = rows(baseDraft, [pointsMatch("0", null)]);
    expect(html).toContain("per match");
    // The placement vocabulary must be entirely absent, not merely unlabeled.
    expect(html).not.toContain("placement split");
    expect(html).not.toContain("Winner takes all");
  });

  it("Simple renders the placement row (subtitle names a placement split), not overrides", () => {
    const simple: NonGolfConfigDraft = { ...baseDraft, competitionFormat: "head_to_head" };
    const html = rows(simple);
    expect(html).toContain("placement split");
    expect(html).not.toContain("per match");
  });

  it("Matches with an override reads Custom, same vocabulary the total row uses", () => {
    const html = rows(baseDraft, [pointsMatch("0", 5), pointsMatch("1", null)]);
    expect(html).toContain("Custom");
    expect(html).not.toContain("Custom placement split"); // that's the OTHER row's Custom
  });
});

describe("Total Points subtext — Matches vs Simple (§2)", () => {
  const totalRow = (
    competitionFormat: NonGolfConfigDraft["competitionFormat"],
    matches: PointsMatch[],
    value = 8
  ) =>
    renderToStaticMarkup(
      <NonGolfTotalPointsRow
        scoringModel="match_play"
        competitionFormat={competitionFormat}
        distribution={null}
        value={value}
        matches={matches}
        canEdit
        onChange={() => {}}
        onOverrideChange={() => {}}
      />
    );

  it('Matches, no override, 4 matches of 8 points → "Points per match: 2"', () => {
    const four = ["0", "1", "2", "3"].map((id) => pointsMatch(id, null));
    const html = totalRow("matches", four);
    expect(html).toContain("Points per match:");
    expect(html).toContain(">2<");
    expect(html).not.toContain("Win ");
    expect(html).not.toContain("Draw ");
  });

  it('Matches WITH any override → "Points per match: Custom"', () => {
    const withOverride = [pointsMatch("0", 5), pointsMatch("1", null), pointsMatch("2", null), pointsMatch("3", null)];
    const html = totalRow("matches", withOverride);
    expect(html).toContain("Points per match:");
    expect(html).toContain(">Custom<");
  });

  it("Simple keeps its OWN subtext — Win/Draw, not Points per match", () => {
    const html = totalRow("head_to_head", [], 4);
    expect(html).toContain("Win ");
    expect(html).toContain("Draw ");
    expect(html).not.toContain("Points per match:");
  });
});

describe("An override redistributes the remainder (§ tests item 3, liveMatchPointsPerMatch)", () => {
  // `MatchPointsRow` directly, `expanded` forced true — the panel BODY is what's
  // under test here (the per-match figures), which `Collapse` only mounts while
  // open; `NonGolfSettingsRows` owns that state internally with no way to force
  // it from outside, so the format-decision tests above check the subtitle
  // instead and this one goes straight to the row that owns the math.
  const distribution = (matches: PointsMatch[], pointsTotal: number) =>
    renderToStaticMarkup(
      <MatchPointsRow
        part="distribution"
        matches={matches}
        pointsTotal={pointsTotal}
        defaultTotal={0}
        canEdit
        locked={false}
        expanded
        onToggle={() => {}}
        onTotalChange={() => {}}
        onOverrideChange={() => {}}
      />
    );

  it("no overrides: 3 matches of 30 points show 10 each", () => {
    const html = distribution(["0", "1", "2"].map((id) => pointsMatch(id, null)), 30);
    // Three rows, each showing the even share.
    expect((html.match(/>10</g) ?? []).length).toBe(3);
  });

  it("overriding one match to 18 redistributes the remaining 12 across the OTHER two — 6 each, not 10", () => {
    const html = distribution([pointsMatch("0", 18), pointsMatch("1", null), pointsMatch("2", null)], 30);
    expect(html).toContain(">18<"); // the override itself
    expect((html.match(/>6</g) ?? []).length).toBe(2); // the two redistributed shares
    // The naive (wrong) even split must not appear as if it were still live.
    expect(html).not.toContain(">10<");
  });
});

describe("The Matches panel is golf's accordion, with the shapes summary (§3, items 5-6)", () => {
  const draftRow = (playersPerSide: 1 | 2, a: string[], b: string[]): DraftMatchConfig => ({
    matchNumber: 1,
    playersPerSide,
    a,
    b,
    handicap: 0,
    pointValue: null,
  });

  const teamForSlot = (slot: "a" | "b") => (slot === "a" ? { name: "Red", color: "#ef4444" } : { name: "Blue", color: "#3b82f6" });

  const panel = (draft: DraftMatchConfig[]) =>
    renderToStaticMarkup(
      <MatchesAccordionRow
        draft={draft}
        setDraft={() => {}}
        nameOf={new Map()}
        colorOf={new Map()}
        teamColorOf={() => undefined}
        avatarIconOf={new Map()}
        teamForSlot={teamForSlot}
        maxMatches={24}
        twoTeams
        teamedUserIds={new Set(["u1", "u2", "u3", "u4", "u5", "u6"])}
        openSelector={() => {}}
        expanded={false}
        onToggle={() => {}}
        canEdit
      />
    );

  it("is a ChecklistRow (golf's accordion), not a bare header", () => {
    const html = panel([draftRow(1, ["u1"], ["u2"])]);
    expect(html).toContain('data-testid="row-matches"');
    // The old bare-header build's own markers must be gone.
    expect(html).not.toContain("matches-builder");
    expect(html).not.toContain("Nobody paired yet");
  });

  it('a mixed 1v1/2v2 game reads "2 singles · 1 double · 3 of 3 assigned"', () => {
    const html = panel([
      draftRow(1, ["u1"], ["u2"]),
      draftRow(1, ["u3"], ["u4"]),
      draftRow(2, ["u5", "u6"], ["u1", "u2"]),
    ]);
    expect(html).toContain("2 singles");
    expect(html).toContain("1 double");
    expect(html).toContain("3 of 3 assigned");
  });

  it("pure 2v2 uses the plural correctly — not '1 doubles' or '2 double'", () => {
    const html = panel([
      draftRow(2, ["u1", "u2"], ["u3", "u4"]),
      draftRow(2, ["u5", "u6"], ["u1", "u2"]),
    ]);
    expect(html).toContain("2 doubles");
    expect(html).not.toContain("1 single");
  });

  it("an empty draft reads the neutral empty state, not an error", () => {
    const html = panel([]);
    expect(html).toContain("No matches yet");
  });
});
