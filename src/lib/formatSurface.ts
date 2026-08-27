import { isManualGameType } from "@/lib/gameTypes";
import { isGolfFormat } from "@/lib/gameRoutes";

/**
 * The registry of per-format answers for a game SURFACE.
 *
 * ── What problem this solves ────────────────────────────────────────────────
 * Fifteen divergences have now been found between the four game formats, every
 * one of them the same shape: a behaviour that three formats had and a fourth
 * did not, discovered one incident at a time (CLAUDE.md #24 catalogues eight of
 * them for the lifecycle alone). The reason a format could be missing something
 * is that nothing ever ASKED it. Each format was assembled by hand, so an answer
 * it never gave was indistinguishable from an answer of "no".
 *
 * This is the thing that asks. `satisfies Record<GameSurfaceId, FormatSurface>`
 * means a fifth surface does not compile until it has answered every field, and
 * every field is non-optional on purpose — an optional field is a question a new
 * format can decline to answer, which is precisely the failure mode.
 *
 * ── The scope of "surface" ──────────────────────────────────────────────────
 * A surface is not a game type. `gtt_cornhole` and `gtt_beer_pong` are different
 * game TYPES that land on the same non-golf surface, and the registry is keyed
 * by surface because that is the unit that has settings, a header and a
 * lifecycle. `gameTypes: "manual"` is the catch-all arm — every manual format
 * (`resultStrategy: null`) resolves to `nongolf` without being listed here, so
 * adding a new lawn game does not touch this file. Adding a new *engine* does.
 *
 * ── Where each field is enforced ────────────────────────────────────────────
 * A registry field that nothing reads goes stale, so none of these are inert:
 *   settingsZoneLabel  read by `GameSettingsPage` — it IS the rendered header.
 *   course / modifiers pinned to the slots the view passes, by
 *                      `oneSettingsPage.test.ts` (a source scan, so it holds for
 *                      a format nobody thought to add to a list).
 *   scorecard          pinned to `isGolfFormat` by `formatSurface.test.ts`, so
 *                      the registry cannot disagree with routing.
 *   gameTypes          pinned to `gameRoutes.ts` the same way.
 */

/** The four game surfaces. Adding a member here is what forces the questions. */
export type GameSurfaceId = "match" | "rack" | "stroke" | "nongolf" | "pickem";

export type FormatSurface = {
  /**
   * The `game_type_id`s that land on this surface, or `"manual"` for the
   * non-golf catch-all (every type whose `resultStrategy` is null). Pinned to
   * `gameRoutes.ts` by test — routing and settings resolve the same way or the
   * suite fails.
   */
  gameTypes: readonly string[] | "manual";
  /**
   * The SETTINGS zone header. Three different strings today and all three are
   * deliberate: match's spine is per-match, stroke's is per-group, rack's and
   * non-golf's are neither.
   */
  settingsZoneLabel: string;
  /** Renders a Golf Course row in GAME MANAGEMENT. False for non-golf. */
  course: boolean;
  /**
   * Renders a Game Modifiers row after Rules of the Day.
   *
   * TRUE only where the format actually HAS a modifier — pinned to
   * `compatibleModifiers` by test, because this was hand-declared and wrong:
   * rack and stroke both said `true` while their `compatibleModifiers` is `[]`,
   * so they passed a `modifiersRow` whose value was permanently `undefined`. The
   * guard missed it by checking that the PROP was passed in the source rather
   * than that a row ever rendered. Match is the only format with a modifier
   * (`glorious_holes`); `moving_tees` was removed for being offered-and-inert.
   *
   * Note this is the STRUCTURAL question (does the format have one), not the
   * usability one (is it usable right now) — a modifier that exists but needs
   * outcome entry shows a row behind a `Requires:` scrim rather than no row.
   */
  modifiers: boolean;
  /**
   * Carries a scorecard — the chrome action and the standalone scorecard route.
   * Golf-only, and pinned to `isGolfFormat` so the two cannot drift.
   */
  scorecard: boolean;
  /**
   * Renders the **Setup | Scoring** Game State control in GAME MANAGEMENT.
   *
   * True for every format whose go-live IS `games.scoring_enabled`. Pick'em's is
   * not: its lifecycle is `picks_opened_at` / `picks_locked_at` (migration 146),
   * deliberately, because migration 135's CHECK refuses the very state
   * picks-open occupies — scoring on, unpublished, still pending.
   *
   * Added because rendering it anyway printed a FALSEHOOD. A pick'em game with
   * picks open showed "Not live — scoring disabled", which is true of the column
   * and false of the game, with an explanatory note underneath that the eye
   * reaches second. A control that names a state the format does not have does
   * not become honest by being disabled — the same reasoning `course` and
   * `modifiers` already encode, and found the same way: by looking at it.
   */
  gameState: boolean;
};

export const FORMAT_SURFACE = {
  match: {
    gameTypes: ["gtt_match_play"],
    settingsZoneLabel: "Match Settings",
    course: true,
    modifiers: true,
    scorecard: true,
    gameState: true,
  },
  rack: {
    gameTypes: ["gtt_rack_n_stack"],
    settingsZoneLabel: "Settings",
    course: true,
    modifiers: false,
    scorecard: true,
    gameState: true,
  },
  stroke: {
    gameTypes: ["gtt_stroke_play"],
    // Stroke's spine is the play GROUP, not the match — its settings zone holds
    // Point Distribution + Groupings + Handicaps.
    settingsZoneLabel: "Group Settings",
    course: true,
    modifiers: false,
    scorecard: true,
    gameState: true,
  },
  nongolf: {
    gameTypes: "manual",
    settingsZoneLabel: "Settings",
    // No course, no modifiers, no scorecard: a non-golf game has no holes to
    // weight, no stroke index to allocate against, and nothing to print.
    course: false,
    modifiers: false,
    scorecard: false,
    gameState: true,
  },
  pickem: {
    gameTypes: ["gtt_pickem"],
    // The slate is not "settings" in the golf sense — it is the CONTENT being
    // predicted, and it lives behind its own modal so the game page stays
    // identical for everyone (spec §5.1). What this zone holds is the pair of
    // settings that change what a pick is WORTH.
    settingsZoneLabel: "Pick'em Settings",
    // No course: no holes, no stroke index, nothing to allocate against.
    course: false,
    // No modifiers: pick'em's weighting is the per-slate-game MULTIPLIER, which
    // is a property of one contest on the slate rather than a `games.modifiers`
    // flag — so `compatibleModifiers` is [] and this is false, which the
    // registry test pins to each other.
    modifiers: false,
    // No scorecard. A sheet is not a scorecard: it is private until the
    // deadline, which is the opposite of a thing you print and pass around.
    scorecard: false,
    // The ONLY surface that answers false — see `gameState` on FormatSurface.
    gameState: false,
  },
} satisfies Record<GameSurfaceId, FormatSurface>;

/**
 * Which surface a game type opens on. `null` for an unregistered id — the caller
 * decides how to fail, matching `isManualGameType`'s treatment of unknowns
 * (unknown is NOT manual, and must not silently become the non-golf catch-all).
 */
export function surfaceForGameType(gameTypeId: string | null | undefined): GameSurfaceId | null {
  if (!gameTypeId) return null;
  for (const [id, surface] of Object.entries(FORMAT_SURFACE)) {
    if (surface.gameTypes !== "manual" && surface.gameTypes.includes(gameTypeId)) {
      return id as GameSurfaceId;
    }
  }
  return isManualGameType(gameTypeId) ? "nongolf" : null;
}

/** Every game type explicitly registered to a non-manual surface. */
export function registeredGameTypes(): string[] {
  return Object.values(FORMAT_SURFACE)
    .flatMap((s) => (s.gameTypes === "manual" ? [] : [...s.gameTypes]));
}

/** True when this game type's surface carries a scorecard. Agrees with
 *  `isGolfFormat` by construction (pinned by test) — exported so a caller can
 *  ask the registry rather than re-deriving "is this golf" a sixth way. */
export function surfaceHasScorecard(gameTypeId: string | null | undefined): boolean {
  const id = surfaceForGameType(gameTypeId);
  return id ? FORMAT_SURFACE[id].scorecard : isGolfFormat(gameTypeId ?? null);
}

/**
 * True when this format's "has setup finished?" question is answered by
 * `games.scoring_enabled` / `games.status`.
 *
 * ── Why anyone outside a settings panel needs to ask ───────────────────────
 *
 * `isPreScoring` reads exactly those two columns, and every caller of it is
 * really asking "is this game still being set up". For the four golf-and-manual
 * formats that is true. For pick'em it is permanently WRONG: its go-live is
 * `pickem_games.picks_opened_at`, `scoring_enabled` stays false for the whole
 * picking phase (migration 135's CHECK refuses the state it would occupy), and
 * `status` sits at `pending` until a result lands. So `isPreScoring` answers
 * "yes, still in setup" for a pick'em game that sixteen people are actively
 * filling in sheets for.
 *
 * That produced the leaderboard sending an owner into SETTINGS every time they
 * tapped the game — the board's setup-mode shortcut firing forever — so the one
 * person who most needed their own sheet was the one who could never reach it.
 *
 * `gameState` already means "this format's lifecycle is the scoring flag", and
 * it is already false for pick'em; this exposes that same fact to callers
 * outside the settings panel rather than inventing a second predicate. The
 * conservative default for an unregistered type is `true` — the golf behaviour,
 * which is what every pre-registry caller assumed.
 */
export function usesScoringLifecycle(gameTypeId: string | null | undefined): boolean {
  const id = surfaceForGameType(gameTypeId);
  return id ? FORMAT_SURFACE[id].gameState : true;
}
