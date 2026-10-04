"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, UserMinus, UserPlus, Ban } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";

/**
 * The before-and-after preview for a staff roster change once a cup has results
 * (PR 8b-2, ruling 20). The server half is `rosterChange.ts`: after results a
 * move or a removal from a team must carry the fingerprint of the preview it was
 * built on, and is refused while the person is in an unfinished team-dependent
 * game.
 *
 * ── One gate, every entry point ───────────────────────────────────────────
 *
 * The Rosters screen moves and removes people from five places (the team card's
 * drag and ×, the crew list's dropdown and drop-to-unassign, and the Edit Team
 * modal). They all take their mutations from `useTeamAssignmentMutations`, which
 * routes through `useRosterChangeGate` — so the preview is not something each
 * entry point has to remember. The provider sits at the competition face, above
 * every surface that renders a roster (`TeamsPanel`, and `TeamSheet` from the
 * face and the hero).
 *
 * ── What it does NOT change ───────────────────────────────────────────────
 *
 * Before results, and for anyone but staff, the mutation runs exactly as it did
 * (ruled: a stale pre-results move is visible, reversible and scores nothing).
 * After results an ADD is previewed too (ruling 20, settled on the 8b-2 look):
 * it changes what the person's unfinished games count for, and a refusal for the
 * blocked case would not tell an organizer what the add does in the allowed one.
 *
 * ── A blocked change has a ROUTE, not only a reason ───────────────────────
 *
 * "Finish it or take them out of it first" with nothing else left the organizer
 * stranded in Edit Team to go and find the game. The blocked sheet's primary
 * action opens the game (Zach, on the 8b-2 look) — the same lesson as an
 * unpaired match: a state with a reason but no route is half the improvement.
 */

export type RosterChangeKind = "move" | "remove" | "add";

/** Whether a change runs now or goes through the preview. Pure, so every rule
 *  the screen follows is testable without a DOM. */
export function rosterGateDecision(p: {
  staff: boolean;
  hasResults: boolean;
  kind: "assign" | "remove";
  currentTeamId: string | null;
  toTeamId?: string | null;
}): "direct" | "preview" {
  if (!p.staff || !p.hasResults) return "direct";
  if (p.kind === "remove") return p.currentTeamId ? "preview" : "direct";
  // assign: a same-team re-assign is a no-op and runs directly. A MOVE between
  // teams and an ADD to a team both change what the person's unfinished games
  // count for, so after results both are reviewed (ruling 20).
  if (p.currentTeamId === p.toTeamId) return "direct";
  return "preview";
}

export interface RosterGame {
  gameId: string;
  name: string;
}

export interface RosterPreview {
  fingerprint: string;
  hasResults: boolean;
  /** This person played in a finished game. No team: see `RosterChangePreview`. */
  hasFinishedGames: boolean;
  moving: RosterGame[];
  blocking: RosterGame[];
}

export interface RosterChangeRequest {
  kind: RosterChangeKind;
  userId: string;
  personName: string;
  /** The team they are on now (unused for an add — they are on none). */
  fromTeamName: string;
  /** The destination, for a move or an add. */
  toTeamName?: string;
  /** Runs the change with the fingerprint the preview was built on. */
  run: (rosterFingerprint: string) => void;
}

type SheetState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; preview: RosterPreview };

function nameGames(games: RosterGame[]): string {
  const names = games.map((g) => g.name);
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * The sheet itself — presentational, so its copy is testable by static render.
 *
 * WORDING IS LOAD-BEARING: a removal says "from {Team}" every time and never a
 * bare "remove {name}". Leaving the trip is PR 8d's act, with different
 * consequences, and an organizer must not be able to confuse the two from the
 * words on this sheet (Zach, 2026-10-02).
 */
export function RosterChangeSheet({
  request,
  state,
  isPending = false,
  onCancel,
  onConfirm,
  onOpenGame,
}: {
  request: Omit<RosterChangeRequest, "run">;
  state: SheetState;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Open a game the change is blocked by. Absent → the blocked sheet offers OK only. */
  onOpenGame?: (game: RosterGame) => void;
}) {
  const { kind, personName, fromTeamName, toTeamName } = request;
  const blocked = state.phase === "ready" && state.preview.blocking.length > 0;
  const destination = kind === "remove" ? null : toTeamName ?? "the new team";

  const title = blocked
    ? kind === "move"
      ? `${personName} can't be moved yet`
      : kind === "add"
        ? `${personName} can't join ${destination} yet`
        : `${personName} can't be removed from ${fromTeamName} yet`
    : kind === "move"
      ? `Move ${personName} to ${destination}?`
      : kind === "add"
        ? `Add ${personName} to ${destination}?`
        : `Remove ${personName} from ${fromTeamName}?`;

  const Icon = blocked ? Ban : kind === "remove" ? UserMinus : kind === "add" ? UserPlus : ArrowRightLeft;
  const firstBlocking = state.phase === "ready" ? state.preview.blocking[0] : undefined;

  return (
    <ScrollLock>
      <div
        // z-[60] and portalled to <body> by the provider: it opens FROM inside the
        // Rosters overlay and the Edit Team sheet, both z-50, and must clear them —
        // the app's convention for a sheet over a modal (TeamsPanel's add-player
        // picker does the same). Found in the first local render, where the sheet
        // existed with the right title and sat behind the overlay.
        className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onCancel}
        data-testid="roster-change-sheet"
      >
        <div
          className="w-full max-w-sm rounded-t-2xl sm:rounded-2xl"
          style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 pt-5 pb-3 text-center sm:text-left">
            <div
              className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl sm:mx-0"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
            >
              <Icon size={18} />
            </div>
            <h3 className="mt-3 text-base font-bold" style={{ color: "var(--color-bt-text)" }} data-testid="roster-change-title">
              {title}
            </h3>

            {state.phase === "loading" && (
              <p className="mt-1.5 text-sm" style={{ color: "var(--color-bt-text-dim)" }} data-testid="roster-change-loading">
                Checking what this changes…
              </p>
            )}

            {state.phase === "error" && (
              <p className="mt-1.5 text-sm" style={{ color: "var(--color-bt-text-dim)" }} data-testid="roster-change-error">
                Couldn&rsquo;t check what this changes just now. Close this and try again in a moment.
              </p>
            )}

            {state.phase === "ready" && blocked && (
              <p className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }} data-testid="roster-change-blocked">
                {personName} is still playing in {nameGames(state.preview.blocking)}, which was set up with their
                current team. Finish {state.preview.blocking.length === 1 ? "it" : "those games"} or take them out
                of {state.preview.blocking.length === 1 ? "it" : "them"} first.
              </p>
            )}

            {state.phase === "ready" && !blocked && (
              <ul className="mt-2 space-y-1.5 text-left text-sm leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
                {kind === "remove" && (
                  <li data-testid="roster-change-stays">
                    {personName} stays on the trip — this only takes them off {fromTeamName}.
                  </li>
                )}
                {/* FINISHED games: that they stand, and nothing about which team.
                    Their credit is the roster each game finalized with (8a), so
                    any team named here — including "no team" — would be the
                    preview re-deriving from today's roster, which is the bug
                    8a fixed in the writers (Zach's look). A per-team breakdown
                    would grow into a history across trades nobody asked for.
                    No line at all when they played in none. */}
                {state.preview.hasFinishedGames && (
                  <li data-testid="roster-change-finished">
                    {personName} has played in some earlier games — those results will stand.
                  </li>
                )}
                {state.preview.moving.map((g) => (
                  <li key={g.gameId} data-testid="roster-change-moving">
                    {g.name} will count for {destination ?? "no team"} when it finishes.
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 px-5 pb-5 pt-3 sm:flex-row sm:justify-end">
            {state.phase === "ready" && !blocked ? (
              <>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={isPending}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                  style={{ background: "transparent", color: "var(--color-bt-text-dim)", border: "0.5px solid var(--color-bt-border)" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={isPending}
                  className="rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                  style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
                  data-testid="roster-change-confirm"
                >
                  {kind === "move" ? `Move to ${destination}` : kind === "add" ? `Add to ${destination}` : `Remove from ${fromTeamName}`}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium"
                  style={{ background: "transparent", color: "var(--color-bt-text-dim)", border: "0.5px solid var(--color-bt-border)" }}
                >
                  {state.phase === "loading" ? "Cancel" : "OK"}
                </button>
                {blocked && firstBlocking && onOpenGame && (
                  <button
                    type="button"
                    onClick={() => onOpenGame(firstBlocking)}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold"
                    style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
                    data-testid="roster-change-open-game"
                  >
                    Open {firstBlocking.name}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </ScrollLock>
  );
}

const GateContext = createContext<((req: RosterChangeRequest) => void) | null>(null);

/** Null outside a provider — `useTeamAssignmentMutations` then runs changes
 *  directly, and after results the server refuses an unreviewed one with a
 *  sentence saying so. Every roster surface sits under the face's provider. */
export function useRosterChangeGate() {
  return useContext(GateContext);
}

export function RosterChangeGateProvider({
  tripId,
  competitionId,
  onOpenGame,
  children,
}: {
  tripId: string;
  competitionId: string | null;
  /** Take the organizer to a game a change is blocked by: the host closes its
   *  roster overlays and opens the game's panel. */
  onOpenGame?: (gameId: string) => void;
  children: React.ReactNode;
}) {
  const utils = trpc.useUtils();
  const [request, setRequest] = useState<RosterChangeRequest | null>(null);
  const [state, setState] = useState<SheetState>({ phase: "loading" });

  const open = useCallback(
    (req: RosterChangeRequest) => {
      if (!competitionId) return;
      setRequest(req);
      setState({ phase: "loading" });
      // A FRESH read every time: the preview's fingerprint is the claim the
      // confirm makes, so a cached one would confirm against a stale roster.
      utils.teamAssignments.previewChange
        .fetch({ tripId, competitionId, userId: req.userId }, { staleTime: 0 })
        .then((preview) => setState({ phase: "ready", preview }))
        .catch(() => setState({ phase: "error" }));
    },
    [competitionId, tripId, utils]
  );

  const close = () => setRequest(null);

  return (
    <GateContext.Provider value={competitionId ? open : null}>
      {children}
      {request && createPortal(
        <RosterChangeSheet
          request={request}
          state={state}
          onCancel={close}
          onOpenGame={
            onOpenGame
              ? (g) => {
                  close();
                  onOpenGame(g.gameId);
                }
              : undefined
          }
          onConfirm={() => {
            if (state.phase !== "ready") return;
            request.run(state.preview.fingerprint);
            close();
          }}
        />,
        document.body
      )}
    </GateContext.Provider>
  );
}
