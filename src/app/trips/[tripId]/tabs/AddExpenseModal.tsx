"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { trpc } from "@/lib/trpc-client";
import { SplitPanel } from "./SplitPanel";
import { CurrencyInput, memberName } from "./ExpensesSection";
import type { ExpenseMember } from "./ExpensesSection";

export function AddExpenseModal({
  tripId,
  members,
  onClose,
}: {
  tripId: string;
  members: ExpenseMember[];
  onClose: () => void;
}) {
  const currentUser = useCurrentUser();
  const utils = trpc.useUtils();
  useModalBackButton(onClose);

  const defaultPaidBy =
    members.find((m) => m.user_id === currentUser?.id)?.user_id ??
    members[0]?.user_id ??
    "";

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidByUserId, setPaidByUserId] = useState(defaultPaidBy);
  const [splitMode, setSplitMode] = useState<"even" | "custom">("even");
  const [splitAmong, setSplitAmong] = useState<string[]>(
    members.map((m) => m.user_id)
  );
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [date, setDate] = useState("");

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
          date: vars.date ?? null,
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
      onClose();
    },
    onSettled() {
      utils.expenses.list.invalidate({ tripId });
    },
  });

  function toggleSplit(userId: string) {
    if (splitAmong.includes(userId)) {
      setSplitAmong((prev) => prev.filter((id) => id !== userId));
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    } else {
      setSplitAmong((prev) => [...prev, userId]);
    }
  }

  function switchToEven() {
    setSplitMode("even");
    setSplitAmong(members.map((m) => m.user_id));
    setOverrides({});
  }

  const amountNum = Number(amount) || 0;
  const evenPerPerson =
    amountNum > 0 && members.length > 0
      ? amountNum / members.length
      : 0;

  function handleCreate() {
    const splitData =
      splitMode === "even"
        ? members.map((m) => ({ userId: m.user_id, amount: null as number | null }))
        : splitAmong.map((uid) => ({
            userId: uid,
            amount:
              overrides[uid] && overrides[uid] !== ""
                ? Number(overrides[uid])
                : null,
          }));
    createExpense.mutate({
      tripId,
      id: crypto.randomUUID(),
      title: title.trim(),
      amount: amountNum,
      paidByUserId,
      date: date || null,
      splitAmong: splitData,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      />
      {/* Canonical modal structure (CC_MODAL_AUDIT.md Part 2.1):
          header / body / footer split with border-bottom + border-top
          dividers, max-w-[560px] for multi-field forms,
          overflow-hidden so the borders extend edge-to-edge,
          var(--shadow-floating) for elevation. */}
      <div
        className="relative flex w-full max-w-[560px] flex-col overflow-hidden rounded-xl"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
          boxShadow: "var(--shadow-floating)",
          maxHeight: "min(85dvh, 720px)",
        }}
      >
        {/* Header */}
        <div
          className="flex flex-shrink-0 items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-bt-border)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Add Receipt
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{
              background: "var(--color-bt-card-raised)",
              color: "var(--color-bt-text-dim)",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {/* Side-by-side Description + Amount */}
          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Receipt</label>
              <input
                data-testid="expense-title-input"
                placeholder="Description (e.g. Dinner)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              />
            </div>
            <div className="w-36 flex-shrink-0">
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>Cost</label>
              <CurrencyInput
                data-testid="expense-amount-input"
                value={amount}
                onChange={setAmount}
                className="w-full"
              />
            </div>
          </div>

          {/* Paid by + Date on same line */}
          <div className="flex gap-3">
            <div className="min-w-0 flex-1">
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
            <div className="w-36 flex-shrink-0">
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                Date (optional)
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: "var(--color-bt-base)", borderColor: "var(--color-bt-border)", color: "var(--color-bt-text)" }}
              />
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
              totalAmount={amountNum}
              includedIds={splitAmong}
              overrides={overrides}
              onToggle={toggleSplit}
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
          )}

        </div>

        {/* Footer — canonical right-aligned actions with gap-3, Medium
            button size (px-4 py-2.5 text-sm), Ghost + Primary variants. */}
        <div
          className="flex flex-shrink-0 items-center justify-end gap-3 px-5 py-4"
          style={{ borderTop: "1px solid var(--color-bt-border)" }}
        >
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium"
            style={{
              background: "transparent",
              color: "var(--color-bt-text-dim)",
              border: "0.5px solid var(--color-bt-border)",
            }}
          >
            Cancel
          </button>
          <button
            data-testid="save-expense-btn"
            disabled={
              !title.trim() ||
              !amount ||
              amountNum <= 0 ||
              !paidByUserId ||
              (splitMode === "custom" && splitAmong.length === 0) ||
              createExpense.isPending
            }
            onClick={handleCreate}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
          >
            Add Receipt
          </button>
        </div>
      </div>
    </div>
  );
}
