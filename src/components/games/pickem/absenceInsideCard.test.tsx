import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PickemMatchPlayCard } from "./PickemMatchPlayCard";
import type { BoardRow } from "@/lib/pickemBoard";

/**
 * ROUND 3 ITEM 1 — `NO PICKS` is inside the card, under the right player.
 *
 * It used to be a SIBLING below the card. On a phone it escaped its container
 * entirely, floating below the card and overlapping the next one — not
 * displacing something, outside it.
 */

const rows: BoardRow[] = [
  { slateGameId: "g1", result: "home", swing: 3, aPoints: 3, bPoints: 0, upsideA: 0, upsideB: 0, zeroKind: null } as unknown as BoardRow,
];

const render = (picked: { a: boolean; b: boolean }) =>
  renderToStaticMarkup(
    <PickemMatchPlayCard
      matchNumber={2}
      aName="JohnnyD"
      bName="Taj"
      slate={[{ id: "g1" }, { id: "g2" }] as never}
      rows={rows}
      aColor="#22c55e"
      bColor="#f97316"
      picked={picked}
      mine={false}
      onOpen={() => {}}
    />
  );

/**
 * Is `badge` inside the same cell as `name`? The discriminator is an
 * intervening CELL CLOSE: a badge in the player's own column follows the name
 * with no `</div>` between them, and a badge that is centred — its own row
 * under both names, which is the round-2 defect one container in — necessarily
 * has the name's cell closing before it.
 */
const inSameCellAs = (html: string, name: string, badgeTestId: string) => {
  const n = html.indexOf(`>${name}<`);
  const b = html.indexOf(`data-testid="${badgeTestId}"`);
  if (n === -1 || b === -1 || b < n) return false;
  return !html.slice(n, b).includes("</div>");
};

describe("the absence notice sits inside the card, under its own player", () => {
  it("renders inside the affected player's column, not centred", () => {
    const html = render({ a: true, b: false });
    expect(html).toContain('data-testid="pickem-mp-nopicks-b"');
    expect(inSameCellAs(html, "Taj", "pickem-mp-nopicks-b")).toBe(true);
  });

  /**
   * INSIDE THE CARD AT ALL — the round-3 defect. The notice must fall before
   * the card's own history strip, which is the last thing the card draws; a
   * sibling rendered after the card closes falls after it.
   */
  it("falls within the card's markup, before its segment strip closes", () => {
    const html = render({ a: true, b: false });
    const badge = html.indexOf('data-testid="pickem-mp-nopicks-b"');
    const strip = html.lastIndexOf("border-top:1px solid var(--color-bt-subtle-border)");
    expect(strip).toBeGreaterThan(-1); // the anchor must exist
    expect(badge).toBeLessThan(strip);
  });

  /** PER SIDE, and only the side it is true of. */
  it("marks only the player who submitted nothing", () => {
    const html = render({ a: true, b: false });
    expect(html).not.toContain('data-testid="pickem-mp-nopicks-a"');

    const other = render({ a: false, b: true });
    expect(other).toContain('data-testid="pickem-mp-nopicks-a"');
    expect(other).not.toContain('data-testid="pickem-mp-nopicks-b"');
    expect(inSameCellAs(other, "JohnnyD", "pickem-mp-nopicks-a")).toBe(true);
  });

  /**
   * THE NAME SAYS IT FIRST. A side scoring nothing reads dim before the badge
   * confirms it — which is what lets the badge be small and sit under the name
   * instead of competing with it. Asserted as a DIFFERENCE between the two
   * sides on one card, so a build that dimmed both (or neither) fails.
   */
  it("de-emphasises the absent player's name and not the other's", () => {
    const html = render({ a: true, b: false });
    const nameStyle = (name: string) => {
      const at = html.indexOf(`>${name}<`);
      return html.slice(html.lastIndexOf("<span", at), at);
    };
    expect(nameStyle("Taj")).toContain("var(--color-bt-text-dim)");
    expect(nameStyle("JohnnyD")).toContain("var(--color-bt-text)");
    expect(nameStyle("JohnnyD")).not.toContain("var(--color-bt-text-dim)");
  });

  it("leaves a card where both submitted completely alone", () => {
    const html = render({ a: true, b: true });
    expect(html).not.toContain("pickem-mp-nopicks");
    expect(html).not.toContain("NO PICKS");
  });
});
