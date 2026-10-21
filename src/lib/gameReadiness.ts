import { matchPlayReady } from "./matchDraft";
import { isBracketGame, isMatchesGame } from "./resultStrategy";
import { MIN_BRACKET_FIELD } from "./bracketDraft";
import { splitPlacesWarning, type PlaceCapacity } from "./gameConfig";
import type { PointsDistribution } from "./pointsDistribution";
import { SETUP_REASON_WORD } from "./vocabulary";

/**
 * Why a game is not ready — the ONE rule, for the board, every settings page and
 * the server's enable guard (Zach's Needs-attention rulings, 2026-10-21).
 *
 * Before this the answer lived in three shapes that drifted: the server's
 * yes/no `isConfigured`, the database's go-live branch in `save_game_config`,
 * and five hand-written "why it's blocked" sentences in the settings views. The
 * database and the server disagreed twice (#1686's Matches arm; a cup match
 * game with no points read Ready on the board and was refused at Save), and the
 * views each spelled their own reasons.
 *
 * Now every caller builds a `SetupInput` from what it has (a settings draft, or
 * the database's rows) and reads the reasons from here. Words come from
 * `SETUP_REASON_WORD` in the vocabulary. `gameReadinessParity.test.ts` holds
 * the go-live reasons to the database: each one is a state `save_game_config`
 * refuses, and a game with none goes live.
 *
 * Pure and client-safe: no reads.
 */

// One unified match-play type (Refactor A1) — 1v1/2v2/mixed is per-match, not a
// game type. A Set is kept (rather than an equality) so any future match-play
// variant slots in without touching call sites.
export const MATCH_PLAY_TYPES = new Set(["gtt_match_play"]);
export const RACK_TYPE = "gtt_rack_n_stack";
// Roster-gated golf formats: both stroke and rack are "configured" once they have
// participants assigned to a PLAYING GROUP (the manual group builder). Groupings are
// MANDATORY for both (089) — an ungrouped player isn't in the game — so the caller
// passes the GROUPED participant count (see the grouped-count branch below).
export const SCRAMBLE_TYPE = "gtt_scramble";
/**
 * Scramble belongs here for a STRONGER reason than stroke and rack do, and it is
 * worth stating because the arm it would otherwise fall to (`hasPoints`) looks
 * survivable.
 *
 * For stroke and rack, an ungrouped roster means players nobody has put in a
 * cart. For scramble the play_group IS the scoring unit — migration 181 resolves
 * a member's right to write through `game_participants.play_group_id` — so a
 * scramble game with no groups has literally nobody who can enter a score. Going
 * live would produce a board that cannot be filled in.
 *
 * ── This rule is implemented TWICE and both had to learn it ─────────────────
 *
 * `save_game_config`'s go-live branch (migration 182) carries the same
 * condition in SQL. That duplication is not introduced here — it predates
 * scramble — but scramble is the first format to prove it is a real maintenance
 * cost rather than defence in depth: adding a format means editing two
 * enumerations in two languages that no test compares. Filed rather than fixed
 * in passing.
 */
export const SKINS_TYPE = "gtt_skins";
/**
 * Skins belongs here for scramble's reason AND one of its own.
 *
 * A member's right to record a hole resolves through
 * `game_participants.play_group_id` (`can_score_skins_grouping`, migration 184),
 * so a groupless skins game has nobody who may enter anything — that half is
 * scramble's argument verbatim.
 *
 * The extra half is that the grouping is also the CARRYOVER BOUNDARY. Skins is
 * several independent contests on one round and the grouping is what separates
 * them, so a game with no groups has no contests in it at all — not merely
 * nobody to write, but nothing to write into.
 *
 * Added in the same change as migration 185's matching SQL arm, which is the
 * duplication the note above describes (#1332) being paid a second time rather
 * than discovered a second time.
 */
export const ROSTER_TYPES = new Set(["gtt_stroke_play", RACK_TYPE, SCRAMBLE_TYPE, SKINS_TYPE]);

export const PICKEM_TYPE = "gtt_pickem";

/** What a reason stops, which decides where it may be shown and how loudly. */
export type SetupBlock = "go_live" | "save" | "open_picks";

export type SetupReason =
  | { code: "matches_none" }
  | { code: "matches_unpaired"; unpaired: number }
  | { code: "player_not_on_team" }
  | { code: "groups_none" }
  | { code: "bracket_field" }
  | { code: "points_missing" }
  | { code: "too_many_places"; line: string }
  | { code: "slate_empty" };

export type SetupReasonCode = SetupReason["code"];

/**
 * - go_live: `save_game_config` (and `assertGameReady`) refuse to take the
 *   game live. The parity test holds this set to the database.
 * - save: the settings Save is refused, and so is finalize.
 * - open_picks: pick'em's Start (`EMPTY_SLATE`) is refused.
 */
export const SETUP_REASON_BLOCKS: Record<SetupReasonCode, SetupBlock> = {
  matches_none: "go_live",
  matches_unpaired: "go_live",
  player_not_on_team: "go_live",
  groups_none: "go_live",
  bracket_field: "go_live",
  points_missing: "go_live",
  too_many_places: "save",
  slate_empty: "open_picks",
};

export interface SetupInput {
  gameTypeId: string | null;
  competitionFormat: string | null;
  /** In a competition. A side game has no points term and no teams. */
  inCompetition: boolean;
  /** The competition has teams. A teamless tournament does not, and nobody in
   *  it can be "not on a team". */
  cupHasTeams: boolean;
  pointsTotal: number | null;
  pointsDistribution: PointsDistribution | null;
  /** Match rows (match play and the Matches format): all, and fully paired. */
  matchesTotal: number;
  matchesPaired: number;
  /** Players in a fully paired match who are on none of the cup's teams. */
  pairedPlayersOffTeam: number;
  /** Players in a playing group (stroke, rack, scramble, skins). */
  groupedPlayers: number;
  /** A bracket's seeded entrants. */
  bracketEntrants: number;
  /** The finishing places this game has (`placeCapacity.ts`), or null when not
   *  yet knowable, which never refuses. */
  placeCapacity: PlaceCapacity | null;
  /** Pick'em only: games on the slate. */
  slateGames: number;
}

/**
 * The reasons this game is not ready, in the order a reader should fix them:
 * the game's structure (matches, players, groups, field), then its points,
 * then what blocks Save. Empty when there is nothing to do.
 *
 * Mirrors `save_game_config`'s go-live branch arm for arm:
 *  - a cup game needs a point total above 0 (093);
 *  - match play and the Matches format need at least one match, every match
 *    paired (221), and, in a cup with teams, every paired player on a team (222);
 *  - stroke, rack, scramble and skins need someone in a playing group (089);
 *  - anything else needs points set at all, and a bracket a field of two (117).
 *
 * Pick'em never goes live through that branch (its games keep
 * `scoring_enabled` false), so its only reason is an empty slate, which is what
 * its own Start refuses.
 */
export function gameSetupReasons(i: SetupInput): SetupReason[] {
  const out: SetupReason[] = [];
  const type = i.gameTypeId;
  if (type === PICKEM_TYPE) {
    if (i.slateGames === 0) out.push({ code: "slate_empty" });
    return out;
  }

  const matchShaped = (type != null && MATCH_PLAY_TYPES.has(type)) || isMatchesGame(type, i.competitionFormat);
  if (matchShaped) {
    if (i.matchesTotal === 0) out.push({ code: "matches_none" });
    else if (!matchPlayReady(i.matchesPaired, i.matchesTotal)) {
      out.push({ code: "matches_unpaired", unpaired: i.matchesTotal - i.matchesPaired });
    }
    if (i.inCompetition && i.cupHasTeams && i.pairedPlayersOffTeam > 0) out.push({ code: "player_not_on_team" });
  } else if (type != null && ROSTER_TYPES.has(type)) {
    if (i.groupedPlayers === 0) out.push({ code: "groups_none" });
  } else if (isBracketGame(type, i.competitionFormat) && i.bracketEntrants < MIN_BRACKET_FIELD) {
    out.push({ code: "bracket_field" });
  }

  // A cup game needs a positive total; a side game in the general arm needs
  // points set at all (the database's `points_distribution IS NOT NULL OR
  // points_total IS NOT NULL`). Match-shaped and grouped side games need none.
  const generalArm = !matchShaped && !(type != null && ROSTER_TYPES.has(type));
  const pointsMissing = i.inCompetition
    ? !((i.pointsTotal ?? 0) > 0)
    : generalArm && i.pointsTotal == null && i.pointsDistribution == null;
  if (pointsMissing) out.push({ code: "points_missing" });

  const tooMany = splitPlacesWarning(i.pointsDistribution, i.placeCapacity ?? { count: null, source: "teams" });
  if (tooMany) out.push({ code: "too_many_places", line: tooMany });
  return out;
}

/** Players in a FILLED match who are on no team. An unfilled match is the
 *  pairing reason's concern, not this one, so it is never counted twice. */
export function pairedPlayersOffTeam(
  matches: ReadonlyArray<{ a: ReadonlyArray<string>; b: ReadonlyArray<string>; playersPerSide: number }>,
  teamed: ReadonlySet<string>
): number {
  let n = 0;
  for (const m of matches) {
    if (m.a.length !== m.playersPerSide || m.b.length !== m.playersPerSide) continue;
    for (const id of [...m.a, ...m.b]) if (!teamed.has(id)) n += 1;
  }
  return n;
}

/** The short phrase a list shows for a reason (the board's rows). */
export function setupReasonLine(r: SetupReason): string {
  switch (r.code) {
    case "matches_unpaired":
      return SETUP_REASON_WORD.matches_unpaired.line(r.unpaired);
    case "too_many_places":
      return r.line;
    default:
      return SETUP_REASON_WORD[r.code].line;
  }
}

/** The sentence a settings page shows beside the control the reason blocks. */
export function setupReasonBlocked(r: SetupReason): string {
  return r.code === "too_many_places" ? r.line : SETUP_REASON_WORD[r.code].blocked;
}

/**
 * The Game State row's two values, from the reasons. `skip` drops codes the
 * caller handles another way: stroke and skins ASK about a side game instead
 * of refusing for points when nobody playing is on a team (#1668).
 */
export function goLiveGate(
  reasons: ReadonlyArray<SetupReason>,
  opts: { skip?: ReadonlyArray<SetupReasonCode> } = {}
): { ready: boolean; blockedReason: string | null } {
  const first = reasons.find((r) => SETUP_REASON_BLOCKS[r.code] === "go_live" && !opts.skip?.includes(r.code));
  return { ready: !first, blockedReason: first ? setupReasonBlocked(first) : null };
}

/** Configured, for the board's sections: nothing stops it going live (or, for
 *  pick'em, opening picks). A Save-blocking split is a reason to show, not a
 *  reason the game is unconfigured. */
export function isSetUp(reasons: ReadonlyArray<SetupReason>): boolean {
  return !reasons.some((r) => SETUP_REASON_BLOCKS[r.code] !== "save");
}

/** A match row as stored: each side a user, or a play group of two. */
export interface StoredMatchRow {
  side_a: { type?: string; id?: string | null } | null;
  side_b: { type?: string; id?: string | null } | null;
}

/**
 * The people in the FULLY PAIRED matches of a game's stored rows: a side is a
 * user, or a play group whose members are its participants. The shape the
 * database's own check reads (migration 222), so the two count the same people.
 */
export function pairedMemberIds(
  matches: ReadonlyArray<StoredMatchRow>,
  participants: ReadonlyArray<{ user_id: string | null; play_group_id: string | null }>
): string[] {
  const byGroup = new Map<string, string[]>();
  for (const p of participants) {
    if (!p.play_group_id || !p.user_id) continue;
    byGroup.set(p.play_group_id, [...(byGroup.get(p.play_group_id) ?? []), p.user_id]);
  }
  const out: string[] = [];
  for (const m of matches) {
    if (!m.side_a?.id || !m.side_b?.id) continue;
    for (const side of [m.side_a, m.side_b]) {
      if (side.type === "play_group") out.push(...(byGroup.get(side.id as string) ?? []));
      else out.push(side.id as string);
    }
  }
  return out;
}

/** Matches in stored rows that are fully paired: both sides carry an id, the
 *  test the database applies (`side_a->>'id' IS NOT NULL`). */
export function pairedMatchCount(matches: ReadonlyArray<StoredMatchRow>): number {
  return matches.filter((m) => !!m.side_a?.id && !!m.side_b?.id).length;
}

/** A starting input with nothing in it, for a settings page to spread its own
 *  draft over: each page sets only what its format has. */
export const NO_SETUP_INPUT: SetupInput = {
  gameTypeId: null,
  competitionFormat: null,
  inCompetition: false,
  cupHasTeams: false,
  pointsTotal: null,
  pointsDistribution: null,
  matchesTotal: 0,
  matchesPaired: 0,
  pairedPlayersOffTeam: 0,
  groupedPlayers: 0,
  bracketEntrants: 0,
  placeCapacity: null,
  slateGames: 0,
};
