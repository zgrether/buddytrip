/**
 * Pure, client-safe game-config draft helpers (Game Settings: Draft-Then-Save, P1).
 *
 * The settings page becomes ONE composite client draft covering the WHOLE page —
 * matches, modifiers, points, course, entry mode, name, rules, delegates, and the
 * `scoring_enabled` flag. Nothing commits to the server until Save. This module is
 * the pure core of that model (no React / tRPC / DB), mirroring `travelForm.ts`'s
 * trio shape so the draft logic is unit-testable and shared:
 *
 *   - `configToDraft`        server snapshot → editable draft (the baseline)
 *   - `configDraftToPayload` draft → the atomic `save_game_config` RPC payload
 *   - `configDraftsEqual`    pure equality (drives the dirty / Save-enabled gate)
 *
 * Why it matters (the two-store hazard, spec §1): today six settings rows derive
 * from TWO backing stores (local draft + `serverMatches`) and it only works
 * because the single-open accordion force-commits between rows. Under multi-open +
 * draft-then-save, EVERY cross-row derivation must read the draft. This module is
 * the one draft those derivations read.
 *
 * The per-match point-value override lives ON the match (`pointValue`), not in a
 * separate map keyed by server match id — a not-yet-saved match has no server id,
 * and co-locating the override with its match keeps it correct across reorder /
 * add / remove. The even-share `points_distribution.value` is DERIVED at payload
 * time from `{ total, overrides, matchCount }` via the shared `evenShare` (never
 * snapshotted), so entering a match can't leave a stale share behind.
 */

import { evenShare, isPlacement, type PointsDistribution } from "./pointsDistribution";
import { isMatchPlayFormat } from "./gameRoutes";
import { MATCHES_COMPETITION_FORMAT } from "./resultStrategy";
import type { ModifiersMap } from "./modifiers";
import { buildDraw, type BracketDrawMatch } from "./bracket";
import { buildDoubleDraw } from "./bracketDouble";

/**
 * WINNER TAKES ALL (item 6) — stroke/placement's default & degenerate case: one
 * payout place that holds the WHOLE total. Represented in the DRAFT as `null` OR a
 * single-place placement (both mean "1st = 100% = the total") — a real split has ≥2
 * places. The `1st = total` relationship is DERIVED, never a stored snapshot: the
 * draft carries null, the editor shows the live total, and the total is materialized
 * into `[total]` only at payload time (`strokeDraftToPayload`) — so changing the
 * total recomputes the winner's share with no stale value to reconcile (the item-1 /
 * P1 lesson). The award path's `placement` branch then awards it unchanged.
 */
export function isWinnerTakesAll(dist: PointsDistribution | null): boolean {
  return dist == null || (isPlacement(dist) && dist.values.length <= 1);
}

/** `games.competition_format` values (non-golf structure). ONE definition shared by the
 *  draft, the payload, and the `saveConfig` zod so they can't drift.
 *
 *  `live_results` was removed (168/169) once its one production row was
 *  repointed to `head_to_head` — CLAUDE.md 3b's removal ordering. It named a
 *  feature that was never built, and this column stopped being cosmetic when
 *  `resolveResultStrategy` began branching on it. It is NOT moved to
 *  `LEGACY_COMPETITION_FORMATS` below: that list exists so rows which still hold
 *  a retired value stay saveable, and no row holds this one.
 *
 *  `matches` is `MATCHES_COMPETITION_FORMAT` — imported from `resultStrategy.ts`
 *  rather than a second string literal, so the value the resolver branches on
 *  and the value the zod accepts cannot drift apart. Migration 170 (the CHECK
 *  constraint, a THIRD place this same value is enumerated per 114's precedent)
 *  must land before this ships, or the zod accepts a value the database
 *  refuses. */
export const COMPETITION_FORMATS = ["head_to_head", "bracket", "best_of_n", MATCHES_COMPETITION_FORMAT] as const;
/**
 * Values the picker no longer OFFERS but the saveConfig zod must still ACCEPT.
 *
 * `bracket_se` / `bracket_de` collapsed into one `bracket` (single vs double is a
 * setting inside it, not a separate format). A game saved before that still holds
 * the old value, and every non-golf save re-sends its whole config — so refusing
 * them here would make an untouched legacy bracket game unsaveable, failing on a
 * field the user never went near. Read-accepted, never offered; `formatLabel`
 * carries the matching display fallback.
 */
export const LEGACY_COMPETITION_FORMATS = ["bracket_se", "bracket_de"] as const;
export type CompetitionFormat =
  | (typeof COMPETITION_FORMATS)[number]
  | (typeof LEGACY_COMPETITION_FORMATS)[number];

/** A match inside the composite draft. Extends the pairing shape (`DraftMatch`)
 *  with the per-match point-value override (A2b) so Points derives from the draft,
 *  not `serverMatches`. `handicap` is signed: <0 → side A gets |n| strokes, >0 →
 *  side B gets n, 0 → even. */
export interface DraftMatchConfig {
  matchNumber: number;
  /** Per-match shape (A2a): 1 = 1v1, 2 = 2v2. FILLED ⟺ both sides carry exactly
   *  this many members. */
  playersPerSide: 1 | 2;
  a: string[];
  b: string[];
  handicap: number;
  /** Per-match points override (`game_matches.point_value`); null = take the even
   *  share. Keyed to the match itself, NOT a server id (draft matches have none). */
  pointValue: number | null;
}

/**
 * Did the Setup/Scoring toggle CHANGE between the baseline and the draft?
 *
 * Used by `useConfigDraft` to decide whether a landed save may close the settings
 * panel. It may not when this is true: the toggle is the ONE field whose effect is
 * outside the panel — it decides which surface the game view renders, and the
 * panel is covering that surface — so committing it used to eject you, and you had
 * to re-enter to keep editing.
 *
 * **Changed, not set.** Flip the toggle and flip it back and this is false, so that
 * save closes like any other. A truthiness test (`draft.scoringEnabled`) would keep
 * the panel open for every save on an already-live game, which is most of them.
 *
 * **Against the BASELINE, not the live server value.** The baseline is what Save
 * commits against (it is the optimistic-concurrency base) and it is frozen on the
 * `anyTouched` transition, so the ~20s config poll cannot move it mid-edit. Reading
 * the live server flag would let a poll change this answer underneath the user
 * between their tap and their Save.
 *
 * A `null` baseline means nothing is committable yet, so nothing has changed.
 */
export function scoringToggleChanged(
  draft: Pick<BaseConfigDraft, "scoringEnabled">,
  baseline: Pick<BaseConfigDraft, "scoringEnabled"> | null | undefined,
): boolean {
  return !!baseline && draft.scoringEnabled !== baseline.scoringEnabled;
}

/**
 * The COMMON base every format's draft shares (P2 §8: three variants over one base,
 * not one shape). These are the format-agnostic settings — identity, rules, the
 * points pool, delegates, the visibility flag, and non-golf's structure label. Each
 * format's draft extends this with its own STRUCTURAL slice: match adds matches +
 * course + entry mode + modifiers (`ConfigDraft`); non-golf adds nothing
 * (`NonGolfConfigDraft`); rack/stroke will add groups / participant strokes.
 */
/**
 * The bracket's scalar settings, as stored in `games.bracket_config`.
 *
 * The POOL and the DRAW are not here — they are rows (`bracket_entrants` /
 * `bracket_matches`), not config, and they clean-replace through their own
 * payload keys. This is only what a bracket IS, not who is in it.
 */
export interface BracketConfig {
  elimination: "single" | "double";
  entrants: "singles" | "partners";
  seeding: "manual" | "random_avoid_teammates" | "random";
  /** The 3rd-place play-off. Drives whether the distribution has 3rd/4th rows at
   *  all — they are structurally absent when this is false, not hidden. */
  consolation: boolean;
}

/**
 * Decode `games.bracket_config` — a jsonb column — into a config or null.
 *
 * NOT a cast, and the difference is a CI failure. The column is
 * `NOT NULL DEFAULT '{}'::jsonb` (migration 112), so EVERY game in the database
 * has a `bracket_config`, and every one that isn't a bracket has `{}`. A
 * `game.bracket_config as BracketConfig` type-checks perfectly and is false at
 * runtime for all of them — the draft then carried a truthy `{}`, the payload
 * included it, and the RPC's zod refused a save on every non-bracket game.
 *
 * That is CLAUDE.md #23 in miniature: a declared type is not a runtime guarantee
 * across a boundary the type system cannot see into. jsonb is exactly such a
 * boundary, so it gets a decoder rather than an assertion — `{}` and anything
 * else malformed read as "no bracket configured", which is what they mean.
 */
export function toBracketConfig(raw: unknown): BracketConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ok =
    (r.elimination === "single" || r.elimination === "double") &&
    (r.entrants === "singles" || r.entrants === "partners") &&
    (r.seeding === "manual" || r.seeding === "random_avoid_teammates" || r.seeding === "random") &&
    typeof r.consolation === "boolean";
  return ok ? (r as unknown as BracketConfig) : null;
}

export interface BaseConfigDraft {
  /** The game's format id — READ-ONLY context, never edited (so it's excluded from
   *  the dirty check). Drives the points model: a match-play draft derives a
   *  `per_match` even share from the total. */
  gameTypeId: string | null;
  name: string;
  rulesForToday: string | null;
  /** `games.competition_format` — non-golf's structure label (head-to-head / bracket /
   *  best-of-N / live-results). Null for golf formats. Quiet tier: it recalculates
   *  nothing (no scoring path reads it), so it's just a drafted scalar like name/rules. */
  competitionFormat: CompetitionFormat | null;
  /**
   * `games.bracket_config` — the bracket's scalar settings (elimination,
   * entrants, seeding mode, consolation). Null for every format that isn't a
   * bracket, and for a bracket that hasn't been set up yet.
   *
   * A drafted scalar like the rest of this block: the whole settings page still
   * commits through ONE `save_game_config` (#18), so bracket setup does not get
   * its own live write.
   */
  bracketConfig: BracketConfig | null;
  /** A draft FIELD (spec §2.7-2): Save commits the config AND goes live / disables
   *  in one action. Not a separate transaction. */
  scoringEnabled: boolean;
  /** `points_total` — the owner-set pool; the per-match even share is derived. */
  pointsTotal: number | null;
  /** The persisted distribution shape (its `.value` is recomputed on Save for
   *  match play; a `placement` array is authored as-is). Null before any points
   *  are set. */
  pointsDistribution: PointsDistribution | null;
  /** `game_delegates` user ids (per-game organizers). */
  delegates: string[];
}

/**
 * Non-golf's draft — the base plus TWO structural slices, one per engine format:
 * the bracket pool and the Matches pairing grid. A card game that is neither
 * carries both empty, which is why this stays one draft rather than a fourth or
 * fifth variant — the same reasoning bracket's pool already established, now
 * exercised by a second format instead of asserted for one.
 *
 * Everything else on the page (name · delegate · rules · format · points) is
 * Quiet or Warned, so there is nothing a scored game must lock. The two pools
 * are the exception, and each is its format's only structural authoring.
 *
 * ── The bracket pool ─────────────────────────────────────────────────────
 * A list of ENTRANTS in seed order, each a list of user ids (one for singles,
 * two for partners). `string[][]` deliberately matches `RackConfigDraft.groups`,
 * so the same presentation-only builder (`RackGroupBuilder`) drives both and
 * there is no second person-picker to keep in step.
 *
 * The DRAW is not here. It is a pure function of the entrant count and the
 * consolation flag (`buildDraw`), so storing it would be a snapshot of something
 * derivable — it is computed at payload time instead.
 *
 * ── The Matches pairing grid ────────────────────────────────────────────
 * The SAME `DraftMatchConfig` shape golf's `ConfigDraft` and pick'em's
 * `PickemConfigDraft` carry, and it rides the SAME `save_game_config` matches
 * arm — gated on the payload key being present, not on game type. That reuse is
 * the whole reason this is a field addition rather than a new draft variant:
 * the RPC, the hash, and `MatchSetup` already treat "a game with matches" as one
 * shape regardless of which format put them there.
 */
export interface NonGolfConfigDraft extends BaseConfigDraft {
  /** Entrants in SEED order: index 0 is seed 1. Empty for a non-bracket game. */
  bracketEntrants: string[][];
  /** Pairings for the Matches format. Empty whenever `competitionFormat !==
   *  "matches"` — including immediately after switching away, which is when an
   *  existing pool must be explicitly CLEARED rather than merely stop being
   *  read; see `nonGolfDraftToPayload`. */
  matches: DraftMatchConfig[];
}

/** The shared course sub-object (id + composed back-nine + snapshotted schema) — the
 *  same shape match carries, since rack + match both route it through GameSetupRows /
 *  CourseRowContent. */
export interface DraftCourse {
  id: string | null;
  /** `games.back_course_id` — the composed two-nines 18's BACK course; null otherwise. */
  backId: string | null;
  /** Snapshotted `scorecard_schema` (par[] / handicap_index[] frozen in units.metadata). */
  scorecardSchema: unknown | null;
}

/**
 * The RACK variant: the base + rack's structural slice. Rack is net-stroke team play
 * built from GROUPINGS (carts) + a course, with A2b total-points (owner sets the total;
 * the per-slot share DERIVES = total ÷ slot count, so it's not stored on the draft — it's
 * recomputed at payload time like match's even share). No entry_mode toggle.
 *
 *  - `groups` — one user-id array per cart, in cart order (the STRUCTURE unit; a
 *    membership change is refused once scores exist — the coarse HAS_SCORES wall).
 *  - `strokes` — per-participant handicap strokes, keyed by user id (the FIELD tier:
 *    in-place, allowed with scores).
 *  - `course` — the shared course sub-object.
 *  - `modifiers` — round modifiers (`games.modifiers`). Rack's Moving-tee-boxes row went
 *    live in the modifier-matrix reconcile, so rack now carries this slice like stroke.
 */
export interface RackConfigDraft extends BaseConfigDraft {
  groups: string[][];
  strokes: Record<string, number>;
  course: DraftCourse;
  modifiers: ModifiersMap;
}

/** The MATCH-PLAY variant: the base + the match structural slice. Every settings row
 *  reads and writes THIS — no row reads `serverMatches` directly (spec §1). */
export interface ConfigDraft extends BaseConfigDraft {
  /** `games.entry_mode` — "score" (gross entry) vs "outcome" (hole winner). */
  entryMode: string;
  modifiers: ModifiersMap;
  matches: DraftMatchConfig[];
  course: {
    id: string | null;
    /** `games.back_course_id` — the composed two-nines 18's BACK course (W-9HOLE-01);
     *  null for a real 18 or a lone 9-hole front. Drafted alongside `id` because the
     *  row's front/back/needs-a-back state reads it: persisting the composed schema
     *  without it would strand the back-nine identity (and a stale ref would render a
     *  phantom back nine against an unrelated course). */
    backId: string | null;
    /** Snapshotted `scorecard_schema` (par[] / handicap_index[] frozen in
     *  `units.metadata`). Recomputed by the UI when the course changes; this
     *  module only carries it through. */
    scorecardSchema: unknown | null;
  };
  /** `game_delegates` user ids (per-game organizers). */
  delegates: string[];
}

/** The pre-resolved match shape `configToDraft` consumes — the caller
 *  (MatchGameView) resolves play-group sides → member-id lists and the signed
 *  handicap before handing them here, so this module stays free of play-group
 *  plumbing. */
export interface DraftMatchInput {
  matchNumber: number;
  playersPerSide: 1 | 2;
  a: string[];
  b: string[];
  handicap: number;
  pointValue: number | null;
}

/** The `games`-row fields the draft baseline reads (a subset of `getById`). */
export interface ConfigGameSnapshot {
  /** `games.bracket_config` — see `BracketConfig`. */
  bracket_config?: unknown;
  game_type_id?: string | null;
  name?: string | null;
  rules_for_today?: string | null;
  competition_format?: string | null;
  scoring_enabled?: boolean | null;
  entry_mode?: string | null;
  modifiers?: ModifiersMap | null;
  points_total?: number | null;
  points_distribution?: PointsDistribution | null;
  course_id?: string | null;
  back_course_id?: string | null;
  scorecard_schema?: unknown | null;
}

/**
 * Build the editable draft (and the dirty-check BASELINE) from the server
 * snapshot. A wholly-unset field takes its neutral default (empty name, no rules,
 * not scoring, gross entry, no modifiers, no points). Deterministic and total so
 * `configDraftsEqual(configToDraft(x), configToDraft(x))` is always true.
 */
export function configToDraft(
  game: ConfigGameSnapshot,
  matches: DraftMatchInput[],
  delegates: string[]
): ConfigDraft {
  return {
    gameTypeId: game.game_type_id ?? null,
    name: game.name ?? "",
    rulesForToday: game.rules_for_today ?? null,
    competitionFormat: (game.competition_format ?? null) as CompetitionFormat | null,
    bracketConfig: toBracketConfig(game.bracket_config),
    scoringEnabled: game.scoring_enabled ?? false,
    entryMode: game.entry_mode ?? "score",
    modifiers: game.modifiers ?? {},
    matches: matches.map((m) => ({
      matchNumber: m.matchNumber,
      playersPerSide: m.playersPerSide,
      a: [...m.a],
      b: [...m.b],
      handicap: m.handicap,
      pointValue: m.pointValue,
    })),
    pointsTotal: game.points_total ?? null,
    pointsDistribution: game.points_distribution ?? null,
    course: {
      id: game.course_id ?? null,
      backId: game.back_course_id ?? null,
      scorecardSchema: game.scorecard_schema ?? null,
    },
    delegates: [...delegates].sort(),
  };
}

/** True when both sides carry exactly the match's own `playersPerSide` players —
 *  the only matches that get written on Save (an unfilled slot is an unfinished
 *  add, never persisted). */
export function isDraftMatchFilled(m: DraftMatchConfig): boolean {
  return m.a.length === m.playersPerSide && m.b.length === m.playersPerSide;
}

/**
 * Does a change of the rendered game id invalidate the "user has touched this
 * draft" lock?
 *
 * The touched-lock (`draftTouched`) is keyed to "has the user typed here", not
 * to any id — and the only things that clear it are Save and Cancel. Neither
 * fires when the SAME mounted view is handed a DIFFERENT game, so a touched
 * draft for game A suppresses the seed for game B and the panel keeps showing
 * A's match rows. That is stale content, not merely a stale flag.
 *
 * Two cases are deliberately NOT a game change:
 *  - `prev === next` — the identity is unchanged; nothing to invalidate.
 *  - `prev === null` — the CREATE transition (`handleCreate` sets the id on a
 *    view that was mounted with none). The draft the user built on the new-game
 *    screen belongs to the game just created, so clearing it there would discard
 *    exactly the work `handleCreate` takes care to preserve.
 *
 * Pure + exported so the rule is directly testable — the views that own the ref
 * can't be rendered under this suite (node env, no jsdom), and the seed/lock
 * interaction is too easy to get subtly wrong to leave untested.
 */
export function isDraftLockStale(prev: string | null, next: string | null): boolean {
  return prev !== null && prev !== next;
}

// ── Payload (the `save_game_config` RPC contract) ────────────────────────────

/** One match row the RPC writes. Sides are member-id lists (a 2v2 side becomes a
 *  play_group of those members); the signed draft handicap is pre-distributed into
 *  per-side stroke counts so the plpgsql writer stays a dumb transactional writer
 *  (spec §2.2 Design A — no derivation in SQL). */
export interface SaveMatchRow {
  matchNumber: number;
  playersPerSide: 1 | 2;
  a: string[];
  b: string[];
  /** Strokes GIVEN to side A / side B (exactly one is non-zero, or both 0). */
  strokesA: number;
  strokesB: number;
  /** `game_matches.point_value` — the resolved override, or null for even share. */
  pointValue: number | null;
}

/** The atomic-Save payload (design A). The client pre-computes everything derived
 *  — filled-match filter, handicap distribution, the even-share
 *  `points_distribution.value` — so the RPC only does the all-or-nothing multi-
 *  table write. */
export interface SaveConfigPayload {
  name: string;
  rulesForToday: string | null;
  /** `games.competition_format` (086) — non-golf's structure label; null for golf. */
  competitionFormat: CompetitionFormat | null;
  /** Omitted rather than null when the format doesn't own it — the RPC
   *  COALESCE-PRESERVES, so sending null would be indistinguishable from
   *  "clear it" for a column only a bracket speaks for. */
  bracketConfig?: BracketConfig | null;
  /** The bracket POOL, seed-ordered. Emitted only for a bracket with entrants —
   *  its presence is what gates the RPC's whole pool+draw block. */
  bracketEntrants?: { seed: number; teamId: string | null; userIds: string[] }[];
  /** The DRAW for that pool. Moves with `bracketEntrants`, never alone. */
  bracketDraw?: BracketDrawMatch[];
  scoringEnabled: boolean;
  /** Match play owns these; a format that doesn't (non-golf) omits them — the RPC
   *  preserves entry_mode (COALESCE) and defaults modifiers to {}. */
  entryMode?: string;
  modifiers?: ModifiersMap;
  pointsTotal: number | null;
  pointsDistribution: PointsDistribution | null;
  courseId: string | null;
  /** `games.back_course_id` — written in lockstep with `courseId`/`scorecardSchema`
   *  so a composed two-nines 18 round-trips (and clearing the course clears it). */
  backCourseId: string | null;
  scorecardSchema: unknown | null;
  /** `game_delegates` user ids. OPTIONAL (#625): OMITTED when the delegate set is
   *  UNCHANGED vs the baseline (or unknown), so the RPC's `p_payload ? 'delegates'` gate
   *  (088) PRESERVES it. Sent only on a real change — never the phantom `[]` a save-before-
   *  `listOrganizers`-resolves would otherwise wipe with. Present `[]` = the user cleared it. */
  delegates?: string[];
  /**
   * Pick'em's two scoring settings (`pickem_games.roll_up` / `use_confidence`),
   * written by `save_game_config`'s pick'em arm since migration 157.
   *
   * ALWAYS sent by `pickemDraftToPayload`, never conditionally: the RPC
   * COALESCE-preserves an absent key, so omitting it on a change would silently
   * keep the old value. Absent for every other format, which is what stops
   * their saves touching a pick'em game's settings.
   */
  pickem?: { rollUp: "team_totals" | "individual_matches"; useConfidence: boolean };
  /** Match play ONLY. Omitted for non-golf (and, in later P2 phases, rack/stroke) so
   *  the RPC — which gates its matches block on `payload ? 'matches'` (085) — skips it
   *  entirely rather than running the clean-replace with an empty set. */
  matches?: SaveMatchRow[];
  /**
   * Did the match SET (structure: which matches, each side's roster, the shape)
   * change vs the state the draft was seeded from? — NOT whether a per-match FIELD
   * (handicap / pointValue) changed.
   *
   * True  → the RPC clean-replaces matches/participants/play_groups (mints fresh
   *         UUIDs). REFUSED once scores exist (`HAS_SCORES`) — the new ids would
   *         orphan the score rows.
   * False → the RPC does NOT clean-replace. It instead writes the per-match FIELDS
   *         in place (game_matches.point_value + side handicap_strokes), keyed to the
   *         surviving rows by match_number — allowed WITH scores (the warned tier).
   *
   * So a handicap or point-override edit on a scored game (same set, field differs)
   * reports False here and persists in place; adding/removing a player or a match
   * reports True and is refused with scores. A client that under-reports gets its
   * structural edits silently written in-place-only (safe-ish); over-reports gets
   * refused (safe). Was `matchesDirty` — renamed when the structure/field split
   * landed (migration 084). Optional: absent whenever `matches` is (non-golf).
   */
  matchesStructureDirty?: boolean;
  /** RACK GROUPINGS (085) — the structure unit (cart membership + name). Present only
   *  for rack; the RPC gates its groups block on the key's presence. */
  groups?: SaveGroupRow[];
  /** Did the cart membership change vs the seed? True → clean-replace (refused with
   *  scores — the coarse wall); false/absent → skip. Mirrors `matchesStructureDirty`. */
  groupsStructureDirty?: boolean;
  /** Per-participant handicap strokes (FIELD, in-place; rack + stroke). The RPC updates
   *  existing game_participants by user_id — allowed with scores (warned tier). */
  participants?: { userId: string; strokes: number }[];
}

/** Split a signed handicap into per-side stroke counts (<0 → A gets |n|; >0 → B
 *  gets n; 0 → even). Mirrors `setHandicap`'s recipient resolution. */
export function splitHandicap(signed: number): { strokesA: number; strokesB: number } {
  if (signed < 0) return { strokesA: -signed, strokesB: 0 };
  if (signed > 0) return { strokesA: 0, strokesB: signed };
  return { strokesA: 0, strokesB: 0 };
}

/**
 * Convert the draft into the atomic RPC payload. ONLY fully-filled matches are
 * written (an unfinished add never persists — same rule the setup gate enforces).
 *
 * The match-play even share is recomputed here from the FINAL draft
 * (`evenShare(total, overrides, filledCount)`) and folded into
 * `points_distribution.value`, so the persisted fallback award can't lag a match
 * add/remove. It is ESTABLISHED here too, not just refreshed: a first-setup game
 * has `points_distribution = null`, and the reconcile effect that used to seed it
 * is gone — without this, a first Save would write a total with nothing to award
 * against (`point_value ?? points_distribution.value` → null). A `placement`
 * distribution is authored explicitly and passed through untouched.
 *
 * Pass `baseline` (the draft as seeded from the server) to report `matchesDirty`
 * honestly; omit it and the payload conservatively claims the matches changed.
 */
/**
 * Draft rows -> the RPC's match rows. ONE mapping, because both formats send
 * matches through the same `save_game_config` arm and a second spelling of this
 * is where their two shapes would start to differ.
 *
 * Only FILLED rows travel: a half-paired row is a normal mid-edit state, not a
 * match, and the server clean-replaces from what it is sent.
 */
export function matchesToSaveRows(rows: DraftMatchConfig[]): SaveMatchRow[] {
  return rows.filter(isDraftMatchFilled).map((m) => {
    const { strokesA, strokesB } = splitHandicap(m.handicap);
    return {
      matchNumber: m.matchNumber,
      playersPerSide: m.playersPerSide,
      a: [...m.a],
      b: [...m.b],
      strokesA,
      strokesB,
      pointValue: m.pointValue,
    };
  });
}

export function configDraftToPayload(draft: ConfigDraft, baseline?: ConfigDraft): SaveConfigPayload {
  const filled = draft.matches.filter(isDraftMatchFilled);
  const matches: SaveMatchRow[] = matchesToSaveRows(draft.matches);

  // Match play derives its per_match share from the total — establish it when it's
  // absent (first setup) as well as refresh it. Anything else (a placement payout)
  // is authored, so leave it alone.
  let distribution = draft.pointsDistribution;
  if (
    draft.pointsTotal != null &&
    isMatchPlayFormat(draft.gameTypeId) &&
    (distribution == null || distribution.type === "per_match")
  ) {
    const overrides = filled.map((m) => m.pointValue).filter((v): v is number => v != null);
    distribution = { type: "per_match", value: evenShare(draft.pointsTotal, overrides, filled.length) };
  }

  return {
    ...baseDraftToPayload(draft, distribution, baseline),
    entryMode: draft.entryMode,
    modifiers: draft.modifiers,
    courseId: draft.course.id,
    backCourseId: draft.course.backId,
    scorecardSchema: draft.course.scorecardSchema,
    matches,
    // ONLY structure gates the clean-replace — a field-only edit (handicap / point
    // override) reports false and the RPC writes it in place.
    matchesStructureDirty: baseline ? !matchesStructureEqual(draft.matches, baseline.matches) : true,
  };
}

/** Did the delegate set change vs the baseline? `true` when there's no baseline (first
 *  save — send it) or the (sorted) lists differ. `false` — including when both are the
 *  phantom-empty of an unresolved `listOrganizers` — means OMIT the key so the RPC (088)
 *  preserves the server's delegates rather than wiping them (#625). */
function delegatesChanged(draft: BaseConfigDraft, baseline?: BaseConfigDraft): boolean {
  return !baseline || !arraysEqual(draft.delegates, baseline.delegates);
}

/** The base fields shared by every format's payload. `distribution` is the caller's
 *  already-resolved `points_distribution` (match play recomputes its even share; other
 *  formats pass it through). `delegates` is emitted ONLY when it changed vs the baseline —
 *  see `delegatesChanged`. */
function baseDraftToPayload(
  draft: BaseConfigDraft,
  distribution: PointsDistribution | null,
  baseline?: BaseConfigDraft
): SaveConfigPayload {
  return {
    name: draft.name.trim(),
    rulesForToday: draft.rulesForToday?.trim() || null,
    competitionFormat: draft.competitionFormat,
    // Only SENT when the draft actually has one. The RPC COALESCE-preserves an
    // absent key, so omitting is how a non-bracket format says "not mine to
    // speak for" rather than wiping a bracket's setup.
    ...(draft.bracketConfig ? { bracketConfig: draft.bracketConfig } : {}),
    scoringEnabled: draft.scoringEnabled,
    pointsTotal: draft.pointsTotal,
    pointsDistribution: distribution,
    courseId: null,
    backCourseId: null,
    scorecardSchema: null,
    ...(delegatesChanged(draft, baseline) ? { delegates: [...draft.delegates].sort() } : {}),
  };
}

// ── Non-golf variant ─────────────────────────────────────────────────────────

/** Server snapshot → non-golf draft baseline. Leaner than golf's `configToDraft`:
 *  no course, no entry mode, no modifiers — this format owns none of them. It
 *  DOES take matches now, unlike before Matches existed, mirroring
 *  `configToPickemDraft`'s identical parameter. */
export function configToNonGolfDraft(
  game: ConfigGameSnapshot,
  delegates: string[],
  /** Persisted entrants in seed order, pre-resolved by the caller (mirrors how
   *  `configToRackDraft` takes play_groups already resolved). Absent for every
   *  non-bracket game. */
  entrants: string[][] = [],
  /** Persisted pairings, as stored. Absent for every non-Matches game. */
  matches: DraftMatchInput[] = []
): NonGolfConfigDraft {
  return {
    gameTypeId: game.game_type_id ?? null,
    name: game.name ?? "",
    rulesForToday: game.rules_for_today ?? null,
    competitionFormat: (game.competition_format ?? null) as CompetitionFormat | null,
    bracketConfig: toBracketConfig(game.bracket_config),
    scoringEnabled: game.scoring_enabled ?? false,
    pointsTotal: game.points_total ?? null,
    pointsDistribution: game.points_distribution ?? null,
    delegates: [...delegates].sort(),
    bracketEntrants: entrants.map((e) => [...e]),
    matches: matches.map((m) => ({
      matchNumber: m.matchNumber,
      playersPerSide: m.playersPerSide,
      a: [...m.a],
      b: [...m.b],
      handicap: m.handicap,
      pointValue: m.pointValue,
    })),
  };
}

/**
 * Non-golf draft → the atomic Save payload. Base fields, plus WHICHEVER of the
 * two structural slices the chosen format owns — never both, and never the
 * wrong one. No `entryMode`/`modifiers` (the RPC preserves entry_mode and
 * defaults modifiers to {} — both no-ops for a format that owns neither), null
 * course. A `placement` distribution is authored, so it passes through
 * untouched.
 *
 * ── The bracket slice ──────────────────────────────────────────────────────
 * `bracketEntrants` + `bracketDraw` are emitted TOGETHER or not at all: the draw
 * references entrants by seed, and the RPC gates the whole block on
 * `bracketEntrants` being present. Omitting both is what leaves an existing pool
 * untouched, which is the right default for every save that is not about the
 * pool (a rename must not rebuild a draw).
 *
 * The DRAW is computed here rather than drafted — `buildDraw` is a pure function
 * of the entrant count and the consolation flag, so drafting it would snapshot
 * something derivable and let the two drift.
 *
 * `teamByUser` resolves each entrant's cup team. An entrant belongs to exactly
 * one team — that is what makes a 2v2 pairing structurally unable to span two —
 * so the team is read from the entrant's FIRST member; the builder is what
 * enforces that its members agree.
 *
 * ── The Matches slice ───────────────────────────────────────────────────────
 * `matches` + `matchesStructureDirty` ride the SAME `save_game_config` arm golf
 * and pick'em use, and — per #1172 — `matchesStructureDirty` MUST be sent
 * whenever `matches` is: the RPC defaults an absent flag to TRUE, so omitting it
 * clean-replaces every match on every save, re-minting the ids that
 * `readGameConfigHash` both hashes and sorts by. That is #1172's bug, reachable
 * by any format that reuses this arm and forgets the flag; Matches does not
 * reforget it.
 *
 * The dirty comparison is over the rows that are actually SENT
 * (`matchesToSaveRows`'s own filter, mirrored here as `sent`), not the raw
 * draft — comparing raw drafts reports dirty forever on a game with an unfilled
 * slot (an odd player out, a match being built), which is the same bug wearing
 * a filter that never runs.
 *
 * ── Emptying a pool IS a change, and has to be SENT — for EITHER slice ──────
 * "Omit when it isn't about the pool" and "omit when there is no pool" read as
 * the same rule and are not. The RPC preserves what an absent key doesn't
 * mention, so a draft that has been emptied — the format switched away from
 * Bracket or Matches, or partners → singles taken through
 * `ClearPairingsPrompt` — would silently leave the persisted rows in place: the
 * prompt promises they will be removed, the save reports success, and they are
 * still there on the next read. So a clear is sent EXPLICITLY (`[]` for the
 * bracket pool, `matches: [], matchesStructureDirty: true` for Matches), which
 * is what makes the RPC's dirty-compare see a difference and delete.
 *
 * Each is sent only against a BASELINE that actually held rows for that slice.
 * Without a baseline nothing is comparable, and an empty slice then means "this
 * game has never had one" — omitting is right there, and wiping on a hunch is
 * not. (A bracket with picks recorded is still refused server-side, HAS_PICKS;
 * Matches with a decided result is refused the same way — see the freeze guard
 * migration.)
 *
 * A game is never both formats at once (`competitionFormat` is one value), so
 * the two slices are computed independently and only one is ever non-empty —
 * there is no ordering between them to get wrong.
 */
export function nonGolfDraftToPayload(
  draft: NonGolfConfigDraft,
  baseline?: NonGolfConfigDraft,
  bracket?: { teamByUser: Record<string, string | null> }
): SaveConfigPayload {
  // Matches derives its per_match SHARE from the total, the same relationship
  // golf's `configDraftToPayload` establishes for `gtt_match_play` — but that is
  // a DIFFERENT function, reachable only by a `ConfigDraft` (a golf game type),
  // which a non-golf game can never hold. Reusing `isMatchPlayFormat` here would
  // mean widening a predicate three OTHER call sites (view routing, glorious
  // holes) correctly key on staying golf-only — so this is the parallel
  // computation, not a shared one, gated on the FORMAT rather than the game
  // type. Established on first setup as well as refreshed on every match
  // add/remove, exactly like golf's version — `isPerMatch` is what
  // `writeTeamMatchPoints` gates the award write on (via `computeCompetitionLeaderboard`'s
  // read of the SAME column), so an unminted distribution is not a smaller
  // award — it is the award path never firing at all.
  let distribution = draft.pointsDistribution;
  if (
    draft.pointsTotal != null &&
    draft.competitionFormat === MATCHES_COMPETITION_FORMAT &&
    (distribution == null || distribution.type === "per_match")
  ) {
    const filled = draft.matches.filter(isDraftMatchFilled);
    const overrides = filled.map((m) => m.pointValue).filter((v): v is number => v != null);
    distribution = { type: "per_match", value: evenShare(draft.pointsTotal, overrides, filled.length) };
  }

  let payload = baseDraftToPayload(draft, distribution, baseline);

  // ── Bracket slice ──
  const pool = draft.competitionFormat === "bracket" ? draft.bracketEntrants.filter((e) => e.length > 0) : [];
  if (pool.length === 0) {
    const had = baseline?.bracketEntrants.some((e) => e.length > 0);
    if (had) payload = { ...payload, bracketEntrants: [], bracketDraw: [] };
  } else {
    payload = {
      ...payload,
      bracketEntrants: pool.map((userIds, i) => ({
        seed: i + 1,
        teamId: bracket?.teamByUser[userIds[0]] ?? null,
        userIds: [...userIds],
      })),
      // THE PERSISTED DRAW MUST MATCH THE CHOSEN FORMAT. This built a single-elim
      // tree unconditionally, so a game saved as "double" would have been stored
      // with no lower bracket and no grand final at all — the setting recorded,
      // the structure not. That is why the toggle stayed disabled: enabling it
      // alone would have produced games labelled double that were single
      // underneath.
      //
      // Consolation is not passed to the double builder, and cannot be: double
      // elimination produces 3rd structurally, so a play-off would be a second
      // answer to a settled question (and the setup row hides it for the same
      // reason).
      bracketDraw:
        draft.bracketConfig?.elimination === "double"
          ? buildDoubleDraw(pool.length)
          : buildDraw(pool.length, { consolation: draft.bracketConfig?.consolation ?? false }),
    };
  }

  // ── Matches slice ──
  const sent = (ms: DraftMatchConfig[]) => ms.filter(isDraftMatchFilled);
  const matchRows = draft.competitionFormat === MATCHES_COMPETITION_FORMAT ? sent(draft.matches) : [];
  if (matchRows.length === 0) {
    const had = baseline && sent(baseline.matches).length > 0;
    if (had) payload = { ...payload, matches: [], matchesStructureDirty: true };
  } else {
    payload = {
      ...payload,
      matches: matchesToSaveRows(draft.matches),
      matchesStructureDirty: baseline
        ? !matchesStructureEqual(matchRows, sent(baseline.matches))
        : true,
    };
  }

  return payload;
}

/** Pure whole-page equality for the non-golf draft — the base fields, plus
 *  BOTH structural slices. Seed ORDER is meaningful for the bracket pool (it is
 *  the draw position), so that compares the arrays in order rather than as
 *  sets; `matchesEqual` mirrors golf's own whole-draft comparison
 *  (`configDraftsEqual`) so the two formats' dirty gates agree on what "a match
 *  changed" means. */
export function nonGolfDraftsEqual(a: NonGolfConfigDraft, b: NonGolfConfigDraft): boolean {
  return (
    baseDraftsEqual(a, b) &&
    canonical(a.bracketEntrants) === canonical(b.bracketEntrants) &&
    matchesEqual(a.matches, b.matches)
  );
}

// ── Rack variant ─────────────────────────────────────────────────────────────

/** One group the rack RPC writes (085 `groups[]`): membership + optional name. */
export interface SaveGroupRow {
  name: string;
  userIds: string[];
}

/** Server snapshot → rack draft baseline. The caller (RackGameView) resolves the
 *  persisted play_groups → an ordered `string[][]` and the participants → a
 *  `{ userId → strokes }` map before handing them here, so this module stays free of
 *  play-group plumbing (mirrors `configToDraft`'s pre-resolved matches). */
export function configToRackDraft(
  game: ConfigGameSnapshot,
  groups: string[][],
  strokes: Record<string, number>,
  delegates: string[]
): RackConfigDraft {
  return {
    gameTypeId: game.game_type_id ?? null,
    name: game.name ?? "",
    rulesForToday: game.rules_for_today ?? null,
    competitionFormat: (game.competition_format ?? null) as CompetitionFormat | null,
    bracketConfig: toBracketConfig(game.bracket_config),
    scoringEnabled: game.scoring_enabled ?? false,
    pointsTotal: game.points_total ?? null,
    pointsDistribution: game.points_distribution ?? null,
    delegates: [...delegates].sort(),
    groups: groups.map((g) => [...g]),
    strokes: { ...strokes },
    course: {
      id: game.course_id ?? null,
      backId: game.back_course_id ?? null,
      scorecardSchema: game.scorecard_schema ?? null,
    },
    modifiers: game.modifiers ?? {},
  };
}

/** Drop empty groups (an unfinished "add cart") and renumber the survivors Group 1..N —
 *  the persist shape the RPC's `groups[]` path expects. Mirrors `rackGroupDraft.toPersist`
 *  (kept here too so the pure payload builder has no component dependency). */
export function rackGroupsToPersist(groups: string[][]): SaveGroupRow[] {
  return groups.filter((g) => g.length > 0).map((userIds, i) => ({ name: `Group ${i + 1}`, userIds: [...userIds] }));
}

/**
 * Convert the rack draft into the atomic RPC payload. The per-slot share is DERIVED
 * here from `points_total ÷ slotCount` and folded into `points_distribution.value` — the
 * same establish-and-refresh discipline `configDraftToPayload` uses for match play, so
 * changing the total or the groups can't leave a stale per-slot award behind.
 *
 * `slotCount` is the rack SLOT count (rank-paired 1v1s = `min(grouped-A, grouped-B)`) —
 * passed in because it needs team membership the pure draft doesn't carry, matching the
 * SAME divisor `RackTotalPointsControl` uses so the displayed and persisted shares agree.
 *
 * `participants[]` carries the full roster's strokes (the in-place FIELD write);
 * `groupsStructureDirty` reports whether the cart membership changed vs the baseline
 * (gates the clean-replace, refused with scores).
 */
export function rackDraftToPayload(draft: RackConfigDraft, slotCount: number, baseline?: RackConfigDraft): SaveConfigPayload {
  const persistGroups = rackGroupsToPersist(draft.groups);
  const roster = persistGroups.flatMap((g) => g.userIds);

  // Derive the per-slot share from the owner-set total (empty overrides → plain
  // division), establishing it on first setup as well as refreshing it. Non-per_match
  // (a placement payout) is never authored for rack, so this is the only shape.
  let distribution = draft.pointsDistribution;
  if (draft.pointsTotal != null) {
    distribution = { type: "per_match", value: evenShare(draft.pointsTotal, [], slotCount) };
  }

  const participants = roster.map((userId) => ({ userId, strokes: draft.strokes[userId] ?? 0 }));

  return {
    ...baseDraftToPayload(draft, distribution, baseline),
    // Send modifiers EXPLICITLY (the RPC defaults a missing key to `{}`, which would wipe
    // them) — rack gained the Moving-tee-boxes row in the matrix reconcile.
    modifiers: draft.modifiers,
    courseId: draft.course.id,
    backCourseId: draft.course.backId,
    scorecardSchema: draft.course.scorecardSchema,
    groups: persistGroups,
    groupsStructureDirty: baseline ? !rackGroupsEqual(draft.groups, baseline.groups) : true,
    participants,
  };
}

/** Pure whole-page equality for the rack draft — base fields + course + strokes +
 *  groupings + modifiers (drives the Save-enabled gate). */
export function rackDraftsEqual(a: RackConfigDraft, b: RackConfigDraft): boolean {
  return (
    baseDraftsEqual(a, b) &&
    a.course.id === b.course.id &&
    a.course.backId === b.course.backId &&
    canonical(a.course.scorecardSchema) === canonical(b.course.scorecardSchema) &&
    canonical(a.strokes) === canonical(b.strokes) &&
    canonical(a.modifiers) === canonical(b.modifiers) &&
    rackGroupsEqual(a.groups, b.groups)
  );
}

/** Groupings equality — membership-per-cart, position-sensitive (a reorder renames the
 *  carts, so it's a structural rebuild). Empty carts are dropped first (an unfinished
 *  add is never a change); userIds compare order-independently within a cart (a cart is
 *  a set of players, not a sequence). Drives BOTH the dirty check and
 *  `groupsStructureDirty`. */
function rackGroupsEqual(a: string[][], b: string[][]): boolean {
  const na = a.filter((g) => g.length > 0).map((g) => [...g].sort());
  const nb = b.filter((g) => g.length > 0).map((g) => [...g].sort());
  if (na.length !== nb.length) return false;
  return na.every((g, i) => arraysEqual(g, nb[i]));
}

// ── Stroke variant ───────────────────────────────────────────────────────────

/**
 * The STROKE variant: base + course + participant strokes + modifiers. Stroke is net
 * stroke play — no groupings (its roster is create-only, per the P2 Phase-0 call), and
 * PLACEMENT points (owner sets total + the placement split; the distribution passes
 * through, not derived). The one destroys tier is the COURSE (a course change on a scored
 * game orphans the snapshot the entered scores net against — refused SERVER-side,
 * COURSE_LOCKED); strokes + modifiers are the warned/in-place tier.
 *
 *  - `strokes` — per-participant handicap strokes, keyed by user id.
 *  - `modifiers` — the round modifiers (`games.modifiers`; stroke has them, rack didn't).
 *  - `course` — the shared course sub-object.
 */
export interface StrokeConfigDraft extends BaseConfigDraft {
  strokes: Record<string, number>;
  modifiers: ModifiersMap;
  course: DraftCourse;
  /** GROUPINGS (P3 3.2) — tee-groups over the create-only roster, one user-id array per
   *  group in group order. Optional (a stroke game needn't group its players). Reuses
   *  rack's `play_groups` data path: the RPC UPSERTS participants (never deletes the
   *  roster) and reassigns `play_group_id`, so grouping only ORGANIZES the existing
   *  roster. A membership change is refused once scores exist (HAS_SCORES), like rack. */
  groups: string[][];
}

/** Server snapshot → stroke draft baseline. The caller resolves participants → a
 *  `{ userId → strokes }` map and play_groups → an ordered `string[][]` before handing
 *  them here (mirrors the rack/match resolvers). */
export function configToStrokeDraft(
  game: ConfigGameSnapshot,
  strokes: Record<string, number>,
  groups: string[][],
  delegates: string[]
): StrokeConfigDraft {
  return {
    gameTypeId: game.game_type_id ?? null,
    name: game.name ?? "",
    rulesForToday: game.rules_for_today ?? null,
    competitionFormat: (game.competition_format ?? null) as CompetitionFormat | null,
    bracketConfig: toBracketConfig(game.bracket_config),
    scoringEnabled: game.scoring_enabled ?? false,
    pointsTotal: game.points_total ?? null,
    // Winner-takes-all (item 6): a persisted single-place split IS winner-takes-all —
    // normalize it to the null sentinel so the draft carries no stale snapshot and the
    // editor re-derives `1st = total` live. A real ≥2-place split passes through.
    pointsDistribution: isWinnerTakesAll((game.points_distribution ?? null) as PointsDistribution | null)
      ? null
      : (game.points_distribution ?? null),
    delegates: [...delegates].sort(),
    strokes: { ...strokes },
    modifiers: game.modifiers ?? {},
    course: {
      id: game.course_id ?? null,
      backId: game.back_course_id ?? null,
      scorecardSchema: game.scorecard_schema ?? null,
    },
    groups: groups.map((g) => [...g]),
  };
}

/**
 * Convert the stroke draft into the atomic RPC payload. Placement points pass THROUGH
 * (owner-authored, not derived). `modifiers` is sent EXPLICITLY (the RPC defaults a
 * missing key to `{}`, which would wipe them). `participants[]` carries every roster
 * member's strokes (the in-place FIELD write). No `groups`/`matches` (the RPC skips both
 * blocks); the course change is the destroys tier, gated SERVER-side (COURSE_LOCKED).
 */
export function strokeDraftToPayload(draft: StrokeConfigDraft, baseline?: StrokeConfigDraft): SaveConfigPayload {
  // Winner-takes-all (item 6): the null/single-place default materializes to `[total]`
  // — the whole pool to 1st — DERIVED from the current total at save time, never a
  // stored snapshot. The award path's `placement` branch awards it unchanged, so no
  // award-path change. A real ≥2-place split passes through; total==null (never
  // configured) stays null (nothing to award).
  let distribution = draft.pointsDistribution;
  if (isWinnerTakesAll(distribution) && draft.pointsTotal != null) {
    distribution = { type: "placement", values: [draft.pointsTotal] };
  }
  return {
    ...baseDraftToPayload(draft, distribution, baseline),
    modifiers: draft.modifiers,
    courseId: draft.course.id,
    backCourseId: draft.course.backId,
    scorecardSchema: draft.course.scorecardSchema,
    participants: Object.entries(draft.strokes).map(([userId, strokes]) => ({ userId, strokes })),
    // GROUPINGS (P3 3.2) — reuse rack's groups[] path: the STRUCTURE unit, clean-replaced
    // on a real change (refused with scores) and skipped when unchanged. The RPC upserts
    // the roster union (never deletes), so grouping only ORGANIZES stroke's existing roster.
    groups: rackGroupsToPersist(draft.groups),
    groupsStructureDirty: baseline ? !rackGroupsEqual(draft.groups, baseline.groups) : true,
  };
}

/** Pure whole-page equality for the stroke draft — base + course + strokes + modifiers +
 *  groupings (drives the Save-enabled gate). */
export function strokeDraftsEqual(a: StrokeConfigDraft, b: StrokeConfigDraft): boolean {
  return (
    baseDraftsEqual(a, b) &&
    a.course.id === b.course.id &&
    a.course.backId === b.course.backId &&
    canonical(a.course.scorecardSchema) === canonical(b.course.scorecardSchema) &&
    canonical(a.strokes) === canonical(b.strokes) &&
    canonical(a.modifiers) === canonical(b.modifiers) &&
    rackGroupsEqual(a.groups, b.groups)
  );
}

// ── Dirty check ──────────────────────────────────────────────────────────────

/**
 * A match row splits into TWO kinds of change, and they persist completely
 * differently — `matchesDirty` used to conflate them, which is why editing a
 * handicap or a point override on a scored game was wrongly refused:
 *
 *  - STRUCTURE (`matchesStructureEqual`) = the SET: which matches exist, each side's
 *    roster, the shape. A change here has no stable row identity to update, so the
 *    RPC clean-replaces (mints fresh UUIDs) — which orphans score rows. Correctly
 *    REFUSED once scores exist (`HAS_SCORES`).
 *  - FIELDS (`matchFieldsEqual`) = values on rows that AREN'T going anywhere: the
 *    per-side `handicap` and the per-match `pointValue`. The set is identical, so
 *    these persist via an in-place `UPDATE` — allowed with scores (the WARNED tier:
 *    results recalculate, nothing is orphaned). Only meaningful when structure is
 *    equal (same rows to update); it's not a substitute for upsert-by-identity,
 *    which handles "set changed but some rows survive" — this is "set is identical."
 */
function matchesStructureEqual(a: DraftMatchConfig[], b: DraftMatchConfig[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => {
    const n = b[i];
    return (
      m.matchNumber === n.matchNumber &&
      m.playersPerSide === n.playersPerSide &&
      arraysEqual(m.a, n.a) &&
      arraysEqual(m.b, n.b)
    );
  });
}

/** FIELDS equality — assumes structure already matches (compares position-wise). */
function matchFieldsEqual(a: DraftMatchConfig[], b: DraftMatchConfig[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((m, i) => m.handicap === b[i].handicap && m.pointValue === b[i].pointValue);
}

/** The whole-match dirty check (drives the Save-enabled gate) — dirty if EITHER
 *  structure or fields differ. */
function matchesEqual(a: DraftMatchConfig[], b: DraftMatchConfig[]): boolean {
  return matchesStructureEqual(a, b) && matchFieldsEqual(a, b);
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Pure whole-page equality — drives the Save-enabled / dirty indicator (mirrors
 * `travelFormsEqual`). Compares the semantic content of every drafted field.
 * `name`/`rules` compare trimmed (trailing whitespace isn't a change); modifiers
 * and the distribution compare via canonical JSON (key-order-independent);
 * delegates compare order-independently (sorted at both build sites).
 */
export function configDraftsEqual(a: ConfigDraft, b: ConfigDraft): boolean {
  return (
    baseDraftsEqual(a, b) &&
    a.entryMode === b.entryMode &&
    a.course.id === b.course.id &&
    a.course.backId === b.course.backId &&
    canonical(a.modifiers) === canonical(b.modifiers) &&
    canonical(a.course.scorecardSchema) === canonical(b.course.scorecardSchema) &&
    matchesEqual(a.matches, b.matches)
  );
}

/** The base-field equality every variant shares (name/rules/format/scoring/points/
 *  delegates). Trimmed name/rules, canonical distribution, order-independent delegates. */
function baseDraftsEqual(a: BaseConfigDraft, b: BaseConfigDraft): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    (a.rulesForToday?.trim() || "") === (b.rulesForToday?.trim() || "") &&
    a.competitionFormat === b.competitionFormat &&
    // Value equality, not reference: the draft holds a fresh object every render.
    JSON.stringify(a.bracketConfig ?? null) === JSON.stringify(b.bracketConfig ?? null) &&
    a.scoringEnabled === b.scoringEnabled &&
    a.pointsTotal === b.pointsTotal &&
    canonical(a.pointsDistribution) === canonical(b.pointsDistribution) &&
    arraysEqual(a.delegates, b.delegates)
  );
}

/** Stable, key-order-independent JSON (same idea as `configHash.ts`'s
 *  `canonicalize`) so `{a:1,b:2}` and `{b:2,a:1}` compare equal. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
}

// ── Pick'em variant ──────────────────────────────────────────────────────────

/**
 * Pick'em's settings page, as a draft.
 *
 * ── The two extra fields, and where they live ──────────────────────────────
 *
 * `rollUp` and `useConfidence` are columns on `pickem_games`, not `games`,
 * which is the only reason pick'em was not already on this machinery.
 * `save_game_config` learned to write them in migration 157, so the whole page
 * — name, rules, delegates, points total, and these two — commits through the
 * one atomic RPC like every other format (#18).
 *
 * ── What the page carried before ───────────────────────────────────────────
 *
 * Four write models on one screen: Total Points wrote on every stepper press;
 * the deadline and the two scoring settings each had a private draft with its
 * own commit button; and name / rules / delegates were rendered but wired to
 * NOTHING — typing Rules of the Day and closing the panel lost it silently,
 * which is the defect that made this worth doing before the cosmetic half.
 *
 * The SLATE is deliberately not here. It is content rather than configuration,
 * it commits through `save_pickem_config`, and it has a different freeze
 * boundary (picks-open, where these wait for the first result).
 */
export interface PickemConfigDraft extends BaseConfigDraft {
  rollUp: "team_totals" | "individual_matches";
  useConfidence: boolean;
  /**
   * The PAIRINGS, drafted like everything else on the settings page.
   *
   * They used to write immediately through `save_pickem_matches` from a panel on
   * the GAME page. Both halves of that were wrong: pairing is setup, not
   * something you do while the game runs, and a control on a settings surface
   * that writes on its own action is the one thing #18 exists to prevent.
   *
   * `save_game_config`'s matches arm is gated on `p_payload ? 'matches'`, not on
   * game type, so pick'em rides the SAME atomic write match play does — one RPC
   * per page, no migration, and Cancel discards the pairing with the rest.
   */
  matches: DraftMatchConfig[];
}

/** Server snapshot → pick'em draft baseline. `settings` comes from the
 *  `pickem_games` row, which `pickem.get` already returns. */
export function configToPickemDraft(
  game: ConfigGameSnapshot,
  delegates: string[],
  settings: { rollUp: "team_totals" | "individual_matches"; useConfidence: boolean },
  /** The pairings as stored. Empty for a team-totals game, which has none. */
  matches: DraftMatchInput[] = []
): PickemConfigDraft {
  return {
    gameTypeId: game.game_type_id ?? null,
    name: game.name ?? "",
    rulesForToday: game.rules_for_today ?? null,
    competitionFormat: (game.competition_format ?? null) as CompetitionFormat | null,
    bracketConfig: toBracketConfig(game.bracket_config),
    // Pick'em is the ONE surface with `FORMAT_SURFACE.gameState === false`: its
    // go-live is `pickem_games.picks_opened_at`, and `scoring_enabled` stays
    // false for the whole life of the game (migration 135's CHECK refuses the
    // state picks-open would otherwise occupy). Mirrored from the server so the
    // payload echoes it back unchanged; never toggled here.
    scoringEnabled: game.scoring_enabled ?? false,
    pointsTotal: game.points_total ?? null,
    pointsDistribution: game.points_distribution ?? null,
    delegates: [...delegates].sort(),
    rollUp: settings.rollUp,
    useConfidence: settings.useConfidence,
    matches: matches.map((m) => ({
      matchNumber: m.matchNumber,
      playersPerSide: m.playersPerSide,
      a: [...m.a],
      b: [...m.b],
      handicap: m.handicap,
      pointValue: m.pointValue,
    })),
  };
}

export function pickemDraftsEqual(a: PickemConfigDraft, b: PickemConfigDraft): boolean {
  return (
    baseDraftsEqual(a, b) &&
    a.rollUp === b.rollUp &&
    a.useConfidence === b.useConfidence &&
    // Reuses match play's comparison rather than a second one: the rows are the
    // same `DraftMatchConfig`, so two spellings of "did the pairing change" is
    // how the Save bar and the server start disagreeing.
    matchesEqual(a.matches, b.matches)
  );
}

/**
 * Pick'em draft → the atomic Save payload.
 *
 * Base fields plus the `pickem` key the RPC's arm reads. No `matches`, no
 * `groups`, no course, no `entryMode`/`modifiers` — pick'em owns none of them,
 * and the RPC preserves what a payload does not mention.
 *
 * The `pickem` key is ALWAYS sent. It is COALESCE-preserved server-side, so an
 * absent key would silently keep the old values — the shape that made
 * MODIFIERS-MUST-ALWAYS-SEND a rule. Sending it every time means a change to
 * either setting cannot be lost by an omission, and re-sending unchanged values
 * costs nothing.
 */
export function pickemDraftToPayload(
  draft: PickemConfigDraft,
  baseline?: PickemConfigDraft
): SaveConfigPayload {
  /**
   * ── `matchesStructureDirty` MUST BE SENT, and it was not ───────────────────
   *
   * The RPC defaults it to TRUE when the key is absent, and absent is what this
   * builder sent. So every pick'em save — a rename, a points total, anything —
   * took the clean-replace branch: DELETE every `game_matches` row, re-INSERT
   * with fresh `gen_random_uuid()` ids.
   *
   * Those ids are hashed AND are the sort key in `readGameConfigHash`, so the
   * config fingerprint moved on a save that changed nothing. Measured: two
   * identical saves through this very function gave c917f20f then c10a5608 with
   * the row content byte-identical. That churn fires a config refetch on every
   * other open device, and widens the optimistic-concurrency window for anyone
   * holding a base hash from before it.
   *
   * ── Compared over the rows that are SENT, not the draft ───────────────────
   *
   * `matchesToSaveRows` drops unfilled matches (an unpaired slot is not a match),
   * while the draft carries a placeholder row for every slot. Comparing the raw
   * drafts would therefore report dirty forever on any game with a spare
   * player — the 8-people-into-7-matches case — which is the same bug wearing a
   * flag. Both sides are filtered so the comparison is over exactly what the
   * payload carries.
   */
  const sent = (ms: DraftMatchConfig[]) => ms.filter(isDraftMatchFilled);
  return {
    ...baseDraftToPayload(draft, draft.pointsDistribution, baseline),
    /**
     * Sent when pairings are IN PLAY for this game — which is not the same as
     * the draft currently holding some.
     *
     * The condition was `draft.matches.length > 0` alone, and that made Clear a
     * no-op: emptying the draft omitted the key, and the RPC preserves what a
     * payload does not mention. So the pairings survived the clear that was
     * supposed to remove them, which is half of how a game got stuck.
     *
     * The BASELINE is the other half of the question. A team-totals game that
     * never had pairings still sends nothing — an unconditional `matches: []`
     * would read as "clear every pairing" there — but a game that HAS them and
     * has just had them cleared sends the empty list that says so.
     */
    ...(draft.matches.length > 0 || (baseline?.matches.length ?? 0) > 0
      ? {
          matches: matchesToSaveRows(draft.matches),
          // No baseline = first save of this page; assume dirty, which is the
          // RPC's own default and the safe direction.
          matchesStructureDirty: baseline
            ? !matchesStructureEqual(sent(draft.matches), sent(baseline.matches))
            : true,
        }
      : {}),
    /**
     * ── SENT ONLY WHEN IT CHANGED, and that is not a weakening ──────────────
     *
     * This was unconditional, on the MODIFIERS-MUST-ALWAYS-SEND reasoning: the
     * RPC COALESCE-preserves an absent key, so omitting one silently keeps the
     * old value and a change could be lost.
     *
     * But `save_game_config`'s scoring freeze fires on the PRESENCE of this key:
     *
     *     IF _pickem_has_results(game) THEN
     *       IF (payload ? 'pickem') OR (payload ? 'pointsTotal' AND <changed>)
     *         RAISE 'PICKEM_SCORED: results are in, so how this game scores is frozen'
     *
     * Note the asymmetry — `pointsTotal` is tested for a CHANGED VALUE and this
     * one only for being there. So once any result existed, an always-sent key
     * made the ENTIRE settings page unsaveable: renaming the game was refused,
     * and told the runner that how it SCORES is frozen. Measured — a
     * name-only save failed with exactly that.
     *
     * Sending it only when it differs restores the guard's intent rather than
     * dodging it: a real scoring change still carries the key and is still
     * refused, which is what the freeze is for. The always-send rule exists so a
     * CHANGE is never lost, and a change is still always sent — the same shape
     * `matchesStructureDirty` already uses two keys above.
     *
     * With no baseline (a first save) it is sent, which is both safe and the
     * honest default.
     */
    ...(!baseline ||
    draft.rollUp !== baseline.rollUp ||
    draft.useConfidence !== baseline.useConfidence
      ? { pickem: { rollUp: draft.rollUp, useConfidence: draft.useConfidence } }
      : {}),
  };
}
