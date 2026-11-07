"use client";

import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import type { SharedTie } from "@/lib/needsAttention";
import { invalidateGameBoards } from "@/lib/gameBoardInvalidation";
import { trpc } from "@/lib/trpc-client";
import { TYPE_SCALE } from "@/lib/typeScale";
import { CLINCH_STORY_WORD as WORD } from "@/lib/vocabulary";
import { SheetButton, TieFooter, TieOrderBody, tieSheetTitle, useTieOrders } from "./BreakTieSheet";

export type { FinishStep } from "@/lib/cupDecision";
import type { FinishStep } from "@/lib/cupDecision";
type Pending = "finish" | "use" | "keep" | null;

/**
 * The empty board's decision as it renders: the ask, or the tie step. Pure, so
 * every state is a test rather than a look at a screen.
 */
export function FinishCupSheetView({
  cupName,
  step,
  ties,
  orders,
  order,
  pending,
  error,
  onReorder,
  onGo,
  onUse,
  onKeep,
  onAddGame,
  onClose,
}: {
  cupName: string;
  step: FinishStep;
  ties: readonly SharedTie[];
  orders: Readonly<Record<number, string[]>>;
  order: readonly string[];
  pending: Pending;
  error: string | null;
  onReorder: (place: number, next: string[]) => void;
  onGo: () => void;
  onUse: () => void;
  onKeep: () => void;
  onAddGame: () => void;
  onClose: () => void;
}) {
  // A tie can come or go while the sheet is open; the step follows the board.
  if (step === "ties" && ties.length > 0) {
    return (
      <Sheet
        title={tieSheetTitle(ties)}
        onClose={onClose}
        testId="finish-cup-sheet"
        footer={<TieFooter order={order} pending={pending === "use" || pending === "keep" ? pending : null} error={error} onUse={onUse} onKeep={onKeep} />}
      >
        <TieOrderBody ties={ties} orders={orders} onReorder={onReorder} />
      </Sheet>
    );
  }
  return (
    <Sheet
      title={cupName}
      onClose={onClose}
      testId="finish-cup-sheet"
      footer={
        <div className="flex flex-col gap-2">
          {error && (
            <p className="text-[12.5px]" style={{ color: "var(--color-bt-danger)" }} data-testid="finish-cup-error">
              {error}
            </p>
          )}
          <SheetButton primary pending={pending === "finish"} onClick={onGo} testId="finish-cup-sheet-go">
            {WORD.finishCup}
          </SheetButton>
          <SheetButton disabled={pending != null} onClick={onAddGame} testId="finish-cup-sheet-add-game">
            {WORD.addAnotherGame}
          </SheetButton>
        </div>
      }
    >
      <p style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 500, color: "var(--color-bt-text)" }} data-testid="finish-cup-question">
        {WORD.finishQuestion}
      </p>
    </Sheet>
  );
}

/**
 * The empty board's decision (spec §5, v2.8), opened for Owners and Organizers
 * on arriving at the cup. It asks whether all games are in, and if any tie is on
 * the board it moves to the tie step before declaring: the order, or a tie kept,
 * goes with the finish itself. ✕ decides nothing; the same ask waits in Needs
 * attention.
 */
export function FinishCupSheet({
  cupName,
  ties,
  tripId,
  competitionId,
  startAt = "ask",
  onClose,
  onAddGame,
  onFinished,
}: {
  cupName: string;
  ties: SharedTie[];
  tripId: string;
  competitionId: string;
  startAt?: FinishStep;
  onClose: () => void;
  onAddGame?: () => void;
  /** The cup went Final from this device. */
  onFinished: () => void;
}) {
  const [step, setStep] = useState<FinishStep>(startAt);
  const [pending, setPending] = useState<Pending>(null);
  const { orders, reorder, order } = useTieOrders(ties);
  const utils = trpc.useUtils();
  const finish = trpc.competitions.finish.useMutation({
    onSuccess: () => {
      onFinished();
      invalidateGameBoards(utils, { tripId, competitionId });
      onClose();
    },
    // A refusal means the ties moved under the sheet: read them again.
    onError: () => invalidateGameBoards(utils, { tripId, competitionId }),
    onSettled: () => setPending(null),
  });
  const run = (which: Exclude<Pending, null>, input: { order?: string[] }) => {
    setPending(which);
    finish.mutate({ tripId, competitionId, ...input });
  };

  return (
    <FinishCupSheetView
      cupName={cupName}
      step={step}
      ties={ties}
      orders={orders}
      order={order}
      pending={pending}
      error={finish.error?.message ?? null}
      onReorder={reorder}
      onGo={() => (ties.length > 0 ? setStep("ties") : run("finish", {}))}
      onUse={() => run("use", { order })}
      onKeep={() => run("keep", { order: [] })}
      onAddGame={() => {
        onClose();
        onAddGame?.();
      }}
      onClose={onClose}
    />
  );
}
