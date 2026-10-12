"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { useTripRole } from "@/hooks/useTripRole";
import { rosterGateDecision, useRosterChangeGate } from "@/components/competition/RosterChangeGate";
import { cancelRosterWriters } from "@/lib/rosterCacheSync";
import { createRosterMutations, newRosterBurst } from "@/lib/rosterMutations";

/**
 * Moved out of `TeamsPanel.tsx` unchanged (PR 9b) so the match builder's
 * "Add to {team}" takes the SAME path the Rosters screen does — the optimistic
 * patch, the invalidation set, and after results the 8b preview — rather than a
 * second assign with its own list of what to refresh (CLAUDE.md #22: one
 * invalidator, not two lists that happen to match).
 */

export interface Assignment {
  competition_id: string;
  user_id: string;
  team_id: string;
  is_captain?: boolean;
  sort_order?: number;
}

// ── Optimistic mutation hook ────────────────────────────────────────────────
// Both the drag-drop drop handler and the mobile crew roster talk to the
// same teamAssignments cache; this hook wires the four roster mutations to
// ONE shared cache policy (`createRosterMutations`), so the avatar chip moves
// the instant the user drops or picks a team, not after the network roundtrip.
//
// The policy lives in `src/lib/rosterMutations.ts`, where a test drives it:
// the optimistic patches, the trailing-edge settle that re-pulls server truth
// once a burst drains, and NO snapshot restore on error (#1405 — a restored
// snapshot discarded a sibling tap the server had already committed).

export function useTeamAssignmentMutations(tripId: string, competitionId: string) {
  const utils = trpc.useUtils();
  const queryKey = { tripId, competitionId };
  // The burst counter is the only state that must outlive a render: it holds
  // the refetch until the last tap of a burst settles, across all four
  // mutations. The options around it are rebuilt each render, on the current key.
  const [burst] = useState(newRosterBurst);
  const policy = createRosterMutations(
    {
      cancelWriters: () => cancelRosterWriters(utils, queryKey),
      patch: (fn) =>
        utils.teamAssignments.list.setData(queryKey, (old) =>
          fn((old as Assignment[] | undefined) ?? []) as never
        ),
      refetch: ({ leaderboard }) => {
        const u = utils;
        u.teamAssignments.list.invalidate(queryKey);
        // Only when a team's SIZE moved (assign / remove): a reorder-only burst
        // doesn't force an extra leaderboard refetch.
        if (leaderboard) u.competitions.leaderboard.invalidate(queryKey);
        // faceBootstrap ALSO seeds teamAssignments.list (#10): the consolidated
        // TeamSheet opens OUTSIDE the LiveFace re-seed path, so re-resolve the
        // bootstrap or the board reads stale until the 30s poll.
        u.competitions.faceBootstrap.invalidate({ tripId: queryKey.tripId });
        // Moving someone between teams (or off one) changes THEIR avatar colour,
        // which the app bar reads on every tab — cached with staleTime: Infinity,
        // so it only refreshes if invalidated here.
        u.competitions.myTeamColor.invalidate({ tripId: queryKey.tripId });
        // Who the Owner could re-credit (PR 8c) is "credited somewhere other
        // than where they are NOW" — so a move, add or removal changes it.
        // Found on the 8c fixture build: Bob moved to Spartans and his
        // "Re-credit" button only appeared after a reload. (A no-op for anyone
        // but the Owner: the query is never enabled for them.)
        if (leaderboard) u.recredits.candidates.invalidate({ tripId: queryKey.tripId, competitionId: queryKey.competitionId });
      },
    },
    burst
  );

  const rawAssign = trpc.teamAssignments.assign.useMutation(policy.assign);
  const rawRemove = trpc.teamAssignments.remove.useMutation(policy.remove);

  // ── The roster-change gate (PR 8b-2) ──────────────────────────────────────
  // Every move and removal on every roster surface comes through here, so the
  // after-results preview is not something each entry point has to remember.
  // Before results, and for anyone but staff, these run exactly as they did.
  const gate = useRosterChangeGate();
  const { canEdit: staff } = useTripRole(tripId);
  const { data: hasResults = false } = trpc.teamAssignments.hasResults.useQuery(queryKey, { enabled: !!competitionId });
  const nameOf = (userId: string) =>
    ((utils.tripMembers.list.getData({ tripId }) ?? []) as { user_id: string | null; displayName?: string }[])
      .find((m) => m.user_id === userId)?.displayName ?? "This player";
  const teamNameOf = (teamId: string | null | undefined) =>
    ((utils.teams.list.getData(queryKey) ?? []) as { id: string; name: string }[]).find((t) => t.id === teamId)?.name ?? "their team";
  const currentTeamOf = (userId: string) =>
    ((utils.teamAssignments.list.getData(queryKey) ?? []) as Assignment[]).find((a) => a.user_id === userId)?.team_id ?? null;

  type AssignVars = Parameters<typeof rawAssign.mutate>[0];
  type RemoveVars = Parameters<typeof rawRemove.mutate>[0];
  const assign = {
    ...rawAssign,
    /**
     * `onRun` fires when the change ACTUALLY runs — at once when it goes
     * direct, or when the organizer confirms the preview — and never on a
     * cancelled preview. The match builder places the person in its slot there
     * (9b look), so a cancelled add leaves the slot as it was.
     */
    mutate: (vars: AssignVars, opts?: { onRun?: () => void }) => {
      const currentTeamId = currentTeamOf(vars.userId);
      const decision = rosterGateDecision({ staff, hasResults, kind: "assign", currentTeamId, toTeamId: vars.teamId });
      if (decision === "direct" || !gate) {
        rawAssign.mutate(vars);
        opts?.onRun?.();
        return;
      }
      gate({
        // No current team: an ADD (previewed after results, ruling 20).
        kind: currentTeamId ? "move" : "add",
        userId: vars.userId,
        personName: nameOf(vars.userId),
        fromTeamName: teamNameOf(currentTeamId),
        toTeamName: teamNameOf(vars.teamId),
        toTeamId: vars.teamId,
        run: (rosterFingerprint) => {
          rawAssign.mutate({ ...vars, rosterFingerprint });
          opts?.onRun?.();
        },
      });
    },
  };
  const remove = {
    ...rawRemove,
    mutate: (vars: RemoveVars) => {
      const currentTeamId = currentTeamOf(vars.userId);
      const decision = rosterGateDecision({ staff, hasResults, kind: "remove", currentTeamId });
      if (decision === "direct" || !gate) return rawRemove.mutate(vars);
      gate({
        kind: "remove",
        userId: vars.userId,
        personName: nameOf(vars.userId),
        fromTeamName: teamNameOf(currentTeamId),
        toTeamId: null,
        run: (rosterFingerprint) => rawRemove.mutate({ ...vars, rosterFingerprint }),
      });
    },
  };
  // reorder (Part 3): the roster lists derive display order from sort_order, so
  // the rows resequence instantly; the order survives an overlay close + reopen
  // because the settle re-resolves faceBootstrap (#10).
  const reorder = trpc.teamAssignments.reorder.useMutation(policy.reorder);
  // setCaptain (PR b): one captain per team; survives an overlay close/reopen
  // for the same reason.
  const setCaptain = trpc.teamAssignments.setCaptain.useMutation(policy.setCaptain);

  return { assign, remove, setCaptain, reorder };
}
