"use client";

import { useState } from "react";
import { DollarSign, Plus, Receipt, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { trpc } from "@/lib/trpc-client";

export interface ExpenseMember {
  user_id: string;
  user?: { id: string; name?: string | null; email?: string | null } | null;
}

export function ExpensesSection({
  tripId,
  members,
  canEdit,
}: {
  tripId: string;
  members: ExpenseMember[];
  canEdit: boolean;
}) {
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [paidByUserId, setPaidByUserId] = useState(members[0]?.user_id ?? "");
  const [splitAmong, setSplitAmong] = useState<string[]>(
    members.map((m) => m.user_id)
  );

  const { data: expenses = [] } = trpc.expenses.list.useQuery({ tripId });

  const createExpense = trpc.expenses.create.useMutation({
    async onMutate(vars) {
      await utils.expenses.list.cancel({ tripId });
      const prev = utils.expenses.list.getData({ tripId });
      utils.expenses.list.setData({ tripId }, [
        {
          id: vars.id,
          trip_id: tripId,
          title: vars.title,
          amount: vars.amount,
          paid_by_user_id: vars.paidByUserId,
          created_at: new Date().toISOString(),
          splits: vars.splitAmong.map((userId) => ({
            expense_id: vars.id,
            user_id: userId,
            amount: null,
          })),
        },
        ...(prev ?? []),
      ]);
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.expenses.list.setData({ tripId }, context.prev);
    },
    onSuccess() {
      setShowAdd(false);
      setNewTitle("");
      setNewAmount("");
      setSplitAmong(members.map((m) => m.user_id));
    },
    onSettled() {
      utils.expenses.list.invalidate({ tripId });
    },
  });

  const removeExpense = trpc.expenses.remove.useMutation({
    onSuccess: () => utils.expenses.list.invalidate({ tripId }),
  });

  const memberName = (userId: string | null | undefined) => {
    if (!userId) return "Unknown";
    const m = members.find((x) => x.user_id === userId);
    return m?.user?.name ?? m?.user?.email ?? userId.slice(0, 6);
  };

  function toggleSplit(userId: string) {
    setSplitAmong((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  }

  // Tally: who owes / is owed
  const balances = new Map<string, number>();
  for (const expense of expenses) {
    const evenShare =
      expense.splits.length > 0 ? expense.amount / expense.splits.length : 0;
    balances.set(
      expense.paid_by_user_id,
      (balances.get(expense.paid_by_user_id) ?? 0) + expense.amount
    );
    for (const s of expense.splits) {
      const share = s.amount ?? evenShare;
      balances.set(s.user_id, (balances.get(s.user_id) ?? 0) - share);
    }
  }

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-3">
      {expenses.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-10 w-10" />}
          headline="No expenses yet"
          action={canEdit && !showAdd ? (
            <button
              data-testid="show-add-expense-btn"
              onClick={() => setShowAdd(true)}
              className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
              style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
            >
              <Plus size={16} />
              Add Expense
            </button>
          ) : undefined}
        />
      ) : (
        <>
          <div className="space-y-2">
            {expenses.map((expense) => (
              <div
                key={expense.id}
                data-testid={`expense-row-${expense.id}`}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
              >
                <DollarSign size={14} style={{ color: "var(--color-bt-accent)" }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                    {expense.title}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                    Paid by {memberName(expense.paid_by_user_id)} · split {expense.splits.length} ways
                  </p>
                </div>
                <span className="flex-shrink-0 text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                  ${expense.amount.toFixed(2)}
                </span>
                {canEdit && (
                  <button
                    data-testid={`remove-expense-${expense.id}`}
                    onClick={() => removeExpense.mutate({ tripId, expenseId: expense.id })}
                    disabled={removeExpense.isPending}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full disabled:opacity-40"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div
            className="rounded-xl p-3"
            style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
          >
            <div className="mb-2 flex justify-between text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
              <span>Total</span>
              <span style={{ color: "var(--color-bt-text)" }}>${total.toFixed(2)}</span>
            </div>
            {members.map((m) => {
              const bal = balances.get(m.user_id) ?? 0;
              if (Math.abs(bal) < 0.01) return null;
              return (
                <div key={m.user_id} className="flex justify-between text-xs">
                  <span style={{ color: "var(--color-bt-text-dim)" }}>{memberName(m.user_id)}</span>
                  <span style={{ color: bal > 0 ? "var(--color-bt-accent)" : "var(--color-bt-danger)" }}>
                    {bal > 0 ? `+$${bal.toFixed(2)}` : `-$${Math.abs(bal).toFixed(2)}`}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {canEdit && (
        showAdd ? (
          <div
            className="space-y-3 rounded-xl p-4"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>Add Expense</p>
            <input
              data-testid="expense-title-input"
              placeholder="Description (e.g. Dinner)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
            />
            <input
              data-testid="expense-amount-input"
              type="number"
              min={0}
              step={0.01}
              placeholder="Amount ($)"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
            />
            <div>
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Paid by</label>
              <select
                data-testid="expense-paidby-select"
                value={paidByUserId}
                onChange={(e) => setPaidByUserId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              >
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{memberName(m.user_id)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Split among</label>
              <div className="space-y-1">
                {members.map((m) => {
                  const checked = splitAmong.includes(m.user_id);
                  return (
                    <label
                      key={m.user_id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5"
                      style={{
                        background: checked ? "var(--color-bt-accent-faint)" : "var(--color-bt-base)",
                        border: `1px solid ${checked ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                      }}
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleSplit(m.user_id)} className="accent-bt-accent" />
                      <span className="text-sm" style={{ color: "var(--color-bt-text)" }}>{memberName(m.user_id)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAdd(false); setNewTitle(""); setNewAmount(""); setPaidByUserId(members[0]?.user_id ?? ""); setSplitAmong(members.map((m) => m.user_id)); }}
                className="flex-1 rounded-lg border py-2 text-sm"
                style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
              >
                Cancel
              </button>
              <button
                data-testid="save-expense-btn"
                disabled={!newTitle.trim() || !newAmount || Number(newAmount) <= 0 || !paidByUserId || splitAmong.length === 0 || createExpense.isPending}
                onClick={() => {
                  createExpense.mutate({ tripId, id: crypto.randomUUID(), title: newTitle.trim(), amount: Number(newAmount), paidByUserId, splitAmong });
                }}
                className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                Add Expense
              </button>
            </div>
          </div>
        ) : expenses.length > 0 ? (
          <button
            data-testid="show-add-expense-btn"
            onClick={() => setShowAdd(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
          >
            <Plus size={16} />
            Add Expense
          </button>
        ) : (
          null
        )
      )}
    </div>
  );
}
