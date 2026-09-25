import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * SOURCE GUARD — outcome mode reconciles with the server (#1437).
 *
 * The bug was a WIRING gap, not a logic one: `useOutcomeSaver` returned a
 * `reconcile` and `MatchGameView` never took it, so a tapped hole overrode the
 * server for the life of the view and two phones that scored it differently
 * stayed apart indefinitely. The merge and the notice are tested purely
 * (`outcomeReconcile.test.ts`); this pins the part a pure test cannot see.
 *
 * A source check, deliberately and stated: this suite runs in `node` with no
 * renderer, so the view cannot be mounted. Each assertion is one the fix needs
 * and the bug lacked — proven by the mutation harness in the PR (removing the
 * effect, the destructure, the data guard, or the grace window each fails one).
 */

const VIEW = readFileSync(resolve(__dirname, "MatchGameView.tsx"), "utf8");
const HOOK = readFileSync(resolve(__dirname, "../../hooks/useOutcomeSaver.ts"), "utf8");

describe("MatchGameView wires outcome mode's reconcile", () => {
  it("takes the saver's reconcile — the destructure that stopped at retryCell", () => {
    expect(VIEW).toMatch(/reconcile:\s*reconcileOutcome,[\s\S]*?\}\s*=\s*useOutcomeSaver\(/);
  });

  it("calls it on the server snapshot, from an effect, guarded on the DATA having loaded", () => {
    // Guarded on data: `loadedOutcomeValues` is {} before the first fetch, and
    // reconciling against that would read as every hole being cleared.
    const effect = VIEW.match(/useEffect\(\(\) => \{\n\s*if \(!gameId \|\| !outcomesQ\.data\) return;\n\s*reconcileOutcome\(loadedOutcomeValues\);/);
    expect(effect, "no guarded effect calling reconcileOutcome(loadedOutcomeValues)").not.toBeNull();
  });

  it("hands the saver the overwrite callback, so a changed entry is announced", () => {
    // The exact call: a pattern over `[^)]*` cannot cross the `()` inside it.
    expect(VIEW).toContain("useOutcomeSaver(tripId, gameId, () => void outcomesQ.refetch(), onOutcomeOverwritten)");
  });
});

describe("useOutcomeSaver protects a just-confirmed hole, as useScoreSaver does", () => {
  it("adds confirmed holes to protectedKeys for CONFIRM_GRACE_MS", () => {
    // Without it, a response already in flight when the write landed would
    // revert the tap — and raise a false "changed" notice.
    expect(HOOK).toMatch(/if \(now - at < CONFIRM_GRACE_MS\) protectedKeys\.add\(k\);/);
    expect(HOOK).toMatch(/confirmedAtRef\.current\.set\(key, Date\.now\(\)\);/);
  });
});
