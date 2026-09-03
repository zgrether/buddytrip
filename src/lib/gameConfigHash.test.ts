import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { resetGameConfigHash, type GameConfigHashUtils } from "./gameConfigHash";

/**
 * Two guards over one invariant: **a write that moves the config fingerprint,
 * outside `save_game_config`, must refresh `games.configHash`.**
 *
 * The reported failure: set a game's points, use the Course row's "search the
 * wider database", get navigated to `/courses/new`, save the course — which
 * applies it to the game with `games.applyCourse` — come back, finish the
 * settings, Save, and be told "This game changed on another device." That page
 * invalidated `games.getById` (so the new course RENDERED, which is what made the
 * message read as a lie) but never the fingerprint, and `staleTime` is 60s, so
 * the remounted page froze its baseline on the pre-course hash.
 *
 * The second test is the one with teeth. It derives BOTH halves — which
 * procedures move the hash, and which client files call them — rather than
 * listing either, so a new writer cannot join quietly. Exceptions are named, in
 * the same spirit as `configHash.coverage.test.ts`'s `NOT_HASHED`.
 */

const ROOT = resolve(__dirname, "..", "..");
const SRC = join(ROOT, "src");

/**
 * Strip comments before asserting over source.
 *
 * Not optional here, and not theoretical: the page this file checks explains
 * #1226 in a doc block that NAMES `games.applyCourse` — so a raw `not.toContain`
 * would fail against the prose describing the very removal it is verifying. The
 * same trap is recorded in `middlewareAuthTimeout.test.ts` ("a source guard that
 * can be satisfied or broken by a comment is not guarding anything") and solved
 * the same way in `originConcat.guard.test.ts`.
 *
 * Blanks rather than deletes, so line/offset-based reasoning elsewhere in a file
 * would still line up.
 */
function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/\/\/[^\n]*/g, blank);
}

// ── the helper itself ───────────────────────────────────────────────────────

describe("resetGameConfigHash", () => {
  it("resets the hash for exactly this game", () => {
    const calls: unknown[] = [];
    const utils: GameConfigHashUtils = {
      games: { configHash: { reset: (input) => calls.push(input) } },
    };
    resetGameConfigHash(utils, { tripId: "t1", gameId: "g1" });
    expect(calls).toEqual([{ tripId: "t1", gameId: "g1" }]);
  });

  it("RESETS rather than invalidates — the distinction is the bug", () => {
    // `invalidate` marks the entry stale and leaves the value in place, so a
    // remount renders the stale hash for one round trip — long enough for the
    // next tap to freeze a baseline on it. Only `reset` drops the value. Pin the
    // surface so nobody "simplifies" this into an invalidate.
    const utils = { games: { configHash: { reset: () => undefined } } };
    expect(Object.keys(utils.games.configHash)).toEqual(["reset"]);
  });
});

// ── the derived call-site guard ─────────────────────────────────────────────

/** `games` columns that are NOT in `HASH_COLS.games` — a write touching only
 *  these cannot move the fingerprint. Used to keep the over-approximation below
 *  honest about what it is. */
const UNHASHED_GAME_COLS = [
  "display_order", "scheduled_at", "schedule_item_id", "competition_id", "trip_id", "created_at", "id",
];

/** Every table `readGameConfigHash` folds in besides `games`. */
const HASHED_TABLES = [
  "game_matches", "game_participants", "play_groups", "game_delegates",
  "bracket_entrants", "bracket_entrant_members", "bracket_matches", "pickem_games",
];

/**
 * Names that, when CALLED, refresh the fingerprint: `resetGameConfigHash` plus
 * every `src/lib` helper that calls it. Derived, not listed — `GameRulesSheet`
 * refreshes the hash through `invalidateGameRulesQueries`, and a file-granular
 * substring check cannot see through one level of import.
 */
function hashRefreshingFunctions(): string[] {
  const names = ["resetGameConfigHash"];
  const lib = join(SRC, "lib");
  for (const f of readdirSync(lib).filter((f) => f.endsWith(".ts") && !f.includes(".test."))) {
    const source = readFileSync(join(lib, f), "utf8");
    if (!/resetGameConfigHash\s*\(\s*[A-Za-z]/.test(source)) continue;
    for (const m of source.matchAll(/^export function ([A-Za-z][A-Za-z0-9_]*)/gm)) names.push(m[1]);
  }
  return [...new Set(names)];
}

/**
 * Does this file actually REFRESH the hash — a call, not a mention?
 *
 * This was `/configHash/i.test(source)`, and it was decorative: deleting the
 * `resetGameConfigHash(...)` call from both fixed files left their IMPORT line
 * behind, the regex matched that, and the guard stayed green through the exact
 * regression it was written for. Both mutants passed. An import is not a
 * refresh; require the parentheses.
 */
function refreshesHash(source: string, refreshers = hashRefreshingFunctions()): boolean {
  if (/configHash\.(reset|invalidate|refetch)\s*\(/.test(source)) return true;
  return refreshers.some((n) => new RegExp(`\\b${n}\\s*\\(\\s*[A-Za-z]`).test(source));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e) && !e.includes(".test.")) out.push(full);
  }
  return out;
}

/** Split a router file into `name: authedProcedure …` chunks. */
function procedures(source: string): Array<[string, string]> {
  const heads = [...source.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*): (?:authed|public)Procedure/gm)];
  return heads.map((h, i) => [
    h[1],
    source.slice(h.index!, i + 1 < heads.length ? heads[i + 1].index! : source.length),
  ]);
}

/** Procedures that write something the fingerprint covers, `save_game_config` aside. */
function hashMovingProcedures(): Set<string> {
  const movers = new Set<string>();
  const routers = join(SRC, "server", "routers");
  for (const file of readdirSync(routers).filter((f) => f.endsWith(".ts") && !f.includes(".test."))) {
    const router = file.replace(/\.ts$/, "");
    for (const [name, body] of procedures(readFileSync(join(routers, file), "utf8"))) {
      // Skip only a procedure that CALLS the RPC — not one that merely names it
      // in a comment. `body.includes("save_game_config")` was the first version,
      // and it silently excluded `applyCourse` and `setBackNine`, whose comments
      // say "…so an applied course and a drafted one can't drift." Those are the
      // two writers this whole file exists for, and the guard could not see
      // them: a textual exclusion matching prose instead of a call.
      if (/\.rpc\("save_game_config"/.test(body)) continue;
      const writesGameRow = /\.from\("games"\)[\s\S]{0,400}?\.(update|upsert)\(/.test(body);
      const writesHashedTable = HASHED_TABLES.some((t) =>
        new RegExp(`\\.from\\("${t}"\\)[\\s\\S]{0,400}?\\.(insert|delete|update|upsert)\\(`).test(body)
      );
      const writesViaRpc = /\.rpc\("(set_pickem|save_pickem|reset_|apply_)/.test(body);
      if (writesGameRow || writesHashedTable || writesViaRpc) movers.add(`${router}.${name}`);
    }
  }
  return movers;
}

/**
 * Client files that call a hash-moving mutation and do NOT refresh the hash.
 *
 * These are not all bugs — most are unreachable while a settings draft is frozen
 * (a score entry, a board reorder, a bracket pick). They are listed so the set
 * cannot GROW without someone deciding, which is the only part a test can hold.
 * The two that were reachable are fixed and deliberately absent:
 *
 *   • `src/app/courses/new/page.tsx`  — navigates away from an open settings
 *     draft and applies a course to the game (the reported bug)
 *   • `src/components/games/GameDangerZone.tsx` — lives ON the settings page and
 *     resets status / scoring / the whole match structure
 *
 * Adding a file here is a claim that no settings draft can be frozen when it
 * writes. Removing one means it now refreshes the hash.
 *
 * CAVEAT, stated because it is a real limit and not a rounding error: the
 * predicate is FILE-granular, so one call site's hash refresh vouches for every
 * other writer in the same file. CLAUDE.md's sweep-unit rule says the unit is the
 * smallest thing that can independently fail, and a file is not it. Making this
 * call-granular needs the mutation's `onSuccess` body, which is a bigger parse
 * than this guard earns today — so it catches a whole file that forgets, not a
 * second writer added beside one that remembers.
 */
const NO_HASH_REFRESH_ALLOWED = [
  "src/app/trips/[tripId]/tabs/ScheduleTab.tsx",
  "src/components/competition/CompetitionGamesPanel.tsx",
  "src/components/competition/CompetitionLeaderboard.tsx",
  "src/components/competition/CompetitionSettingsModal.tsx",
  "src/components/games/NonGolfGameView.tsx",
  // Its movers are `pickem.setPhase` / `setDeadline` / `setResult`, which write
  // `pickem_games`'s CLOCK columns and `pickem_slate_games` — neither hashed
  // (`HASH_COLS.pickem_games` is the two scoring settings only; the clock is the
  // game's state, not its config). The detector flags any write to a hashed
  // TABLE, which over-approximates here. Its settings save is `useConfigDraft`,
  // which refetches the hash itself.
  "src/components/games/PickemGameView.tsx",
  // `startRack` — the NEW-GAME path: create the game, then apply the picked
  // course to it. No settings draft can be frozen against a game that did not
  // exist a moment ago. (`MatchGameView` does the same thing in `handleCreate`
  // and is not listed only because it happens to mention `configHash` elsewhere,
  // for `matches.addMatch` — file granularity letting one call site vouch for
  // another. Noted rather than papered over; see the caveat above.)
  "src/components/games/RackGameView.tsx",
  // `playGroups.setFoursomes`, called on Start to seed the mandatory default
  // grouping for a game being created — the same new-game exemption as rack.
  "src/components/games/StrokeGameView.tsx",
  "src/components/games/bracket/BracketScoringSurface.tsx",
  "src/components/games/course/CourseRowContent.tsx",
  "src/hooks/useGameCorrection.ts",
  "src/hooks/useGameFinalize.ts",
  "src/hooks/useScoreSaver.ts",
];

describe("every client writer of hashed state refreshes games.configHash", () => {
  const movers = hashMovingProcedures();

  it("derives a real set of hash-moving procedures (the scan is not empty)", () => {
    // "Absence of matches is absence of search": an extractor that found nothing
    // would make the coverage assertion below pass vacuously. Anchor it on the
    // writer that caused the bug and on two structurally different others.
    expect(movers.has("games.applyCourse")).toBe(true);
    expect(movers.has("games.resetToSkeleton")).toBe(true);
    expect(movers.has("matches.setPairings")).toBe(true);
    expect(movers.size).toBeGreaterThan(10);
    // And it must NOT sweep in the settings save itself, which owns the hash.
    expect(movers.has("games.saveConfig")).toBe(false);
  });

  it("flags no client writer outside the named exceptions", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.includes(`${join("src", "server")}`) || file.includes("/server/")) continue;
      const source = readFileSync(file, "utf8");
      const calls = [...movers].filter((m) =>
        new RegExp(`trpc\\.${m.replace(".", "\\.")}\\.useMutation`).test(source)
      );
      if (calls.length === 0) continue;
      if (refreshesHash(source)) continue;
      offenders.push(relative(ROOT, file).split("\\").join("/"));
    }
    expect(offenders.sort()).toEqual([...NO_HASH_REFRESH_ALLOWED].sort());
  });

  it("keeps the reachable writer OUT of the exception list", () => {
    // Named separately from the derived check: that one would also go quiet if
    // the detector stopped seeing this file at all, and a silent guard is how
    // this class of bug survives.
    //
    // ONE file, not two. `src/app/courses/new/page.tsx` was the other, and #1226
    // removed its reason to be here rather than fixing it again — see the case
    // below.
    const fixed = "src/components/games/GameDangerZone.tsx";
    expect(NO_HASH_REFRESH_ALLOWED).not.toContain(fixed);
    // `refreshesHash`, not `toContain` — see its note: the import alone
    // satisfied a substring check and both mutants passed.
    expect(refreshesHash(readFileSync(join(ROOT, fixed), "utf8"))).toBe(true);
  });

  it("`/courses/new` no longer writes the GAME at all — the #1226 invariant", () => {
    /**
     * The stronger replacement for what this file used to assert about that
     * page, and the reason the assertion changed shape rather than being
     * deleted.
     *
     * #1227 made `/courses/new` refresh the hash after applying a course. That
     * fixed the spurious CONFLICT and left the second bug standing: the write
     * still moved the fingerprint, so `draftOutboxRecover` found `stored.base`
     * no longer matching and threw the settings draft away, silently (#1226).
     *
     * The fix is that the page no longer applies anything — it creates the
     * global course and hands it back for the settings draft to stage. So the
     * property worth pinning is not "it refreshes the hash" but "it has nothing
     * to refresh": no `games.*` mutation on this page means no fingerprint move,
     * which is what makes the draft survive the round trip.
     *
     * Asserted over the SOURCE because the page is a client component that
     * cannot be rendered in this `node` environment, and stated as an absence of
     * the two specific movers rather than a general "no mutations" — the page
     * legitimately calls `courses.create`, whose table is not hashed.
     */
    const source = readFileSync(join(ROOT, "src/app/courses/new/page.tsx"), "utf8");
    const code = stripComments(source);

    // The two writes that moved the hash, gone.
    expect(code).not.toContain("games.applyCourse");
    expect(code).not.toContain("games.setBackNine");
    // The library write it legitimately keeps — asserted so this case fails if
    // someone gutted the page rather than changing what it writes, which would
    // satisfy the two checks above for the wrong reason.
    expect(code).toContain("courses.create");
    // And the hand-off it replaced them with.
    expect(code).toContain("pendingCoursePut");

    // It follows that the derived guard above must NOT be listing this file as
    // an offender: with no mover called, it drops out of that scan entirely.
    expect(NO_HASH_REFRESH_ALLOWED).not.toContain("src/app/courses/new/page.tsx");
  });

  it("names only real, currently-unhashed game columns as unhashed", () => {
    // Keeps the comment above honest: if one of these is ever added to
    // HASH_COLS.games, the over-approximation note here is wrong.
    const hashCols = readFileSync(join(SRC, "server", "routers", "games.ts"), "utf8");
    const line = /const GAME_CONFIG_COLS\s*=\s*\n?\s*"([^"]+)"/.exec(hashCols)?.[1] ?? "";
    expect(line.length).toBeGreaterThan(0);
    const hashed = new Set(line.split(",").map((c) => c.trim()));
    expect(UNHASHED_GAME_COLS.filter((c) => hashed.has(c))).toEqual([]);
  });
});
