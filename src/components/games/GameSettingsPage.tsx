"use client";

import type { ReactNode } from "react";
import { GameDangerZone } from "@/components/games/GameDangerZone";
import { GameManagementPanel } from "@/components/games/GameManagementPanel";
import { GameIdentityHeader } from "@/components/games/GameIdentityHeader";
import { GameRulesNote } from "@/components/games/GameRulesNote";
import { formatExplanation } from "@/components/games/GameFormatExplainer";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import { SettingsColumn } from "@/components/games/SettingsColumn";
import { SettingsSlideOver } from "@/components/games/SettingsSlideOver";
import { FORMAT_SURFACE, type GameSurfaceId } from "@/lib/formatSurface";
import type { GameRow } from "@/components/competition/CompetitionGamesPanel";

/**
 * The ONE game settings page — every format, one assembly.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * Three trees: `GameConfigurationView` (rack + stroke), `NonGolfConfigurationView`,
 * and ~390 lines inlined in `MatchGameView`. They were never three designs. All
 * three already rendered the same skeleton — `SettingsSlideOver` → `SettingsColumn`
 * → `ZoneHeader`-separated sections → `GameDangerZone` — in the same canonical
 * order, out of the same shared components, having been dragged into agreement one
 * cross-format consistency pass at a time. What differed was which rows each zone
 * held, which is a slot, and a handful of accidents, which is the problem.
 *
 * ── The order is the contract ───────────────────────────────────────────────
 *   identity → GAME MANAGEMENT (points → course → state) → <SETTINGS zone>
 *   → rules → modifiers → danger zone
 * That sequence is load-bearing and was arrived at deliberately (Rules is the
 * QUIET tier, so it reads before the WARNED Modifiers accordion; Course resolves
 * before Handicaps because per-hole strokes need a stroke index). It is expressed
 * once here rather than three times, so the next pass cannot move two of three.
 *
 * ── Why the format slots are nodes and not booleans ─────────────────────────
 * A slot takes the rows a format actually has, already wired to that format's
 * draft. The page decides WHERE they go and whether the zone exists; the view
 * decides what they are. The alternative — the page branching on surface id —
 * puts four formats' knowledge in one component and reintroduces exactly the
 * per-format `if` this phase exists to delete.
 *
 * ── What was NOT collapsed, and why it was safe to ──────────────────────────
 * Match wrapped its whole GAME MANAGEMENT zone in `canEdit`, and gated its save
 * bar on `canEdit`, where the other three did neither. Those read as behaviour
 * divergences and are not: all four formats gate `onSettings` on `canEdit`, and
 * `useGameSettingsOverlay` gates the `?settings=1` deep link on `canEdit` too, so
 * this page is unreachable with `canEdit === false`. They were dead conditionals,
 * proven dead before removal rather than assumed dead. See the PR for the third
 * (match's extra `pb-4`), which was a real 16px and is the one visible delta.
 */
export function GameSettingsPage({
  surface,
  onClose,
  saveBar,
  tripId,
  competitionId,
  game,
  canEdit,
  isOwner,
  canManageGame,
  nameValue,
  onNameChange,
  delegateValue,
  onDelegateChange,
  totalPointsRow,
  courseRow,
  standaloneRows,
  management,
  settingsRows,
  rulesValue,
  onRulesChange,
  modifiersRow,
  onChanged,
  onDeleted,
  onScoresReset,
}: {
  /** Which format is being configured — supplies the SETTINGS zone header. */
  surface: GameSurfaceId;
  onClose: () => void;
  /** The shared `SettingsSaveBar`, rendered as the slide-over's sticky footer. */
  saveBar: ReactNode;
  tripId: string;
  /** Null for a standalone game: identity, points and rules are competition
   *  concepts and are hidden without one — the same gate all three trees used. */
  competitionId: string | null;
  game: GameRow;
  canEdit: boolean;
  /** Trip Owner ONLY. Gates the delegation grant inside `GameIdentityHeader` —
   *  handing someone edit rights is changing who is trusted. Do NOT reuse this
   *  for the danger zone; see `canManageGame`. */
  isOwner: boolean;
  /** Trip Owner or Organizer, delegates excluded. Gates the danger zone
   *  (reset/delete), matching its server gate since #788. Split from `isOwner`
   *  in #789 — one flag can't guard two powers with different answers. */
  canManageGame: boolean;

  /** Identity — name and assigned-to, both draft slices. */
  nameValue: string;
  onNameChange: (next: string) => void;
  delegateValue: string | null;
  onDelegateChange: (next: string | null) => void;

  /** GAME MANAGEMENT, 1st — the format's Total Points row. Competition only. */
  totalPointsRow?: ReactNode;
  /** GAME MANAGEMENT, 2nd — the Golf Course row. Omitted by non-golf, which has
   *  no course; `FORMAT_SURFACE[surface].course` records that answer and
   *  `oneSettingsPage.test.ts` pins the two together. */
  courseRow?: ReactNode;
  /** Rows shown only on a STANDALONE game (match's read-only Players echo). In a
   *  competition the rosters live on the competition face, so this is redundant
   *  noise there and the row is hidden entirely. */
  standaloneRows?: ReactNode;
  /** GAME MANAGEMENT, 3rd — the single Setup/Scoring toggle. `staged` is
   *  draft ≠ server, so the subtitle never claims a state the server lacks. */
  management: {
    scoringEnabled: boolean;
    ready: boolean;
    blockedReason?: string | null;
    onEnable: () => void;
    onDisable: () => void;
    pending: boolean;
    staged: boolean;
  };

  /** The SETTINGS zone body — the format's own spine. The zone header renders
   *  only when there is content, which is what all three trees did. */
  settingsRows?: ReactNode;

  rulesValue: string | null;
  onRulesChange: (next: string) => void;

  /** The Game Modifiers row, AFTER Rules of the Day. Omitted by non-golf. */
  modifiersRow?: ReactNode;

  /** Danger-zone aftermath. `onScoresReset` is REQUIRED: a host that can't say
   *  what a reset means locally shows stale scores until it remounts (#807). */
  onChanged: () => void;
  onDeleted: () => void;
  onScoresReset: () => void;
}) {
  const { settingsZoneLabel } = FORMAT_SURFACE[surface];

  return (
    <SettingsSlideOver
      title={nameValue || "Game settings"}
      onClose={onClose}
      footer={saveBar}
      testId="game-settings-slideover"
    >
      <SettingsColumn>
        {/* IDENTITY — name (tap-to-edit) + assigned-to, both draft slices. A live
            write here would move the config hash out from under the frozen
            baseHash the page's own Save is holding. */}
        {competitionId && (
          <GameIdentityHeader
            tripId={tripId}
            competitionId={competitionId}
            canEdit={canEdit}
            isOwner={isOwner}
            nameValue={nameValue}
            onNameChange={onNameChange}
            delegateValue={delegateValue}
            onDelegateChange={onDelegateChange}
          />
        )}

        {/* GAME MANAGEMENT — Total Points (1st) → Golf Course (2nd) → Game State
            (3rd). Points and Course sit here rather than in SETTINGS because
            neither depends on the format's spine: a total is settable before a
            single match exists, and a course is an independent lookup. */}
        <ZoneHeader>Game Management</ZoneHeader>
        {competitionId && totalPointsRow}
        {courseRow}
        <GameManagementPanel
          mode={management.scoringEnabled ? "scoring" : "setup"}
          ready={management.ready}
          blockedReason={management.blockedReason}
          onEnable={management.onEnable}
          onDisable={management.onDisable}
          pending={management.pending}
          staged={management.staged}
        />
        {!competitionId && standaloneRows}

        {/* SETTINGS — the format's spine, under its own label. */}
        {settingsRows && (
          <>
            <ZoneHeader>{settingsZoneLabel}</ZoneHeader>
            {settingsRows}
          </>
        )}

        {/* RULES OF THE DAY — the QUIET tier (free text, can't rescore a hole),
            so it reads before the WARNED Modifiers accordion below. */}
        {competitionId && (
          <GameRulesNote
            canEdit={canEdit}
            value={rulesValue ?? ""}
            onChange={onRulesChange}
            starterText={formatExplanation(game.game_type_id) ?? undefined}
          />
        )}

        {modifiersRow}

        {/* DANGER ZONE — the one place on this page that deliberately reads the
            SERVER's scoring flag rather than the draft. These are not drafted
            edits; they are immediate, irreversible surgery, and a game being
            scored on right now must not have its scores wiped because someone
            staged a Setup toggle they haven't saved. */}
        {canManageGame && (
          <GameDangerZone
            tripId={tripId}
            gameId={game.id}
            competitionId={competitionId}
            onChanged={onChanged}
            onDeleted={onDeleted}
            onScoresReset={onScoresReset}
          />
        )}
      </SettingsColumn>
    </SettingsSlideOver>
  );
}
