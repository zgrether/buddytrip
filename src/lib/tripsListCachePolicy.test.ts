import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Source guard — the cache policy on `trips.list` (#764).
 *
 * `trips.list` is read from three call sites and every one of them resolves to
 * the SAME React Query key: the input is `undefined` everywhere, and tRPC omits
 * an undefined input from the key (`getQueryKeyInternal`). So there is ONE
 * query, and the effective freshness of that query is set by whichever mounted
 * observer has the shortest `staleTime` — which means a policy added at one
 * site silently changes behaviour at all the others, and WHICH policy wins
 * depends on the route the user happens to be on.
 *
 * That is the shape F4 found on `competitions.leaderboard`: standings froze
 * while presenting as live, because on some routes the `staleTime: Infinity`
 * observer was the only one mounted. `queryConfig.ts` names the hazard and asks
 * for a grep of every other call site before spreading a policy — this test is
 * that grep, run on every push instead of remembered.
 *
 * THE RULE IT PINS: exactly one call site (`ContextRail`) may set a cache
 * policy on this key. Everything else inherits the global defaults, and the
 * dashboard's inherited 60s is specifically what refreshes the shared cache
 * inside a session (see the note at its call site). A second policy appearing
 * anywhere is the thing that breaks, so a second policy is what fails here.
 *
 * A comment could not enforce this — CLAUDE.md #22 is the same lesson from the
 * chat subscription: an invariant asserted in prose stops being true the moment
 * the shell restructures and nobody re-reads the prose.
 */

const SRC = join(process.cwd(), "src");

/** The ONE site allowed to override. Adding to this list is the decision this
 *  test exists to make deliberate — it is not a formality. */
const POLICY_OWNERS = ["src/components/shell/ContextRail.tsx"];

/** Options that change WHEN the shared query refetches. `enabled` is absent on
 *  purpose: it gates whether an observer fires at all, which is per-site and
 *  legitimately varies (the switcher and the feedback modal are both gated on
 *  `open`). It does not change the cache policy the other observers see. */
const CACHE_POLICY_OPTIONS = [
  "staleTime",
  "gcTime",
  "refetchInterval",
  "refetchOnMount",
  "refetchOnWindowFocus",
  "refetchOnReconnect",
  "STRUCTURE_QUERY",
  "LEADERBOARD_QUERY",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** The options object passed to a `trips.list.useQuery(...)` call, if any.
 *  Brace-matched rather than regex-captured so a nested object in the options
 *  (or a `useQuery()` with no arguments at all) doesn't truncate the slice. */
function optionsArgFor(source: string, callIndex: number): string | null {
  const open = source.indexOf("(", callIndex);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

describe("trips.list cache policy", () => {
  const files = walk(SRC);
  const callSites = files
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => source.includes("trips.list.useQuery"));

  it("finds the call sites (the guard is not silently passing on zero)", () => {
    // If a refactor renames the procedure or the call shape, this fails LOUDLY
    // rather than the guard below vacuously passing over an empty set — the
    // failure mode CLAUDE.md #16's swallowed-error landmine is made of.
    //
    // Was 4 when this guard landed (#814), lowered to 3 by #812: `TripSwitcher`
    // was deleted as unreachable, and `TopNav`'s query went with it (it existed
    // only to resolve the switcher's current trip). Lower this ONLY alongside a
    // deliberate removal — a drop you didn't intend is the signal.
    expect(callSites.length).toBeGreaterThanOrEqual(3);
  });

  it("has exactly one site setting a cache policy on the shared key", () => {
    const offenders: string[] = [];

    for (const { file, source } of callSites) {
      const rel = file.slice(process.cwd().length + 1).replace(/\\/g, "/");
      if (POLICY_OWNERS.includes(rel)) continue;

      let idx = source.indexOf("trips.list.useQuery");
      while (idx !== -1) {
        const args = optionsArgFor(source, idx + "trips.list.useQuery".length);
        const found = CACHE_POLICY_OPTIONS.filter((opt) =>
          new RegExp(`\\b${opt}\\b`).test(args ?? "")
        );
        if (found.length > 0) offenders.push(`${rel} → ${found.join(", ")}`);
        idx = source.indexOf("trips.list.useQuery", idx + 1);
      }
    }

    expect(
      offenders,
      "A second cache policy on `trips.list` changes freshness at every other " +
        "call site, and which policy wins depends on the route. If this is " +
        "intended, add the file to POLICY_OWNERS and document the split at " +
        "BOTH sites — see ContextRail and DashboardClient."
    ).toEqual([]);
  });

  it("keeps ContextRail's documented override in place", () => {
    // The other half of the pair: if the rail's override is removed, the
    // explanation at DashboardClient describing why the two differ becomes a
    // lie, and this test should be revisited rather than left asserting a
    // split that no longer exists.
    const rail = readFileSync(join(SRC, "components/shell/ContextRail.tsx"), "utf8");
    expect(rail).toContain("STRUCTURE_QUERY");
  });
});
