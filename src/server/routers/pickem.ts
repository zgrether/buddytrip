import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireGameEdit } from "../middleware";

/**
 * pickem — the slate, the two scoring settings, and the lifecycle transitions.
 *
 * ── Thin on purpose ─────────────────────────────────────────────────────────
 * Every write here is one `rpc()` call. The rules — who may edit
 * (`assert_game_edit`), whether the slate is frozen, that the slate is upserted
 * rather than clean-replaced, that picks cannot open on an empty slate — all
 * live in `save_pickem_config` / `set_pickem_phase` (migration 148), because a
 * rule enforced in a tRPC procedure is a rule a direct PostgREST caller does not
 * meet. These procedures exist to give the client a typed door, not to be the
 * gate.
 *
 * ── `get` is deliberately readable by any trip member ───────────────────────
 * It returns the clock, the settings and the slate. None of that is secret — a
 * member needs the deadline to render a countdown and the slate to pick against.
 * What IS secret is other people's picks. `myPicks` carries the caller's OWN
 * sheet and nobody else's: it is filtered to `ctx.user!.id` on the way out *as
 * well as* being held to it by `pickem_picks_select`, which is belt and braces
 * in the one place where a widening would be invisible from the client. After
 * the reveal the same query would return the whole field — that is Phase 6's
 * read, through a different procedure, deliberately not this one.
 *
 * The slate comes back EMPTY for a plain member before picks open, and that is
 * the RLS policy doing its job rather than a bug — spec §3.1's first fairness
 * rule is that a member cannot tell an empty slate from a finished, unpublished
 * one. The procedure does not special-case it, because filtering here would be a
 * second definition of that rule sitting in front of the real one.
 */

/** One contest on the slate, as the client sends it. `id` is minted client-side
 *  so a row keeps its identity across an edit — which is what lets the RPC
 *  upsert rather than clean-replace, and therefore what keeps picks alive
 *  through a Reopen (migration 148). */
const slateGameSchema = z.object({
  id: z.string().min(1),
  awayTeam: z.string().min(1).max(60),
  homeTeam: z.string().min(1).max(60),
  spread: z.string().max(20).nullable().optional(),
  kickoff: z.string().max(40).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
  /** Default 1 — setting nothing must produce a normal game (spec §2.3). */
  multiplier: z.number().positive().max(100).default(1),
  /** Provenance when the row was filled from the matchup search; null when the
   *  runner typed it. Opaque — deliberately not validated against an ESPN id
   *  shape, since ESPN is undocumented and a format assertion would make their
   *  change our outage (migration 149). */
  espnEventId: z.string().max(64).nullable().optional(),
});

export const pickemRouter = router({
  // ── read ────────────────────────────────────────────────────────────────
  get: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, name, game_type_id, competition_id, status, points_total")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

      const [configRes, slateRes, picksRes, matchRes] = await Promise.all([
        ctx.supabase
          .from("pickem_games")
          .select("picks_opened_at, picks_deadline, picks_locked_at, roll_up, use_confidence")
          .eq("game_id", input.gameId)
          .maybeSingle(),
        ctx.supabase
          .from("pickem_slate_games")
          .select("id, display_order, away_team, home_team, spread, kickoff, note, multiplier, espn_event_id")
          .eq("game_id", input.gameId)
          .order("display_order", { ascending: true }),
        ctx.supabase
          .from("pickem_picks")
          .select("slate_game_id, pick, confidence")
          .eq("game_id", input.gameId)
          .eq("user_id", ctx.user!.id),
        // Pick'em reuses `game_matches` rather than a private table: the shared
        // divisor (`liveMatchPointsPerMatch`), the guest merge's JSONB handling
        // and the realtime publication all already speak it.
        ctx.supabase
          .from("game_matches")
          .select("id, display_order, side_a, side_b, point_value")
          .eq("game_id", input.gameId)
          .order("display_order", { ascending: true }),
      ]);

      const cfg = configRes.data;
      return {
        game,
        /** Null until the runner first saves — a game switched to pick'em has no
         *  config row yet, and the client must render "nothing built" rather
         *  than inventing defaults that disagree with the column defaults. */
        clock: {
          picksOpenedAt: (cfg?.picks_opened_at as string | null) ?? null,
          picksDeadline: (cfg?.picks_deadline as string | null) ?? null,
          picksLockedAt: (cfg?.picks_locked_at as string | null) ?? null,
        },
        settings: {
          rollUp: (cfg?.roll_up as "team_totals" | "individual_matches" | undefined) ?? "team_totals",
          useConfidence: (cfg?.use_confidence as boolean | undefined) ?? true,
        },
        slate: (slateRes.data ?? []).map((r) => ({
          id: r.id as string,
          displayOrder: r.display_order as number,
          awayTeam: r.away_team as string,
          homeTeam: r.home_team as string,
          spread: (r.spread as string | null) ?? null,
          kickoff: (r.kickoff as string | null) ?? null,
          note: (r.note as string | null) ?? null,
          espnEventId: (r.espn_event_id as string | null) ?? null,
          // `numeric` arrives as a string over PostgREST; the whole app treats a
          // multiplier as a number, so it is coerced ONCE, here, rather than at
          // every call site that would otherwise get `"2"` and concatenate.
          multiplier: Number(r.multiplier ?? 1),
        })),
        /**
         * The caller's own sheet, RAW — not reconciled against the slate.
         *
         * `reconcileSheet` is the one place that folds these onto the current
         * slate, fills the gaps and decides whether the ranking survived a
         * reopen. It is client-safe so the sheet screen and (Phase 6) the
         * scoring engine call the SAME function; doing half of it here would be
         * the second definition.
         *
         * EMPTY means never saved, which is what spec §4 calls "not submitted"
         * — derived, so there is no column that can disagree with the rows.
         */
        /**
         * The matches, in the exact shape `liveMatchPointsPerMatch` takes, so
         * nothing downstream re-derives what "valid" means. A side is `{type,
         * id}` JSONB (CLAUDE.md #27) — null id means an empty slot, which is
         * what makes a match invalid for the divisor.
         */
        matches: (matchRes.data ?? []).map((r) => ({
          id: r.id as string,
          displayOrder: r.display_order as number,
          sideAId: ((r.side_a as { id?: string } | null)?.id ?? null) as string | null,
          sideBId: ((r.side_b as { id?: string } | null)?.id ?? null) as string | null,
          pointValue: r.point_value == null ? null : Number(r.point_value),
        })),
        myPicks: (picksRes.data ?? []).map((r) => ({
          slateGameId: r.slate_game_id as string,
          pick: r.pick as "away" | "home",
          confidence: (r.confidence as number | null) ?? null,
        })),
      };
    }),

  // ── the modal's one write ───────────────────────────────────────────────
  saveConfig: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        // Both optional: absent means "leave that half alone". The modal sends
        // both; a future surface that edits only settings does not have to
        // resend a slate it never showed.
        slate: z.array(slateGameSchema).max(200).optional(),
        settings: z
          .object({
            rollUp: z.enum(["team_totals", "individual_matches"]).optional(),
            useConfidence: z.boolean().optional(),
          })
          .optional(),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const payload: Record<string, unknown> = {};
      if (input.slate) payload.slate = input.slate;
      if (input.settings) payload.settings = input.settings;

      const { error } = await ctx.supabase.rpc("save_pickem_config", {
        p_game_id: input.gameId,
        p_payload: payload,
      });
      if (error) throw pickemError(error.message);
      return { ok: true };
    }),

  // ── the sheet's one write ───────────────────────────────────────────────
  /**
   * A participant saving their own sheet.
   *
   * `requireTripMember`, NOT `requireGameEdit` — this is the one pick'em write
   * a plain member makes, and the only thing that decides whether they may make
   * it is `pickem_picks_write`: their own rows, while picks are open, for
   * EVERYONE including the Owner. Nothing here re-implements that.
   *
   * The whole sheet goes every time. A per-game PATCH would be smaller and
   * would also make a ranking swap two writes, which is a window in which the
   * sheet is not a legal 1..N — precisely what the partial unique index refuses
   * (see migration 150). The sheet is small and the atomic write is the point.
   */
  savePicks: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        picks: z
          .array(
            z.object({
              slateGameId: z.string().min(1),
              pick: z.enum(["away", "home"]),
              /** Null on a confidence-off game. The RPC forces it to null there
               *  regardless, so a client that sends one is corrected rather than
               *  refused — the value is meaningless, not hostile. */
              confidence: z.number().int().min(1).nullable(),
            })
          )
          .min(1)
          .max(200),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("save_pickem_picks", {
        p_game_id: input.gameId,
        p_picks: input.picks,
      });
      if (error) throw pickemError(error.message);
      return { ok: true };
    }),

  // ── the points total ────────────────────────────────────────────────────
  /**
   * Deliberately NOT part of `saveConfig`: that write is frozen once picks open
   * (spec §4), and the total is the one setting that legitimately changes after
   * — it decides what the game is WORTH, not anything a participant already
   * decided. See migration 152.
   */
  setPointsTotal: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        /** Null means "not decided yet", which is a different state from 0
         *  ("decided, worth nothing"). Both are legal; the UI warns on either
         *  once matches exist. */
        total: z.number().min(0).max(1000).nullable(),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("set_pickem_points_total", {
        p_game_id: input.gameId,
        p_total: input.total,
      });
      if (error) throw pickemError(error.message);
      return { ok: true };
    }),

  // ── the matches ─────────────────────────────────────────────────────────
  /**
   * Writes into `game_matches`, not a private table — the divisor, MatchSides,
   * the guest merge and the realtime publication all already speak it.
   *
   * NOT gated on the lock (spec §1, correcting the original spec's fairness
   * rule): there is no strategic reason to pick differently against one
   * opponent than another, and with confidence off the idea is meaningless.
   * What survives is a REVEAL rule — participants do not SEE matches until
   * picks lock — and that is enforced by the read, not by refusing the write.
   */
  saveMatches: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        pairs: z
          .array(
            z.object({
              a: z.string().nullable(),
              b: z.string().nullable(),
            })
          )
          .max(100),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("save_pickem_matches", {
        p_game_id: input.gameId,
        p_pairs: input.pairs,
      });
      if (error) throw pickemError(error.message);
      return { ok: true };
    }),

  // ── the deadline, on its own ────────────────────────────────────────────
  /**
   * Split out of `setPhase('open')` (migration 153), which also coalesces
   * `picks_opened_at` and clears `picks_locked_at` — so editing a deadline
   * through it would publish a building game or silently unlock a locked one.
   * This writes one column and is therefore safe in any phase.
   */
  setDeadline: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        /** Null clears it — "no deadline, I lock by hand", a supported choice. */
        deadline: z.string().datetime().nullable(),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("set_pickem_deadline", {
        p_game_id: input.gameId,
        p_deadline: input.deadline,
      });
      if (error) throw pickemError(error.message);
      return { ok: true };
    }),

  // ── open / lock / reopen ────────────────────────────────────────────────
  setPhase: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        action: z.enum(["open", "lock", "unlock", "reopen"]),
        /** Only meaningful with `open`. Null means "no deadline — I will lock by
         *  hand", which is a supported choice rather than a missing value. */
        deadline: z.string().datetime().nullable().optional(),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("set_pickem_phase", {
        p_game_id: input.gameId,
        p_action: input.action,
        p_deadline: input.deadline ?? null,
      });
      if (error) throw pickemError(error.message);
      return { ok: true };
    }),
});

/**
 * Turn the RPC's tagged exceptions into messages a person can act on.
 *
 * Each arm names the thing to DO, not just what went wrong — the generic
 * fallthrough is what CLAUDE.md's "a generic couldn't-be-saved is a
 * FALLTHROUGH" note is about, and the specific arms are what keep the real
 * Postgres text out of the UI while still saying something true.
 */
function pickemError(message: string): TRPCError {
  if (message.includes("SLATE_LOCKED")) {
    return new TRPCError({
      code: "CONFLICT",
      message:
        "Picks are open, so the slate and its scoring settings are frozen. Reopen the slate first — everyone will have to re-rank.",
    });
  }
  if (message.includes("EMPTY_SLATE")) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "Add at least one game to the slate before opening picks.",
    });
  }
  if (message.includes("PICKS_CLOSED")) {
    return new TRPCError({
      code: "CONFLICT",
      // Names the two ways it can be true, because the participant cannot tell
      // them apart and the difference decides whether waiting helps.
      message: "Picks are closed — the deadline passed or the runner locked them.",
    });
  }
  if (message.includes("INCOMPLETE_SHEET") || message.includes("UNKNOWN_SLATE_GAME")) {
    return new TRPCError({
      code: "CONFLICT",
      message: "The slate changed while you were picking. Reload and check your sheet before saving.",
    });
  }
  if (message.includes("BAD_CONFIDENCE")) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "Every game needs its own rank, with no repeats.",
    });
  }
  if (message.includes("MATCH_DECIDED")) {
    return new TRPCError({
      code: "CONFLICT",
      message: "A match already has a result. Clear it before changing the pairings.",
    });
  }
  if (message.includes("DUPLICATE_PLAYER")) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: "Someone is in more than one match — a person plays once.",
    });
  }
  if (message.includes("BAD_TOTAL")) {
    return new TRPCError({ code: "BAD_REQUEST", message: "Points can't be negative." });
  }
  if (message.includes("BAD_MULTIPLIER")) {
    return new TRPCError({ code: "BAD_REQUEST", message: "A multiplier has to be greater than zero." });
  }
  if (message.includes("NOT_AUTHORIZED")) {
    return new TRPCError({ code: "FORBIDDEN", message: "You can't edit this game." });
  }
  if (message.includes("GAME_NOT_FOUND")) {
    return new TRPCError({ code: "NOT_FOUND", message: "Game not found." });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Pick'em save failed: ${message}` });
}
