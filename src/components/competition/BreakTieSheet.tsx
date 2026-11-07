"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { ReorderableList } from "@/components/ReorderableList";
import { Sheet } from "@/components/Sheet";
import { TeamBadge } from "@/components/TeamBadge";
import type { SharedTie } from "@/lib/needsAttention";
import { invalidateGameBoards } from "@/lib/gameBoardInvalidation";
import { trpc } from "@/lib/trpc-client";
import { CLINCH_STORY_WORD as WORD, ordinalShort } from "@/lib/vocabulary";

/**
 * The tiebreak order to save. One tie: the order on screen, moved or not.
 * Several: a tie left alone stays shared, so only the ones that were moved count.
 */
export function orderToSave(ties: readonly SharedTie[], orders: Readonly<Record<number, string[]>>, moved: ReadonlySet<number>): string[] {
  return ties.filter((t) => ties.length === 1 || moved.has(t.place)).flatMap((t) => orders[t.place]);
}

/** One tie is "Tied for 1st"; several are "Ties", each its own section (v2.8). */
export function tieSheetTitle(ties: readonly SharedTie[]): string {
  return ties.length === 1 ? WORD.tiedFor(ordinalShort(ties[0].place)) : WORD.ties;
}

/** The orders on screen, and which ties a person has moved. A tie already ordered counts as moved. */
export function useTieOrders(ties: readonly SharedTie[]) {
  const [orders, setOrders] = useState<Record<number, string[]>>(() => Object.fromEntries(ties.map((t) => [t.place, t.units.map((u) => u.id)])));
  const [moved, setMoved] = useState<ReadonlySet<number>>(() => new Set(ties.filter((t) => t.ordered).map((t) => t.place)));
  const reorder = (place: number, next: string[]) => {
    setOrders((o) => ({ ...o, [place]: next }));
    setMoved((m) => new Set(m).add(place));
  };
  // A tie that appeared since the sheet opened has no order yet: it reads as shown.
  const current = Object.fromEntries(ties.map((t) => [t.place, orders[t.place] ?? t.units.map((u) => u.id)]));
  return { orders: current, reorder, order: orderToSave(ties, current, moved) };
}

/** The body both tie sheets share: the line, then a draggable list per tie. */
export function TieOrderBody({
  ties,
  orders,
  onReorder,
}: {
  ties: readonly SharedTie[];
  orders: Readonly<Record<number, string[]>>;
  onReorder: (place: number, next: string[]) => void;
}) {
  const one = ties.length === 1;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px]" style={{ color: "var(--color-bt-text-dim)" }} data-testid="tie-body">
        {WORD.tieBody}
      </p>
      {ties.map((tie) => {
        const unitOf = (id: string) => tie.units.find((u) => u.id === id);
        return (
          <section key={tie.place} data-testid={`break-tie-group-${tie.place}`}>
            {!one && (
              <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                {WORD.tiedFor(ordinalShort(tie.place))}
              </h3>
            )}
            <ReorderableList
              ids={orders[tie.place]}
              controlsSide="trailing"
              labelOf={(id) => unitOf(id)?.name ?? ""}
              onReorder={(next) => onReorder(tie.place, next)}
              renderRow={(id, index) => {
                const unit = unitOf(id);
                if (!unit) return null;
                return (
                  <span
                    className="flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2"
                    style={{ background: "var(--color-bt-card-raised)" }}
                    data-testid={`break-tie-row-${id}`}
                  >
                    <span className="w-7 shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
                      {ordinalShort(tie.place + index)}
                    </span>
                    {unit.color ? (
                      <TeamBadge teamId={unit.id} name={unit.name} shortName={unit.shortName} color={unit.color} size={24} />
                    ) : (
                      <Avatar name={unit.name} sizePx={24} />
                    )}
                    <span className="min-w-0 truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
                      {unit.name}
                    </span>
                  </span>
                );
              }}
            />
          </section>
        );
      })}
    </div>
  );
}

/**
 * A full-width sheet button in the app's loading state (STYLE_GUIDE "Button
 * states"): while its save is in flight the spinner leads, the text stays, and it
 * is disabled.
 */
export function SheetButton({
  primary = false,
  pending = false,
  disabled = false,
  onClick,
  testId,
  children,
}: {
  primary?: boolean;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold disabled:opacity-40"
      style={
        primary
          ? { background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }
          : { background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }
      }
      data-testid={testId}
      aria-busy={pending || undefined}
    >
      {pending && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** The tie step's two answers. Both are a decision, and both are saved. */
export function TieFooter({
  order,
  pending,
  error,
  onUse,
  onKeep,
}: {
  order: readonly string[];
  pending: "use" | "keep" | null;
  error: string | null;
  onUse: () => void;
  onKeep: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p className="text-[12.5px]" style={{ color: "var(--color-bt-danger)" }} data-testid="break-tie-error">
          {error}
        </p>
      )}
      <SheetButton primary pending={pending === "use"} disabled={pending != null || order.length === 0} onClick={onUse} testId="break-tie-save">
        {WORD.useThisOrder}
      </SheetButton>
      <SheetButton pending={pending === "keep"} disabled={pending != null} onClick={onKeep} testId="break-tie-keep">
        {WORD.keepItATie}
      </SheetButton>
    </div>
  );
}

/**
 * The ties at Final, opened from Needs attention or ⚙ Tiebreaks (spec §5): an
 * optional follow-up for a tiebreaker played later. Nothing waits on it.
 */
export function BreakTieSheet({
  ties,
  tripId,
  competitionId,
  onClose,
}: {
  ties: SharedTie[];
  tripId: string;
  competitionId: string;
  onClose: () => void;
}) {
  const { orders, reorder, order } = useTieOrders(ties);
  const [pending, setPending] = useState<"use" | "keep" | null>(null);
  const utils = trpc.useUtils();
  const save = trpc.competitions.setTiebreakOrder.useMutation({
    onSuccess: () => {
      invalidateGameBoards(utils, { tripId, competitionId });
      onClose();
    },
    onSettled: () => setPending(null),
  });

  return (
    <Sheet
      title={tieSheetTitle(ties)}
      onClose={onClose}
      testId="break-tie-sheet"
      footer={
        <TieFooter
          order={order}
          pending={pending}
          error={save.error?.message ?? null}
          onUse={() => {
            setPending("use");
            save.mutate({ tripId, competitionId, order });
          }}
          onKeep={() => {
            setPending("keep");
            save.mutate({ tripId, competitionId, order: [] });
          }}
        />
      }
    >
      <TieOrderBody ties={ties} orders={orders} onReorder={reorder} />
    </Sheet>
  );
}
