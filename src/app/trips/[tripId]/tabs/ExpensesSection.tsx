"use client";

import { useState } from "react";
import {
  DollarSign,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Avatar } from "@/components/Avatar";
import { SampleHeader, SampleCard } from "@/components/SampleSection";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { trpc } from "@/lib/trpc-client";
import { EditExpenseModal } from "./EditExpenseModal";
import { AddExpenseModal } from "./AddExpenseModal";

// ── Types ────────────────────────────────────────────────────────────────

export interface ExpenseMember {
  user_id: string;
  role?: string | null;
  isGuest?: boolean;
  displayName?: string | null;
  user?: { id: string; name?: string | null; email?: string | null; avatar_icon?: string | null } | null;
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
  disabled = false,
  "data-testid": testId,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
}) {
  return (
    <div
      className={`relative flex items-center rounded-lg border ${className}`}
      style={{
        background: "var(--color-bt-card)",
        borderColor: "var(--color-bt-border)",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        className="pointer-events-none pl-3 font-mono text-sm"
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
        disabled={disabled}
        className="min-w-0 flex-1 bg-transparent py-2 pl-1 pr-3 text-right font-mono text-sm outline-none disabled:cursor-not-allowed"
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

      {/* Trailing action — faithfully previews a real row, which now
          exposes just the opt-in/out control inline. Edit and delete
          moved into the tap-to-open editor, so the sample drops them too. */}
      <div className="flex items-center" style={{ color: "var(--color-bt-text-dim)" }}>
        <span className="flex h-6 w-6 items-center justify-center rounded-full">
          <UserMinus size={13} />
        </span>
      </div>
    </div>
  );
}

// ── ReceiptLegend ────────────────────────────────────────────────────────
// Explains the opt-in / opt-out icons that appear on each receipt row.
// Wide layout: full card pinned to the top of the balances column.
// Mirrors the Crew tab's StatusLegend so the two tabs feel consistent.

const RECEIPT_LEGEND_ROWS = [
  {
    key: "out",
    icon: UserMinus,
    label: "Opt out",
    // Matches the receipt row: opt-out is the quiet gray action.
    color: "var(--color-bt-text-dim)",
    body: "You're in this split. Tap to drop yourself from a receipt you didn't share in — your share gets spread across everyone else.",
  },
  {
    key: "in",
    icon: UserPlus,
    label: "Opt in",
    // Matches the receipt row: rejoin is teal to invite you back in.
    color: "var(--color-bt-accent)",
    body: "You've opted out. Tap to rejoin the split and take your share again.",
  },
] as const;

function ReceiptLegend() {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: "var(--color-bt-card)",
        border: "1px solid var(--color-bt-border)",
      }}
    >
      <div
        className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em]"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        What these mean
      </div>
      <div className="space-y-2.5 text-[11px]" style={{ color: "var(--color-bt-text)" }}>
        {RECEIPT_LEGEND_ROWS.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.key} className="flex items-start gap-2.5">
              <span
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: "var(--color-bt-card-raised)",
                  border: "1px solid var(--color-bt-border)",
                  color: r.color,
                }}
                aria-hidden
              >
                <Icon size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{r.label}</div>
                <div className="leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
                  {r.body}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── CompactReceiptLegend ──────────────────────────────────────────────────
// Single-row variant rendered below the receipts list at narrow widths
// where the balances column has stacked underneath. Same morph behavior
// as the Crew tab's CompactStatusLegend.

function CompactReceiptLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]"
      style={{ color: "var(--color-bt-text)" }}
    >
      {RECEIPT_LEGEND_ROWS.map((r) => {
        const Icon = r.icon;
        return (
          <span key={r.key} className="inline-flex items-center gap-1.5">
            <Icon
              size={13}
              className="flex-shrink-0"
              style={{ color: r.color }}
              aria-hidden
            />
            <span className="font-semibold">{r.label}</span>
          </span>
        );
      })}
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
  tripId,
  members,
  currentUserId,
  onOpenFull,
  variant = "rail",
}: {
  tripId: string;
  members: ExpenseMember[];
  currentUserId: string | null | undefined;
  /** Optional escape hatch — opens the full AddExpenseModal for cases
   *  the inline composer can't handle (>6 crew, per-user split amounts,
   *  etc.). Rendered as a small "More options →" link below the hint. */
  onOpenFull: () => void;
  /**
   * "rail" (default) — full chrome: accent-bordered card, raised shadow,
   *   internal padding, uppercase eyebrow row.
   * "sheet" — chrome stripped. Inputs sit directly on the mobile bottom
   *   sheet's card-float surface, which already supplies framing and a
   *   title bar above the form, so the composer's own card would read
   *   as a nested duplicate.
   */
  variant?: "rail" | "sheet";
}) {
  const utils = trpc.useUtils();
  const me = members.find((m) => m.user_id === currentUserId);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<string>(
    me?.user_id ?? members[0]?.user_id ?? ""
  );
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const create = trpc.expenses.create.useMutation({
    onMutate() {
      setError(null);
    },
    onSuccess() {
      setTitle("");
      setAmount("");
      setExcluded(new Set());
      utils.expenses.list.invalidate({ tripId });
    },
    onError(err) {
      setError(err.message);
    },
  });

  const inputBase = {
    background: "var(--color-bt-card-raised)",
    borderColor: "var(--color-bt-border)",
    color: "var(--color-bt-text)",
  };

  // Cap pill rendering to first ~6 members so wide crews don't blow
  // out the rail. Anyone beyond that gets routed to the full modal
  // via the "More options" link.
  const pillCrew = members.slice(0, 6);
  const hasOverflow = members.length > pillCrew.length;

  const parsedAmount = (() => {
    const cleaned = amount.replace(/[^0-9.]/g, "");
    const n = parseFloat(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const canSubmit =
    title.trim().length > 0 &&
    parsedAmount !== null &&
    !!paidBy &&
    !create.isPending;

  const togglePill = (uid: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!canSubmit || parsedAmount === null) return;
    const included = members.filter((m) => !excluded.has(m.user_id));
    if (included.length === 0) {
      setError("Need at least one person in the split.");
      return;
    }
    create.mutate({
      tripId,
      id: crypto.randomUUID(),
      title: title.trim(),
      amount: parsedAmount,
      paidByUserId: paidBy,
      splitAmong: included.map((m) => ({ userId: m.user_id })),
    });
  };

  const isSheet = variant === "sheet";

  return (
    <div
      className={
        isSheet
          ? "flex flex-col gap-2.5"
          : "flex flex-col gap-2.5 rounded-xl p-4"
      }
      style={
        isSheet
          ? undefined
          : {
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-accent-border)",
              boxShadow: "var(--shadow-raised)",
            }
      }
    >
      {!isSheet && (
        <div
          className="text-[11px] font-bold uppercase tracking-[0.12em]"
          style={{ color: "var(--color-bt-accent)" }}
        >
          Add your first receipt
        </div>
      )}

      <input
        type="text"
        placeholder="Title (e.g. Steak dinner)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        className="w-full rounded-lg border px-2.5 py-2 text-[13px] outline-none"
        style={inputBase}
      />

      <div className="flex gap-1.5">
        <input
          type="text"
          inputMode="decimal"
          placeholder="$0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          className="min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-right font-mono text-[13px] outline-none"
          style={inputBase}
        />
        <select
          value={paidBy}
          onChange={(e) => setPaidBy(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-[13px] outline-none"
          style={inputBase}
        >
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              Paid by · {memberName(members, m.user_id)}
            </option>
          ))}
        </select>
      </div>

      <div className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
        Split with
      </div>
      <div className="flex flex-wrap gap-1">
        {pillCrew.map((m) => {
          const name = memberName(members, m.user_id);
          const out = excluded.has(m.user_id);
          return (
            <button
              key={m.user_id}
              type="button"
              onClick={() => togglePill(m.user_id)}
              className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-[11px] font-semibold transition-opacity"
              style={{
                background: out
                  ? "transparent"
                  : "var(--color-bt-card-raised)",
                border: out
                  ? "0.5px dashed var(--color-bt-border)"
                  : "0.5px solid var(--color-bt-accent-border)",
                color: out
                  ? "var(--color-bt-text-dim)"
                  : "var(--color-bt-text)",
                opacity: out ? 0.6 : 1,
              }}
              title={out ? `Add ${name} back to the split` : `Toggle ${name} out of the split`}
            >
              {/* The real member avatar (Tabler icon / initials), not a
                  hand-rolled circle — matches avatars everywhere else. */}
              <Avatar
                name={name}
                avatarIcon={m.user?.avatar_icon ?? null}
                sizePx={18}
                accent={!out}
                muted={out}
              />
              {name.split(/\s+/)[0]}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="mt-1 rounded-lg py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          background: "var(--color-bt-accent)",
          color: "var(--color-bt-on-accent)",
        }}
      >
        {create.isPending ? "Adding…" : "Add receipt"}
      </button>

      {error && (
        <p
          className="text-[11px] leading-snug"
          style={{ color: "var(--color-bt-danger)" }}
        >
          {error}
        </p>
      )}

      <p
        className="text-[11px] leading-snug"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        Tap a crew member to toggle them out of the split.
        {hasOverflow && (
          <>
            {" "}
            <button
              type="button"
              onClick={onOpenFull}
              className="underline transition-opacity hover:opacity-80"
              style={{
                color: "var(--color-bt-accent)",
                background: "none",
                border: "none",
                padding: 0,
                font: "inherit",
                cursor: "pointer",
              }}
            >
              More options
            </button>{" "}
            for a per-person split.
          </>
        )}
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
  // `isLoading` is true only on the very first fetch with no cached data;
  // revisiting the tab reads from cache and renders instantly. We gate the
  // empty/populated decision on it so the empty state never flashes before
  // the receipts arrive (the list isn't prefetched at the page level).
  const { data: expenses = [], isLoading } = trpc.expenses.list.useQuery({ tripId });

  // ── Mutations ──
  // Deleting a receipt now lives inside EditExpenseModal (tap a row to
  // open it), so the section itself no longer needs a remove mutation.
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
  const ROLE_ORDER: Record<string, number> = { Owner: 0, Organizer: 1, Member: 2 };
  // Show every current crew member — including anyone added after the
  // receipts were logged (they sit at $0.00 until a split pulls them
  // in). Previously this filtered to members with a non-zero balance,
  // so a freshly-added member never appeared until their first receipt.
  // Matches the empty-state BalancesPreview, which already lists
  // everyone at $0.00.
  const balanceRows = [...members].sort((a, b) => {
    const aOrder = ROLE_ORDER[a.role ?? "Member"] ?? 2;
    const bOrder = ROLE_ORDER[b.role ?? "Member"] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1;
    return memberName(members, a.user_id).localeCompare(memberName(members, b.user_id));
  });

  // While the first fetch is in flight we can't yet tell empty from
  // populated, so show a couple of faded placeholder rows instead of
  // flashing the empty-state composer (which then snaps to the real
  // list a beat later).
  if (isLoading) {
    return (
      <div className="space-y-2" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[58px] animate-pulse rounded-xl"
            style={{
              background: "var(--color-bt-card)",
              border: "1px solid var(--color-bt-border)",
            }}
          />
        ))}
      </div>
    );
  }

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
            ? "grid gap-4 min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
            : ""
        }
      >

        {/* ── Left: receipt list (add affordance lives in the parent
            TabHeader / TabFab, not inline here) ─────────────────────── */}
        <div className="space-y-3">
          {!hasExpenses ? (
            // Any member can log a receipt (expenses.create is
            // requireTripMember, not Organizer), so the composer empty
            // state shows for everyone — no read-only EmptyState fork.
            // Empty-state grid — just the sample + composer. Balances
            // are hidden until there's an actual receipt to balance
            // (the live BALANCES panel shows in the populated state).
            //   lg+   [ sample (1fr) | composer (300px) ]  composer right
            //   md–lg  sample on top, composer below it
            //   <md   sample only; composer hidden (TabFab adds).
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                {/* Sample — "how a receipt will look". Fills the full
                    width of its column (no max-width cap) so the example
                    receipt spans the left column. */}
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
                </div>

                {/* Composer — top-right rail at lg, stacks under the
                    sample below lg. Hidden on phones (<md); the TabFab
                    is the mobile add affordance. */}
                <aside className="hidden md:block" style={{ maxWidth: 540 }}>
                  <AddReceiptFullComposer
                    tripId={tripId}
                    members={members}
                    currentUserId={currentUser?.id}
                    onOpenFull={() => onAddOpenChange(true)}
                  />
                </aside>
              </div>
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
                const paidByYou = !!currentUser && expense.paid_by_user_id === currentUser.id;

                return (
                  <div
                    key={expense.id}
                    data-testid={`expense-row-${expense.id}`}
                    // Whole row is the edit affordance (canEdit = Owner or
                    // Organizer). Tap opens the editor where splits/fields are
                    // changed and the receipt can be deleted — no inline
                    // pencil/trash clutter. A native drag never fires click,
                    // and the opt-out button stops propagation, so neither
                    // collides with the row tap.
                    onClick={canEdit ? () => setEditingExpense(expense) : undefined}
                    role={canEdit ? "button" : undefined}
                    tabIndex={canEdit ? 0 : undefined}
                    onKeyDown={
                      canEdit
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setEditingExpense(expense);
                            }
                          }
                        : undefined
                    }
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                      canEdit
                        ? "cursor-pointer transition-shadow hover:shadow-[0_0_0_1px_var(--color-bt-accent-border)]"
                        : ""
                    }`}
                    style={{
                      background: isOptedOut ? "var(--color-bt-base)" : "var(--color-bt-card)",
                      border: "1px solid var(--color-bt-border)",
                      // Teal left accent marks receipts you paid for — a
                      // highlight, not a fill (STYLE_GUIDE: teal fills are
                      // reserved for Primary buttons). 3px so it reads at
                      // a glance down the list.
                      borderLeft: paidByYou
                        ? "3px solid var(--color-bt-accent)"
                        : "1px solid var(--color-bt-border)",
                    }}
                  >
                    {/* Content group — dimmed when opted out. The action
                        buttons live OUTSIDE this wrapper so the opt-in
                        button stays full opacity (opacity on a parent
                        can't be undone by a child). */}
                    <div
                      className="flex min-w-0 flex-1 items-center gap-3"
                      style={{ opacity: isOptedOut ? 0.55 : 1 }}
                    >
                      <DollarSign size={14} className="flex-shrink-0" style={{ color: "var(--color-bt-accent)" }} />
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
                        <div className="flex flex-wrap items-center gap-x-1.5 text-xs" style={{ color: "var(--color-bt-text-dim)" }}>
                          <span>
                            Paid by{" "}
                            <span style={{ color: "var(--color-bt-text)" }}>
                              {paidByYou ? "you" : memberName(members, expense.paid_by_user_id)}
                            </span>
                          </span>
                          <span aria-hidden>·</span>
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
                    </div>
                    {userSplit && (
                      <button
                        onClick={(e) => {
                          // Keep the opt-out tap from bubbling to the row's
                          // edit handler.
                          e.stopPropagation();
                          optOutMutation.mutate({
                            tripId,
                            expenseId: expense.id,
                            optOut: !isOptedOut,
                          });
                        }}
                        disabled={optOutMutation.isPending}
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-70 disabled:opacity-40"
                        // Opt out (you're in) reads as a quiet gray action;
                        // rejoin (you're out) is teal to invite you back in.
                        // The legend mirrors these two colors exactly.
                        style={{ color: isOptedOut ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
                        title={isOptedOut ? "Rejoin" : "Opt out"}
                      >
                        {isOptedOut ? <UserPlus size={13} /> : <UserMinus size={13} />}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Compact opt-in/out legend — only below 640px (true mobile),
              where the legend panel collapses to text. Between 640 and
              900 the full legend panel sits beside Balances under the
              receipts; at ≥900 it moves into the right rail. Morphs to
              icon + label like the Crew tab. */}
          {hasExpenses && (
            <div className="min-[640px]:hidden pt-1">
              <CompactReceiptLegend />
            </div>
          )}
        </div>

        {/* ── Right: legend + balances ─────────────────────────────────── */}
        {/* Only render when there's at least one receipt to balance —
            otherwise the column is just a "Balances appear once receipts
            are added" placeholder, which is noise. alignSelf start keeps
            the panel pinned at the top while the left column grows. */}
        {hasExpenses && (
          <aside
            style={{ alignSelf: "start" }}
            className={[
              // Right rail — legend + balances. Three states, mirroring
              // the Crew tab's stacked-rail morph:
              //   <640   single column; legend collapses to the compact
              //          text under the receipts (hidden here), balances
              //          full width below.
              //   640-899 two side-by-side panels under the receipts
              //          (legend | balances).
              //   ≥900   stacked in the narrow right rail track of the
              //          main grid (legend panel on top, balances below).
              // Arbitrary min-[…] variants on both edges so Tailwind v4
              // sorts the cascade numerically.
              "grid gap-4",
              "min-[640px]:grid-cols-2",
              "min-[900px]:flex min-[900px]:flex-col",
            ].join(" ")}
          >
            {/* Full opt-in/out legend panel — shown at ≥640. Below that
                the CompactReceiptLegend under the receipts takes over. */}
            <div className="hidden min-[640px]:block">
              <ReceiptLegend />
            </div>

            <div>
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
                      <span className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: "var(--color-bt-text)" }}>
                        {/* Reused member avatar (Tabler icon / initials) beside the
                            name — matches the split-toggle avatars above (W4-5). */}
                        <Avatar
                          name={memberName(members, m.user_id)}
                          avatarIcon={m.user?.avatar_icon ?? null}
                          sizePx={22}
                        />
                        <span className="truncate">
                          {memberName(members, m.user_id)}
                          {isCurrentUser && (
                            <span className="ml-1 text-xs font-normal" style={{ color: "var(--color-bt-text-dim)" }}>(you)</span>
                          )}
                        </span>
                      </span>
                      <span
                        className="text-sm font-semibold tabular-nums"
                        style={{
                          color:
                            Math.abs(bal) < 0.01
                              ? "var(--color-bt-text-dim)"
                              : bal > 0
                                ? "var(--color-bt-accent)"
                                : "var(--color-bt-danger)",
                        }}
                      >
                        {Math.abs(bal) < 0.01
                          ? "$0.00"
                          : bal > 0
                            ? `+$${bal.toFixed(2)}`
                            : `-$${Math.abs(bal).toFixed(2)}`}
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
          </aside>
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
          isOwner={isOwner}
          canDelete={canEdit}
          onClose={() => setEditingExpense(null)}
        />
      )}
    </>
  );
}
