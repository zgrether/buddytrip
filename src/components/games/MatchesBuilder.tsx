"use client";

import { MatchesAccordionRow } from "@/components/games/MatchesAccordionRow";
import { PlayerSelector } from "@/components/games/matchSetup/MatchSetup";
import type { DraftMatchConfig } from "@/lib/configDraft";
import { assignInDraft } from "@/lib/matchDraft";
import type { LBTeamLite } from "@/components/competition/CompetitionGamesPanel";
import { slotPool } from "@/lib/pairingShape";

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
  headToHead,
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
  /** The cup's teams, in creation order. In a Match Play cup side A binds to
   *  teams[0] and side B to teams[1], same as the scoreboard's
   *  `NonGolfMatchControl`, so a runner sees ONE pair of colors across both
   *  surfaces. Renders nothing for a cup with no teams. */
  teams: LBTeamLite[];
  /** Is the cup head to head (Match Play)? Binds each side to its team. A points
   *  race binds nothing (PR 5): any rostered player may play either side, from
   *  any of its teams, same-team opponents included (ruling 10). */
  headToHead: boolean;
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
  // This used to take `const [a, b] = teams` in EVERY cup, so in a points race
  // with three teams, team 3 could never be paired and counted as roster-invalid,
  // and which two teams became A and B followed an unordered query.
  if (teams.length === 0) return null;
  if (headToHead && teams.length !== 2) return null; // a Match Play cup is exactly two

  const teamForSlot = (slot: "a" | "b") => (headToHead ? (slot === "a" ? teams[0] : teams[1]) : undefined);
  // Everyone rostered, in team order — the pool in a points race, and the
  // roster-validity check's input in either kind of cup.
  const rostered = teams.flatMap((t) => rosterByTeam.get(t.id) ?? []);
  const teamedUserIds = new Set(rostered);
  const poolFor = (slot: "a" | "b") => slotPool(headToHead, teams.map((t) => t.id), rosterByTeam, slot);

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
        inCup
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
          colorOf={teamColorOf}
          draft={draft}
          crew={poolFor(selector.slot)}
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
