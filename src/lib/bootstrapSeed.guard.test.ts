import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { BOOTSTRAP_SEEDED_KEYS } from "./bootstrapSeed";

/**
 * SOURCE GUARDS for #1405's C: bootstrap-seeded caches, and snapshot restores.
 *
 * 1. The seeded-key list is READ from `LiveFaceClient.tsx`, not transcribed. A
 *    key added to the seed without being added here would leave its optimistic
 *    writers unguarded, so the two must agree exactly.
 * 2. Every MUTATION that optimistically writes a seeded key cancels the
 *    bootstrap first. The unit is the mutation block, not the file: a file can
 *    hold one writer that cancels and one that does not (the auth-stall lesson,
 *    CLAUDE.md "measure the thing").
 * 3. The roster, schedule and trip-member writers do not restore a snapshot on
 *    error (#1405, CLAUDE.md #1): a restored snapshot discards a concurrent
 *    sibling's committed write.
 *
 * Source greps, deliberately: the properties are about the SHAPE of every
 * writer, including ones a runtime test would never exercise.
 */

const SRC = resolve(__dirname, "..");
const LIVE_FACE = "components/competition/LiveFaceClient.tsx";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(SRC, p).split("\\").join("/");
const FILES = walk(SRC);

/** The seed's own keys, from `utils.<a>.<b>.setData(` in LiveFaceClient. */
function seededKeysInLiveFace(src: string): string[] {
  const keys = new Set<string>();
  for (const m of src.matchAll(/utils\.(\w+)\.(\w+)\.setData\(/g)) keys.add(`${m[1]}.${m[2]}`);
  return [...keys].sort();
}

/**
 * The balanced-paren block that starts at `open` (the index of a `(`). Counts
 * parens only; good enough for these files, and the "found N blocks" assertions
 * below would expose a parse that went wrong.
 */
function blockFrom(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/** Every optimistic-writer block: a `useMutation(...)` or the roster policy. */
function writerBlocks(src: string): string[] {
  const blocks: string[] = [];
  for (const m of src.matchAll(/(?:useMutation|createRosterMutations)\(/g)) {
    blocks.push(blockFrom(src, m.index! + m[0].length - 1));
  }
  return blocks;
}

const writesSeeded = (block: string) =>
  BOOTSTRAP_SEEDED_KEYS.some((k) => block.includes(`${k}.setData(`));
const cancelsBootstrap = (block: string) =>
  /cancelBootstrapSeed\(|cancelRosterWriters\(|faceBootstrap\.cancel\(/.test(block);

/** The restore idiom: `setData(<key>, ctx.prev)` / `context.previous` / `ctxRollback.previous`. */
const RESTORE = /\.setData\([^;]*?,\s*(?:ctx|context|ctxRollback)\??\.[A-Za-z]+\s*\)/;

describe("bootstrap-seeded caches (#1405 C)", () => {
  it("BOOTSTRAP_SEEDED_KEYS is exactly what LiveFaceClient seeds", () => {
    const live = readFileSync(join(SRC, LIVE_FACE), "utf8");
    const seeded = seededKeysInLiveFace(live);
    expect(seeded.length, "found no seed calls: did LiveFaceClient move?").toBeGreaterThan(0);
    expect(seeded).toEqual([...BOOTSTRAP_SEEDED_KEYS].sort());
  });

  it("every mutation that optimistically writes a seeded cache cancels the bootstrap first", () => {
    const offenders: string[] = [];
    let writers = 0;
    for (const f of FILES) {
      if (rel(f) === LIVE_FACE) continue; // the seed itself
      const src = readFileSync(f, "utf8");
      for (const block of writerBlocks(src)) {
        if (!writesSeeded(block)) continue;
        writers++;
        if (!cancelsBootstrap(block)) offenders.push(`${rel(f)}: ${block.slice(0, 80).replace(/\s+/g, " ")}…`);
      }
    }
    // Today: TeamsPanel's roster policy, ScheduleTab's game link, and the two
    // competition-rename mutations. Fewer means the scan went blind.
    expect(writers, "the scan found fewer seeded writers than exist").toBeGreaterThanOrEqual(4);
    expect(
      offenders,
      "These optimistic writers of a faceBootstrap-seeded cache do not cancel the bootstrap. An " +
        "in-flight bootstrap will land after the write and overwrite it with a stale snapshot. " +
        "Call cancelBootstrapSeed (src/lib/bootstrapSeed.ts) beside the query's own cancel."
    ).toEqual([]);
  });
});

describe("no snapshot restore on the roster, schedule and trip-member writers (#1405)", () => {
  const SCOPE = [
    "components/competition/TeamsPanel.tsx",
    "lib/rosterMutations.ts",
    "app/trips/[tripId]/tabs/ScheduleTab.tsx",
    "app/trips/[tripId]/tabs/components/MemberEditor.tsx",
    "app/trips/[tripId]/tabs/components/TravelControls.tsx",
  ];

  it.each(SCOPE)("%s re-fetches on error instead of restoring a snapshot", (file) => {
    const src = readFileSync(join(SRC, file), "utf8");
    const hit = src.match(RESTORE);
    expect(
      hit?.[0] ?? null,
      `${file} restores a cached snapshot on error. With concurrent mutations the snapshot ` +
        `predates a sibling's committed write and discards it; re-pull server truth instead ` +
        `(CLAUDE.md #1).`
    ).toBeNull();
  });

  /**
   * THE RATCHET (#1514). The idiom survives in 13 other files, deliberately left
   * until after PR 9: no wrong number reaches production (the server holds the
   * truth and the screen corrects on the next refetch) and nothing is lost.
   *
   * This is NOT an exemption list. An exemption is permanent; this has to reach
   * zero. The assertion is EQUALITY with the list, so it fails both ways:
   *  - a 14th file adopts the idiom → it is in the scan and not in the list;
   *  - a listed file is converted → it is in the list and not in the scan, and
   *    the fix is to delete its line. The list can only shrink.
   */
  const RESTORE_DEBT = [
    "app/trips/[tripId]/components/DatesSheet.tsx",
    "app/trips/[tripId]/components/IdeaZonePanel.tsx",
    "app/trips/[tripId]/components/LodgingPanel.tsx",
    "app/trips/[tripId]/components/setup-guide/SetDatesFlipCard.tsx",
    "app/trips/[tripId]/tabs/AddExpenseModal.tsx",
    "app/trips/[tripId]/tabs/EditExpenseModal.tsx",
    "app/trips/[tripId]/tabs/ExpensesSection.tsx",
    "app/trips/[tripId]/tabs/components/DatePollCard.tsx",
    "components/InfoTileModal.tsx",
    "components/competition/CompetitionSettingsModal.tsx",
    "components/competition/CompetitionSetupPanel.tsx",
    "components/profile/PreferencesPanel.tsx",
    "lib/useNotificationPreference.ts",
  ];

  it("RATCHET: the restore idiom appears in exactly the known-debt files, and that list only shrinks (#1514)", () => {
    const restoring = FILES.filter((f) => RESTORE.test(readFileSync(f, "utf8"))).map(rel).sort();
    expect(
      restoring,
      "The set of files restoring a snapshot on error changed. If a file was ADDED, re-fetch on " +
        "error instead (CLAUDE.md #1). If one was CONVERTED, delete its line from RESTORE_DEBT: " +
        "the list only shrinks, and #1514 is done when it is empty."
    ).toEqual([...RESTORE_DEBT].sort());
  });

  it("the ruled scope never re-enters the debt list", () => {
    for (const f of SCOPE) expect(RESTORE_DEBT).not.toContain(f);
  });

  it("the restore pattern matches the idiom it exists to catch (the instrument can go red)", () => {
    // Every real shape the codebase used, so a regex that matches nothing cannot pass.
    expect(RESTORE.test("utils.tripMembers.list.setData({ tripId }, ctx.prev);")).toBe(true);
    expect(RESTORE.test("utils.expenses.list.setData({ tripId }, context.prev);")).toBe(true);
    expect(RESTORE.test("utils.teamAssignments.list.setData(queryKey, ctxRollback.previous);")).toBe(true);
    expect(RESTORE.test("if (ctx?.prevGames) utils.games.listByTrip.setData({ tripId }, ctx.prevGames);")).toBe(true);
    // …and not an ordinary optimistic patch.
    expect(RESTORE.test("utils.schedule.list.setData({ tripId }, (old) => old);")).toBe(false);
  });
});
