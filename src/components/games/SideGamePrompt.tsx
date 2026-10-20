"use client";

import { createPortal } from "react-dom";

/**
 * Asked at GO-LIVE (#1668 look, item 3): this game is in a team competition and
 * nobody playing it is on a team, so it cannot award points — their results
 * count for no team.
 *
 * Two answers, both legitimate, so neither is styled as the risky one:
 *  - **Play it as a side game** — this Save takes the game out of its
 *    competition (migration 218) and goes live. Owner/Organizer only, which the
 *    RPC enforces; anyone else is told who can.
 *  - **Keep as is** — go live in the competition anyway. Finish still asks
 *    before a game that awards nothing (the backstop, #1668).
 *
 * Tapping outside answers neither: scoring is not turned on.
 */
export const SIDE_GAME_PROMPT_TITLE = "Nobody here is on a team, so this game can't award points.";

interface SideGamePromptProps {
  /** Owner or Organizer — the tier that may take a game out of its competition. */
  canMakeSideGame: boolean;
  onSideGame: () => void;
  onKeep: () => void;
  onDismiss: () => void;
}

/** The prompt, portalled over the page. */
export function SideGamePrompt(props: SideGamePromptProps) {
  if (typeof document === "undefined") return null;
  return createPortal(<SideGamePromptCard {...props} />, document.body);
}

/** The prompt's body, exported so its two shapes are testable by static render
 *  (the wrapper portals to `document`, which the node suite has not got). */
export function SideGamePromptCard({ canMakeSideGame, onSideGame, onKeep, onDismiss }: SideGamePromptProps) {
  const button = {
    height: 44,
    borderRadius: 12,
    fontSize: 14.5,
    fontWeight: 600,
  } as const;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onDismiss}
      data-testid="side-game-prompt"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{ maxWidth: 340, background: "var(--color-bt-card-float)", borderRadius: 18, padding: 18 }}
      >
        <div style={{ fontSize: 16.5, fontWeight: 700, color: "var(--color-bt-text)" }}>{SIDE_GAME_PROMPT_TITLE}</div>
        {!canMakeSideGame && (
          <p className="mt-1.5 text-[13px] leading-snug" style={{ color: "var(--color-bt-text-dim)" }} data-testid="side-game-prompt-note">
            An organizer can make it a side game.
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {canMakeSideGame && (
            <button
              type="button"
              onClick={onSideGame}
              className="w-full"
              style={{ ...button, background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)", border: "none" }}
              data-testid="side-game-prompt-side"
            >
              Play it as a side game
            </button>
          )}
          <button
            type="button"
            onClick={onKeep}
            className="w-full"
            style={{
              ...button,
              background: canMakeSideGame ? "transparent" : "var(--color-bt-accent)",
              color: canMakeSideGame ? "var(--color-bt-text)" : "var(--color-bt-on-accent)",
              border: canMakeSideGame ? "1px solid var(--color-bt-border)" : "none",
            }}
            data-testid="side-game-prompt-keep"
          >
            Keep as is
          </button>
        </div>
      </div>
    </div>
  );
}
