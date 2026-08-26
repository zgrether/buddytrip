import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReorderableList } from "./ReorderableList";

/**
 * What RENDERING can witness about the reorder primitive.
 *
 * The environment is `node` (no RTL, no jsdom), so this is
 * `renderToStaticMarkup` and nothing here clicks anything. The arrow ARITHMETIC
 * is covered directly in `src/lib/reorderList.test.ts`; what is left for markup
 * is the part that arithmetic cannot see — row order, the end-of-list disabled
 * state, which side the controls sit on, and that turning the feature off
 * really removes the affordances rather than hiding them.
 *
 * Deliberately NOT asserted: the seven dnd-kit settings. A test that greps its
 * own source for `distance: 4` proves the string is present, not that the
 * sensor is configured — the shape #945 was filed about. They are load-bearing
 * and device-established, so they are documented in the component header and
 * left to the device.
 */

const ids = ["alpha", "bravo", "charlie"];
const render = (extra: Partial<Parameters<typeof ReorderableList>[0]> = {}) =>
  renderToStaticMarkup(
    <ReorderableList
      ids={ids}
      labelOf={(id) => id}
      renderRow={(id, i) => <span>{`${i}:${id}`}</span>}
      onReorder={() => {}}
      {...extra}
    />
  );

describe("ReorderableList", () => {
  it("renders every row, in the order given, with its index", () => {
    const html = render();
    expect(html).toContain("0:alpha");
    expect(html).toContain("1:bravo");
    expect(html).toContain("2:charlie");
    // Order, not just presence — a list that rendered them sorted or reversed
    // would satisfy three `toContain`s on its own.
    expect(html.indexOf("0:alpha")).toBeLessThan(html.indexOf("1:bravo"));
    expect(html.indexOf("1:bravo")).toBeLessThan(html.indexOf("2:charlie"));
  });

  it("gives every row a grip and a labelled pair of arrows", () => {
    const html = render();
    expect(html.match(/data-testid="reorder-grip"/g)).toHaveLength(3);
    expect(html.match(/data-testid="reorder-up"/g)).toHaveLength(3);
    expect(html.match(/data-testid="reorder-down"/g)).toHaveLength(3);
    // Named per row, so a screen reader says which thing moves.
    expect(html).toContain('aria-label="Move bravo up"');
    expect(html).toContain('aria-label="Reorder charlie"');
  });

  it("disables exactly the two arrows that would leave the list", () => {
    // The count is the assertion. "Contains a disabled button" would pass
    // against every arrow being disabled, which is the failure that would make
    // the list unreorderable by arrow while still looking correct.
    //
    // NOTE the pattern: `disabled=""`, the rendered ATTRIBUTE — never the bare
    // substring "disabled", which also appears in the Tailwind class
    // `disabled:opacity-30` on every arrow. The first draft of this test used
    // the substring and the middle-row assertion failed; the two that passed
    // were passing off the class name, not the attribute. A pattern the
    // surrounding markup cannot produce, per CLAUDE.md.
    const html = render();
    expect(html.match(/disabled=""/g)).toHaveLength(2);

    // ...and specifically the first row's up and the last row's down. Sliced to
    // the button's own tag so a neighbour's attribute cannot satisfy it.
    const buttonAt = (label: string) => {
      const start = html.indexOf(`aria-label="${label}"`);
      expect(start, `no button labelled ${label}`).toBeGreaterThan(-1);
      return html.slice(start, html.indexOf(">", start));
    };
    expect(buttonAt("Move alpha up")).toContain('disabled=""');
    expect(buttonAt("Move charlie down")).toContain('disabled=""');
    // The middle row is free in both directions.
    expect(buttonAt("Move bravo up")).not.toContain('disabled=""');
    expect(buttonAt("Move bravo down")).not.toContain('disabled=""');
    // ...and the ends are free in the other direction, or the list would be
    // unreorderable by arrow while still counting two disabled buttons.
    expect(buttonAt("Move alpha down")).not.toContain('disabled=""');
    expect(buttonAt("Move charlie up")).not.toContain('disabled=""');
  });

  it("a single-row list has both arrows disabled and still renders the row", () => {
    const html = renderToStaticMarkup(
      <ReorderableList
        ids={["only"]}
        labelOf={(id) => id}
        renderRow={(id) => <span>{id}</span>}
        onReorder={() => {}}
      />
    );
    expect(html).toContain("only");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("puts the controls after the content when asked to", () => {
    // The pick'em confidence row is [rank] [pick] [arrows][grip] — controls
    // trailing. The default is leading, which is what the board rows use.
    const leading = render();
    const trailing = render({ controlsSide: "trailing" });
    expect(leading.indexOf("reorder-grip")).toBeLessThan(leading.indexOf("0:alpha"));
    expect(trailing.indexOf("0:alpha")).toBeLessThan(trailing.indexOf("reorder-grip"));
  });

  it("arrows can be turned off without losing the grip", () => {
    const html = render({ arrows: false });
    expect(html).not.toContain("reorder-up");
    expect(html.match(/data-testid="reorder-grip"/g)).toHaveLength(3);
  });

  it("disabled REMOVES the affordances rather than hiding them", () => {
    // Not `disabled` attributes and not `opacity: 0` — genuinely absent, so
    // there is no tap target and no keyboard path to a control that does
    // nothing. The rows themselves must still be there.
    const html = render({ enabled: false });
    expect(html).not.toContain("reorder-grip");
    expect(html).not.toContain("reorder-up");
    expect(html).toContain("0:alpha");
    expect(html).toContain("2:charlie");
  });

  it("disabled renders the caller's own fallback when given one", () => {
    const html = render({
      enabled: false,
      disabledFallback: <p>read-only list</p>,
    });
    expect(html).toContain("read-only list");
    expect(html).not.toContain("0:alpha");
  });

  it("uses the caller's list className, so row spacing cannot be dropped", () => {
    // `ReorderableGames` shipped a bug where turning reordering on silently
    // collapsed the vertical rhythm, because the reorder path hardcoded its own
    // wrapper class. Pinned here so the primitive cannot reintroduce it.
    expect(render({ listClassName: "grid gap-9" })).toContain('class="grid gap-9"');
  });
});
