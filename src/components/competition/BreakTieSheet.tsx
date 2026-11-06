"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import { ReorderableList } from "@/components/ReorderableList";
import { Sheet } from "@/components/Sheet";
import { TeamBadge } from "@/components/TeamBadge";
import type { SharedTie } from "@/lib/needsAttention";
import { invalidateGameBoards } from "@/lib/gameBoardInvalidation";
import { trpc } from "@/lib/trpc-client";
import { CLINCH_STORY_WORD as WORD, ordinalShort } from "@/lib/vocabulary";

/**
 * Break one tie at Final (docs/CLINCH_AND_PODIUM.md §5). Nothing waits on it: a tie
 * left alone stays shared, so Keep it shared saves nothing.
 */
export function BreakTieSheet({
  tie,
  tripId,
  competitionId,
  onClose,
}: {
  tie: SharedTie;
  tripId: string;
  competitionId: string;
  onClose: () => void;
}) {
  const [order, setOrder] = useState(() => tie.units.map((u) => u.id));
  const utils = trpc.useUtils();
  const save = trpc.competitions.setTiebreakOrder.useMutation({
    onSuccess: () => {
      invalidateGameBoards(utils, { tripId, competitionId });
      onClose();
    },
  });
  const place = ordinalShort(tie.place);
  const unitOf = (id: string) => tie.units.find((u) => u.id === id);

  return (
    <Sheet
      title={WORD.breakTieTitle(place)}
      onClose={onClose}
      testId="break-tie-sheet"
      footer={
        <div className="flex flex-col gap-2 p-4">
          {save.error && (
            <p className="text-[12.5px]" style={{ color: "var(--color-bt-danger)" }} data-testid="break-tie-error">
              {save.error.message}
            </p>
          )}
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate({ tripId, competitionId, order })}
            className="w-full rounded-lg px-6 py-3 text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)" }}
            data-testid="break-tie-save"
          >
            {WORD.saveOrder}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg px-6 py-3 text-sm font-semibold"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)" }}
            data-testid="break-tie-keep"
          >
            {WORD.keepShared}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-[13px]" style={{ color: "var(--color-bt-text-dim)" }}>
        {WORD.breakTieBody(place)}
      </p>
      <ReorderableList
        ids={order}
        controlsSide="trailing"
        labelOf={(id) => unitOf(id)?.name ?? ""}
        onReorder={setOrder}
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
    </Sheet>
  );
}
