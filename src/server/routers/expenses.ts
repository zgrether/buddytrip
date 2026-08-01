import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { assertNoError } from "@/server/lib/assertAffected";
import { router, authedProcedure } from "../trpc";
import { requireTripMember } from "../middleware";

export const expensesRouter = router({
  // -----------------------------------------------------------------------
  // list — any member can view expenses
  // -----------------------------------------------------------------------
  list: authedProcedure
    .input(z.object({ tripId: z.string() }))
    .use(requireTripMember)
    .query(async ({ ctx }) => {
      const { data: expenses, error } = await ctx.supabase
        .from("expenses")
        .select("*")
        .eq("trip_id", ctx.tripId)
        .order("created_at", { ascending: false });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch expenses",
        });
      }

      // Fetch splits for all expenses
      const expenseIds = (expenses ?? []).map((e) => e.id);
      let splits: { expense_id: string; user_id: string; amount: number | null; opted_out: boolean }[] = [];
      if (expenseIds.length > 0) {
        const { data: s } = await ctx.supabase
          .from("expense_splits")
          .select("expense_id, user_id, amount, opted_out")
          .in("expense_id", expenseIds);
        splits = s ?? [];
      }

      const splitsByExpense = new Map<string, typeof splits>();
      for (const s of splits) {
        const arr = splitsByExpense.get(s.expense_id) ?? [];
        arr.push(s);
        splitsByExpense.set(s.expense_id, arr);
      }

      return (expenses ?? []).map((e) => ({
        ...e,
        splits: splitsByExpense.get(e.id) ?? [],
      }));
    }),

  // -----------------------------------------------------------------------
  // create — Owner or Organizer (canEdit)
  // -----------------------------------------------------------------------
  create: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        id: z.string().min(1),
        title: z.string().min(1).max(200),
        amount: z.number().min(0),
        paidByUserId: z.string(),
        date: z.string().nullable().optional(),
        splitAmong: z.array(
          z.object({
            userId: z.string(),
            amount: z.number().min(0).nullable().optional(),
          })
        ).min(1),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const { data: expense, error } = await ctx.supabase
        .from("expenses")
        .insert({
          id: input.id,
          trip_id: ctx.tripId,
          title: input.title,
          amount: input.amount,
          paid_by_user_id: input.paidByUserId,
          ...(input.date !== undefined ? { date: input.date } : {}),
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create expense: ${error.message}`,
        });
      }

      // Insert splits — amount null means even split computed at read time
      const splitRows = input.splitAmong.map((s) => ({
        expense_id: input.id,
        user_id: s.userId,
        amount: s.amount ?? null,
      }));

      const { error: splitErr } = await ctx.supabase
        .from("expense_splits")
        .insert(splitRows);

      if (splitErr) {
        // Clean up expense.
        //
        // #779 — logged, not thrown: this runs inside an existing failure path,
        // so throwing here would replace splitErr's message with a worse one.
        // A failed cleanup leaves an expense with NO splits — visible in the
        // trip total but owed by nobody, which is the "real disagreement about
        // who owes what" the audit named (§4.4).
        const { error: cleanupErr } = await ctx.supabase
          .from("expenses")
          .delete()
          .eq("id", input.id);
        if (cleanupErr) {
          console.error(
            `[expenses.create] cleanup of split-less expense ${input.id} failed: ${cleanupErr.message}`
          );
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create expense splits",
        });
      }

      return expense;
    }),

  // -----------------------------------------------------------------------
  // updateSplits — Owner (any receipt), OR a Member editing a receipt THEY
  // paid for (paid_by_user_id === self) — same "own receipt" exception as
  // `remove`, so a mistyped self-logged receipt can be fixed, not just deleted.
  // Also supports updating the expense title and amount.
  // -----------------------------------------------------------------------
  updateSplits: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        expenseId: z.string(),
        title: z.string().min(1).max(200).optional(),
        amount: z.number().min(0).optional(),
        date: z.string().nullable().optional(),
        paidByUserId: z.string().optional(),
        splits: z.array(
          z.object({
            userId: z.string(),
            amount: z.number().min(0).nullable(),
            optedOut: z.boolean().optional(),
          })
        ),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      if (ctx.tripRole !== "Owner") {
        const { data: existing } = await ctx.supabase
          .from("expenses")
          .select("paid_by_user_id")
          .eq("id", input.expenseId)
          .eq("trip_id", ctx.tripId)
          .maybeSingle();
        if (!existing || existing.paid_by_user_id !== ctx.user!.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only edit a receipt you paid for",
          });
        }
      }

      // Update expense fields if provided
      if (input.title !== undefined || input.amount !== undefined || input.date !== undefined || input.paidByUserId !== undefined) {
        const updates: Record<string, unknown> = {};
        if (input.title !== undefined) updates.title = input.title;
        if (input.amount !== undefined) updates.amount = input.amount;
        if (input.date !== undefined) updates.date = input.date;
        if (input.paidByUserId !== undefined) updates.paid_by_user_id = input.paidByUserId;
        const { error: expErr } = await ctx.supabase
          .from("expenses")
          .update(updates)
          .eq("id", input.expenseId)
          .eq("trip_id", ctx.tripId);
        if (expErr) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to update expense: ${expErr.message}`,
          });
        }
      }

      // Delete existing splits.
      //
      // #779 — error-checked; count NOT asserted (an expense with no splits yet
      // legitimately clears zero). This is the first half of a delete-then-insert
      // rewrite: a silent failure here meant the OLD splits survived and the new
      // ones were inserted on top, doubling the amounts owed.
      //
      // NOT transactional, and this commit does not make it so: if the insert
      // below fails after this delete succeeds, the expense is left with no
      // splits at all. Pre-existing; making the failure loud is what changed.
      assertNoError(
        await ctx.supabase
          .from("expense_splits")
          .delete()
          .eq("expense_id", input.expenseId),
        "clear the expense's previous splits"
      );

      // Insert new splits
      const splitRows = input.splits.map((s) => ({
        expense_id: input.expenseId,
        user_id: s.userId,
        amount: s.amount,
        opted_out: s.optedOut ?? false,
      }));

      const { error } = await ctx.supabase
        .from("expense_splits")
        .insert(splitRows);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update splits",
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // optOut — any trip member can opt out of / rejoin their own split
  // -----------------------------------------------------------------------
  optOut: authedProcedure
    .input(
      z.object({
        tripId: z.string(),
        expenseId: z.string(),
        optOut: z.boolean(),
      })
    )
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user!.id;

      // Verify caller has a split row for this expense
      const { data: existing } = await ctx.supabase
        .from("expense_splits")
        .select("expense_id, user_id")
        .eq("expense_id", input.expenseId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "You are not included in this expense",
        });
      }

      // #779 — count asserted. The caller's own split row was read back
      // immediately above (the NOT_FOUND guard), so zero rows here is not a
      // race — it means the write didn't land, and opting out of a shared cost
      // that silently didn't apply is exactly the money disagreement this issue
      // is about.
      const { error, count } = await ctx.supabase
        .from("expense_splits")
        .update(
          {
            opted_out: input.optOut,
            amount: input.optOut ? 0 : null,
          },
          { count: "exact" }
        )
        .eq("expense_id", input.expenseId)
        .eq("user_id", userId);

      if (!error && count !== 1) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to record your opt-out: expected 1 row, affected ${count ?? "unknown"}.`,
        });
      }

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update opt-out status",
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // remove — Owner or Organizer (canEdit), OR a Member removing a receipt
  // THEY paid for (paid_by_user_id === self) — so a mistyped self-logged
  // receipt isn't stuck forever waiting on an Owner/Organizer.
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(z.object({ tripId: z.string(), expenseId: z.string() }))
    .use(requireTripMember)
    .mutation(async ({ ctx, input }) => {
      const isStaff = ctx.tripRole === "Owner" || ctx.tripRole === "Organizer";
      if (!isStaff) {
        const { data: existing } = await ctx.supabase
          .from("expenses")
          .select("paid_by_user_id")
          .eq("id", input.expenseId)
          .eq("trip_id", ctx.tripId)
          .maybeSingle();
        if (!existing || existing.paid_by_user_id !== ctx.user!.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only remove a receipt you paid for",
          });
        }
      }

      // Delete splits first.
      //
      // #779 — error-checked; count NOT asserted (an expense may legitimately
      // have none). A silent failure orphans split rows whose parent expense is
      // then deleted below — invisible in every UI, and they resurface in any
      // query that reads splits directly.
      assertNoError(
        await ctx.supabase
          .from("expense_splits")
          .delete()
          .eq("expense_id", input.expenseId),
        "clear the expense's splits"
      );

      const { error } = await ctx.supabase
        .from("expenses")
        .delete()
        .eq("id", input.expenseId)
        .eq("trip_id", ctx.tripId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove expense",
        });
      }

      return { success: true };
    }),
});
