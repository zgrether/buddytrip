import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchEntryView, type MatchGroupData } from "./MatchEntryView";
import { NO_GLORIOUS, type GloriousConfig } from "@/lib/gloriousHoles";
import type { ScoreUnit } from "./types";

// Glorious Finishing Holes — the score-entry banner (§8/#571 gate c). A full
// contiguous 18-hole round so `currentHole` (engine position) matches the unit
// index directly. Rendered via react-dom/server (no RTL, matches StandardGrid's
// convention) — the component reads `currentHole` from props (no internal state
// dependency needed for a single static render).

const units: ScoreUnit[] = Array.from({ length: 18 }, (_, i) => ({
  label: String(i + 1),
  section: i < 9 ? "front" : "back",
  par: 4,
}));

const matches: MatchGroupData[] = [
  {
    matchId: "m1",
    label: "Match 1",
    a: { id: "a", name: "Alex", color: "#22c55e" },
    b: { id: "b", name: "Bailey", color: "#f97316" },
    strokesA: 0,
    strokesB: 0,
  },
];

const glor3: GloriousConfig = { enabled: true, n: 3 }; // last 3 → holes 16,17,18

function renderAt(hole: number, glorious: GloriousConfig) {
  return renderToStaticMarkup(
    <MatchEntryView
      gameName="Test Match"
      units={units}
      matches={matches}
      values={{}}
      onChange={() => {}}
      currentHole={hole}
      glorious={glorious}
    />
  );
}

describe("MatchEntryView — Glorious banner (gate c)", () => {
  it("shows the banner on a glorious hole (17, within the last 3)", () => {
    const html = renderAt(17, glor3);
    expect(html).toContain("glorious-entry-banner");
    expect(html).toContain("Glorious Finishing Hole · Worth Double");
  });

  it("hides the banner on a non-glorious hole (12)", () => {
    const html = renderAt(12, glor3);
    expect(html).not.toContain("glorious-entry-banner");
  });

  it("hides the banner everywhere when glorious is off, even on hole 17", () => {
    const html = renderAt(17, NO_GLORIOUS);
    expect(html).not.toContain("glorious-entry-banner");
  });

  it("defaults to NO_GLORIOUS when the prop is omitted (no banner anywhere)", () => {
    const html = renderToStaticMarkup(
      <MatchEntryView gameName="Test Match" units={units} matches={matches} values={{}} onChange={() => {}} currentHole={17} />
    );
    expect(html).not.toContain("glorious-entry-banner");
  });

  it("marks exactly the boundary hole correctly — 15 (raw) vs 16 (glorious) for N=3", () => {
    expect(renderAt(15, glor3)).not.toContain("glorious-entry-banner");
    expect(renderAt(16, glor3)).toContain("glorious-entry-banner");
  });
});

// The keypad's own error line for the cell being entered — the same words as
// `UnsavedScoresBanner` for the same situation (Zach, 2026-10-14). Anchored on
// strings only the KEYPAD emits: the player's name in the line, and the keypad
// Retry's own test id. The banner above it also says "score not synced" and has
// its own Retry, so a bare substring would be satisfied by the wrong element.
describe("MatchEntryView — keypad unsaved-score line", () => {
  const KEY = "a:1"; // scoreCellKey("a", "1") — Alex is the active player on hole 1
  const renderErr = (refusals?: Record<string, string>) =>
    renderToStaticMarkup(
      <MatchEntryView
        gameName="Test Match"
        units={units}
        matches={matches}
        values={{}}
        onChange={() => {}}
        currentHole={1}
        saveStatus={{ [KEY]: "error" }}
        onRetryCell={() => {}}
        refusals={refusals}
      />
    );

  it("a score that can still be sent: \"not synced\", with the keypad's Retry", () => {
    const html = renderErr();
    expect(html).toContain("Alex’s score not synced");
    expect(html).toContain('data-testid="keypad-error-retry"');
  });

  it("a score the server refused: \"wouldn't save\", and no keypad Retry", () => {
    const html = renderErr({ [KEY]: "This round is posted." });
    expect(html).toContain("Alex’s score wouldn’t save");
    expect(html).not.toContain("Alex’s score not synced");
    expect(html).not.toContain('data-testid="keypad-error-retry"');
  });
});
