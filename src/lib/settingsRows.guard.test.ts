import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseSettingsRow, SETTINGS_ROWS, settingsRowTestId } from "./settingsRows";

/**
 * A link names a settings row by its `ChecklistRow` test id (`&row=matches` opens
 * `row-matches`), so a renamed or removed row would leave links that open the
 * settings and scroll to nothing. This guard reads the settings screens' source
 * and requires every row a link can name to still be rendered somewhere in it.
 *
 * And a row that EXPANDS must start open from the link: each one's owner reads
 * `useSettingsRowLink`, checked by the row's literal appearing beside it. The
 * rows with no open state (Total Points, The Picks) are only scrolled to.
 */

const GAMES = join(__dirname, "../components/games");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}
const sources = walk(GAMES).map((p) => readFileSync(p, "utf8"));

describe("every settings row a link can name exists", () => {
  for (const row of SETTINGS_ROWS) {
    it(`row-${row}`, () => {
      const id = settingsRowTestId(row);
      expect(sources.some((s) => s.includes(`testId="${id}"`)), `no settings row renders ${id}`).toBe(true);
    });
  }
});

describe("an expanding row starts open from the link", () => {
  const SCROLL_ONLY = new Set(["total-points", "the-picks"]);
  for (const row of SETTINGS_ROWS.filter((r) => !SCROLL_ONLY.has(r))) {
    it(row, () => {
      const owners = sources.filter((s) => /useSettingsRowLink\(\)/.test(s) && s.includes(`=== "${row}"`));
      expect(owners.length, `nothing opens ${row} from the link`).toBeGreaterThan(0);
    });
  }
});

describe("parseSettingsRow", () => {
  it("takes a known row and refuses anything else", () => {
    expect(parseSettingsRow("matches")).toBe("matches");
    expect(parseSettingsRow("row-matches")).toBeNull();
    expect(parseSettingsRow(null)).toBeNull();
  });
});
