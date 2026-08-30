"use client";

import { MatchSetup, PlayerSelector } from "@/components/games/matchSetup/MatchSetup";
import type { DraftMatchConfig } from "@/lib/configDraft";
import { liveMatchPointsPerMatch } from "@/lib/pointsDistribution";
import { assignInDraft } from "@/lib/matchDraft";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import type { LBTeamLite } from "@/components/competition/CompetitionGamesPanel";

/**
 * Non-golf Matches' pairing, in settings — the shared match-play builder,
 * composed exactly the way `PickemMatchBuilder` composes it (that file's own
 * header has the extraction history: `MatchSetup` was already the golf/pick'em
 * shape, and a third caller confirms it rather than tests it for the first
 * time).
 *
 * ── What is Matches', and stays here ────────────────────────────────────────
 *
 * Nothing, deliberately. Pick'em adds Randomize/Clear because zipping two
 * fixed rosters is a real convenience for that shape; Matches has no such
 * shape to zip — a cornhole crew is built match by match, "Add match" already
 * does that job, and `MatchSetup` offers 1v1/2v2 per row (`singlesOnly` is
 * OMITTED here — Phase 0's decision: mixed shapes cost nothing to allow and
 * pool games are 1v1 while cornhole is 2v2, so the choice has to survive).
 * The divisor line stays, because a runner deciding how many matches to build
 * needs to see what each is worth as they go, same reason pick'em keeps it.
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
  pointsTotal,
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
  /** team id → member user ids — the PICKER'S pool per side. `LBTeamLite`
   *  itself carries no roster, so this is the caller's own team→crew index
   *  (built off `teamAssignments`, the same source `teamByUser` reads). */
  rosterByTeam: Map<string, string[]>;
  nameMap: Map<string, string>;
  colorMap: Map<string, string>;
  avatarIconMap: Map<string, string | null>;
  teamColorOf: (userId: string) => string | undefined;
  canEdit: boolean;
  pointsTotal: number | null;
  selector: { matchIdx: number; slot: "a" | "b"; memberIdx: number } | null;
  setSelector: (s: { matchIdx: number; slot: "a" | "b"; memberIdx: number } | null) => void;
}) {
  const [a, b] = teams;
  if (!a || !b) return null;

  const teamForSlot = (slot: "a" | "b") => (slot === "a" ? a : b);

  const valid = draft.filter((m) => m.a.length === m.playersPerSide && m.b.length === m.playersPerSide).length;
  const perMatch = liveMatchPointsPerMatch(
    pointsTotal,
    draft.map((m) => ({
      // #1031's own contract: a match counts once BOTH sides are fully filled
      // for its shape (`isDraftMatchFilled`), not once either side has anyone —
      // a half-built 2v2 row must not enter the divisor.
      sideAId: m.a.length === m.playersPerSide ? (m.a[0] ?? null) : null,
      sideBId: m.b.length === m.playersPerSide ? (m.b[0] ?? null) : null,
      pointValue: m.pointValue,
    }))
  );

  return (
    <div className="flex flex-col gap-2" data-testid="matches-builder">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-1">
        <span style={EYEBROW}>Matches</span>
        <span
          data-testid="matches-divisor"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
        >
          {valid === 0
            ? "Nobody paired yet"
            : `${valid} match${valid === 1 ? "" : "es"} · ${perMatch.toFixed(2)} pts each`}
        </span>
      </div>

      <MatchSetup
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
        openSelector={(matchIdx, slot, memberIdx) => setSelector({ matchIdx, slot, memberIdx })}
        // `frozen` here is ACCESS control (a viewer without edit rights), not
        // the "scores exist" trigger golf's own caller uses — this page has no
        // live-add path (no `onAddLive`), so there is no separate "frozen but
        // still appendable" state to represent. The load-bearing guard against
        // moving a DECIDED match's result is migration 171, server-side; this
        // is UX only, matching how `MatchSetup`'s own doc frames `frozen` as
        // preventing an error rather than being the enforcement itself.
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
    </div>
  );
}
