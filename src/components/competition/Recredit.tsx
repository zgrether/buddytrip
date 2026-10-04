"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, History } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";
import { useTripRole } from "@/hooks/useTripRole";
import { invalidateGameBoards } from "@/lib/gameBoardInvalidation";
import type { RecreditPreview, TeamPoints } from "@/lib/recredit";

/**
 * RE-CREDIT (PR 8c, ruling 18): the trip Owner fixes a finished game that
 * credited someone to the wrong team. Game by game, every box unchecked to
 * start (Zach, 2026-10-04): a re-credit is for MISTAKES, and a deliberate trade
 * leaves the rounds before it where they were earned — so the Owner picks the
 * rounds that were wrong and nothing else moves.
 *
 * Named re-credit throughout, never "correction": that word already means
 * reopening a game to edit scores, and both can show on the same board row.
 */

/** "Red 10 → 6 · Blue 6 → 10" — only the teams whose points this game moves. */
export function pointsChangeText(before: TeamPoints[], after: TeamPoints[]): string | null {
  const parts: string[] = [];
  for (const b of before) {
    const a = after.find((x) => x.teamId === b.teamId);
    const next = a?.points ?? 0;
    if (next !== b.points) parts.push(`${b.teamName} ${fmt(b.points)} → ${fmt(next)}`);
  }
  for (const a of after) {
    if (!before.some((b) => b.teamId === a.teamId) && a.points !== 0) parts.push(`${a.teamName} 0 → ${fmt(a.points)}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export type RecreditSheetState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; preview: RecreditPreview };

export function RecreditSheet({
  personName,
  state,
  selected,
  onToggle,
  onCancel,
  onConfirm,
  isPending = false,
  applyError = null,
  onReview,
}: {
  personName: string;
  state: RecreditSheetState;
  selected: ReadonlySet<string>;
  onToggle: (gameId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isPending?: boolean;
  /** The server's sentence when a confirm was refused. */
  applyError?: string | null;
  /** Build the preview again — offered when a confirm was refused as stale. */
  onReview?: () => void;
}) {
  const preview = state.phase === "ready" ? state.preview : null;
  const destination = preview?.toTeamName ?? null;
  const count = selected.size;

  return (
    <ScrollLock>
      <div
        // Over the Edit Team sheet and the Rosters overlay (both z-50), as the
        // roster-change sheet is.
        className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onCancel}
        data-testid="recredit-sheet"
      >
        <div
          className="flex max-h-[85vh] w-full max-w-sm flex-col rounded-t-2xl sm:rounded-2xl"
          style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="overflow-y-auto px-5 pt-5 pb-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
            >
              <History size={18} />
            </div>
            <h3 className="mt-3 text-base font-bold" style={{ color: "var(--color-bt-text)" }} data-testid="recredit-title">
              Re-credit {personName}&rsquo;s games
            </h3>

            {state.phase === "loading" && (
              <p className="mt-1.5 text-sm" style={{ color: "var(--color-bt-text-dim)" }} data-testid="recredit-loading">
                Checking {personName}&rsquo;s finished games…
              </p>
            )}
            {state.phase === "error" && (
              <p className="mt-1.5 text-sm" style={{ color: "var(--color-bt-text-dim)" }} data-testid="recredit-error">
                Couldn&rsquo;t check {personName}&rsquo;s games just now. Close this and try again in a moment.
              </p>
            )}

            {preview && (
              <>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }} data-testid="recredit-intro">
                  {destination
                    ? `For a game that counted ${personName} for the wrong team. Each game you tick will count for ${destination}.`
                    : `For a game that shouldn't have counted ${personName} for any team. Each game you tick will count for no team — ${personName}'s own result stays, but no team scores it.`}
                </p>

                {preview.eligible.length === 0 && (
                  <p className="mt-3 text-sm" style={{ color: "var(--color-bt-text-dim)" }} data-testid="recredit-none">
                    Nothing to re-credit — every finished game already counts {personName} where they are now.
                  </p>
                )}

                <ul className="mt-3 space-y-2">
                  {preview.eligible.map((g) => {
                    const on = selected.has(g.gameId);
                    const change = pointsChangeText(g.before, g.after);
                    return (
                      <li key={g.gameId}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => onToggle(g.gameId)}
                          disabled={isPending}
                          className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left"
                          style={{
                            background: "var(--color-bt-card-raised)",
                            border: on ? "1.5px solid var(--color-bt-accent)" : "1px solid var(--color-bt-border)",
                          }}
                          data-testid="recredit-game"
                          data-game-id={g.gameId}
                        >
                          <span
                            className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded"
                            style={{
                              background: on ? "var(--color-bt-accent)" : "transparent",
                              border: on ? "none" : "1.5px solid var(--color-bt-border)",
                              color: "var(--color-bt-on-accent)",
                            }}
                          >
                            {on && <Check size={12} strokeWidth={3} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                              {g.name}
                            </span>
                            <span className="block text-[12px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="recredit-game-direction">
                              {/* The DIRECTION, explicitly (Zach, on the 8c look): "counts for X now"
                                  read either as where it counts today or where it will
                                  after the tick. */}
                              {g.fromTeamName ?? "No team"} → {destination ?? "No team"}
                            </span>
                            <span className="block text-[12px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="recredit-game-change">
                              {/* The line that warns before a re-credit HURTS the team someone
                                  joins: a stroke team total is a sum, so an extra player adds
                                  strokes and can lose the game for them. */}
                              {change ? `Points in this game: ${change}` : "No points change in this game."}
                            </span>
                            {/* #1561's ruling: warn, never block. The sentence that explains a
                                result that looks backwards — and says which way it cuts. */}
                            {g.unequalTeams && (
                              <span className="mt-1 block text-[12px]" style={{ color: "var(--color-bt-warning)" }} data-testid="recredit-game-unequal">
                                {g.unequalTeams}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}

                  {/* Listed, not hidden: the Owner sees why a game they remember
                      is not offered, instead of wondering where it went. */}
                  {preview.standing.map((g) => (
                    <li
                      key={g.gameId}
                      className="rounded-xl px-3 py-2.5"
                      style={{ border: "1px solid var(--color-bt-border)", opacity: 0.6 }}
                      data-testid="recredit-standing"
                    >
                      <span className="block text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                        {g.name}
                      </span>
                      <span className="block text-[12px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="recredit-standing-reason">
                        {g.reason === "in_review"
                          ? "Open for score edits — finish the review, then re-credit it."
                          : "Stands as played — its result depended on who was on which team."}
                      </span>
                    </li>
                  ))}
                </ul>

                {count > 0 && (
                  <p className="mt-3 text-[12px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="recredit-public">
                    Everyone on the trip will see these games marked as re-credited by you.
                  </p>
                )}
                {applyError && (
                  <p className="mt-3 text-sm" style={{ color: "var(--color-bt-danger)" }} data-testid="recredit-apply-error">
                    {applyError}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 px-5 pb-5 pt-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              style={{ background: "transparent", color: "var(--color-bt-text-dim)", border: "0.5px solid var(--color-bt-border)" }}
            >
              Cancel
            </button>
            {applyError && onReview ? (
              <button
                type="button"
                onClick={onReview}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
                data-testid="recredit-review-again"
              >
                Review again
              </button>
            ) : (
              preview &&
              preview.eligible.length > 0 && (
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={isPending || count === 0}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
                  style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
                  data-testid="recredit-confirm"
                >
                  {count === 0 ? "Pick a game" : `Re-credit ${count} game${count === 1 ? "" : "s"}`}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </ScrollLock>
  );
}

/** Who the trip Owner could re-credit in this cup — empty for everyone else,
 *  and the query is never sent for them (the server would refuse it). */
export function useRecreditCandidates(tripId: string, competitionId: string): Set<string> {
  const { isOwner } = useTripRole(tripId);
  const q = trpc.recredits.candidates.useQuery({ tripId, competitionId }, { enabled: isOwner });
  return new Set(isOwner ? q.data?.userIds ?? [] : []);
}

/**
 * The entry point: one quiet button per person, opening their sheet. Rendered
 * only for the Owner, only for people with something to re-credit.
 */
export function RecreditButton({
  tripId,
  competitionId,
  userId,
  personName,
}: {
  tripId: string;
  competitionId: string;
  userId: string;
  personName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium"
        style={{ color: "var(--color-bt-text)", border: "1px dashed var(--color-bt-border)" }}
        data-testid="recredit-open"
        data-user-id={userId}
      >
        <History size={13} style={{ color: "var(--color-bt-text-dim)" }} />
        Re-credit {personName}&rsquo;s finished games
      </button>
      {open && (
        <RecreditFlow
          tripId={tripId}
          competitionId={competitionId}
          userId={userId}
          personName={personName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RecreditFlow({
  tripId,
  competitionId,
  userId,
  personName,
  onClose,
}: {
  tripId: string;
  competitionId: string;
  userId: string;
  personName: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const preview = trpc.recredits.preview.useQuery(
    { tripId, competitionId, userId },
    // Always fresh: a preview is a promise about the board as it stands NOW.
    { staleTime: 0, gcTime: 0, refetchOnWindowFocus: false }
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyError, setApplyError] = useState<string | null>(null);

  const apply = trpc.recredits.confirm.useMutation({
    onSuccess: () => {
      invalidateGameBoards(utils, { tripId, competitionId });
      void utils.recredits.candidates.invalidate({ tripId, competitionId });
      onClose();
    },
    onError: (err) => setApplyError(err.message),
  });

  const state: RecreditSheetState = preview.isError
    ? { phase: "error" }
    : preview.data
      ? { phase: "ready", preview: preview.data }
      : { phase: "loading" };

  return createPortal(
    <RecreditSheet
      personName={personName}
      state={state}
      selected={selected}
      onToggle={(gameId) => {
        setApplyError(null);
        setSelected((s) => {
          const next = new Set(s);
          if (next.has(gameId)) next.delete(gameId);
          else next.add(gameId);
          return next;
        });
      }}
      onCancel={onClose}
      isPending={apply.isPending}
      applyError={applyError}
      onReview={() => {
        setApplyError(null);
        setSelected(new Set());
        void preview.refetch();
      }}
      onConfirm={() => {
        if (!preview.data || selected.size === 0) return;
        apply.mutate({
          tripId,
          competitionId,
          userId,
          expectedTeamId: preview.data.toTeamId,
          games: preview.data.eligible
            .filter((g) => selected.has(g.gameId))
            .map((g) => ({ gameId: g.gameId, fingerprint: g.fingerprint })),
        });
      }}
    />,
    document.body
  );
}
