import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SideGamePromptCard, SIDE_GAME_PROMPT_TITLE } from "./SideGamePrompt";

/**
 * The go-live prompt's two shapes (#1668 look, item 3), by static render of its
 * body. The click wiring is the views', checked in the browser pass on the PR;
 * this file pins what each viewer is OFFERED.
 */

const noop = () => {};
/** Static markup escapes the apostrophe in "can't"; read it back as text. */
const render = (canMakeSideGame: boolean) =>
  renderToStaticMarkup(<SideGamePromptCard canMakeSideGame={canMakeSideGame} onSideGame={noop} onKeep={noop} onDismiss={noop} />).split("&#x27;").join("'");

describe("SideGamePromptCard", () => {
  it("an organizer gets both answers, and no note", () => {
    const html = render(true);
    expect(html).toContain(SIDE_GAME_PROMPT_TITLE);
    expect(html).toContain('data-testid="side-game-prompt-side"');
    expect(html).toContain('data-testid="side-game-prompt-keep"');
    expect(html).not.toContain('data-testid="side-game-prompt-note"');
  });

  it("anyone else can only keep it, and is told who can make it a side game", () => {
    const html = render(false);
    expect(html).not.toContain('data-testid="side-game-prompt-side"');
    expect(html).toContain('data-testid="side-game-prompt-keep"');
    expect(html).toContain("An organizer can make it a side game.");
  });
});
