import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";

// ── feedback router ───────────────────────────────────────────────────────
//
// Beta feedback channel. One procedure, `send`, that routes a report from
// the in-app feedback form to the founder inbox via Resend. No DB
// persistence in v1 — the inbox IS the queue. The send is gated behind
// FEEDBACK_TO_EMAIL being configured; if it isn't, the call returns ok
// with `delivered: false` so a missing env in preview/dev doesn't surface
// as an error to the user.

export const feedbackRouter = router({
  send: authedProcedure
    .input(
      z.object({
        category: z.enum(["bug", "idea", "confusing", "love"]),
        message: z.string().trim().min(1).max(4000),
        // Optional reply-to. The form pre-fills this from the signed-in
        // user's email but lets them clear it; an empty string here means
        // "they explicitly opted out of a reply path".
        replyTo: z.string().email().nullable().optional(),
        // Auto-captured context — all optional, all surfaced in the email
        // so the founder has enough to triage without bouncing back.
        screen: z.string().max(200).nullable().optional(),
        // Full relative URL including query string (e.g. /trips/abc?tab=crew).
        // Complements the friendly `screen` label with the exact location.
        url: z.string().max(500).nullable().optional(),
        tripLabel: z.string().max(200).nullable().optional(),
        platform: z.string().max(40).nullable().optional(),
        build: z.string().max(40).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // No destination configured (preview / local without secrets). We
      // intentionally don't 500 — the form still closes cleanly and the
      // user gets the success toast. Whoever runs the env logs this.
      if (!process.env.FEEDBACK_TO_EMAIL) {
        return { delivered: false as const };
      }

      // Best-effort: a Resend failure shouldn't surface as a tRPC error
      // because there's no useful retry path from the client. Log and
      // return delivered:false so the modal still closes.
      try {
        const { data: profile } = await ctx.supabase
          .from("users")
          .select("name, email")
          .eq("id", ctx.user.id)
          .single();

        const { sendFeedback } = await import("@/lib/email");
        await sendFeedback({
          category: input.category,
          message: input.message,
          replyTo: input.replyTo ?? null,
          screen: input.screen ?? null,
          url: input.url ?? null,
          tripLabel: input.tripLabel ?? null,
          platform: input.platform ?? null,
          build: input.build ?? null,
          reporterName: profile?.name ?? null,
          reporterEmail: profile?.email ?? null,
        });
        return { delivered: true as const };
      } catch (err) {
        console.error("[feedback.send] failed", err);
        // Surface as a soft failure so the client can show a different
        // toast if it cares — most callers can just treat this as ok.
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to deliver feedback",
        });
      }
    }),
});
