/**
 * scoreUnit — the PURE, client-safe core of "can a plain MEMBER enter this score?"
 *
 * Score-entry is scoped (SERVER-enforced; this is the shared truth the mutation
 * guard AND the UI tap-routing both read so they can't diverge):
 *   - Owner / co-admin / delegate-of-this-game → any unit (handled by
 *     `canEditGame`, NOT here — this function is only the MEMBER tier).
 *   - Member → only the unit they participate in.
 *   - Non-participant member → nothing.
 *
 * The "unit" differs per format:
 *   - stroke: the individual player — a member scores only THEIR OWN row.
 *   - 1v1 match: the match (its two user-sides) — a member scores either player
 *     in the match they're in.
 *   - rack: the play_group (cart) — a member scores anyone in their group.
 *   - 2v2 match: the match (its two side play_groups) — a member scores either
 *     side of the match they're in.
 *
 * Cart-scoping (rack) vs individual-scoping (stroke) is told by the caller via
 * `groupScoped`, NOT inferred from whether the target has a play_group. Since 089
 * made stroke groupings MANDATORY, a grouped target no longer means "rack" — stroke
 * players are grouped too, but their unit stays the individual. Inferring rack from
 * `play_group_id != null` would silently let a stroke cart-mate score your row.
 *
 * Deferred (needs a match↔foursome data link that doesn't exist): letting one
 * cart-mate score the OTHER 1v1 match in the same foursome. For now a 1v1 member
 * scores only their own match — this function's match check is already the clean
 * boundary to widen later.
 */

/** A match side as stored on `game_matches.side_a/side_b` (jsonb). */
export interface ScoreUnitSide {
  type: "user" | "play_group";
  id: string;
}

/** One row of `game_matches` — only the two sides matter for unit membership. */
export interface ScoreUnitMatch {
  side_a: ScoreUnitSide | null;
  side_b: ScoreUnitSide | null;
}

export interface MemberScoreAccessInput {
  /** The scorer's user id. */
  meId: string;
  /** The score's participant id — a user_id ("user") or play_group_id ("play_group"). */
  participantId: string;
  participantType: "user" | "play_group";
  /** This game's matches (empty for stroke + rack — they have no game_matches). */
  matches: ScoreUnitMatch[];
  /** The scorer's own `game_participants.play_group_id` (null if none / not a participant). */
  myPlayGroupId: string | null;
  /** The TARGET user's play_group_id — only meaningful for participantType "user"
   *  (rack). Null for stroke / 1v1 / when the target isn't a grouped participant. */
  targetPlayGroupId: string | null;
  /** Whether the scorer is a participant of this game at all (gates stroke self-scoring). */
  meIsParticipant: boolean;
  /** Does this FORMAT scope scoring to the play_group (cart)? TRUE for rack — cart-mates
   *  score each other; FALSE for stroke — the unit is the individual. Set by the caller
   *  from the game TYPE (rack), never inferred from grouping (stroke is grouped now too). */
  groupScoped: boolean;
}

/**
 * Can a plain MEMBER enter this score? (Owner/co-admin/delegate bypass this — they
 * are allowed by `canEditGame` before this is ever consulted.)
 */
export function memberCanScoreUnit(input: MemberScoreAccessInput): boolean {
  const { meId, participantId, participantType, matches } = input;

  // 2v2: participantId is a SIDE (play_group). The unit is the whole match, so a
  // member on EITHER side may keep the match card. Find the match this side
  // belongs to, then require the scorer to be in one of that match's side groups.
  if (participantType === "play_group") {
    const match = matches.find(
      (m) => m.side_a?.id === participantId || m.side_b?.id === participantId,
    );
    if (!match) return false;
    const sideGroupIds = [match.side_a, match.side_b]
      .filter((s): s is ScoreUnitSide => s?.type === "play_group")
      .map((s) => s.id);
    return input.myPlayGroupId != null && sideGroupIds.includes(input.myPlayGroupId);
  }

  // participantType === "user":

  // 1v1 match — participantId is a user-side. The unit is the match (both
  // players), so a member in the match scores either player. Deferred: this is
  // scoped to THEIR match, not the other 1v1 in the same cart.
  const singlesMatch = matches.find(
    (m) =>
      (m.side_a?.type === "user" && m.side_a.id === participantId) ||
      (m.side_b?.type === "user" && m.side_b.id === participantId),
  );
  if (singlesMatch) {
    const users = [singlesMatch.side_a, singlesMatch.side_b]
      .filter((s): s is ScoreUnitSide => s?.type === "user")
      .map((s) => s.id);
    return users.includes(meId);
  }

  // rack — the format is cart-scoped (`groupScoped`) and the target user is in a
  // play_group. The unit is the group, so a member scores anyone in the SAME group.
  // Gated on `groupScoped` (the game TYPE), NOT on grouping alone — stroke is grouped
  // now too, and must fall through to the individual check below.
  if (input.groupScoped && input.targetPlayGroupId != null) {
    return input.myPlayGroupId != null && input.myPlayGroupId === input.targetPlayGroupId;
  }

  // stroke — the unit is the individual: a member scores only their own row (and must
  // actually be a participant), regardless of which group they're in.
  return participantId === meId && input.meIsParticipant;
}

/**
 * Can a plain MEMBER score THIS MATCH? — the client-side entry point, expressed
 * in the shapes a match view already holds (side ids + the play-group roster map).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * `MatchGameView` used to hand-roll this, and it branched on the GAME-level
 * `sided` flag (`matches.some(side is a play_group)`) to decide whether a side id
 * was a play_group id or a user id. 1v1-vs-2v2 is a PER-MATCH property — the file's
 * own note says so ("A2 unfolds this game-level `sided` into a true per-match
 * shape") — so in a MIXED game the flag is true for every match, and the 1v1
 * matches' *user* ids were looked up in a map keyed by play_group id. Both sides
 * missed, and a member opening their own singles match was handed the read-only
 * scorecard: locked out of scoring by the presence of somebody else's doubles
 * match. The server disagreed and would have accepted the write — `canWriteOutcome`
 * resolves membership per match through `memberCanScoreUnit`, which is correct.
 *
 * So the fix is not a better flag; it is the client asking the SAME function the
 * server asks (CLAUDE.md #24 — one predicate, one definition). The discriminator
 * is `membersOfSide.has(sideId)`, which is per-side and cannot be wrong, and is
 * already what `sideParticipant` / `sidePlayersOf` use two screens away.
 *
 * Mirrors `canWriteOutcome`'s note: `memberCanScoreUnit`'s 1v1/2v2 branches look at
 * BOTH sides of the match once found, so passing EITHER side's ref resolves
 * identically — side A unless it is missing, then side B.
 */
export function memberCanScoreMatch(input: {
  /** The viewer's user id. */
  meId: string | null | undefined;
  /** `game_matches.side_a.id` for the open match — a user id (1v1) or play_group id (2v2). */
  sideAId: string | null | undefined;
  sideBId: string | null | undefined;
  /** Every match in the game — `memberCanScoreUnit` finds the one holding the ref. */
  matches: ScoreUnitMatch[];
  /** play_group_id → its member user ids. A side id present as a KEY is a play_group. */
  membersOfSide: Map<string, string[]>;
  myPlayGroupId: string | null;
  meIsParticipant: boolean;
}): boolean {
  const { meId, sideAId, sideBId, matches, membersOfSide } = input;
  if (!meId) return false;
  const sideId = sideAId ?? sideBId;
  if (!sideId) return false; // an unpaired match has nothing to authorize against
  return memberCanScoreUnit({
    meId,
    participantId: sideId,
    // PER SIDE, never from a game-level flag — this is the whole fix.
    participantType: membersOfSide.has(sideId) ? "play_group" : "user",
    matches,
    myPlayGroupId: input.myPlayGroupId,
    targetPlayGroupId: null,
    meIsParticipant: input.meIsParticipant,
    // Outcomes/match play are never cart-scoped — the match branch authorizes.
    groupScoped: false,
  });
}

