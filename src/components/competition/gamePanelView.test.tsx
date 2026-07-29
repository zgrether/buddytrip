import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gamePanelView } from "./gamePanelView";
import { opensAsPanel } from "@/lib/gameRoutes";
import { MatchGameView } from "@/components/games/MatchGameView";
import { RackGameView } from "@/components/games/RackGameView";
import { NonGolfGameView } from "@/components/games/NonGolfGameView";
import { StrokeGameView } from "@/components/games/StrokeGameView";

/**
 * #744 — the board's game pane must not survive a `?game=` swap.
 *
 * ── What these tests assert, and what they do not ───────────────────────────
 * React's reconciliation rule is: an element at the SAME position with the SAME
 * `type` and the SAME `key` is the same instance and re-renders; change either and
 * React unmounts and mounts fresh. So `type` and `key` ARE the decision inputs,
 * and that is what is asserted here — on real elements from React's own factory.
 *
 * This is not an observed remount. It can't be: the repo has no DOM and no
 * reconciliation-capable renderer (no jsdom, happy-dom, @testing-library/react or
 * react-test-renderer — checked), and the component tests that exist go through
 * `renderToStaticMarkup`, which does not reconcile. Adding a renderer to prove one
 * assertion was judged worse than testing the inputs precisely and saying so.
 * `Zach's device check` on the PR is what closes the last gap.
 */

const ALL_PANEL_FORMATS = [
  "gtt_match_play",
  "gtt_rack_n_stack",
  "gtt_stroke_play",
  "gtt_manual",
  "gtt_generic_card",
] as const;

const GAME_A = "11111111-2222-4333-8444-555555555555";
const GAME_B = "99999999-8888-4777-8666-555555555555";

// ── The regression ──────────────────────────────────────────────────────────
// THIS IS THE ONE THAT FAILS ON `main`. Before the fix every branch returned an
// UNKEYED element, so `key` was null for both games: same position, same type,
// same (null) key → React reused the instance, `MatchGameView`'s mount-captured
// `gameId` never moved, and the pane kept rendering — and writing to — game A.
describe("a same-format swap produces a DIFFERENT key (React remounts)", () => {
  it.each(["gtt_match_play", "gtt_rack_n_stack", "gtt_stroke_play", "gtt_manual"])(
    "%s: game A and game B do not share a key",
    (format) => {
      const a = gamePanelView(format, GAME_A);
      const b = gamePanelView(format, GAME_B);
      expect(a.type).toBe(b.type); // same format ⇒ same component…
      expect(a.key).not.toBe(b.key); // …so ONLY the key can force the remount
      expect(a.key).toBe(GAME_A);
      expect(b.key).toBe(GAME_B);
    },
  );

  it("re-selecting the SAME game keeps the same key (no gratuitous remount)", () => {
    const first = gamePanelView("gtt_match_play", GAME_A);
    const second = gamePanelView("gtt_match_play", GAME_A);
    expect(first.type).toBe(second.type);
    expect(first.key).toBe(second.key);
  });
});

// ── The format boundary, pinned in BOTH directions ──────────────────────────
// Cross-format swaps already remounted before this fix, because the branch returns
// a different component and React never reuses an instance across types. That is
// why only match→match and rack→rack ever reproduced #744. Pinned so that
// collapsing these branches into something type-uniform later — a lookup table
// returning one wrapper, say — can't silently reintroduce the bug by making every
// format share a type.
describe("format boundary", () => {
  it("each format maps to its OWN component type", () => {
    expect(gamePanelView("gtt_match_play", GAME_A).type).toBe(MatchGameView);
    expect(gamePanelView("gtt_rack_n_stack", GAME_A).type).toBe(RackGameView);
    expect(gamePanelView("gtt_stroke_play", GAME_A).type).toBe(StrokeGameView);
    expect(gamePanelView("gtt_manual", GAME_A).type).toBe(NonGolfGameView);
  });

  it("a cross-format swap changes the type — it remounted even before the key", () => {
    const match = gamePanelView("gtt_match_play", GAME_A);
    const rack = gamePanelView("gtt_rack_n_stack", GAME_B);
    expect(match.type).not.toBe(rack.type);
  });

  it("the four types are mutually distinct (no two formats share an instance)", () => {
    const types = ["gtt_match_play", "gtt_rack_n_stack", "gtt_stroke_play", "gtt_manual"].map(
      (f) => gamePanelView(f, GAME_A).type,
    );
    expect(new Set(types).size).toBe(4);
  });
});

// ── The class guard ─────────────────────────────────────────────────────────
// The analogous guard to `TripIdProvider.test.ts`'s "don't read useParams().tripId"
// — but pointed at the invariant that actually holds this closed.
//
// NB a literal ban on `search.get("game")` inside the views would be the WRONG
// guard here and would fail on the two files this fix deliberately does not touch:
// `MatchGameView` and `RackGameView` still capture the id at mount, and under a
// keyed panel that is SAFE, because the key guarantees a fresh mount. Reading the
// param is not the hazard; mounting a view for a new game without a new key is.
// So the guard is: every format the panel can open comes back KEYED.
describe("class guard — no panel-hosted view may mount unkeyed", () => {
  it.each(ALL_PANEL_FORMATS)("%s returns a keyed element", (format) => {
    // Guard the premise: these are the formats the panel host actually opens.
    expect(opensAsPanel(format)).toBe(true);
    const el = gamePanelView(format, GAME_A);
    expect(el.key).toBe(GAME_A);
    expect(el.key).not.toBeNull();
  });

  /**
   * A future format added to `opensAsPanel` but not to `gamePanelView` falls
   * through to the non-golf branch, which IS keyed — so it can't reintroduce #744.
   * This asserts the fall-through stays keyed rather than asserting the (correct)
   * fact that an unknown golf format would render the wrong view; that is
   * `opensAsPanel`'s allowlist job, covered in `gameRoutes.test.ts`.
   */
  it("the fall-through branch is keyed too", () => {
    expect(gamePanelView("gtt_some_future_format", GAME_A).key).toBe(GAME_A);
  });

  it("CompetitionFace routes the panel through gamePanelView, not its own ternary", () => {
    // If someone re-inlines the branch selection into the host, the keying comment
    // and this module's rationale stop being reachable from the call site.
    const src = readFileSync(resolve(__dirname, "CompetitionFace.tsx"), "utf8");
    expect(src).toContain("gamePanelView(openType, openGameId)");
    expect(src).not.toMatch(/<MatchGameView\s*\/>/);
    expect(src).not.toMatch(/<RackGameView\s*\/>/);
  });
});
