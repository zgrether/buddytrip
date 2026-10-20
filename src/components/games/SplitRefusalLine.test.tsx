import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SplitRefusalLine } from "./SplitRefusalLine";
import { finalizeSplitRefusal } from "@/lib/gameConfig";
import { teamPlaceCapacity } from "@/lib/placeCapacity";

/**
 * #1679 — the refusal under a disabled Save results, with "settings" opening
 * the game's settings (Zach). The words are finalize's own (`.text`), so the
 * screen and the server can only say the same thing; the link is the one
 * difference, and only when the screen can open settings.
 */

const refusal = finalizeSplitRefusal({
  distribution: { type: "placement", values: [5, 3, 1] },
  pointsTotal: 9,
  capacity: teamPlaceCapacity(2),
})!;
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("SplitRefusalLine", () => {
  it("reads exactly as finalize's refusal, with 'settings' as the link", () => {
    const html = renderToStaticMarkup(<SplitRefusalLine refusal={refusal} onSettings={() => {}} />);
    expect(text(html)).toBe(refusal.text);
    expect(html).toContain('data-testid="split-refusal-settings">settings</button>');
  });

  it("CONTROL: with no way to open settings it is the plain sentence, no link", () => {
    const html = renderToStaticMarkup(<SplitRefusalLine refusal={refusal} />);
    expect(html).toBe(refusal.text);
    expect(html).not.toContain("<button");
  });
});
