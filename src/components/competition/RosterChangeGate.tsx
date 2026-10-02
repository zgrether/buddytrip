"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { ArrowRightLeft, UserMinus, Ban } from "lucide-react";
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
 * A pure ADD after results also goes straight through — it needs no preview; the
 * server still refuses one for someone in an unfinished team-dependent game, and
 * says which game.
 */

export type RosterChangeKind = "move" | "remove";

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
  // assign: an ADD (no current team) or a same-team no-op runs directly; only a
  // MOVE between teams is a trade, and a trade after results is reviewed.
  if (!p.currentTeamId || p.currentTeamId === p.toTeamId) return "direct";
  return "preview";
}

export interface RosterGame {
  gameId: string;
  name: string;
}

export interface RosterPreview {
  fingerprint: string;
  hasResults: boolean;
  finishedGames: number;
  moving: RosterGame[];
  blocking: RosterGame[];
}

export interface RosterChangeRequest {
  kind: RosterChangeKind;
  userId: string;
  personName: string;
  /** The team they are on now. */
  fromTeamName: string;
  /** The destination, for a move. */
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
}: {
  request: Omit<RosterChangeRequest, "run">;
  state: SheetState;
  isPending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { kind, personName, fromTeamName, toTeamName } = request;
  const blocked = state.phase === "ready" && state.preview.blocking.length > 0;
  const destination = kind === "move" ? toTeamName ?? "the new team" : null;

  const title = blocked
    ? kind === "move"
      ? `${personName} can't be moved yet`
      : `${personName} can't be removed from ${fromTeamName} yet`
    : kind === "move"
      ? `Move ${personName} to ${destination}?`
      : `Remove ${personName} from ${fromTeamName}?`;

  const Icon = blocked ? Ban : kind === "move" ? ArrowRightLeft : UserMinus;

  return (
    <ScrollLock>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
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
                <li data-testid="roster-change-no-points">
                  {state.preview.finishedGames > 0
                    ? "No points move. Finished games stay with the team they were played for."
                    : "No points move. Nothing has finished yet."}
                </li>
                {state.preview.moving.map((g) => (
                  <li key={g.gameId} data-testid="roster-change-moving">
                    {g.name} isn&rsquo;t finished — {personName}&rsquo;s result in it will count for{" "}
                    {destination ?? "no team"} when it is.
                  </li>
                ))}
                <li data-testid="roster-change-projections">Live projections update straight away.</li>
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
                  {kind === "move" ? `Move to ${destination}` : `Remove from ${fromTeamName}`}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl px-4 py-2.5 text-sm font-medium"
                style={{ background: "transparent", color: "var(--color-bt-text-dim)", border: "0.5px solid var(--color-bt-border)" }}
              >
                {state.phase === "loading" ? "Cancel" : "OK"}
              </button>
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
  children,
}: {
  tripId: string;
  competitionId: string | null;
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
      {request && (
        <RosterChangeSheet
          request={request}
          state={state}
          onCancel={close}
          onConfirm={() => {
            if (state.phase !== "ready") return;
            request.run(state.preview.fingerprint);
            close();
          }}
        />
      )}
    </GateContext.Provider>
  );
}
