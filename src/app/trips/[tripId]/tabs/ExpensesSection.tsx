"use client";

import { useState } from "react";
import { DollarSign, Plus, Receipt, Trash2, X, Pencil } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { trpc } from "@/lib/trpc-client";

// ── Types ────────────────────────────────────────────────────────────────

export interface ExpenseMember {
  user_id: string;
  user?: { id: string; name?: string | null; email?: string | null } | null;
}

interface ExpenseSplit {
  expense_id: string;
  user_id: string;
  amount: number | null;
}

interface ExpenseItem {
  id: string;
  trip_id: string;
  title: string;
  amount: number;
  paid_by_user_id: string;
  created_at: string | null;
  splits: ExpenseSplit[];
}

// ── Split computation ─────────────────────────────────────────────────────

function computeSplitDisplay(
  totalAmount: number,
  includedIds: string[],
  overrides: Record<string, string>
): {
  perPerson: Record<string, number>;
  evenShare: number;
  allOverridden: boolean;
  remaining: number;
} {
  if (includedIds.length === 0) {
    return { perPerson: {}, evenShare: 0, allOverridden: false, remaining: 0 };
  }

  const overriddenTotal = includedIds
    .filter((uid) => (overrides[uid] ?? "") !== "")
    .reduce((sum, uid) => sum + (Number(overrides[uid]) || 0), 0);

  const nonOverriddenIds = includedIds.filter((uid) => (overrides[uid] ?? "") === "");
  const allOverridden = nonOverriddenIds.length === 0;
  const evenShare = !allOverridden
    ? (totalAmount - overriddenTotal) / nonOverriddenIds.length
    : 0;

  const perPerson: Record<string, number> = {};
  for (const uid of includedIds) {
    const ov = overrides[uid];
    perPerson[uid] = ov && ov !== "" ? Number(ov) || 0 : evenShare;
  }

  return {
    perPerson,
    evenShare,
    allOverridden,
    remaining: allOverridden ? totalAmount - overriddenTotal : 0,
  };
}

// ── EditSplitsPanel ───────────────────────────────────────────────────────

function EditSplitsPanel({
  expense,
  members,
  tripId,
  onClose,
}: {
  expense: ExpenseItem;
  members: ExpenseMember[];
  tripId: string;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();

  // Pre-populate overrides from existing split amounts
  const [editOverrides, setEditOverrides] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of expense.splits) {
      if (s.amount !== null && s.amount !== undefined) {
        init[s.user_id] = String(s.amount);
      }
    }
    return init;
  });

  const updateSplits = trpc.expenses.updateSplits.useMutation({
    onSuccess: () => {
      utils.expenses.list.invalidate({ tripId });
      onClose();
    },
  });

  const includedIds = expense.splits.map((s) => s.user_id);
  const { perPerson, allOverridden, remaining } = computeSplitDisplay(
    expense.amount,
    includedIds,
    editOverrides
  );

  const memberName = (uid: string) => {
    const m = members.find((x) => x.user_id === uid);
    return m?.user?.name ?? m?.user?.email ?? uid.slice(0, 6);
  };

  function handleSave() {
    const splits = includedIds.map((uid) => ({
      userId: uid,
      amount:
        editOverrides[uid] && editOverrides[uid] !== ""
          ? Number(editOverrides[uid])
          : null,
    }));
    updateSplits.mutate({ tripId, expenseId: expense.id, splits });
  }

  function resetOverride(uid: string) {
    setEditOverrides((prev) => {
      const next = { ...prev };
      delete next[uid];
      return next;
    });
  }

  return (
    <div
      className="mt-1 space-y-2 rounded-xl p-3"
      style={{ background: "var(--color-bt-base)", border: "1px solid var(--color-bt-border)" }}
    >
      <p className="text-xs font-medium" style={{ color: "var(--color-bt-text-dim)" }}>
        Edit splits
      </p>

      {/* Column headers */}
      <div className="flex items-center gap-2 px-3 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
        <div className="min-w-0 flex-1" />
        <div className="w-14 flex-shrink-0 text-right">Share</div>
        <div className="w-16 flex-shrink-0 text-right">Override</div>
        <div className="w-6 flex-shrink-0" />
      </div>

      <div className="space-y-1">
        {includedIds.map((uid) => {
          const hasOverride = (editOverrides[uid] ?? "") !== "";
          const displayAmt = perPerson[uid] ?? 0;
          const isNeg = displayAmt < 0;
          return (
            <div
              key={uid}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5"
              style={{
                background: "var(--color-bt-accent-faint)",
                border: "1px solid var(--color-bt-accent-border)",
              }}
            >
              <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--color-bt-text)" }}>
                {memberName(uid)}
              </span>
              <span
                className="w-14 flex-shrink-0 text-right text-xs tabular-nums"
                style={{ color: isNeg ? "var(--color-bt-danger)" : "var(--color-bt-text-dim)" }}
              >
                ${displayAmt.toFixed(2)}
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                placeholder="—"
                value={editOverrides[uid] ?? ""}
                onChange={(e) =>
                  setEditOverrides((prev) => ({ ...prev, [uid]: e.target.value }))
                }
                className="w-16 flex-shrink-0 rounded-md border px-2 py-1 text-right text-xs outline-none tabular-nums"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: hasOverride
                    ? "var(--color-bt-accent-border)"
                    : "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
                {hasOverride && (
                  <button
                    type="button"
                    onClick={() => resetOverride(uid)}
                    className="flex h-6 w-6 items-center justify-center transition-opacity hover:opacity-70"
                    style={{ color: "var(--color-bt-text-dim)" }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Remaining / over-by for all-overridden case */}
      {allOverridden && Math.abs(remaining) >= 0.01 && (
        <p
          className="text-right text-xs"
          style={{ color: remaining > 0 ? "var(--color-bt-warning)" : "var(--color-bt-danger)" }}
        >
          {remaining > 0
            ? `Remaining: $${remaining.toFixed(2)} unassigned`
            : `Over by: $${Math.abs(remaining).toFixed(2)}`}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onClose}
          className="flex-1 rounded-lg border py-2 text-sm"
          style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
        >
          Cancel
        </button>
        <button
          disabled={updateSplits.isPending}
          onClick={handleSave}
          className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
        >
          {updateSplits.isPending ? "Saving…" : "Save splits"}
        </button>
      </div>
    </div>
  );
}

// ── ExpensesSection ───────────────────────────────────────────────────────

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
  const utils = trpc.useUtils();
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [paidByUserId, setPaidByUserId] = useState(members[0]?.user_id ?? "");
  const [splitAmong, setSplitAmong] = useState<string[]>(
    members.map((m) => m.user_id)
  );
  const [newOverrides, setNewOverrides] = useState<Record<string, string>>({});
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

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
          splits: vars.splitAmong.map((s) => ({
            expense_id: vars.id,
            user_id: s.userId,
            amount: s.amount ?? null,
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

  function resetForm() {
    setShowAdd(false);
    setNewTitle("");
    setNewAmount("");
    setPaidByUserId(members[0]?.user_id ?? "");
    setSplitAmong(members.map((m) => m.user_id));
    setNewOverrides({});
  }

  const memberName = (userId: string | null | undefined) => {
    if (!userId) return "Unknown";
    const m = members.find((x) => x.user_id === userId);
    return m?.user?.name ?? m?.user?.email ?? userId.slice(0, 6);
  };

  function toggleSplit(userId: string) {
    if (splitAmong.includes(userId)) {
      // Uncheck: remove from split and clear any override
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

  // Balance computation — correctly handles mixed null/amount splits
  const balances = new Map<string, number>();
  for (const expense of expenses as ExpenseItem[]) {
    balances.set(
      expense.paid_by_user_id,
      (balances.get(expense.paid_by_user_id) ?? 0) + expense.amount
    );
    const overridedTotal = expense.splits
      .filter((s) => s.amount !== null)
      .reduce((sum, s) => sum + (s.amount as number), 0);
    const nullSplits = expense.splits.filter((s) => s.amount === null);
    const evenShare =
      nullSplits.length > 0
        ? (expense.amount - overridedTotal) / nullSplits.length
        : 0;
    for (const s of expense.splits) {
      const share = s.amount ?? evenShare;
      balances.set(s.user_id, (balances.get(s.user_id) ?? 0) - share);
    }
  }

  const total = (expenses as ExpenseItem[]).reduce((sum, e) => sum + e.amount, 0);

  // Split amounts for create form
  const totalAmountNum = Number(newAmount) || 0;
  const showSplitAmounts = isOwner && totalAmountNum > 0;
  const splitDisplay = showSplitAmounts
    ? computeSplitDisplay(totalAmountNum, splitAmong, newOverrides)
    : null;

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
            {(expenses as ExpenseItem[]).map((expense) => (
              <div key={expense.id}>
                <div
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
                  {isOwner && (
                    <button
                      data-testid={`edit-splits-${expense.id}`}
                      onClick={() =>
                        setEditingExpenseId((prev) =>
                          prev === expense.id ? null : expense.id
                        )
                      }
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-70"
                      style={{
                        color:
                          editingExpenseId === expense.id
                            ? "var(--color-bt-accent)"
                            : "var(--color-bt-text-dim)",
                      }}
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
                {/* Inline edit splits panel */}
                {editingExpenseId === expense.id && (
                  <EditSplitsPanel
                    expense={expense}
                    members={members}
                    tripId={tripId}
                    onClose={() => setEditingExpenseId(null)}
                  />
                )}
              </div>
            ))}
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
                  <span style={{ color: "var(--color-bt-text-dim)" }}>{memberName(m.user_id)}</span>
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
            <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              Paid by
            </label>
            <select
              data-testid="expense-paidby-select"
              value={paidByUserId}
              onChange={(e) => setPaidByUserId(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
            >
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {memberName(m.user_id)}
                </option>
              ))}
            </select>
          </div>

          {/* Split among + optional override breakdown */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                Split among
              </label>
              {showSplitAmounts && (
                <div className="flex gap-1 pr-8 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  <span className="w-14 text-right">Share</span>
                  <span className="w-16 text-right">Override</span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              {members.map((m) => {
                const uid = m.user_id;
                const checked = splitAmong.includes(uid);
                const hasOverride = isOwner && checked && (newOverrides[uid] ?? "") !== "";
                const displayAmt =
                  showSplitAmounts && checked && splitDisplay
                    ? splitDisplay.perPerson[uid]
                    : null;
                const isNeg = displayAmt !== null && displayAmt < 0;

                if (isOwner && showSplitAmounts && checked) {
                  // Full row: explicit checkbox + name label + share + override + reset
                  return (
                    <div
                      key={uid}
                      className="flex items-center gap-2 rounded-lg px-3 py-1.5"
                      style={{
                        background: "var(--color-bt-accent-faint)",
                        border: "1px solid var(--color-bt-accent-border)",
                      }}
                    >
                      <input
                        type="checkbox"
                        id={`split-new-${uid}`}
                        checked={checked}
                        onChange={() => toggleSplit(uid)}
                        className="flex-shrink-0 cursor-pointer accent-bt-accent"
                      />
                      <label
                        htmlFor={`split-new-${uid}`}
                        className="min-w-0 flex-1 cursor-pointer truncate text-sm"
                        style={{ color: "var(--color-bt-text)" }}
                      >
                        {memberName(uid)}
                      </label>
                      <span
                        className="w-14 flex-shrink-0 text-right text-xs tabular-nums"
                        style={{
                          color: isNeg ? "var(--color-bt-danger)" : "var(--color-bt-text-dim)",
                        }}
                      >
                        {displayAmt !== null ? `$${displayAmt.toFixed(2)}` : ""}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        placeholder="—"
                        value={newOverrides[uid] ?? ""}
                        onChange={(e) =>
                          setNewOverrides((prev) => ({ ...prev, [uid]: e.target.value }))
                        }
                        className="w-16 flex-shrink-0 rounded-md border px-2 py-1 text-right text-xs outline-none tabular-nums"
                        style={{
                          background: "var(--color-bt-base)",
                          borderColor: hasOverride
                            ? "var(--color-bt-accent-border)"
                            : "var(--color-bt-border)",
                          color: "var(--color-bt-text)",
                        }}
                      />
                      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center">
                        {hasOverride && (
                          <button
                            type="button"
                            onClick={() => resetNewOverride(uid)}
                            className="flex h-6 w-6 items-center justify-center transition-opacity hover:opacity-70"
                            style={{ color: "var(--color-bt-text-dim)" }}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

                // Simple checkbox row (unchecked, !isOwner, or no amount yet)
                return (
                  <label
                    key={uid}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5"
                    style={{
                      background: checked ? "var(--color-bt-accent-faint)" : "var(--color-bt-base)",
                      border: `1px solid ${checked ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSplit(uid)}
                      className="flex-shrink-0 accent-bt-accent"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--color-bt-text)" }}>
                      {memberName(uid)}
                    </span>
                  </label>
                );
              })}
            </div>

            {/* Remaining / over-by message (all-overridden case) */}
            {showSplitAmounts && splitDisplay?.allOverridden && Math.abs(splitDisplay.remaining) >= 0.01 && (
              <p
                className="mt-1.5 text-right text-xs"
                style={{
                  color:
                    splitDisplay.remaining > 0
                      ? "var(--color-bt-warning)"
                      : "var(--color-bt-danger)",
                }}
              >
                {splitDisplay.remaining > 0
                  ? `Remaining: $${splitDisplay.remaining.toFixed(2)} unassigned`
                  : `Over by: $${Math.abs(splitDisplay.remaining).toFixed(2)}`}
              </p>
            )}
          </div>

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
                splitAmong.length === 0 ||
                createExpense.isPending
              }
              onClick={() => {
                createExpense.mutate({
                  tripId,
                  id: crypto.randomUUID(),
                  title: newTitle.trim(),
                  amount: Number(newAmount),
                  paidByUserId,
                  splitAmong: splitAmong.map((uid) => ({
                    userId: uid,
                    amount:
                      newOverrides[uid] && newOverrides[uid] !== ""
                        ? Number(newOverrides[uid])
                        : null,
                  })),
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
    </div>
  );
}
