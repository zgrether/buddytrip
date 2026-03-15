"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DollarSign, Plus, Save, Lock, Unlock, Trash2, MessageSquare, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import type { TabProps } from "./types";

// ── ExpensesSection ───────────────────────────────────────────────────────

interface ExpenseMember {
  user_id: string;
  user?: { id: string; name?: string | null; email?: string | null } | null;
}

function ExpensesSection({
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
    // Payer gets credit
    balances.set(
      expense.paid_by_user_id,
      (balances.get(expense.paid_by_user_id) ?? 0) + expense.amount
    );
    // Each splitter owes their share
    for (const s of expense.splits) {
      const share = s.amount ?? evenShare;
      balances.set(s.user_id, (balances.get(s.user_id) ?? 0) - share);
    }
  }

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-3">
      {/* Expense list */}
      {expenses.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-bt-text-dim)" }}>
          No expenses recorded yet.
        </p>
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
        </>
      )}

      {/* Add expense form */}
      {canEdit && (
        showAdd ? (
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
            <div>
              <label className="mb-1.5 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                Split among
              </label>
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
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSplit(m.user_id)}
                        className="accent-bt-accent"
                      />
                      <span className="text-sm" style={{ color: "var(--color-bt-text)" }}>
                        {memberName(m.user_id)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowAdd(false);
                  setNewTitle("");
                  setNewAmount("");
                  setPaidByUserId(members[0]?.user_id ?? "");
                  setSplitAmong(members.map((m) => m.user_id));
                }}
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
                    splitAmong,
                  });
                }}
                className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
              >
                Add Expense
              </button>
            </div>
          </div>
        ) : (
          <button
            data-testid="show-add-expense-btn"
            onClick={() => setShowAdd(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
            style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-accent)" }}
          >
            <Plus size={16} />
            Add Expense
          </button>
        )
      )}
    </div>
  );
}

// ── MoreTab ───────────────────────────────────────────────────────────────

export function MoreTab({ trip, canEdit, isOwner }: TabProps) {
  const router = useRouter();
  const utils = trpc.useUtils();

  // ── Edit form state ──────────────────────────────────────────────────────
  const [title, setTitle] = useState(trip.title);
  const [description, setDescription] = useState(trip.description ?? "");
  const [location, setLocation] = useState(trip.location ?? "");
  const [startDate, setStartDate] = useState(trip.start_date ?? "");
  const [endDate, setEndDate] = useState(trip.end_date ?? "");
  const [notes, setNotes] = useState(trip.notes ?? "");

  // ── Lock destination state ───────────────────────────────────────────────
  const [lockTitle, setLockTitle] = useState(
    trip.locked_destination_title ?? ""
  );
  const [lockLocation, setLockLocation] = useState(
    trip.locked_destination_location ?? ""
  );
  const [showLockForm, setShowLockForm] = useState(false);

  // ── Confirm delete state ─────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId: trip.id });

  // ── Mutations ────────────────────────────────────────────────────────────
  const updateTrip = trpc.trips.update.useMutation({
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId: trip.id });
      utils.trips.list.invalidate();
    },
  });

  const lockDest = trpc.trips.lockDestination.useMutation({
    async onMutate(vars) {
      await utils.trips.getById.cancel({ tripId: trip.id });
      const prev = utils.trips.getById.getData({ tripId: trip.id });
      if (prev) {
        utils.trips.getById.setData({ tripId: trip.id }, { ...prev, locked_destination_title: vars.title, locked_destination_location: vars.location });
      }
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.trips.getById.setData({ tripId: trip.id }, context.prev);
    },
    onSuccess() {
      setShowLockForm(false);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId: trip.id });
    },
  });

  const unlockDest = trpc.trips.unlockDestination.useMutation({
    async onMutate() {
      await utils.trips.getById.cancel({ tripId: trip.id });
      const prev = utils.trips.getById.getData({ tripId: trip.id });
      if (prev) {
        utils.trips.getById.setData({ tripId: trip.id }, { ...prev, locked_destination_title: null, locked_destination_location: null });
      }
      return { prev };
    },
    onError(_err, _vars, context) {
      if (context?.prev !== undefined) utils.trips.getById.setData({ tripId: trip.id }, context.prev);
    },
    onSettled() {
      utils.trips.getById.invalidate({ tripId: trip.id });
    },
  });

  const deleteTrip = trpc.trips.delete.useMutation({
    onSuccess: () => router.push("/dashboard"),
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleSave() {
    updateTrip.mutate({
      tripId: trip.id,
      title: title.trim() || trip.title,
      description: description || undefined,
      location: location || null,
      startDate: startDate || null,
      endDate: endDate || null,
      notes: notes || undefined,
    });
  }

  function handleLock() {
    if (!lockTitle.trim() || !lockLocation.trim()) return;
    lockDest.mutate({
      tripId: trip.id,
      title: lockTitle.trim(),
      location: lockLocation.trim(),
    });
  }

  const isLocked = !!trip.locked_destination_title;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 px-4">
      {/* ── Quick links ─────────────────────────────────────────────────── */}
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Quick Links
        </h2>
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <button
            data-testid="messages-link"
            onClick={() => router.push(`/trips/${trip.id}/messages`)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
          >
            <MessageSquare size={18} style={{ color: "var(--color-bt-accent)" }} />
            <span className="flex-1 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
              Messages
            </span>
            <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
          </button>
        </div>
      </section>

      {/* ── Expenses ──────────────────────────────────────────────────────── */}
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          Expenses
        </h2>
        <ExpensesSection
          tripId={trip.id}
          members={members as ExpenseMember[]}
          canEdit={canEdit}
        />
      </section>

      {/* ── Trip details ──────────────────────────────────────────────────── */}
      {canEdit && (
        <section>
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Trip Details
          </h2>
          <div
            className="space-y-3 rounded-xl p-4"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            {/* Title */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                Name
              </label>
              <input
                data-testid="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                Description
              </label>
              <textarea
                data-testid="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                  resize: "none",
                }}
              />
            </div>

            {/* Location */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                Location
              </label>
              <input
                data-testid="edit-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                }}
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  Start Date
                </label>
                <input
                  type="date"
                  data-testid="edit-start-date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "var(--color-bt-base)",
                    borderColor: "var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                    colorScheme: "inherit",
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  End Date
                </label>
                <input
                  type="date"
                  data-testid="edit-end-date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "var(--color-bt-base)",
                    borderColor: "var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                    colorScheme: "inherit",
                  }}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                Notes
              </label>
              <textarea
                data-testid="edit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "var(--color-bt-base)",
                  borderColor: "var(--color-bt-border)",
                  color: "var(--color-bt-text)",
                  resize: "none",
                }}
              />
            </div>

            {/* Save button */}
            <button
              data-testid="save-trip-btn"
              disabled={updateTrip.isPending}
              onClick={handleSave}
              className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium disabled:opacity-40"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              <Save size={14} />
              {updateTrip.isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </section>
      )}

      {/* ── Lock / Unlock destination ──────────────────────────────────────── */}
      {isOwner && (
        <section>
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Destination
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            {isLocked ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <Lock size={14} style={{ color: "var(--color-bt-accent)" }} />
                  <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                    {trip.locked_destination_title}
                  </p>
                </div>
                <p className="mb-3 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  {trip.locked_destination_location}
                </p>
                <button
                  data-testid="unlock-destination-btn"
                  disabled={unlockDest.isPending}
                  onClick={() => unlockDest.mutate({ tripId: trip.id })}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-40"
                  style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                >
                  <Unlock size={14} />
                  Unlock Destination
                </button>
              </>
            ) : showLockForm ? (
              <div className="space-y-3">
                <p className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                  Lock Destination
                </p>
                <input
                  data-testid="lock-title-input"
                  placeholder="Destination name"
                  value={lockTitle}
                  onChange={(e) => setLockTitle(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "var(--color-bt-base)",
                    borderColor: "var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                  }}
                />
                <input
                  data-testid="lock-location-input"
                  placeholder="Location"
                  value={lockLocation}
                  onChange={(e) => setLockLocation(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "var(--color-bt-base)",
                    borderColor: "var(--color-bt-border)",
                    color: "var(--color-bt-text)",
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowLockForm(false)}
                    className="flex-1 rounded-lg border py-2 text-sm"
                    style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                  >
                    Cancel
                  </button>
                  <button
                    data-testid="confirm-lock-btn"
                    disabled={
                      !lockTitle.trim() ||
                      !lockLocation.trim() ||
                      lockDest.isPending
                    }
                    onClick={handleLock}
                    className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                    style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
                  >
                    Lock
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                  Lock the destination to finalize it for all crew members.
                </p>
                <button
                  data-testid="lock-destination-btn"
                  onClick={() => setShowLockForm(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm transition-colors hover:bg-[var(--color-bt-hover)]"
                  style={{ borderColor: "var(--color-bt-accent)", color: "var(--color-bt-accent)" }}
                >
                  <Lock size={14} />
                  Lock Destination
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* ── Invite hint ───────────────────────────────────────────────────── */}
      {isOwner && (
        <section>
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Members
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            <p className="text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
              To invite new members, search for users in the Crew tab and add
              them by email.
            </p>
          </div>
        </section>
      )}

      {/* ── Danger zone (Owner only) ───────────────────────────────────────── */}
      {isOwner && (
        <section>
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-bt-text-dim)" }}
          >
            Danger Zone
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            {confirmDelete ? (
              <div>
                <p className="mb-3 text-sm" style={{ color: "var(--color-bt-text)" }}>
                  Delete <strong>{trip.title}</strong>? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 rounded-lg border py-2 text-sm"
                    style={{ borderColor: "var(--color-bt-border)", color: "var(--color-bt-text-dim)" }}
                  >
                    Cancel
                  </button>
                  <button
                    data-testid="confirm-delete-btn"
                    disabled={deleteTrip.isPending}
                    onClick={() => deleteTrip.mutate({ tripId: trip.id })}
                    className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                    style={{ background: "var(--color-bt-danger)", color: "#fff" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <button
                data-testid="delete-trip-btn"
                onClick={() => setConfirmDelete(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm"
                style={{ color: "var(--color-bt-danger)" }}
              >
                <Trash2 size={14} />
                Delete Trip
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
