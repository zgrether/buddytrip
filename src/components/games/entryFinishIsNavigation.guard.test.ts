import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * SOURCE GUARD — a scoring surface's "Finish" is NAVIGATION, never a finalize.
 *
 * ── The incident ───────────────────────────────────────────────────────────
 *
 * `SkinsGameView` passed `onFinish={() => void finalize()}` to its entry view.
 * A skins game is several independent contests, so the first grouping to reach
 * hole 18 POSTED THE WHOLE GAME — every other group was locked out mid-round by
 * somebody else's card.
 *
 * The general form, which is why this is a guard and not a fixed line: **an
 * entry surface knows about ONE unit of play** — a grouping, a foursome, a match
 * — so it cannot be the thing that decides a whole game is over. That decision
 * belongs to the board, where `GameLifecycleActions` reads a completeness signal
 * computed across every unit.
 *
 * Rack says exactly this in a comment beside its own call site, and rack, stroke
 * and match all already pass a back-handler. Skins was the one that did not, and
 * a comment on somebody else's line could not stop it.
 *
 * ── Why a source scan ──────────────────────────────────────────────────────
 *
 * The suite is `environment: "node"`, so these components render but cannot be
 * clicked — a render test would assert that a button exists, which is true of
 * the broken build too. What is wrong here is WHICH HANDLER IS PASSED, and that
 * is only visible in the source.
 *
 * ── Scoped to the ELEMENT, deliberately ────────────────────────────────────
 *
 * Matching every `onFinish=` in a file would flag `MatchGameView`'s
 * `MatchesScoreboard`, whose `onFinish={handleFinish}` IS the game-level
 * finalize and is correct. The sibling guard in `oneSettingsPage.test.ts` learned
 * this the noisy way — its first version reported a legitimate handler as a
 * failure — so this one starts scoped to the entry components by name.
 */

const ROOT = join(process.cwd(), "src");

/** The components that render ONE unit of play's score entry. A new one gets
 *  added here; that list is the maintenance cost and it is the point. */
const ENTRY_COMPONENTS = [
  "ScoreEntryView",
  "MatchEntryView",
  "MatchOutcomeEntryView",
  "SkinsEntryView",
];

/**
 * The views that host them. Quick Play is deliberately absent: it is a single
 * local card with no groupings and no competition, so its Finish genuinely does
 * end the round.
 */
const VIEWS = [
  "components/games/MatchGameView.tsx",
  "components/games/RackGameView.tsx",
  "components/games/StrokeGameView.tsx",
  "components/games/skins/SkinsGameView.tsx",
];

/** Every `<Component … />` element in `src`, as raw text. */
function elementsOf(src: string, component: string): string[] {
  const re = new RegExp(`<${component}\\b[\\s\\S]*?/>`, "g");
  return [...src.matchAll(re)].map((m) => m[0]);
}

function onFinishHandlers(el: string): string[] {
  // Balanced enough for these call sites: the handlers are an identifier or a
  // short arrow, never a nested-brace block.
  return [...el.matchAll(/onFinish=\{([^}]*)\}/g)].map((m) => m[1].trim());
}

describe("a scoring surface's Finish returns to the board", () => {
  it.each(VIEWS)("%s passes no finalize to an entry view", (rel) => {
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const component of ENTRY_COMPONENTS) {
      for (const el of elementsOf(src, component)) {
        for (const handler of onFinishHandlers(el)) {
          expect(
            /finalize|games\.finish|handleFinish/.test(handler),
            `${rel}: <${component} onFinish={${handler}}> — an entry surface sees ONE ` +
              `unit of play, so finishing a card must NAVIGATE, not post the game. ` +
              `The board's GameLifecycleActions owns that, gated on every unit being done.`,
          ).toBe(false);
        }
      }
    }
  });

  it("the scan is looking at real call sites (not passing vacuously)", () => {
    /**
     * Without this the suite would pass just as happily against a renamed
     * component or a moved file: zero offenders and zero elements is the same
     * green as zero offenders and five elements. "Absence of matches is absence
     * of search."
     */
    let found = 0;
    for (const rel of VIEWS) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      for (const component of ENTRY_COMPONENTS) {
        for (const el of elementsOf(src, component)) {
          if (onFinishHandlers(el).length > 0) found += 1;
        }
      }
    }
    expect(found, "no entry element with an onFinish was found at all").toBeGreaterThanOrEqual(4);
  });

  it("the matcher can SEE a finalize — fed the broken line, it reports it", () => {
    // The other half of the same discipline: prove the predicate is capable of a
    // red result before trusting a green one. This is the exact string skins
    // shipped.
    const broken = `<SkinsEntryView\n  units={u}\n  onFinish={() => void finalize()}\n/>`;
    const handlers = elementsOf(broken, "SkinsEntryView").flatMap(onFinishHandlers);
    expect(handlers).toHaveLength(1);
    expect(/finalize|games\.finish|handleFinish/.test(handlers[0])).toBe(true);
  });
});
