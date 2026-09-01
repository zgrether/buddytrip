import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { PICKEM_GAME_COLS, PICKEM_GAME_COLS_OMITTED } from "./pickem";

/**
 * The MIRROR-COVERAGE guard: every `games` column `configToPickemDraft` reads
 * must be one `pickem.get` actually selects.
 *
 * ── The bug it pins ─────────────────────────────────────────────────────────
 * `pickem.get` is the only query any pick'em surface reads, `configToPickemDraft`
 * builds the settings page's baseline from its game row, and `rules_for_today`
 * was not in the select. So the baseline slice was permanently `null` — which is
 * not merely "the rules don't show":
 *
 *   • the sheet and the settings note both render the baseline, so a saved
 *     rules-of-the-day rendered as the format starter, i.e. as never saved; and
 *   • `save_game_config` assigns `rules_for_today = p_payload->>'rulesForToday'`
 *     outright (not COALESCE-preserved) while `baseDraftToPayload` sends the key
 *     unconditionally, so the next save of anything else on the page wrote the
 *     null baseline back over the stored text.
 *
 * ── Why it derives the required set instead of listing it ───────────────────
 * A hand-kept list of "columns the mirror needs" is a second list, and CLAUDE.md
 * has the receipts on what two hand-kept lists do. This reads
 * `configToPickemDraft`'s own body — bounded by BRACE BALANCE from its
 * declaration, not by an eyeballed line range, which is how a neighbouring
 * function gets swept in — and requires every `game.<column>` it touches. Add a
 * column to the draft mirror and forget the select, and this fails.
 *
 * Modelled on `configHash.coverage.test.ts`: coverage plus an explicit,
 * justified allowlist (`PICKEM_GAME_COLS_OMITTED`), so a deliberate exception is
 * stated where the next reader will find it rather than being indistinguishable
 * from an oversight.
 */

const CONFIG_DRAFT = join(process.cwd(), "src/lib/configDraft.ts");

/**
 * The body of a top-level function, bounded by brace balance from its opening
 * `{`.
 *
 * The parameter list is skipped by PAREN balance first, and that is not
 * defensive padding — the naive "first `{` after the declaration" found
 * `settings: { rollUp: ...; useConfidence: boolean }`, an inline parameter TYPE,
 * and happily reported it as the function body. Measuring the region around the
 * thing rather than the thing, one more time; the cases below are what caught
 * it.
 */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`declaration not found: ${declaration}`);
  // `declaration` ends at the opening `(`, so walk the parameter list out.
  let parens = 1;
  let i = start + declaration.length;
  for (; i < source.length && parens > 0; i++) {
    if (source[i] === "(") parens++;
    else if (source[i] === ")") parens--;
  }
  if (parens !== 0) throw new Error(`unbalanced parens after: ${declaration}`);
  // Past the parameter list the only thing before the body is the return type
  // annotation, which carries no braces here.
  const open = source.indexOf("{", i);
  if (open < 0) throw new Error(`no body brace after: ${declaration}`);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces after: ${declaration}`);
}

/** Every `game.<snake_case_column>` the body reads. */
function gameColumnsRead(body: string): Set<string> {
  return new Set(Array.from(body.matchAll(/\bgame\.([a-z][a-z0-9_]*)/g), (m) => m[1]));
}

const selected = new Set(PICKEM_GAME_COLS.split(",").map((c) => c.trim()));

describe("pickem.get covers the columns its settings mirror reads", () => {
  const source = readFileSync(CONFIG_DRAFT, "utf8");
  const body = functionBody(source, "export function configToPickemDraft(");
  const required = gameColumnsRead(body);

  it("finds the columns at all (the extractor is not silently empty)", () => {
    // "Absence of matches is absence of search": an extractor that matched
    // nothing would make the coverage assertion below pass vacuously. Anchor it
    // on columns the function demonstrably reads, INCLUDING the one that was
    // missing — so this case fails if the parser stops seeing the body.
    expect(required.has("rules_for_today")).toBe(true);
    expect(required.has("name")).toBe(true);
    expect(required.has("points_total")).toBe(true);
    expect(required.size).toBeGreaterThan(4);
  });

  it("bounds the function by braces, not by a line range", () => {
    // The neighbouring converters read the same column names, so a body that ran
    // past the closing brace would still satisfy the coverage assertion while
    // measuring the wrong function. Pin both ends.
    expect(body.startsWith("{")).toBe(true);
    expect(body.trimEnd().endsWith("}")).toBe(true);
    expect(body).toContain("rollUp: settings.rollUp");
    expect(body).not.toContain("export function pickemDraftsEqual");
    expect(body).not.toContain("configToNonGolfDraft");
  });

  it("selects every column the mirror reads, or names it as an exception", () => {
    const missing = [...required].filter(
      (c) => !selected.has(c) && !(PICKEM_GAME_COLS_OMITTED as readonly string[]).includes(c)
    );
    expect(missing).toEqual([]);
  });

  it("keeps `rules_for_today` selected — the column this guard was written for", () => {
    // Named on its own rather than left to the derived set: the derived set
    // would also go quiet if someone stopped reading the column in the draft,
    // and that is not the same thing as the bug being fixed.
    expect(selected.has("rules_for_today")).toBe(true);
    expect((PICKEM_GAME_COLS_OMITTED as readonly string[]).includes("rules_for_today")).toBe(false);
  });

  it("does not allowlist a column it actually selects", () => {
    // An exception that is not an exception is a stale comment waiting to
    // mislead someone about why a column is absent.
    const bogus = (PICKEM_GAME_COLS_OMITTED as readonly string[]).filter((c) => selected.has(c));
    expect(bogus).toEqual([]);
  });
});
