"use client";

import { MatchesAccordionRow } from "@/components/games/MatchesAccordionRow";
import { PlayerSelector } from "@/components/games/matchSetup/MatchSetup";
import type { DraftMatchConfig } from "@/lib/configDraft";
import { assignInDraft } from "@/lib/matchDraft";
import type { LBTeamLite } from "@/components/competition/CompetitionGamesPanel";

/**
 * Non-golf Matches' pairing, in settings — the non-golf ADAPTER over
 * `MatchesAccordionRow` (golf's own accordion, extracted and shared —
 * settings-parity handoff §3). This file's job is resolving Matches' shape
 * (`teams: LBTeamLite[]` + a team→roster map) into the maps/callbacks the
 * shared row and `PlayerSelector` take — the same adapter role
 * `PickemMatchBuilder` plays for pick'em's shape.
 *
 * ── What used to be here, and why it's gone ─────────────────────────────
 * A bare "MATCHES" header with its own divisor readout ("3 matches ·
 * 2.67 pts each") — a hand-rolled composition summary this file computed
 * itself. Settings-parity §3 replaced it: the summary golf already renders
 * ("2 singles · 1 double · 3 of 3 assigned") lives in `MatchesAccordionRow`
 * now, and the points-per-match figure moved to the Total Points / Point
 * Distribution rows (§1/§2) — a runner reads what a match is WORTH there,
 * not on the pairing row, matching golf's own split.
 *
 * `PlayerSelector` stays owned HERE rather than inside the shared row,
 * mirroring golf's own separation: the CREW pool for a slot is per-caller
 * (golf resolves a team's roster one way, this resolves it from
 * `rosterByTeam`), so `MatchesAccordionRow` only forwards `openSelector` and
 * never renders the selector itself — see that file's header.
 */
export function MatchesBuilder({
  draft,
  setDraft,
  teams,
  rosterByTeam,
  nameMap,
  colorMap,
  avatarIconMap,
  teamColorOf,
  canEdit,
  expanded,
  onToggle,
  selector,
  setSelector,
}: {
  draft: DraftMatchConfig[];
  setDraft: (fn: (prev: DraftMatchConfig[]) => DraftMatchConfig[]) => void;
  /** The cup's two teams — side A binds to teams[0], side B to teams[1], same
   *  as the scoreboard's `NonGolfMatchControl` so a runner sees ONE pair of
   *  colors across both surfaces. Renders nothing for a standalone game
   *  (Matches needs two teams to pair between — see the caller's gate). */
  teams: LBTeamLite[];
  /** team id → member user ids — the PICKER'S pool per side, and (flattened)
   *  the roster-validity check's input. `LBTeamLite` itself carries no
   *  roster, so this is the caller's own team→crew index (built off
   *  `teamAssignments`, the same source `teamByUser` reads). */
  rosterByTeam: Map<string, string[]>;
  nameMap: Map<string, string>;
  colorMap: Map<string, string>;
  avatarIconMap: Map<string, string | null>;
  teamColorOf: (userId: string) => string | undefined;
  canEdit: boolean;
  expanded: boolean;
  onToggle: () => void;
  selector: { matchIdx: number; slot: "a" | "b"; memberIdx: number } | null;
  setSelector: (s: { matchIdx: number; slot: "a" | "b"; memberIdx: number } | null) => void;
}) {
  const [a, b] = teams;
  if (!a || !b) return null;

  const teamForSlot = (slot: "a" | "b") => (slot === "a" ? a : b);
  // Always a 2-team competition here (the gate above already refused
  // otherwise), so the roster-validity half of `invalid` is always live —
  // unlike golf, which also serves a standalone (no-team) shape.
  const teamedUserIds = new Set([...(rosterByTeam.get(a.id) ?? []), ...(rosterByTeam.get(b.id) ?? [])]);

  return (
    <>
      <MatchesAccordionRow
        draft={draft}
        setDraft={setDraft}
        nameOf={nameMap}
        colorOf={colorMap}
        teamColorOf={teamColorOf}
        avatarIconOf={avatarIconMap}
        teamForSlot={teamForSlot}
        // The generous ceiling every non-pick'em caller uses — no team-size cap
        // (a 2v2 game can outgrow either roster's size, e.g. guests filling in).
        maxMatches={24}
        twoTeams
        teamedUserIds={teamedUserIds}
        openSelector={(matchIdx, slot, memberIdx) => setSelector({ matchIdx, slot, memberIdx })}
        expanded={expanded}
        onToggle={onToggle}
        canEdit={canEdit}
        // Mixed shapes are allowed (Phase 0 decision 4, and the reason decision
        // 5 reversed — settings-parity §1): `singlesOnly` is OMITTED, restoring
        // the 1v1/2v2 choice `MatchSetup` already offers.
        //
        // `frozen` here is ACCESS control (a viewer without edit rights), not
        // golf's "scores exist" trigger — this page has no live-add path (no
        // `onAddLive`), so there is no separate "frozen but still appendable"
        // state to represent. The load-bearing guard against moving a DECIDED
        // match's result is migration 171, server-side; this is UX only
        // (see #1177 for the gap between the two).
        frozen={!canEdit}
      />

      {selector && (
        <PlayerSelector
          matchIdx={selector.matchIdx}
          slot={selector.slot}
          memberIdx={selector.memberIdx}
          sided
          teamLabel={teamForSlot(selector.slot)?.name}
          teamColor={teamForSlot(selector.slot)?.color}
          draft={draft}
          crew={rosterByTeam.get(teamForSlot(selector.slot)?.id ?? "") ?? []}
          nameOf={nameMap}
          onPick={(userId) => {
            // The shared assigner (#708/#747): one removal pass across every
            // match and both sides (a player can only be in one match), then a
            // 2v2 destination-slot SWAP rather than a replace — the same
            // mechanism golf's own PlayerSelector call uses, so a picked player
            // behaves identically on both surfaces.
            setDraft((prev) => assignInDraft(prev, selector.matchIdx, selector.slot, selector.memberIdx, userId));
            setSelector(null);
          }}
          onClose={() => setSelector(null)}
        />
      )}
    </>
  );
}
