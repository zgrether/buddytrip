"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { trpc } from "@/lib/trpc-client";
import { SplitPanel } from "./SplitPanel";
import { CurrencyInput, memberName as getMemberName } from "./ExpensesSection";
import type { ExpenseItem, ExpenseMember } from "./ExpensesSection";

export function EditExpenseModal({
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
  useModalBackButton(onClose);

  // Editable expense fields
  const [title, setTitle] = useState(expense.title);
  const [amount, setAmount] = useState(String(expense.amount));
  const [date, setDate] = useState(expense.date ?? "");
  const [paidByUserId, setPaidByUserId] = useState(expense.paid_by_user_id);

  // Pre-populate from current splits
  const [includedIds, setIncludedIds] = useState<string[]>(() =>
    expense.splits.filter((s) => !s.opted_out).map((s) => s.user_id)
  );

  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of expense.splits) {
      if (!s.opted_out && s.amount !== null) {
        init[s.user_id] = String(s.amount);
      }
    }
    return init;
  });

  const optedOutIds = expense.splits
    .filter((s) => s.opted_out)
    .map((s) => s.user_id);

  const updateSplits = trpc.expenses.updateSplits.useMutation({
    async onMutate(vars) {
      await utils.expenses.list.cancel({ tripId });
      const prev = utils.expenses.list.getData({ tripId });
      utils.expenses.list.setData({ tripId }, (old) =>
        (old ?? []).map((exp) =>
          exp.id === vars.expenseId
            ? {
                ...exp,
                ...(vars.title !== undefined ? { title: vars.title } : {}),
                ...(vars.amount !== undefined ? { amount: vars.amount } : {}),
                ...(vars.date !== undefined ? { date: vars.date } : {}),
                ...(vars.paidByUserId !== undefined ? { paid_by_user_id: vars.paidByUserId } : {}),
                splits: vars.splits.map((s) => ({
                  expense_id: vars.expenseId,
                  user_id: s.userId,
                  amount: s.amount,
                  opted_out: s.optedOut ?? false,
                })),
              }
            : exp
        )
      );
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined)
        utils.expenses.list.setData({ tripId }, context.prev);
    },
    onSuccess() {
      onClose();
    },
    onSettled() {
      utils.expenses.list.invalidate({ tripId });
    },
  });

  const memberName = (uid: string) => getMemberName(members, uid);

  function handleToggle(uid: string) {
    if (includedIds.includes(uid)) {
      setIncludedIds((prev) => prev.filter((id) => id !== uid));
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    } else {
      setIncludedIds((prev) => [...prev, uid]);
    }
  }

  const amountNum = Number(amount) || 0;

  function handleSave() {
    const splits = includedIds.map((uid) => ({
      userId: uid,
      amount:
        overrides[uid] && overrides[uid] !== ""
          ? Number(overrides[uid])
          : null,
      optedOut: false,
    }));

    // Keep opted-out members who weren't re-checked
    const stillOptedOut = optedOutIds.filter((uid) => !includedIds.includes(uid));
    for (const uid of stillOptedOut) {
      splits.push({ userId: uid, amount: 0, optedOut: true });
    }

    // Include fields only if changed
    const titleChanged = title.trim() !== expense.title ? title.trim() : undefined;
    const amountChanged = amountNum !== expense.amount ? amountNum : undefined;
    const dateVal = date || null;
    const dateChanged = dateVal !== (expense.date ?? null) ? dateVal : undefined;
    const paidByChanged = paidByUserId !== expense.paid_by_user_id ? paidByUserId : undefined;

    updateSplits.mutate({
      tripId,
      expenseId: expense.id,
      splits,
      ...(titleChanged !== undefined ? { title: titleChanged } : {}),
      ...(amountChanged !== undefined ? { amount: amountChanged } : {}),
      ...(dateChanged !== undefined ? { date: dateChanged } : {}),
      ...(paidByChanged !== undefined ? { paidByUserId: paidByChanged } : {}),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-lg rounded-2xl p-5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Edit Expense
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Editable expense info */}
        <div className="mb-4 space-y-2">
          <div className="flex gap-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Description"
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
            />
            <CurrencyInput
              value={amount}
              onChange={setAmount}
              className="w-28 flex-shrink-0"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Paid by</label>
              <div className="relative">
                <select
                  value={paidByUserId}
                  onChange={(e) => setPaidByUserId(e.target.value)}
                  className="w-full appearance-none rounded-lg border py-2 pl-3 pr-8 text-sm outline-none"
                  style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
                >
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {memberName(m.user_id)}
                    </option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-bt-text-dim)" }} />
                </svg>
              </div>
            </div>
            <div className="flex-shrink-0">
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              />
            </div>
          </div>
        </div>

        {/* Split panel */}
        <SplitPanel
          members={members}
          totalAmount={amountNum}
          includedIds={includedIds}
          overrides={overrides}
          optedOutIds={optedOutIds}
          isOwnerEditing
          onToggle={handleToggle}
          onOverrideChange={(uid, val) =>
            setOverrides((prev) => ({ ...prev, [uid]: val }))
          }
          onResetOverride={(uid) =>
            setOverrides((prev) => {
              const next = { ...prev };
              delete next[uid];
              return next;
            })
          }
        />

        {/* Action buttons */}
        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border py-2 text-sm"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
          >
            Cancel
          </button>
          <button
            disabled={updateSplits.isPending || includedIds.length === 0 || !title.trim() || amountNum <= 0}
            onClick={handleSave}
            className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            {updateSplits.isPending ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
