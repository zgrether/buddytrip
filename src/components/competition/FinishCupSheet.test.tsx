import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinishCupSheetView, type FinishStep } from "./FinishCupSheet";
import type { SharedTie } from "@/lib/needsAttention";

/**
 * The empty board's decision sheet (spec §5, v2.8) as it renders. Which step it
 * opens at, and when it opens, are the leaderboard's; this pins what each step
 * says and how its buttons behave.
 */

const tie = (place: number, ids: string[]): SharedTie => ({ place, ordered: false, units: ids.map((id) => ({ id, name: id.toUpperCase(), shortName: null, color: null })) });
const noop = () => {};

function render(over: { step?: FinishStep; ties?: SharedTie[]; order?: string[]; pending?: "finish" | "use" | "keep" | null; error?: string | null } = {}) {
  const ties = over.ties ?? [];
  return renderToStaticMarkup(
    <FinishCupSheetView
      cupName="Turkey Cup"
      step={over.step ?? "ask"}
      ties={ties}
      orders={Object.fromEntries(ties.map((t) => [t.place, t.units.map((u) => u.id)]))}
      order={over.order ?? []}
      pending={over.pending ?? null}
      error={over.error ?? null}
      onReorder={noop}
      onGo={noop}
      onUse={noop}
      onKeep={noop}
      onAddGame={noop}
      onClose={noop}
    />
  );
}

/** One element's opening tag, by testid. */
function tag(html: string, testid: string): string {
  const at = html.indexOf(`data-testid="${testid}"`);
  if (at < 0) return "";
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

describe("the ask", () => {
  it("names the cup, asks, and offers both answers", () => {
    const html = render();
    expect(html).toContain(">Turkey Cup</h3>");
    expect(html).toContain("All games are in. Head to the winner&#x27;s circle?");
    expect(html).toMatch(/data-testid="finish-cup-sheet-go"[^>]*>To the winner&#x27;s circle</);
    expect(html).toMatch(/data-testid="finish-cup-sheet-add-game"[^>]*>Add another game</);
  });
  it("while the finish saves, its button shows the spinner and holds, and the text stays", () => {
    const html = render({ pending: "finish" });
    const go = tag(html, "finish-cup-sheet-go");
    expect(go).toContain('disabled=""');
    expect(go).toContain('aria-busy="true"');
    expect(html).toMatch(/data-testid="finish-cup-sheet-go"[^>]*><svg[^>]*animate-spin[\s\S]*?To the winner&#x27;s circle</);
  });
  it("CONTROL: at rest it is enabled and has no spinner", () => {
    const go = tag(render(), "finish-cup-sheet-go");
    expect(go).not.toContain('disabled=""');
    expect(go).not.toContain("aria-busy");
    expect(render()).not.toContain("animate-spin");
  });
  it("a refusal shows above the buttons", () => {
    expect(render({ error: "That tie has changed. Try again." })).toContain(">That tie has changed. Try again.<");
  });
  it("the tie step with no tie left falls back to the ask", () => {
    const html = render({ step: "ties", ties: [] });
    expect(html).toContain("All games are in. Head to the winner&#x27;s circle?");
    expect(html).not.toContain("Use this order");
  });
});

describe("the tie step", () => {
  it("one tie: titled by its place, the line, and its two answers", () => {
    const html = render({ step: "ties", ties: [tie(1, ["a", "b"])], order: ["a", "b"] });
    expect(html).toContain(">Tied for 1st</h3>");
    expect(html).toContain(">Played a tiebreaker? Drag to set the order.<");
    expect(html).toMatch(/data-testid="break-tie-save"[^>]*>Use this order</);
    expect(html).toMatch(/data-testid="break-tie-keep"[^>]*>Keep it a tie</);
    expect(html).not.toContain("All games are in");
  });
  it("several ties: titled Ties, a section headed by each place", () => {
    const html = render({ step: "ties", ties: [tie(1, ["a", "b"]), tie(3, ["c", "d"])] });
    expect(html).toContain(">Ties</h3>");
    expect(html).toContain('data-testid="break-tie-group-1"><h3');
    expect(html).toContain(">Tied for 3rd</h3>");
  });
  it("with several and nothing moved, Use this order holds; Keep it a tie does not", () => {
    const html = render({ step: "ties", ties: [tie(1, ["a", "b"]), tie(3, ["c", "d"])], order: [] });
    expect(tag(html, "break-tie-save")).toContain('disabled=""');
    expect(tag(html, "break-tie-keep")).not.toContain('disabled=""');
  });
  it("keeping the tie shows the spinner on that button only, and both hold", () => {
    const html = render({ step: "ties", ties: [tie(1, ["a", "b"])], order: ["a", "b"], pending: "keep" });
    expect(tag(html, "break-tie-keep")).toContain('aria-busy="true"');
    expect(tag(html, "break-tie-save")).not.toContain("aria-busy");
    expect(tag(html, "break-tie-save")).toContain('disabled=""');
  });
});
