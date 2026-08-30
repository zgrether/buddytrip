import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PICKEM_ERROR_CODES, PICKEM_ERRORS, pickemError } from "./pickemErrors";

/**
 * THE ROUTER'S ERROR MAP, CHECKED AGAINST WHAT THE MIGRATIONS ACTUALLY RAISE.
 *
 * ── The failure this exists to prevent ─────────────────────────────────────
 *
 * Twice a migration renamed a tagged exception and the router went QUIET
 * instead of loud:
 *
 *   - 166 introduced `DUPLICATE_PICK`, which had no arm, so the new refusal
 *     fell through to "Pick'em save failed: <raw postgres text>" — the raw
 *     payload reaching a person's screen.
 *   - 167 replaced `GAME_FINAL` with `GAME_LOCKED`, leaving an arm pointing at
 *     Reset — the sledgehammer — that could never fire again.
 *
 * Neither failed to compile. Neither failed a test. **A string match that stops
 * matching produces no signal at all**: the arm is still there, still readable,
 * and permanently wrong.
 *
 * TypeScript cannot see either, because the codes live in SQL.
 *
 * ── Why the MIGRATIONS and not the live database ──────────────────────────
 *
 * They are the definition CI replays from zero, so they are the thing that
 * decides what a fresh database raises — and reading them needs no stack, which
 * means this guard runs in every environment rather than only where Docker is
 * up. A guard that skips is a guard that is not there.
 *
 * The parser replays them the way Postgres does: in filename order, LAST
 * definition of a function wins. Without that, a code deleted in 167 would
 * still be "raised" because 159 mentions it, and the stale-arm half of this
 * check would never fire — which is the half that matters most, since it is the
 * one no runtime error can reveal.
 *
 * ── Both directions, because they are different bugs ───────────────────────
 *
 * A code with no arm leaks Postgres text to a person. An arm with no code is a
 * message that can never render, which is worse than useless: it reads as
 * current, and the next author edits it believing somebody sees it. That is
 * exactly what happened to `MATCHES_INCOMPLETE`, kept during the 167 review on
 * the stated grounds that `save_pickem_matches` still raised it — which this
 * check disproves.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** A pick'em function, by the naming the schema actually uses. */
const isPickemFn = (name: string) => name.includes("pickem");

/**
 * Every `RAISE EXCEPTION 'CODE: …'` in the SURVIVING body of each pick'em
 * function, replaying the migrations in order so later definitions win.
 */
function codesRaisedByPickem(): Set<string> {
  const bodies = new Map<string, string>();

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    // Split on each function definition; everything up to the next one is its
    // body. `$function$` / `$$` bodies both appear in this repo, so the split is
    // on the DECLARATION rather than on a dollar-quote.
    const parts = sql.split(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\./i);
    for (const part of parts.slice(1)) {
      const name = part.slice(0, part.indexOf("(")).trim();
      if (!name) continue;
      bodies.set(name, part);
    }
    // A DROP with no matching CREATE later in the file removes it.
    for (const m of sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.(\w+)/gi)) {
      const dropped = m[1];
      const recreated = sql
        .split(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\./i)
        .slice(1)
        .some((p) => p.slice(0, p.indexOf("(")).trim() === dropped);
      if (!recreated) bodies.delete(dropped);
    }
  }

  const codes = new Set<string>();
  for (const [name, body] of bodies) {
    if (!isPickemFn(name)) continue;
    for (const m of body.matchAll(/RAISE\s+EXCEPTION\s+'([A-Z_]+):/g)) codes.add(m[1]);
  }
  return codes;
}

describe("the pick'em error map is exhaustive against the migrations", () => {
  const raised = codesRaisedByPickem();

  it("the parser found the codes it is supposed to find", () => {
    /**
     * THE GUARD'S OWN GUARD, and it is not optional.
     *
     * Every assertion below compares against `raised`. If the parser returned
     * an empty set — a changed dollar-quote, a moved directory, a regex that
     * stopped matching — the two set-difference checks would BOTH pass
     * vacuously, and this file would report that everything is fine while
     * reading nothing at all.
     *
     * The spot values are ones migration 167 settled: `GAME_LOCKED` is the code
     * it introduced and `GAME_FINAL` the one it removed, so this also pins that
     * the last-definition-wins replay is working rather than unioning every
     * historical body.
     */
    expect(raised.size).toBeGreaterThan(10);
    expect(raised).toContain("GAME_LOCKED");
    expect(raised).toContain("DUPLICATE_PICK");
    expect(raised).not.toContain("GAME_FINAL");
    expect(raised).not.toContain("INCOMPLETE_SHEET");
  });

  it("has an arm for every code the RPCs raise", () => {
    const unmapped = [...raised].filter((c) => !PICKEM_ERROR_CODES.includes(c as never)).sort();
    expect(unmapped, "raised with no router arm — these leak Postgres text").toEqual([]);
  });

  it("has no arm for a code nothing raises", () => {
    const stale = PICKEM_ERROR_CODES.filter((c) => !raised.has(c)).sort();
    expect(stale, "arms whose code nothing raises — messages that can never render").toEqual([]);
  });

  it("every arm produces a message that is not the raw fallthrough", () => {
    for (const code of PICKEM_ERROR_CODES) {
      const err = pickemError(`${code}: something the database said`);
      expect(err.message, code).not.toContain("Pick'em save failed");
      expect(err.message.length, code).toBeGreaterThan(10);
      expect(PICKEM_ERRORS[code].code, code).toBeTruthy();
    }
  });

  it("falls through LOUDLY for a code it does not know", () => {
    // The fallthrough still leaks the Postgres text on purpose: an unmapped code
    // is a bug, and a tidy generic message is how it stays one.
    const err = pickemError("WAT_IS_THIS: something new");
    expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    expect(err.message).toContain("WAT_IS_THIS");
  });
});
