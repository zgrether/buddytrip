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
export type GameSurfaceId = "match" | "rack" | "stroke" | "nongolf";

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
  /** Renders a Game Modifiers row after Rules of the Day. False for non-golf. */
  modifiers: boolean;
  /**
   * Carries a scorecard — the chrome action and the standalone scorecard route.
   * Golf-only, and pinned to `isGolfFormat` so the two cannot drift.
   */
  scorecard: boolean;
};

export const FORMAT_SURFACE = {
  match: {
    gameTypes: ["gtt_match_play"],
    settingsZoneLabel: "Match Settings",
    course: true,
    modifiers: true,
    scorecard: true,
  },
  rack: {
    gameTypes: ["gtt_rack_n_stack"],
    settingsZoneLabel: "Settings",
    course: true,
    modifiers: true,
    scorecard: true,
  },
  stroke: {
    gameTypes: ["gtt_stroke_play"],
    // Stroke's spine is the play GROUP, not the match — its settings zone holds
    // Point Distribution + Groupings + Handicaps.
    settingsZoneLabel: "Group Settings",
    course: true,
    modifiers: true,
    scorecard: true,
  },
  nongolf: {
    gameTypes: "manual",
    settingsZoneLabel: "Settings",
    // No course, no modifiers, no scorecard: a non-golf game has no holes to
    // weight, no stroke index to allocate against, and nothing to print.
    course: false,
    modifiers: false,
    scorecard: false,
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
