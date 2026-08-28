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
 * What IS secret is other people's picks BEFORE the reveal. `myPicks` carries
 * the caller's OWN sheet and nobody else's: filtered to `ctx.user!.id` on the
 * way out *as well as* held to it by `pickem_picks_select`, belt and braces in
 * the one place where a widening would be invisible from the client.
 *
 * `sheets` is the board's read (Phase 6) and carries the FIELD — but only once
 * the game is revealed, because it asks with no user filter and lets
 * `pickem_picks_select` decide. Before the lock the policy returns the caller's
 * rows and nothing else, so the two fields agree; after it, `sheets` widens and
 * `myPicks` does not.
 *
 * This note previously said the board read would live "through a different
 * procedure, deliberately not this one". It lives here instead: the board needs
 * the slate, the settings and the clock in the same breath, and a second
 * procedure would have re-fetched all three to add one field. The reason given
 * for separating them was never security — RLS is the gate at either address —
 * so there was nothing to lose by folding it in, and a round trip to save.
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

      // An EXISTENCE question, so `head: true` — it returns a count and no
      // rows and therefore cannot be truncated by PostgREST's 1000-row cap.
      // Collecting ids out of a fetched set is how a guard gets more permissive
      // the more the trip is used (CLAUDE.md #27).
      const [
        configRes,
        slateRes,
        picksRes,
        matchRes,
        teamRes,
        assignRes,
        resultCountRes,
        allPicksRes,
      ] = await Promise.all([
        ctx.supabase
          .from("pickem_games")
          .select("picks_opened_at, picks_deadline, picks_locked_at, roll_up, use_confidence")
          .eq("game_id", input.gameId)
          .maybeSingle(),
        ctx.supabase
          .from("pickem_slate_games")
          .select(
            "id, display_order, away_team, home_team, spread, kickoff, note, multiplier, espn_event_id, result"
          )
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
          // `result` and `status` ride along for `hasResults` below — the same
          // read, no extra round trip.
          .from("game_matches")
          .select("id, display_order, side_a, side_b, point_value, result, status")
          .eq("game_id", input.gameId)
          .order("display_order", { ascending: true }),
        // The two sides of the cup, for the pairing grid. Pick'em pairs ACROSS
        // teams — one person from each — so the grid needs both rosters, not
        // the game's own participant list (which the pairing produces rather
        // than consumes).
        game.competition_id
          ? ctx.supabase
              .from("teams")
              .select("id, name, short_name, color")
              .eq("competition_id", game.competition_id)
              .order("created_at", { ascending: true })
          : Promise.resolve({ data: [] as { id: string; name: string; short_name: string; color: string }[] }),
        game.competition_id
          ? ctx.supabase
              .from("team_assignments")
              .select("user_id, team_id, sort_order")
              .eq("competition_id", game.competition_id)
              .order("sort_order", { ascending: true })
          : Promise.resolve({ data: [] as { user_id: string; team_id: string; sort_order: number }[] }),
        ctx.supabase
          .from("game_results")
          .select("id", { count: "exact", head: true })
          .eq("game_id", input.gameId),
        // EVERY sheet, for the board — and the RLS policy is the gate rather
        // than a branch here. `pickem_picks_select` admits a row when it is the
        // caller's OWN or the game is revealed, so before the lock this returns
        // exactly the caller's picks and after it returns the field's.
        //
        // Asking without a user filter and letting the policy decide is what
        // makes §7 hold by construction: there is no code path here that could
        // hand a member another person's unrevealed sheet, because the database
        // never sends it.
        ctx.supabase
          .from("pickem_picks")
          .select("user_id, slate_game_id, pick, confidence")
          .eq("game_id", input.gameId),
      ]);

      const cfg = configRes.data;
      /**
       * Has anything been scored yet — the ONE freeze boundary for pick'em's
       * three scoring settings (migration 157).
       *
       * ── The second spelling, and why it is unavoidable ────────────────────
       *
       * `_pickem_has_results` is the authority: it is what `save_game_config`
       * and `save_pickem_config` actually refuse on. It answers about a
       * CONTAINER rather than its caller, so per CLAUDE.md #28 it is REVOKEd
       * from `authenticated` and cannot be called from here.
       *
       * So this mirrors it in TypeScript, exactly as `pickemLifecycle.ts`
       * mirrors `pickem_picks_open`, and for the same reason: SQL cannot import
       * TypeScript. `pickemHasResultsParity.rls.test.ts` drives BOTH over the
       * same states so they cannot drift into disagreeing — the failure that
       * would otherwise show up as a settings row the screen offers and the
       * server then refuses.
       *
       * Conservative in the same direction as the SQL: a `game_results` row, a
       * decided match, or a finished game each count.
       */
      const hasResults =
        (resultCountRes.count ?? 0) > 0 ||
        (matchRes.data ?? []).some(
          (m) => (m.result as string | null) != null || (m.status as string | null) === "complete"
        ) ||
        game.status === "complete";

      /**
       * Every sheet the caller may see, keyed by person — the board's whole
       * input besides the slate.
       *
       * Before the reveal this is one entry (the caller's own) because that is
       * all RLS returns; after it, the field's. The board renders from whatever
       * arrives rather than asking whether it is allowed to.
       */
      const sheets: Record<string, { slateGameId: string; pick: "away" | "home"; confidence: number | null }[]> = {};
      for (const r of (allPicksRes.data ?? []) as {
        user_id: string;
        slate_game_id: string;
        pick: string;
        confidence: number | null;
      }[]) {
        (sheets[r.user_id] ??= []).push({
          slateGameId: r.slate_game_id,
          pick: r.pick as "away" | "home",
          confidence: r.confidence,
        });
      }

      return {
        game,
        /** See `sheets` above — RLS-gated, so this IS §7's guarantee. */
        sheets,
        /** See `hasResults` above — the settings freeze, not the clock. */
        hasResults,
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
          /** How it finished — away / home / push / cancelled, or null for not
           *  yet played (migration 159). */
          result: (r.result as "away" | "home" | "push" | "cancelled" | null) ?? null,
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
         * The cup's two sides, each with its roster in assignment order.
         * Empty for a standalone game, which correctly has no matches surface.
         */
        teams: (teamRes.data ?? []).map((t) => ({
          id: t.id as string,
          name: t.name as string,
          shortName: t.short_name as string,
          color: t.color as string,
          memberIds: (assignRes.data ?? [])
            .filter((a) => a.team_id === t.id)
            .map((a) => a.user_id as string),
        })),
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
  /**
   * Run — record one slate game's outcome.
   *
   * ANY ORDER. Nothing here reads `display_order`, and nothing waits on the
   * row above it: a Thursday nighter lands, then two on Friday, then the bulk
   * on Saturday.
   *
   * Four-valued, because a result is not "who won": a push happened and nobody
   * covered, a cancellation never happened. Same arithmetic, different facts.
   *
   * The completeness gate and the finalize freeze both live in the RPC — see
   * migration 159. They are re-stated as typed errors here so the surface can
   * say WHICH match is short rather than showing a Postgres string.
   */
  setResult: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        slateGameId: z.string(),
        /** Null clears it back to unplayed — every outcome is reversible. */
        result: z.enum(["away", "home", "push", "cancelled"]).nullable(),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("set_pickem_result", {
        p_game_id: input.gameId,
        p_slate_game_id: input.slateGameId,
        p_result: input.result,
      });
      if (error) throw pickemError(error.message);
      return { ok: true };
    }),

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

  // ── open / lock / unlock ────────────────────────────────────────────────
  //
  // `reopen` was removed in migration 156. It destroyed every ranking as a
  // side effect of making the slate editable; the slate is now editable
  // whenever picks are not open, and the clear happens in `saveConfig` when
  // the slate actually changes. The deadline left with it — `setDeadline`
  // owns that column, and `open` writing it wiped the deadline of every
  // re-opened game.
  setPhase: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        action: z.enum(["open", "lock", "unlock"]),
      })
    )
    .use(requireGameEdit())
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase.rpc("set_pickem_phase", {
        p_game_id: input.gameId,
        p_action: input.action,
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
  /**
   * §6.1 — the refusal NAMES the gap.
   *
   * The RPC raises "MATCHES_INCOMPLETE: Bill has no opponent", and the tail is
   * carried through verbatim rather than replaced with a generic line.
   * "Finalize your matches" sends someone hunting through a grid; the name is
   * the actionable half, and throwing it away here would undo the reason the
   * SQL bothered to look it up.
   */
  if (message.includes("MATCHES_INCOMPLETE")) {
    const detail = message.split("MATCHES_INCOMPLETE:")[1]?.trim();
    return new TRPCError({
      code: "CONFLICT",
      message: detail
        ? `Can't record a result yet — ${detail}. Every match needs both sides before points can be split.`
        : "Can't record a result yet — set the matches first.",
    });
  }
  if (message.includes("GAME_FINAL")) {
    return new TRPCError({
      code: "CONFLICT",
      // Names the way back rather than only the refusal. §6.2: the reset path
      // exists and this must not become a second one.
      message: "This game is finalized. Reset its scores from settings to change a result.",
    });
  }
  if (message.includes("SLATE_GAME_NOT_FOUND")) {
    return new TRPCError({
      code: "CONFLICT",
      message: "That game is no longer on the slate. Reload and try again.",
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
