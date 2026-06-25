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
 * The one field with no collapse event, so it can't ride persist-on-collapse: it
 * saves on **blur** (self-contained — works on surfaces with no Save&exit, like
 * the Configuration screen) AND exposes `flush()` so the page's "Save & exit" can
 * commit it before navigating (the honest "I typed a rules sheet, save it" door).
 */
export const GameRulesNote = forwardRef<GameRulesNoteHandle, {
  tripId: string;
  game: GameRow;
  canEdit: boolean;
}>(function GameRulesNote({ tripId, game, canEdit }, ref) {
  const initial = (game.rules_for_today as string | null) ?? "";
  const [text, setText] = useState(initial);
  // The last value we persisted — so flush/blur is a no-op when nothing changed.
  const savedRef = useRef(initial);
  const update = trpc.games.update.useMutation();
  const utils = trpc.useUtils();

  const commit = useCallback(async () => {
    const next = text.trim();
    if (next === savedRef.current.trim()) return; // nothing changed
    savedRef.current = text;
    await update.mutateAsync({ tripId, gameId: game.id, rulesForToday: next || null });
    utils.games.getById.invalidate({ tripId, gameId: game.id });
  }, [text, tripId, game.id, update, utils]);

  useImperativeHandle(ref, () => ({ flush: () => commit().catch(() => {}) }), [commit]);

  return (
    <div className="mt-6">
      <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
        Rules of the day
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        readOnly={!canEdit}
        rows={3}
        maxLength={2000}
        placeholder="Tap out the rules of the day — formats, gimmes, mulligans, tiebreakers…"
        className="mt-2 w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
        style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", opacity: canEdit ? 1 : 0.7 }}
        data-testid="game-rules-note"
      />
    </div>
  );
});
