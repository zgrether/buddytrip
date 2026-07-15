"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

export interface GameRulesNoteHandle {
  /** Commit any unsaved text NOW (the page's "Save & exit" calls this before
   *  navigating). Resolves once the write settles (or immediately if clean). */
  flush: () => Promise<void>;
}

/**
 * Zone 3 (W-EDITMODAL-01) — the "rules of the day" freeform note, at the bottom of
 * the game-setup page BELOW the checklist. It's notes, not a task: nothing to
 * "resolve", so it is NOT a ChecklistRow — a plain textarea.
 *
 * TWO MODES, selected by the EXPLICIT `controlled` flag (never inferred from
 * whether `value` happens to be defined — that made the mode a side effect of a
 * value's presence, so a controlled parent whose text was briefly `undefined`
 * would silently fall back to self-persisting and write to the server):
 *  - **Uncontrolled** (default — the Configuration / non-golf / member surfaces):
 *    self-contained, saves on **blur**, and exposes `flush()` so a page's
 *    "Save & exit" can commit before navigating.
 *  - **Controlled** (`controlled` — the draft-then-save match settings page):
 *    the parent owns the text and decides what an edit means. `onChange` reports
 *    every keystroke; the parent updates its draft and the page's single Save
 *    persists it, so NOTHING commits from here.
 * The uncontrolled mode stays until the remaining surfaces convert (P2).
 */
export const GameRulesNote = forwardRef<GameRulesNoteHandle, {
  tripId: string;
  game: GameRow;
  canEdit: boolean;
  /** Controlled mode: the parent owns the text + persistence. Requires `value`. */
  controlled?: boolean;
  /** Controlled mode: the text to show. */
  value?: string;
  /** Controlled mode: every edit. */
  onChange?: (next: string) => void;
}>(function GameRulesNote({ tripId, game, canEdit, controlled: controlledProp, value, onChange }, ref) {
  const controlled = controlledProp ?? false;
  const initial = (game.rules_for_today as string | null) ?? "";
  const [ownText, setOwnText] = useState(initial);
  const text = controlled ? (value ?? "") : ownText;
  // The last value we persisted — so flush/blur is a no-op when nothing changed.
  const savedRef = useRef(initial);
  const update = trpc.games.update.useMutation();
  const utils = trpc.useUtils();

  const commit = useCallback(async () => {
    if (controlled) return; // the parent owns persistence — nothing to flush
    const next = ownText.trim();
    if (next === savedRef.current.trim()) return; // nothing changed
    savedRef.current = ownText;
    await update.mutateAsync({ tripId, gameId: game.id, rulesForToday: next || null });
    utils.games.getById.invalidate({ tripId, gameId: game.id });
  }, [controlled, ownText, tripId, game.id, update, utils]);

  useImperativeHandle(ref, () => ({ flush: () => commit().catch(() => {}) }), [commit]);

  const setText = (next: string) => {
    if (controlled) onChange?.(next);
    else setOwnText(next);
  };

  return (
    <div className="mt-6">
      {/* #512 §5: label + divider rule, matching the SETTINGS / OPTIONS section
          headers (which had a divider; Rules previously had a bare label). */}
      <div className="flex items-center gap-2 pt-2">
        <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Rules of the day
        </label>
        <span className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
      </div>
      {/* #512 §8: a bordered card PANEL containing the textarea (surface + border +
          padding) so it reads as a peer of the Matches/Course/Points card-rows, not a
          loose field. The textarea itself is transparent — it's the panel's interior. */}
      <div
        className="mt-2 rounded-xl px-3.5 py-3"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void commit()}
          readOnly={!canEdit}
          rows={3}
          maxLength={2000}
          placeholder="Tap out the rules of the day — formats, gimmes, mulligans, tiebreakers…"
          className="w-full resize-none bg-transparent text-sm outline-none"
          style={{ color: "var(--color-bt-text)", opacity: canEdit ? 1 : 0.7 }}
          data-testid="game-rules-note"
        />
      </div>
    </div>
  );
});
