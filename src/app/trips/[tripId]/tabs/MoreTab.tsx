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
    onSuccess: () => {
      utils.expenses.list.invalidate({ tripId });
      setShowAdd(false);
      setNewTitle("");
      setNewAmount("");
      setSplitAmong(members.map((m) => m.user_id));
    },
  });

  const removeExpense = trpc.expenses.remove.useMutation({
    onSuccess: () => utils.expenses.list.invalidate({ tripId }),
  });

  const memberName = (userId: string) => {
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
        <p className="text-sm" style={{ color: "#8b949e" }}>
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
                style={{ background: "#161b22", border: "1px solid #30363d" }}
              >
                <DollarSign size={14} style={{ color: "#00d4aa" }} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" style={{ color: "#e6edf3" }}>
                    {expense.title}
                  </p>
                  <p className="text-xs" style={{ color: "#8b949e" }}>
                    Paid by {memberName(expense.paid_by_user_id)} · split {expense.splits.length} ways
                  </p>
                </div>
                <span className="flex-shrink-0 text-sm font-semibold" style={{ color: "#e6edf3" }}>
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
                    style={{ color: "#8b949e" }}
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
            style={{ background: "#0d1117", border: "1px solid #30363d" }}
          >
            <div className="mb-2 flex justify-between text-xs font-medium" style={{ color: "#8b949e" }}>
              <span>Total</span>
              <span style={{ color: "#e6edf3" }}>${total.toFixed(2)}</span>
            </div>
            {members.map((m) => {
              const bal = balances.get(m.user_id) ?? 0;
              if (Math.abs(bal) < 0.01) return null;
              return (
                <div key={m.user_id} className="flex justify-between text-xs">
                  <span style={{ color: "#8b949e" }}>{memberName(m.user_id)}</span>
                  <span style={{ color: bal > 0 ? "#00d4aa" : "#ef4444" }}>
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
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
              Add Expense
            </p>
            <input
              data-testid="expense-title-input"
              placeholder="Description (e.g. Dinner)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: "#0d1117", borderColor: "#30363d", color: "#e6edf3" }}
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
              style={{ background: "#0d1117", borderColor: "#30363d", color: "#e6edf3" }}
            />
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Paid by
              </label>
              <select
                data-testid="expense-paidby-select"
                value={paidByUserId}
                onChange={(e) => setPaidByUserId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: "#0d1117", borderColor: "#30363d", color: "#e6edf3" }}
              >
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {memberName(m.user_id)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs" style={{ color: "#8b949e" }}>
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
                        background: checked ? "#00d4aa11" : "#0d1117",
                        border: `1px solid ${checked ? "#00d4aa44" : "#30363d"}`,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSplit(m.user_id)}
                        className="accent-[#00d4aa]"
                      />
                      <span className="text-sm" style={{ color: "#e6edf3" }}>
                        {memberName(m.user_id)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowAdd(false); setNewTitle(""); setNewAmount(""); }}
                className="flex-1 rounded-lg border py-2 text-sm"
                style={{ borderColor: "#30363d", color: "#8b949e" }}
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
                style={{ background: "#00d4aa", color: "#0d1117" }}
              >
                Add Expense
              </button>
            </div>
          </div>
        ) : (
          <button
            data-testid="show-add-expense-btn"
            onClick={() => setShowAdd(true)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm transition-colors hover:bg-white/5"
            style={{ borderColor: "#30363d", color: "#00d4aa" }}
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
    onSuccess: () => {
      utils.trips.getById.invalidate({ tripId: trip.id });
      setShowLockForm(false);
    },
  });

  const unlockDest = trpc.trips.unlockDestination.useMutation({
    onSuccess: () => utils.trips.getById.invalidate({ tripId: trip.id }),
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
          style={{ color: "#8b949e" }}
        >
          Quick Links
        </h2>
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: "#161b22", border: "1px solid #30363d" }}
        >
          <button
            data-testid="messages-link"
            onClick={() => router.push(`/trips/${trip.id}/messages`)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
          >
            <MessageSquare size={18} style={{ color: "#00d4aa" }} />
            <span className="flex-1 text-sm font-medium" style={{ color: "#e6edf3" }}>
              Messages
            </span>
            <ChevronRight size={16} style={{ color: "#8b949e" }} />
          </button>
        </div>
      </section>

      {/* ── Expenses ──────────────────────────────────────────────────────── */}
      <section>
        <h2
          className="mb-3 text-sm font-semibold uppercase tracking-wider"
          style={{ color: "#8b949e" }}
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
            style={{ color: "#8b949e" }}
          >
            Trip Details
          </h2>
          <div
            className="space-y-3 rounded-xl p-4"
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            {/* Title */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Name
              </label>
              <input
                data-testid="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "#0d1117",
                  borderColor: "#30363d",
                  color: "#e6edf3",
                }}
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Description
              </label>
              <textarea
                data-testid="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "#0d1117",
                  borderColor: "#30363d",
                  color: "#e6edf3",
                  resize: "none",
                }}
              />
            </div>

            {/* Location */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Location
              </label>
              <input
                data-testid="edit-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "#0d1117",
                  borderColor: "#30363d",
                  color: "#e6edf3",
                }}
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                  Start Date
                </label>
                <input
                  type="date"
                  data-testid="edit-start-date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "#0d1117",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                    colorScheme: "dark",
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
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
                    background: "#0d1117",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                    colorScheme: "dark",
                  }}
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="mb-1 block text-xs" style={{ color: "#8b949e" }}>
                Notes
              </label>
              <textarea
                data-testid="edit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  background: "#0d1117",
                  borderColor: "#30363d",
                  color: "#e6edf3",
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
              style={{ background: "#00d4aa", color: "#0d1117" }}
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
            style={{ color: "#8b949e" }}
          >
            Destination
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            {isLocked ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <Lock size={14} style={{ color: "#00d4aa" }} />
                  <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
                    {trip.locked_destination_title}
                  </p>
                </div>
                <p className="mb-3 text-xs" style={{ color: "#8b949e" }}>
                  {trip.locked_destination_location}
                </p>
                <button
                  data-testid="unlock-destination-btn"
                  disabled={unlockDest.isPending}
                  onClick={() => unlockDest.mutate({ tripId: trip.id })}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm transition-colors hover:bg-white/5 disabled:opacity-40"
                  style={{ borderColor: "#30363d", color: "#8b949e" }}
                >
                  <Unlock size={14} />
                  Unlock Destination
                </button>
              </>
            ) : showLockForm ? (
              <div className="space-y-3">
                <p className="text-sm font-medium" style={{ color: "#e6edf3" }}>
                  Lock Destination
                </p>
                <input
                  data-testid="lock-title-input"
                  placeholder="Destination name"
                  value={lockTitle}
                  onChange={(e) => setLockTitle(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "#0d1117",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                  }}
                />
                <input
                  data-testid="lock-location-input"
                  placeholder="Location"
                  value={lockLocation}
                  onChange={(e) => setLockLocation(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{
                    background: "#0d1117",
                    borderColor: "#30363d",
                    color: "#e6edf3",
                  }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowLockForm(false)}
                    className="flex-1 rounded-lg border py-2 text-sm"
                    style={{ borderColor: "#30363d", color: "#8b949e" }}
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
                    style={{ background: "#00d4aa", color: "#0d1117" }}
                  >
                    Lock
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="mb-3 text-xs" style={{ color: "#8b949e" }}>
                  Lock the destination to finalize it for all crew members.
                </p>
                <button
                  data-testid="lock-destination-btn"
                  onClick={() => setShowLockForm(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-sm transition-colors hover:bg-white/5"
                  style={{ borderColor: "#00d4aa", color: "#00d4aa" }}
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
            style={{ color: "#8b949e" }}
          >
            Members
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            <p className="text-xs" style={{ color: "#8b949e" }}>
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
            style={{ color: "#8b949e" }}
          >
            Danger Zone
          </h2>
          <div
            className="rounded-xl p-4"
            style={{ background: "#161b22", border: "1px solid #30363d" }}
          >
            {confirmDelete ? (
              <div>
                <p className="mb-3 text-sm" style={{ color: "#e6edf3" }}>
                  Delete <strong>{trip.title}</strong>? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 rounded-lg border py-2 text-sm"
                    style={{ borderColor: "#30363d", color: "#8b949e" }}
                  >
                    Cancel
                  </button>
                  <button
                    data-testid="confirm-delete-btn"
                    disabled={deleteTrip.isPending}
                    onClick={() => deleteTrip.mutate({ tripId: trip.id })}
                    className="flex-1 rounded-lg py-2 text-sm font-medium disabled:opacity-40"
                    style={{ background: "#ef4444", color: "#fff" }}
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
                style={{ color: "#ef4444" }}
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
