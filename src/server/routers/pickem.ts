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
 * What IS secret is other people's picks, and those are not in this payload at
 * all: they are read separately, through a policy with no staff branch.
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
});

export const pickemRouter = router({
  // ── read ────────────────────────────────────────────────────────────────
  get: authedProcedure
    .input(z.object({ tripId: z.string(), gameId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx, input }) => {
      const { data: game } = await ctx.supabase
        .from("games")
        .select("id, name, game_type_id, competition_id, status")
        .eq("id", input.gameId)
        .eq("trip_id", ctx.tripId)
        .maybeSingle();
      if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });

      const [configRes, slateRes] = await Promise.all([
        ctx.supabase
          .from("pickem_games")
          .select("picks_opened_at, picks_deadline, picks_locked_at, roll_up, use_confidence")
          .eq("game_id", input.gameId)
          .maybeSingle(),
        ctx.supabase
          .from("pickem_slate_games")
          .select("id, display_order, away_team, home_team, spread, kickoff, note, multiplier")
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
          // `numeric` arrives as a string over PostgREST; the whole app treats a
          // multiplier as a number, so it is coerced ONCE, here, rather than at
          // every call site that would otherwise get `"2"` and concatenate.
          multiplier: Number(r.multiplier ?? 1),
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

  // ── open / lock / reopen ────────────────────────────────────────────────
  setPhase: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        gameId: z.string(),
        action: z.enum(["open", "lock", "reopen"]),
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
