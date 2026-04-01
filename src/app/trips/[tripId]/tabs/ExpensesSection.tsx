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
import { EmptyState } from "@/components/EmptyState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { trpc } from "@/lib/trpc-client";
import { SplitPanel, computeSplitDisplay } from "./SplitPanel";
import { EditExpenseModal } from "./EditExpenseModal";

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
  created_at: string | null;
  splits: ExpenseSplit[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function memberName(members: ExpenseMember[], userId: string | null | undefined) {
  if (!userId) return "Unknown";
  const m = members.find((x) => x.user_id === userId);
  return m?.user?.name ?? m?.user?.email ?? userId.slice(0, 6);
}

function computeUserShare(expense: ExpenseItem, userId: string): number | null {
  const split = expense.splits.find((s) => s.user_id === userId);
  if (!split || split.opted_out) return null;
  if (split.amount !== null) return split.amount;
  // Even split: (total - overridden) / nullSplitCount
  const activeSplits = expense.splits.filter((s) => !s.opted_out);
  const overridedTotal = activeSplits
    .filter((s) => s.amount !== null)
    .reduce((sum, s) => sum + (s.amount as number), 0);
  const nullCount = activeSplits.filter((s) => s.amount === null).length;
  return nullCount > 0 ? (expense.amount - overridedTotal) / nullCount : 0;
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
  const utils = trpc.useUtils();

  // ── Form state ──
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const defaultPaidBy =
    members.find((m) => m.user_id === currentUser?.id)?.user_id ??
    members[0]?.user_id ??
    "";
  const [paidByUserId, setPaidByUserId] = useState(defaultPaidBy);
  const [splitMode, setSplitMode] = useState<"even" | "custom">("even");
  const [splitAmong, setSplitAmong] = useState<string[]>(
    members.map((m) => m.user_id)
  );
  const [newOverrides, setNewOverrides] = useState<Record<string, string>>({});

  // ── Edit modal state ──
  const [editingExpense, setEditingExpense] = useState<ExpenseItem | null>(null);

  // ── Queries ──
  const { data: expenses = [] } = trpc.expenses.list.useQuery({ tripId });

  // ── Mutations ──
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
          splits: vars.splitAmong.map((s) => ({
            expense_id: vars.id,
            user_id: s.userId,
            amount: s.amount ?? null,
            opted_out: false,
          })),
        },
        ...(prev ?? []),
      ]);
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined)
        utils.expenses.list.setData({ tripId }, context.prev);
    },
    onSuccess() {
      resetForm();
    },
    onSettled() {
      utils.expenses.list.invalidate({ tripId });
    },
  });

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

  // ── Form helpers ──
  function resetForm() {
    setShowAdd(false);
    setNewTitle("");
    setNewAmount("");
    setPaidByUserId(defaultPaidBy);
    setSplitMode("even");
    setSplitAmong(members.map((m) => m.user_id));
    setNewOverrides({});
  }

  function toggleSplit(userId: string) {
    if (splitAmong.includes(userId)) {
      setSplitAmong((prev) => prev.filter((id) => id !== userId));
      setNewOverrides((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    } else {
      setSplitAmong((prev) => [...prev, userId]);
    }
  }

  function resetNewOverride(uid: string) {
    setNewOverrides((prev) => {
      const next = { ...prev };
      delete next[uid];
      return next;
    });
  }

  function switchToEven() {
    setSplitMode("even");
    setSplitAmong(members.map((m) => m.user_id));
    setNewOverrides({});
  }

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

  // ── Even split per-person amount ──
  const totalAmountNum = Number(newAmount) || 0;
  const evenPerPerson =
    totalAmountNum > 0 && members.length > 0
      ? totalAmountNum / members.length
      : 0;

  return (
    <div className="space-y-3">
      {/* ── Expense list ──────────────────────────────────────────────── */}
      {expenses.length === 0 ? (
        <EmptyState
          icon={<Receipt className="h-10 w-10" />}
          headline="No expenses yet"
          action={
            canEdit && !showAdd ? (
              <button
                data-testid="show-add-expense-btn"
                onClick={() => setShowAdd(true)}
                className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
                style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
              >
                <Plus size={16} />
                Add Expense
              </button>
            ) : undefined
          }
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
                    </div>
                    {/* Your share or opted out */}
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
                  {/* Opt out / rejoin button (any member, own split only) */}
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
                  {/* Owner edit button */}
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
                  {/* Delete button */}
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

          {/* Total + balances */}
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
                  <span style={{ color: "var(--color-bt-text-dim)" }}>{memberName(members, m.user_id)}</span>
                  <span style={{ color: bal > 0 ? "var(--color-bt-accent)" : "var(--color-bt-danger)" }}>
                    {bal > 0 ? `+$${bal.toFixed(2)}` : `-$${Math.abs(bal).toFixed(2)}`}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Add expense button */}
          {canEdit && !showAdd && (
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
        </>
      )}

      {/* ── Add expense form ──────────────────────────────────────────── */}
      {canEdit && showAdd && (
        <div
          className="space-y-3 rounded-xl p-4"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
            Add Expense
          </p>

          {/* Side-by-side Description + Amount */}
          <div className="flex gap-3">
            <input
              data-testid="expense-title-input"
              placeholder="Description (e.g. Dinner)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
            />
            <input
              data-testid="expense-amount-input"
              type="number"
              min={0}
              step={0.01}
              placeholder="$ 0.00"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              className="w-28 flex-shrink-0 rounded-lg border px-3 py-2 text-right text-sm outline-none"
              style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
            />
          </div>

          {/* Paid by */}
          <div>
            <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Paid by
            </label>
            <div className="relative">
              <select
                data-testid="expense-paidby-select"
                value={paidByUserId}
                onChange={(e) => setPaidByUserId(e.target.value)}
                className="w-full appearance-none rounded-lg border py-2 pl-3 pr-8 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              >
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {memberName(members, m.user_id)}
                  </option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-bt-text-dim)" }} />
              </svg>
            </div>
          </div>

          {/* Even / Custom toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={switchToEven}
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{
                background: splitMode === "even" ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
                borderColor: splitMode === "even" ? "var(--color-bt-accent)" : "var(--color-bt-border)",
                color: splitMode === "even" ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
              }}
            >
              Even split{evenPerPerson > 0 ? ` · $${evenPerPerson.toFixed(2)}` : ""}
            </button>
            <button
              type="button"
              onClick={() => setSplitMode("custom")}
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{
                background: splitMode === "custom" ? "var(--color-bt-tag-bg)" : "var(--color-bt-card)",
                borderColor: splitMode === "custom" ? "var(--color-bt-accent)" : "var(--color-bt-border)",
                color: splitMode === "custom" ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
              }}
            >
              Custom split
            </button>
          </div>

          {/* Custom split panel */}
          {splitMode === "custom" && (
            <SplitPanel
              members={members}
              totalAmount={totalAmountNum}
              includedIds={splitAmong}
              overrides={newOverrides}
              onToggle={toggleSplit}
              onOverrideChange={(uid, val) =>
                setNewOverrides((prev) => ({ ...prev, [uid]: val }))
              }
              onResetOverride={resetNewOverride}
            />
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={resetForm}
              className="flex-1 rounded-lg border py-2 text-sm"
              style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
            >
              Cancel
            </button>
            <button
              data-testid="save-expense-btn"
              disabled={
                !newTitle.trim() ||
                !newAmount ||
                Number(newAmount) <= 0 ||
                !paidByUserId ||
                (splitMode === "custom" && splitAmong.length === 0) ||
                createExpense.isPending
              }
              onClick={() => {
                const splitData =
                  splitMode === "even"
                    ? members.map((m) => ({ userId: m.user_id, amount: null as number | null }))
                    : splitAmong.map((uid) => ({
                        userId: uid,
                        amount:
                          newOverrides[uid] && newOverrides[uid] !== ""
                            ? Number(newOverrides[uid])
                            : null,
                      }));
                createExpense.mutate({
                  tripId,
                  id: crypto.randomUUID(),
                  title: newTitle.trim(),
                  amount: Number(newAmount),
                  paidByUserId,
                  splitAmong: splitData,
                });
              }}
              className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Add Expense
            </button>
          </div>
        </div>
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
