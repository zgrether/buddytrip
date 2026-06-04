"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { ScrollLock } from "@/hooks/useScrollLock";
import { ConfirmDeleteButton } from "@/components/ConfirmDeleteButton";
import { trpc } from "@/lib/trpc-client";
import { SplitPanel } from "./SplitPanel";
import { CurrencyInput, memberName as getMemberName } from "./ExpensesSection";
import type { ExpenseItem, ExpenseMember } from "./ExpensesSection";
import { DatePicker } from "@/components/DatePicker";
import { DOMAIN_COLORS } from "@/lib/domainColors";
import { parseLocalDate, toISODate } from "@/lib/dates";

export function EditExpenseModal({
  expense,
  members,
  tripId,
  isOwner,
  canDelete,
  onClose,
}: {
  expense: ExpenseItem;
  members: ExpenseMember[];
  tripId: string;
  /** Owner — can edit splits/fields (expenses.updateSplits is Owner-only). */
  isOwner: boolean;
  /** Owner or Planner — can delete the receipt (expenses.remove is Planner+). */
  canDelete: boolean;
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

  // Split view starts "even" only when every non-opted-out member is
  // included with no per-person override; any customization → "custom".
  const [splitMode, setSplitMode] = useState<"even" | "custom">(() => {
    const allIncluded = members.every(
      (m) =>
        optedOutIds.includes(m.user_id) || includedIds.includes(m.user_id)
    );
    const noOverrides = Object.keys(overrides).length === 0;
    return allIncluded && noOverrides && optedOutIds.length === 0
      ? "even"
      : "custom";
  });

  function handleModeChange(next: "even" | "custom") {
    if (next === "even") {
      // Re-include everyone and clear overrides (mirrors Add modal).
      setIncludedIds(members.map((m) => m.user_id));
      setOverrides({});
    }
    setSplitMode(next);
  }

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

  const removeExpense = trpc.expenses.remove.useMutation({
    async onMutate() {
      await utils.expenses.list.cancel({ tripId });
      const prev = utils.expenses.list.getData({ tripId });
      utils.expenses.list.setData({ tripId }, (old) =>
        (old ?? []).filter((exp) => exp.id !== expense.id)
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

  // Dirty check — in edit mode Save stays disabled until the user actually
  // changes a field or the split, mirroring the lodging/agenda sheets.
  const initialIncludedIds = expense.splits
    .filter((s) => !s.opted_out)
    .map((s) => s.user_id);
  const initialOverrides: Record<string, string> = {};
  for (const s of expense.splits) {
    if (!s.opted_out && s.amount !== null)
      initialOverrides[s.user_id] = String(s.amount);
  }
  const normalizeOverrides = (ids: string[], ov: Record<string, string>) => {
    const out: Record<string, number> = {};
    for (const id of [...ids].sort()) {
      const raw = ov[id];
      if (raw && raw !== "") out[id] = Number(raw);
    }
    return JSON.stringify(out);
  };
  const isDirty =
    title.trim() !== expense.title ||
    amountNum !== expense.amount ||
    (date || null) !== (expense.date ?? null) ||
    paidByUserId !== expense.paid_by_user_id ||
    JSON.stringify([...includedIds].sort()) !==
      JSON.stringify([...initialIncludedIds].sort()) ||
    normalizeOverrides(includedIds, overrides) !==
      normalizeOverrides(initialIncludedIds, initialOverrides);

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
    <ScrollLock>
      {/* Tiered backdrops — sheet alpha mobile, drawer alpha desktop. */}
      <div
        className="fixed inset-0 z-40 sm:hidden"
        style={{ background: "var(--color-bt-overlay-sheet)" }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-40 hidden sm:block"
        style={{ background: "var(--color-bt-overlay-drawer)" }}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel — bottom sheet (mobile) / right-anchored 440px drawer
          (tablet + desktop, sm+ / ≥640px) per the canonical edit-drawer
          spec. Threshold lowered from lg → sm per Task 51. */}
      <div
        role="dialog"
        aria-modal="true"
        className={[
          "fixed z-50 flex flex-col",
          "inset-x-0 bottom-0 max-h-[90vh] rounded-t-2xl",
          "sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-0 sm:h-screen sm:max-h-screen sm:w-[440px] sm:rounded-none",
        ].join(" ")}
        style={{
          background: "var(--color-bt-card-float)",
          boxShadow: "var(--shadow-floating)",
          borderLeft: "1px solid var(--color-bt-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — sticky top */}
        <div
          className="flex flex-shrink-0 items-center justify-between px-5 pb-3 pt-4"
          style={{ borderBottom: "1px solid var(--color-bt-subtle-border)" }}
        >
          <div className="min-w-0">
            <div
              className="text-[10px] font-bold uppercase tracking-[0.12em]"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Receipt
            </div>
            <div
              className="mt-0.5 truncate text-[15px] font-bold"
              style={{ color: "var(--color-bt-text)" }}
            >
              {title || expense.title || "Untitled receipt"}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

        {/* Editable expense info */}
        <div className="mb-4 space-y-3.5">
          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>Title<span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: "var(--color-bt-danger)" }} aria-hidden /></label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Description"
                disabled={!isOwner}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              />
            </div>
            <div className="w-36 flex-shrink-0">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>Cost<span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: "var(--color-bt-danger)" }} aria-hidden /></label>
              <CurrencyInput
                value={amount}
                onChange={setAmount}
                className="w-full"
                disabled={!isOwner}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>Paid by</label>
              <div className="relative">
                <select
                  value={paidByUserId}
                  onChange={(e) => setPaidByUserId(e.target.value)}
                  disabled={!isOwner}
                  className="w-full appearance-none rounded-lg border py-2 pl-3 pr-8 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ background: "var(--color-bt-card)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
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
            <div className="w-36 flex-shrink-0">
              <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--color-bt-text-dim)" }}>Date <span className="lowercase">(optional)</span></label>
              <DatePicker
                mode="single"
                disabled={!isOwner}
                accent={DOMAIN_COLORS.receipts.color}
                accentFaint={DOMAIN_COLORS.receipts.faint}
                value={date ? parseLocalDate(date) : null}
                onChange={(d) => setDate(d ? toISODate(d) : "")}
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
          isOwnerEditing={isOwner}
          mode={splitMode}
          onModeChange={handleModeChange}
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

        {/* Destructive "Delete receipt" sits at the end of the body —
            above the footer divider and the Cancel/Save row. */}
        {canDelete && (
          <div className="mt-4">
            <ConfirmDeleteButton
              label="Delete receipt"
              confirmLabel="Delete"
              prompt="Delete this receipt?"
              pending={removeExpense.isPending}
              testId={`remove-expense-${expense.id}`}
              onConfirm={() => removeExpense.mutate({ tripId, expenseId: expense.id })}
            />
          </div>
        )}

        </div>

        {/* Footer — sticky bottom. Cancel/Save row; the destructive
            "Delete receipt" action lives at the end of the body in the
            scrollable body. */}
        <div
          className="flex flex-shrink-0 flex-col gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}
        >
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${isOwner ? "" : "flex-1"}`}
              style={{
                borderColor: "var(--color-bt-border)",
                color: "var(--color-bt-text-dim)",
                background: "transparent",
              }}
            >
              {isOwner ? "Cancel" : "Close"}
            </button>
            {isOwner && (
              <button
                disabled={updateSplits.isPending || includedIds.length === 0 || !title.trim() || amountNum <= 0 || !isDirty}
                onClick={handleSave}
                className="flex-1 rounded-lg py-2 text-sm font-semibold disabled:opacity-40"
                style={{
                  background: "var(--color-bt-accent)",
                  color: "var(--color-bt-on-accent)",
                }}
              >
                {updateSplits.isPending ? "Saving..." : "Save Changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </ScrollLock>
  );
}
