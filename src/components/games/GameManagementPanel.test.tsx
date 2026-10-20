import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GameManagementPanel } from "./GameManagementPanel";

/**
 * The staged subtitle says what Save will do (#18's lie class). When the staged
 * go-live also takes the game out of its competition (#1668 look), that is part
 * of what Save will do, and nothing else on the page shows it until it has.
 */

const noop = () => {};
const render = (leavingCompetition: boolean) =>
  renderToStaticMarkup(
    <GameManagementPanel mode="scoring" ready onEnable={noop} onDisable={noop} staged leavingCompetition={leavingCompetition} />
  );

describe("GameManagementPanel — a staged go-live", () => {
  it("says Save will make it a side game when that is staged with it", () => {
    expect(render(true)).toContain("Not live — Save to play it as a side game");
  });

  it("CONTROL: a plain staged go-live keeps its own line", () => {
    const html = render(false);
    expect(html).toContain("Not live — Save to enable scoring");
    expect(html).not.toContain("side game");
  });
});
