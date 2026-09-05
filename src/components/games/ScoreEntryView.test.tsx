import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScoreEntryView } from "./ScoreEntryView";
import type { ScoreUnit } from "./types";

/**
 * Entry-screen standings run on NET (#824).
 *
 * The reported symptom was "handicaps applied twice in rack standings". They are
 * not — `score_entries` holds GROSS and the subtraction happens exactly once. But
 * this screen's running total and "Leading" badge ranked on GROSS while every
 * standings surface ranks on NET, so in a handicap game the entry screen could
 * name a different leader than the board. That contradiction is a large part of
 * what read as a double-applied handicap, and these pin the fix.
 *
 * Rendered via react-dom/server (node env, no RTL) — same as MatchEntryView.
 */

// par 4 / 3 / 5 / 4 on holes 1, 2, 10, 18.
const units: ScoreUnit[] = [
  { label: "1", section: "front", par: 4, strokeIndex: 5 },
  { label: "2", section: "front", par: 3, strokeIndex: 17 },
  { label: "10", section: "back", par: 5, strokeIndex: 2 },
  { label: "18", section: "back", par: 4, strokeIndex: 8 },
];

const participants = [
  { id: "zach", name: "Zach", color: "#2dd4bf" },
  { id: "matt", name: "Matt", color: "#f59e0b" },
];

// Hole 1 is left UNSCORED so the current hole shows the "Leading" branch rather
// than the golf word for a played hole.
const values = {
  zach: { "2": 4, "10": 6, "18": 5 }, // gross 15 → net 13 (strokes on 2 and 10)
  matt: { "2": 3, "10": 6, "18": 5 }, // gross 14 → net 14 (scratch)
};

const render = (pips?: Record<string, Set<string>>) =>
  renderToStaticMarkup(
    <ScoreEntryView
      gameName="Day 1"
      units={units}
      participants={participants}
      values={values}
      pips={pips}
      currentHole={1}
      onChange={() => {}}
    />
  );

/** The markup of one player's row — from their name to the next player's. */
const rowOf = (html: string, name: string, next?: string) => {
  const i = html.indexOf(`>${name}<`);
  const j = next ? html.indexOf(`>${next}<`) : html.length;
  return html.slice(i, j === -1 ? html.length : j);
};

describe("ScoreEntryView — running total + Leading score NET", () => {
  const html = render({ zach: new Set(["2", "10"]) });

  it("shows each player's NET total, labelled as net", () => {
    // Zach: 15 gross − 2 strokes = 13. Matt: 14, no strokes.
    expect(rowOf(html, "Zach", "Matt")).toContain("13 net");
    expect(rowOf(html, "Matt")).toContain("14 net");
  });

  it("crowns the NET leader, not the gross leader", () => {
    // Gross would name Matt (14 < 15); net names Zach (13 < 14). Before the fix
    // this row said Matt while the board said Zach.
    expect(rowOf(html, "Zach", "Matt")).toContain("Leading");
    expect(rowOf(html, "Matt")).not.toContain("Leading");
  });

  it("keeps the per-hole net hint on a stroked hole", () => {
    // Hole 2 is stroked for Zach; the existing "· net {word}" hint is untouched.
    const onHole2 = renderToStaticMarkup(
      <ScoreEntryView
        gameName="Day 1"
        units={units}
        participants={participants}
        values={values}
        pips={{ zach: new Set(["2", "10"]) }}
        currentHole={2}
        onChange={() => {}}
      />
    );
    expect(rowOf(onHole2, "Zach", "Matt")).toContain("net");
  });
});

describe("ScoreEntryView — no handicaps (net ≡ gross, unchanged)", () => {
  const html = render(undefined);

  it("labels the total 'total' and ranks on gross, exactly as before", () => {
    expect(rowOf(html, "Zach", "Matt")).toContain("15 total");
    expect(rowOf(html, "Matt")).toContain("14 total");
    expect(html).not.toContain("net");
  });

  it("crowns the gross leader when nobody has strokes", () => {
    expect(rowOf(html, "Matt")).toContain("Leading");
    expect(rowOf(html, "Zach", "Matt")).not.toContain("Leading");
  });
});

describe("ScoreEntryView — 'No scores yet' keys on having a score, not a 0 total", () => {
  it("a net total of 0 still reads as a score (an ace on a stroked hole)", () => {
    const html = renderToStaticMarkup(
      <ScoreEntryView
        gameName="Day 1"
        units={units}
        participants={[{ id: "zach", name: "Zach", color: "#2dd4bf" }]}
        // Gross 1 on a stroked hole → net 0, which the old `total === 0` gate
        // would have mislabelled as "No scores yet".
        values={{ zach: { "2": 1 } }}
        pips={{ zach: new Set(["2"]) }}
        currentHole={1}
        onChange={() => {}}
      />
    );
    expect(html).toContain("0 net");
    expect(html).not.toContain("No scores yet");
  });
});
