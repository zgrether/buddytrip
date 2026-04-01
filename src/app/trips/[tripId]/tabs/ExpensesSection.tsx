"use client";

import { useState } from "react";
import {
  DollarSign,
  Pencil,
  Plus,
  Receipt,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useTheme } from "next-themes";
import { EmptyState } from "@/components/EmptyState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { trpc } from "@/lib/trpc-client";
import { SplitPanel } from "./SplitPanel";
import { EditExpenseModal } from "./EditExpenseModal";
import { AddExpenseModal } from "./AddExpenseModal";

// ── Types ────────────────────────────────────────────────────────────────

export interface ExpenseMember {
  user_id: string;
  user?: { id: string; name?: string | null; email?: string | null } | null;
}

export interface ExpenseSplit {
  expense_id: string;
  user_id: string;
  amount: number | null;
  opted_out: boolean;
}

export interface ExpenseItem {
  id: string;
  trip_id: string;
  title: string;
  amount: number;
  paid_by_user_id: string;
  date: string | null;
  created_at: string | null;
  splits: ExpenseSplit[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

export function memberName(members: ExpenseMember[], userId: string | null | undefined) {
  if (!userId) return "Unknown";
  const m = members.find((x) => x.user_id === userId);
  return m?.user?.name ?? m?.user?.email ?? userId.slice(0, 6);
}

function computeUserShare(expense: ExpenseItem, userId: string): number | null {
  const split = expense.splits.find((s) => s.user_id === userId);
  if (!split || split.opted_out) return null;
  if (split.amount !== null) return split.amount;
  const activeSplits = expense.splits.filter((s) => !s.opted_out);
  const overridedTotal = activeSplits
    .filter((s) => s.amount !== null)
    .reduce((sum, s) => sum + (s.amount as number), 0);
  const nullCount = activeSplits.filter((s) => s.amount === null).length;
  return nullCount > 0 ? (expense.amount - overridedTotal) / nullCount : 0;
}

// ── CurrencyInput ────────────────────────────────────────────────────────

export function CurrencyInput({
  value,
  onChange,
  placeholder = "0.00",
  className = "",
  "data-testid": testId,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}) {
  return (
    <div
      className={`relative flex items-center rounded-lg border ${className}`}
      style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)" }}
    >
      <span
        className="pointer-events-none pl-3 text-sm"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        $
      </span>
      <input
        data-testid={testId}
        type="number"
        min={0}
        step={0.01}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-2 pl-1 pr-3 text-right text-sm outline-none"
        style={{ color: "var(--color-bt-text)" }}
      />
    </div>
  );
}

// ── ExpensesSection ──────────────────────────────────────────────────────

export function ExpensesSection({
  tripId,
  members,
  canEdit,
  isOwner = false,
}: {
  tripId: string;
  members: ExpenseMember[];
  canEdit: boolean;
  isOwner?: boolean;
}) {
  const currentUser = useCurrentUser();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const utils = trpc.useUtils();

  // ── Modal state ──
  const [showAdd, setShowAdd] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseItem | null>(null);

  // ── Queries ──
  const { data: expenses = [] } = trpc.expenses.list.useQuery({ tripId });

  // ── Mutations ──
  const removeExpense = trpc.expenses.remove.useMutation({
    onSuccess: () => utils.expenses.list.invalidate({ tripId }),
  });

  const optOutMutation = trpc.expenses.optOut.useMutation({
    async onMutate(vars) {
      await utils.expenses.list.cancel({ tripId });
      const prev = utils.expenses.list.getData({ tripId });
      const oldData = utils.expenses.list.getData({ tripId }) ?? [];
      utils.expenses.list.setData(
        { tripId },
        oldData.map((exp) => ({
          ...exp,
          splits: exp.splits.map((s: { expense_id: string; user_id: string; amount: number | null; opted_out: boolean }) =>
            s.expense_id === vars.expenseId && s.user_id === currentUser?.id
              ? { ...s, opted_out: vars.optOut, amount: vars.optOut ? 0 : null }
              : s
          ),
        }))
      );
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined)
        utils.expenses.list.setData({ tripId }, context.prev);
    },
    onSettled() {
      utils.expenses.list.invalidate({ tripId });
    },
  });

  // ── Balance computation ──
  const balances = new Map<string, number>();
  for (const expense of expenses as ExpenseItem[]) {
    balances.set(
      expense.paid_by_user_id,
      (balances.get(expense.paid_by_user_id) ?? 0) + expense.amount
    );
    const activeSplits = expense.splits.filter((s) => !s.opted_out);
    const overridedTotal = activeSplits
      .filter((s) => s.amount !== null)
      .reduce((sum, s) => sum + (s.amount as number), 0);
    const nullSplits = activeSplits.filter((s) => s.amount === null);
    const evenShare =
      nullSplits.length > 0
        ? (expense.amount - overridedTotal) / nullSplits.length
        : 0;
    for (const s of activeSplits) {
      const share = s.amount ?? evenShare;
      balances.set(s.user_id, (balances.get(s.user_id) ?? 0) - share);
    }
  }

  const total = (expenses as ExpenseItem[]).reduce((sum, e) => sum + e.amount, 0);

  // Members with non-zero balances for the summary table
  const balanceRows = members.filter((m) => Math.abs(balances.get(m.user_id) ?? 0) >= 0.01);

  return (
    <div className="space-y-3">
      {/* ── Expense list ──────────────────────────────────────────────── */}
      {/* Add expense button — always at the top */}
      {canEdit && (
        <button
          data-testid="show-add-expense-btn"
          onClick={() => setShowAdd(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
          style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
        >
          <Plus size={16} />
          Add Expense
        </button>
      )}

      {expenses.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-10 w-10" />}
          headline="No expenses yet"
        />
      ) : (
        <>
          <div className="space-y-2">
            {(expenses as ExpenseItem[]).map((expense) => {
              const userSplit = currentUser
                ? expense.splits.find((s) => s.user_id === currentUser.id)
                : null;
              const isOptedOut = userSplit?.opted_out === true;
              const activeSplitCount = expense.splits.filter((s) => !s.opted_out).length;
              const userShare = currentUser
                ? computeUserShare(expense, currentUser.id)
                : null;

              return (
                <div
                  key={expense.id}
                  data-testid={`expense-row-${expense.id}`}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{
                    background: isOptedOut ? "var(--color-bt-base)" : "var(--color-bt-card)",
                    border: "1px solid var(--color-bt-border)",
                    opacity: isOptedOut ? 0.7 : 1,
                  }}
                >
                  <DollarSign size={14} style={{ color: "var(--color-bt-accent)" }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                      {expense.title}
                    </p>
                    <div className="flex flex-wrap gap-x-2 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                      <span>Paid by {memberName(members, expense.paid_by_user_id)}</span>
                      <span>split {activeSplitCount} ways</span>
                      {expense.date && (
                        <span>{new Date(expense.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      )}
                    </div>
                    {userSplit && (
                      <p className="mt-0.5 text-xs" style={{
                        color: isOptedOut ? "var(--color-bt-text-dim)" : "var(--color-bt-accent)",
                      }}>
                        {isOptedOut
                          ? "Opted out"
                          : userShare !== null
                            ? `Your share: $${userShare.toFixed(2)}`
                            : null}
                      </p>
                    )}
                  </div>
                  <span className="flex-shrink-0 text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                    ${expense.amount.toFixed(2)}
                  </span>
                  {userSplit && (
                    <button
                      onClick={() =>
                        optOutMutation.mutate({
                          tripId,
                          expenseId: expense.id,
                          optOut: !isOptedOut,
                        })
                      }
                      disabled={optOutMutation.isPending}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-70 disabled:opacity-40"
                      style={{ color: isOptedOut ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                      title={isOptedOut ? "Rejoin" : "Opt out"}
                    >
                      {isOptedOut ? <UserPlus size={13} /> : <UserMinus size={13} />}
                    </button>
                  )}
                  {isOwner && (
                    <button
                      data-testid={`edit-splits-${expense.id}`}
                      onClick={() => setEditingExpense(expense)}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-70"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {canEdit && (
                    <button
                      data-testid={`remove-expense-${expense.id}`}
                      onClick={() =>
                        removeExpense.mutate({ tripId, expenseId: expense.id })
                      }
                      disabled={removeExpense.isPending}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Totals — crew tab table style */}
          <div>
            <h2
              className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Totals
            </h2>
            {/* Total row */}
            <div
              className="flex justify-between border-b px-1 py-2 text-xs font-medium"
              style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
            >
              <span>Total</span>
              <span style={{ color: "var(--color-bt-text)" }}>${total.toFixed(2)}</span>
            </div>
            {/* Balance rows */}
            {balanceRows.map((m, i) => {
              const bal = balances.get(m.user_id) ?? 0;
              return (
                <div
                  key={m.user_id}
                  className="flex items-center justify-between border-b px-1 py-2.5"
                  style={{
                    borderColor: "var(--color-bt-border)",
                    background: i % 2 === 1 ? (isDark ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.025)") : undefined,
                  }}
                >
                  <span className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>{memberName(members, m.user_id)}</span>
                  <span className="text-sm font-medium" style={{ color: bal > 0 ? "var(--color-bt-accent)" : "var(--color-bt-danger)" }}>
                    {bal > 0 ? `+$${bal.toFixed(2)}` : `-$${Math.abs(bal).toFixed(2)}`}
                  </span>
                </div>
              );
            })}
          </div>

        </>
      )}

      {/* ── Add Expense Modal ─────────────────────────────────────────── */}
      {showAdd && (
        <AddExpenseModal
          tripId={tripId}
          members={members}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* ── Edit Expense Modal ────────────────────────────────────────── */}
      {editingExpense && (
        <EditExpenseModal
          expense={editingExpense}
          members={members}
          tripId={tripId}
          onClose={() => setEditingExpense(null)}
        />
      )}
    </div>
  );
}
