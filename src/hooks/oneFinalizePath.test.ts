import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";

/**
 * `games.finish` is called from ONE place, and its aftermath lives with it.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * Four hand-written finalize handlers. Each called the mutation and then redid
 * the same four steps: flip the cache to locked, refresh its own reads,
 * invalidate the three board queries, leave. They had already drifted:
 *
 *   match     refetched three queries and AWAITED them, where the others
 *             invalidated one and did not
 *   rack      no retry policy
 *   stroke    retry: 4 with backoff
 *   non-golf  no retry, and no self-refresh at all — it relied on the
 *             optimistic `markLocked` and never revalidated its own row
 *
 * None of that was decided per format; it is where four copies ended up.
 *
 * ── Why the mutation call is what's guarded ─────────────────────────────────
 * Guarding the aftermath directly would mean listing its steps here, and a list
 * of steps in a test is the same maintenance problem as a list of steps in four
 * views. Guarding the CALL is stronger and needs no list: if `games.finish` can
 * only be invoked from `useGameFinalize`, the aftermath cannot be reimplemented
 * somewhere else, because there is nowhere else the finalize happens.
 */

const SRC = resolve(__dirname, "..");
const SCANNED = ["components", "hooks", "app"];

/** The one module allowed to call it. */
const OWNER = "useGameFinalize.ts";

/** `trpc.games.finish.useMutation(` — the call, in any formatting. */
const FINISH_MUTATION = /games\s*\.\s*finish\s*\.\s*useMutation/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const ALL = SCANNED.flatMap((d) => sourceFiles(join(SRC, d)));

describe("one finalize path", () => {
  it("only useGameFinalize calls games.finish", () => {
    const callers = ALL.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src
        .split("\n")
        .some((l) => {
          const t = l.trim();
          if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
          return FINISH_MUTATION.test(l);
        });
    }).map((f) => f.split(/[\\/]/).pop()!);

    expect(
      callers,
      "Finalize through `useGameFinalize`. It owns the aftermath — the " +
        "optimistic lock, the self-refresh, the three board invalidations " +
        "(faceBootstrap included, per CLAUDE.md #10), the exit, and the retry " +
        "policy. A second call site means a second copy of that list, which is " +
        "how non-golf ended up without a self-refresh and rack without a retry.",
    ).toEqual([OWNER]);
  });

  it("every game surface leaves through useExitToBoard", () => {
    /**
     * The guard above targets the mutation CALL, deliberately — it proves there
     * is one finalize and one aftermath. It cannot prove that what each caller
     * PASSES to that aftermath agrees, and #808 is exactly that gap:
     * `useGameFinalize` takes `onExit` as a parameter, three formats passed
     * `exitToBoard`, and non-golf passed a bare `router.back()` for two phases
     * after the hook existed. A shared pipeline with a per-format argument is
     * CLAUDE.md #24's first shape — inputs diverging under a shared output —
     * and finalizing from a cold push-notification deep-link ejected you out of
     * the app, because there was no `?game=` entry to pop.
     *
     * Scoped to the game SURFACES (the files publishing chrome), the same
     * derivation `oneGameHeader.test.ts` uses, so a fifth format is in scope
     * automatically rather than by being added to a list here.
     */
    const surfaces = ALL.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes("useGameSurfaceChrome") && !f.endsWith("GameChrome.tsx");
    });
    expect(surfaces.length, "the surface scan found nothing — did the hook get renamed?")
      .toBeGreaterThanOrEqual(4);

    const offenders = surfaces
      .filter((f) => !readFileSync(f, "utf8").includes("useExitToBoard"))
      .map((f) => f.split(/[\\/]/).pop()!);

    expect(
      offenders,
      "Leave a finished game through `useExitToBoard`. A bare `router.back()` " +
        "is only the inverse of a PANEL open; on a standalone route or a cold " +
        "deep-link there is no entry to pop and it exits the app (#808).",
    ).toEqual([]);
  });

  it("the scan sees the owner (not passing vacuously)", () => {
    // A regex that stops matching would make the test above pass with an empty
    // list forever. Assert the one legitimate caller is actually found.
    expect(ALL.length).toBeGreaterThan(50);
    expect(ALL.some((f) => f.endsWith(OWNER))).toBe(true);
    const ownerSrc = readFileSync(ALL.find((f) => f.endsWith(OWNER))!, "utf8");
    expect(FINISH_MUTATION.test(ownerSrc)).toBe(true);
  });
});
