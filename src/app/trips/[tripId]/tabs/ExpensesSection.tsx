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
import { SampleHeader, SampleCard } from "@/components/SampleSection";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { trpc } from "@/lib/trpc-client";
import { SplitPanel } from "./SplitPanel";
import { EditExpenseModal } from "./EditExpenseModal";
import { AddExpenseModal } from "./AddExpenseModal";

// ── Types ────────────────────────────────────────────────────────────────

export interface ExpenseMember {
  user_id: string;
  role?: string | null;
  isGuest?: boolean;
  displayName?: string | null;
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
  return m?.displayName ?? m?.user?.name ?? m?.user?.email ?? userId.slice(0, 6);
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

// ── ReceiptExample ───────────────────────────────────────────────────────
// Full-opacity sample receipt rendered inside <SampleCard /> on the
// empty-state Receipts page. Mirrors the real receipt row styling
// without depending on real data so it stays decoupled from row evolution.

function ReceiptExample() {
  return (
    <div
      className="grid items-center gap-3.5 rounded-xl px-3 py-2.5"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
        gridTemplateColumns: "auto 1fr auto auto",
      }}
    >
      {/* $ chip — 36×36 accent-faint square with mono $ glyph */}
      <span
        className="flex h-9 w-9 items-center justify-center rounded-[9px] font-mono text-base font-bold"
        style={{
          background: "var(--color-bt-accent-faint)",
          color: "var(--color-bt-accent)",
        }}
      >
        $
      </span>

      {/* Content — title + paid-by/split + your-share */}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-bold" style={{ color: "var(--color-bt-text)" }}>
          Steak dinner + open bar
        </p>
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
          Paid by{" "}
          <strong className="font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Ryan
          </strong>
          <span className="mx-2">·</span>
          split 4 ways
        </p>
        <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-accent)" }}>
          Your share:{" "}
          <strong className="font-semibold">$120.00</strong>
        </p>
      </div>

      {/* Amount — mono, right-aligned, min-width so the icons sit clear */}
      <span
        className="text-right font-mono text-[15px] font-semibold"
        style={{ color: "var(--color-bt-text)", minWidth: 70 }}
      >
        $480.00
      </span>

      {/* Trailing icon trio — match the populated state's action set
          so the EXAMPLE faithfully previews what a real row looks like. */}
      <div className="flex items-center gap-1" style={{ color: "var(--color-bt-text-dim)" }}>
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-md">
          <UserMinus size={14} />
        </span>
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-md">
          <Pencil size={14} />
        </span>
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-md">
          <Trash2 size={14} />
        </span>
      </div>
    </div>
  );
}

// ── BalancesPreview ──────────────────────────────────────────────────────
// Even on the empty Receipts state we render the live BALANCES section
// pre-populated with every crew member at $0.00. This is REAL data
// (not example), so it shows the user what the other half of the tab
// does (squares up debts) before they've logged anything. Per
// HANDOFF-gaps-receipts-empty.md §3.

function BalancesPreview({
  members,
  currentUserId,
}: {
  members: ExpenseMember[];
  currentUserId: string | null | undefined;
}) {
  // Order matches what the populated balances panel uses elsewhere:
  // Owner first, Planners next, then everyone else by name.
  const ROLE_ORDER: Record<string, number> = { Owner: 0, Planner: 1, Member: 2 };
  const sorted = [...members].sort((a, b) => {
    const aOrder = ROLE_ORDER[a.role ?? "Member"] ?? 2;
    const bOrder = ROLE_ORDER[b.role ?? "Member"] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1;
    return memberName(members, a.user_id).localeCompare(memberName(members, b.user_id));
  });

  if (sorted.length === 0) return null;

  return (
    <div className="mt-2">
      <div
        className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--color-bt-accent)" }}
      >
        Balances
      </div>
      <div
        className="rounded-[10px] px-4"
        style={{
          background: "var(--color-bt-card)",
          border: "1px solid var(--color-bt-border)",
        }}
      >
        {sorted.map((m, idx) => {
          const name = memberName(members, m.user_id);
          const isYou = m.user_id === currentUserId;
          return (
            <div
              key={m.user_id}
              className="flex items-center justify-between py-3"
              style={{
                borderBottom:
                  idx < sorted.length - 1
                    ? "1px solid var(--color-bt-subtle-border)"
                    : undefined,
              }}
            >
              <span
                className="text-sm font-semibold"
                style={{ color: "var(--color-bt-text)" }}
              >
                {name}
                {isYou && (
                  <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 400 }}>
                    {" "}
                    (you)
                  </span>
                )}
              </span>
              <span
                className="font-mono text-sm font-semibold"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                $0.00
              </span>
            </div>
          );
        })}
      </div>
      <p
        className="mt-2.5 text-[11px] italic"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Everyone&apos;s even — no receipts logged yet.
      </p>
    </div>
  );
}

// ── AddReceiptFullComposer ───────────────────────────────────────────────
// Boosted variant of the rail composer specific to Receipts. Mirrors
// the spec's AddReceiptComposer: title input → amount + paid-by select
// → "Split with" pill row → primary CTA + hint.
//
// The inputs are visual scaffolding for the spec — submission still
// flows through AddExpenseModal (where the real validation + tRPC
// wiring lives). Clicking any control opens that modal. A future
// commit can pre-fill the modal with whatever the user typed here.

function AddReceiptFullComposer({
  members,
  currentUserId,
  onOpen,
}: {
  members: ExpenseMember[];
  currentUserId: string | null | undefined;
  onOpen: () => void;
}) {
  const inputBase = {
    background: "var(--color-bt-card-raised)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
  };
  const me = members.find((m) => m.user_id === currentUserId);
  const myName = me ? memberName(members, me.user_id) : "you";
  // Cap to first ~6 members so the pill row doesn't run away on
  // larger crews — full assignment happens in the modal.
  const pillCrew = members.slice(0, 6);

  return (
    <div
      className="flex flex-col gap-2.5 rounded-xl p-4"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-accent-border)",
        boxShadow: "var(--shadow-raised)",
      }}
    >
      <div
        className="text-[11px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--color-bt-accent)" }}
      >
        Add your first receipt
      </div>

      <input
        type="text"
        placeholder="Title (e.g. Steak dinner)"
        onFocus={onOpen}
        readOnly
        className="w-full cursor-pointer rounded-lg border px-2.5 py-2 text-[13px] outline-none"
        style={inputBase}
      />

      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="$0.00"
          onFocus={onOpen}
          readOnly
          className="min-w-0 flex-1 cursor-pointer rounded-lg border px-2.5 py-2 text-right font-mono text-[13px] outline-none"
          style={inputBase}
        />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate rounded-lg border px-2.5 py-2 text-left text-[13px]"
          style={inputBase}
        >
          Paid by · {myName}
        </button>
      </div>

      <div className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
        Split with
      </div>
      <div className="flex flex-wrap gap-1">
        {pillCrew.map((m) => {
          const name = memberName(members, m.user_id);
          const initials =
            name
              .split(/\s+/)
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase() || "?";
          return (
            <button
              key={m.user_id}
              type="button"
              onClick={onOpen}
              className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-[11px] font-semibold"
              style={{
                background: "var(--color-bt-card-raised)",
                border: "0.5px solid var(--color-bt-accent-border)",
                color: "var(--color-bt-text)",
              }}
              title={`Toggle ${name}`}
            >
              <span
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[8px]"
                style={{
                  background: "var(--color-bt-accent)",
                  color: "var(--color-bt-on-accent)",
                }}
              >
                {initials}
              </span>
              {name.split(/\s+/)[0]}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="mt-1 rounded-lg py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
        style={{
          background: "var(--color-bt-accent)",
          color: "var(--color-bt-on-accent)",
        }}
      >
        Add receipt
      </button>

      <p
        className="text-[11px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Tap a crew member to toggle them out of the split.
      </p>
    </div>
  );
}

// ── ExpensesSection ──────────────────────────────────────────────────────

export function ExpensesSection({
  tripId,
  members,
  canEdit,
  isOwner = false,
  // "Add receipt" modal state is lifted to the parent (ExpensesTab) so
  // the TabHeader desktop button and the mobile TabFab can both trigger
  // it. The section itself no longer renders an inline add button.
  addOpen,
  onAddOpenChange,
}: {
  tripId: string;
  members: ExpenseMember[];
  canEdit: boolean;
  isOwner?: boolean;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}) {
  const currentUser = useCurrentUser();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const utils = trpc.useUtils();

  // ── Modal state ──
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

  const hasExpenses = expenses.length > 0;
  const ROLE_ORDER: Record<string, number> = { Owner: 0, Planner: 1, Member: 2 };
  const balanceRows = members
    .filter((m) => Math.abs(balances.get(m.user_id) ?? 0) >= 0.01)
    .sort((a, b) => {
      const aOrder = ROLE_ORDER[a.role ?? "Member"] ?? 2;
      const bOrder = ROLE_ORDER[b.role ?? "Member"] ?? 2;
      if (aOrder !== bOrder) return aOrder - bOrder;
      if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1;
      return memberName(members, a.user_id).localeCompare(memberName(members, b.user_id));
    });

  return (
    <>
      {/* Two-column layout (receipts 2/3 | balances 1/3) only when there
          are expenses to balance. With no receipts yet the balances panel
          has nothing useful to show, so we hide it entirely and let the
          empty-state receipts column take the full width. minmax(0,…)
          prevents min-content from pushing column widths once the grid
          is active. */}
      <div
        className={
          hasExpenses
            ? "grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
            : ""
        }
      >

        {/* ── Left: receipt list (add affordance lives in the parent
            TabHeader / TabFab, not inline here) ─────────────────────── */}
        <div className="space-y-3">
          {!hasExpenses ? (
            canEdit ? (
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                {/* Main column — SampleHeader + example card + standalone
                    caption + live BALANCES preview. Caption sits BETWEEN
                    the example and BALANCES per spec; previously it lived
                    inside the composer's hint, wrong placement. */}
                <div className="flex flex-col gap-3.5">
                  <SampleHeader label="How a receipt will look" />
                  <SampleCard>
                    <ReceiptExample />
                  </SampleCard>
                  <p
                    className="m-0 hidden md:block"
                    style={{
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: "var(--color-bt-text-dim)",
                    }}
                  >
                    Log who paid and how to split it. By default everyone
                    splits evenly — tap a receipt later to customize.
                  </p>
                  <BalancesPreview
                    members={members}
                    currentUserId={currentUser?.id}
                  />
                </div>

                {/* Right rail (lg+) / stacked composer (md ≤ x < lg).
                    Hidden on phones (<md) — the TabFab is the mobile add
                    affordance. Capped at 540px when stacked. */}
                <aside
                  className="hidden md:block"
                  style={{ maxWidth: 540 }}
                >
                  <AddReceiptFullComposer
                    members={members}
                    currentUserId={currentUser?.id}
                    onOpen={() => onAddOpenChange(true)}
                  />
                </aside>
              </div>
            ) : (
              <EmptyState
                icon={<Receipt className="h-10 w-10" />}
                headline="No receipts yet"
                subtext="The crew hasn't logged any receipts yet."
              />
            )
          ) : (
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
                      <div className="flex items-baseline gap-2">
                        <p className="truncate text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                          {expense.title}
                        </p>
                        {expense.date && (
                          <span className="flex-shrink-0 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                            {new Date(expense.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-2 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                        <span>Paid by {memberName(members, expense.paid_by_user_id)}</span>
                        <span>split {activeSplitCount} ways</span>
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
          )}
        </div>

        {/* ── Right: balances ──────────────────────────────────────────── */}
        {/* Only render when there's at least one receipt to balance —
            otherwise the column is just a "Balances appear once receipts
            are added" placeholder, which is noise. alignSelf start keeps
            the panel pinned at the top while the left column grows. */}
        {hasExpenses && (
          <div style={{ alignSelf: "start" }}>
            <h2
              className="mb-2 text-xs font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              Balances
            </h2>
            {balanceRows.length > 0 ? (
              <div
                className="rounded-xl overflow-hidden"
                style={{ border: "1px solid var(--color-bt-border)" }}
              >
                {balanceRows.map((m, i) => {
                  const bal = balances.get(m.user_id) ?? 0;
                  const isCurrentUser = m.user_id === currentUser?.id;
                  return (
                    <div
                      key={m.user_id}
                      className="flex items-center justify-between px-3 py-2.5"
                      style={{
                        background: i % 2 === 0
                          ? "var(--color-bt-card)"
                          : isDark ? "rgba(255,255,255,0.025)" : "rgba(0,0,0,0.018)",
                        borderBottom: i < balanceRows.length - 1
                          ? "1px solid var(--color-bt-border)"
                          : undefined,
                      }}
                    >
                      <span className="text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                        {memberName(members, m.user_id)}
                        {isCurrentUser && (
                          <span className="ml-1 text-xs font-normal" style={{ color: "var(--color-bt-text-dim)" }}>(you)</span>
                        )}
                      </span>
                      <span className="text-sm font-semibold tabular-nums" style={{ color: bal > 0 ? "var(--color-bt-accent)" : "var(--color-bt-danger)" }}>
                        {bal > 0 ? `+$${bal.toFixed(2)}` : `-$${Math.abs(bal).toFixed(2)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
                All settled up 🎉
              </p>
            )}
          </div>
        )}

      </div>

      {/* ── Add Expense Modal ─────────────────────────────────────────── */}
      {addOpen && (
        <AddExpenseModal
          tripId={tripId}
          members={members}
          onClose={() => onAddOpenChange(false)}
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
    </>
  );
}
