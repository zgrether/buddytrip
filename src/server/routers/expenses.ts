import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { requireTripMember, requireTripRole } from "../middleware";

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
  // create — Owner or Planner (canEdit)
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
        // Clean up expense
        await ctx.supabase.from("expenses").delete().eq("id", input.id);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create expense splits",
        });
      }

      return expense;
    }),

  // -----------------------------------------------------------------------
  // updateSplits — Owner only (isOwner)
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
    .use(requireTripRole("Owner"))
    .mutation(async ({ ctx, input }) => {
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

      // Delete existing splits
      await ctx.supabase
        .from("expense_splits")
        .delete()
        .eq("expense_id", input.expenseId);

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

      const { error } = await ctx.supabase
        .from("expense_splits")
        .update({
          opted_out: input.optOut,
          amount: input.optOut ? 0 : null,
        })
        .eq("expense_id", input.expenseId)
        .eq("user_id", userId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update opt-out status",
        });
      }

      return { success: true };
    }),

  // -----------------------------------------------------------------------
  // remove — Owner or Planner (canEdit)
  // -----------------------------------------------------------------------
  remove: authedProcedure
    .input(z.object({ tripId: z.string(), expenseId: z.string() }))
    .use(requireTripRole("Planner"))
    .mutation(async ({ ctx, input }) => {
      // Delete splits first
      await ctx.supabase
        .from("expense_splits")
        .delete()
        .eq("expense_id", input.expenseId);

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
