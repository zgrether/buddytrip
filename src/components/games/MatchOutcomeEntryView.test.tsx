import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchOutcomeEntryView } from "./MatchOutcomeEntryView";
import type { MatchGroupData } from "./MatchEntryView";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import type { OutcomeValues } from "./types";

/**
 * MatchOutcomeEntryView (Refactor B2, built to hole_outcome_entry_mockup.html).
 * The entry zone is three stacked choice rows (side A / Halved / side B) — no
 * number pad, one tap records the whole hole. Rendered via react-dom/server
 * (node env); `useState` initializes fine under SSR (no interactivity needed
 * for these render-shape assertions).
 */

const GLOR1: GloriousConfig = { enabled: true, n: 1 }; // last hole only

const match: MatchGroupData = {
  matchId: "m1",
  label: "Match 1",
  a: { id: "a1", name: "Brad", color: "#4ade80" },
  b: { id: "b1", name: "Johnny D", color: "#fb923c" },
  strokesA: 0,
  strokesB: 0,
  leftColor: "#4ade80",
  rightColor: "#fb923c",
};
const units = [
  { label: "1", par: 4 },
  { label: "2", par: 4 },
  { label: "3", par: 3 },
];
// Glorious weighting is hardcoded relative to an 18-hole round (ROUND_HOLES in
// gloriousHoles.ts) regardless of the caller's actual unit count — an existing,
// deliberate engine simplification. The Glorious-banner test below needs a full
// 18-hole unit list to land on a real glorious hole.
const units18 = Array.from({ length: 18 }, (_, i) => ({ label: String(i + 1), par: 4 }));

function render(values: OutcomeValues, hole = 1, glorious: GloriousConfig = NO_GLORIOUS, unitList = units) {
  return renderToStaticMarkup(
    <MatchOutcomeEntryView
      gameName="Test Game"
      units={unitList}
      match={match}
      values={values}
      onChange={() => {}}
      onClear={() => {}}
      currentHole={hole}
      meId="a1"
      glorious={glorious}
    />
  );
}

describe("MatchOutcomeEntryView — the three-choice entry zone", () => {
  it("shows both players' names + a neutral Halved choice — no number pad anywhere", () => {
    const html = render({});
    expect(html).toContain("Brad");
    expect(html).toContain("Johnny D");
    expect(html).toContain("Halved");
    expect(html).not.toContain("keypad"); // no StrokeKeypad-style number entry
  });

  it("marks the recorded choice as selected via its testid and check ring", () => {
    const html = render({ m1: { "1": "side_a" } });
    // The selected choice renders "Won the hole"; the others show no sub-label.
    expect(html).toContain("Won the hole");
    expect(html).toContain("outcome-choice-a");
  });

  it("shows Reset hole only once a choice is recorded", () => {
    expect(render({})).not.toContain("outcome-reset-hole");
    expect(render({ m1: { "1": "halved" } })).toContain("outcome-reset-hole");
  });

  it("shows the Glorious banner only on a glorious hole", () => {
    // Glorious weighting is hardcoded relative to an 18-hole round — hole 18 is
    // "the last 1" (GLOR1); a full 18-hole unit list is needed to land on it.
    const onGlorious = render({}, 18, GLOR1, units18);
    const notGlorious = render({}, 1, GLOR1, units18);
    expect(onGlorious).toContain("glorious-entry-banner");
    expect(notGlorious).not.toContain("glorious-entry-banner");
  });

  it("shows the live match board (MatchCard) derived from recorded outcomes", () => {
    const html = render({ m1: { "1": "side_a" } });
    // MatchCard renders the match label + a live "1 UP" while in progress.
    expect(html).toContain("Match 1");
    expect(html).toContain("1 UP");
  });

  it("shows the closed-out result banner once the match is decided", () => {
    const html = render({ m1: { "1": "side_a", "2": "side_a", "3": "side_a" } });
    expect(html).toContain("Brad def. Johnny D");
  });
});
