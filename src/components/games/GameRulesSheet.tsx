"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { Sheet } from "@/components/Sheet";
import { GameRulesNote } from "@/components/games/GameRulesNote";
import { formatExplanation } from "@/components/games/GameFormatExplainer";

/**
 * GameRulesSheet — rules of the day, reachable DURING scoring.
 *
 * Until now the rules had exactly one home: the settings page, behind the
 * owner/delegate gear. That put them out of reach of the people most likely to
 * need them — the crew standing on a tee arguing about whether gimmes are on —
 * and out of reach of everyone once the game went live.
 *
 * Modelled on the scorecard, which is the established answer to "something you
 * open, read, and dismiss without leaving the game": a `Sheet` over the current
 * surface, reached from a small persistent affordance in `GameActionRow`.
 *
 * ── Why this one WRITES, unlike every other rules render site ───────────────
 * Everywhere else `GameRulesNote` is a controlled draft slice committed by the
 * settings page's single atomic Save (CLAUDE.md #18). There is no draft here and
 * no Save bar — this sheet is opened mid-round to read, and sometimes to correct
 * a line, and routing that through the settings page's composite draft would
 * mean opening settings mid-round to change one sentence.
 *
 * So it persists on CLOSE via `games.update`, and only when the text actually
 * changed. That is a deliberate exception to the draft-then-save rule, not an
 * oversight, and it is safe for the specific reason the rest of the rule exists
 * to protect against: `rules_for_today` is the QUIET tier — free text that
 * cannot rescore a hole, move a standing, or change the config hash. A write
 * here cannot conflict with a settings draft's frozen baseHash, because the
 * hash does not cover it.
 */
export function GameRulesSheet({
  open,
  onClose,
  tripId,
  gameId,
  gameTypeId,
  rules,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  tripId: string;
  gameId: string;
  /** Seeds the starter text when the game has no rules of its own yet. */
  gameTypeId: string | null;
  /** Current persisted rules (null/empty → the format explanation shows). */
  rules: string | null;
  /** Owner/delegate → editable; a member reads. */
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const update = trpc.games.update.useMutation();
  // Local while open, so typing doesn't fire a write per keystroke.
  const [draft, setDraft] = useState(rules ?? "");

  // Re-seed whenever the sheet opens, or the server value changes underneath
  // (another device edited it — the ~20s config poll brings it in). Guarded on
  // `open` so it never clobbers what someone is typing.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(rules ?? "");
  }, [open, rules]);

  function close() {
    const next = draft.trim();
    // Only write a real change. The starter text is DISPLAY — an untouched sheet
    // leaves `rules_for_today` null rather than persisting the format blurb into
    // every game's rules field.
    if (canEdit && next !== (rules ?? "").trim()) {
      update.mutate(
        { tripId, gameId, rulesForToday: next || null },
        {
          onSuccess: () => {
            void utils.games.getById.invalidate({ tripId, gameId });
            void utils.games.listByTrip.invalidate({ tripId });
          },
        },
      );
    }
    onClose();
  }

  if (!open) return null;
  return (
    <Sheet
      title="Rules of the day"
      subtitle={canEdit ? "Edits save when you close this." : undefined}
      onClose={close}
      testId="game-rules-sheet"
    >
      <GameRulesNote
        bare
        canEdit={canEdit}
        value={draft}
        onChange={canEdit ? setDraft : undefined}
        starterText={formatExplanation(gameTypeId) ?? undefined}
      />
    </Sheet>
  );
}
