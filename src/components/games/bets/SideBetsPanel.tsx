"use client";

import { useState } from "react";
import { Banknote, ChevronDown, Plus } from "lucide-react";
import { formatMoney, type BetSide, type SideBet, type SideBetsResult } from "@/lib/sideBets";
import { BetForm, BetList, freshBetDraft } from "@/components/games/bets/betControls";
import type { BetDraft } from "@/lib/betDraft";
import type { Participant } from "@/components/games/types";

/**
 * Side bets as a COLLAPSIBLE SECTION of the setup / settings modal, rather
 * than a modal of its own behind a nav row.
 *
 * Agreeing a bet is part of agreeing the round — same conversation, same
 * moment — so it belongs beside the roster and the course, not one level
 * deeper. The nav row this replaces cost a tap to reach a screen, a tap to
 * come back, and left the modal you were filling in sitting behind it.
 *
 * Collapsed by DEFAULT when the round already has bets, because the summary
 * line answers the common question ("what's riding on this?") without
 * expanding. Open by default when there are none and the group is big enough
 * to have one, since an empty collapsed section reads as nothing to see.
 *
 * The controls themselves are `betControls` — shared verbatim with
 * `SideBetSheet`, which is still the in-round breakdown behind the money
 * strip. Two homes, one implementation, so the list cannot describe a bet one
 * way here and another way there.
 */
export function SideBetsPanel({
  players,
  result,
  recordedBetIds,
  sidesLocked,
  lockedSides,
  holeCount,
  currentHole,
  nassauAvailable,
  perspectivePlayerId,
  sideName,
  onAdd,
  onRemove,
}: {
  players: Participant[];
  result: SideBetsResult;
  recordedBetIds: string[];
  sidesLocked: boolean;
  lockedSides: BetSide[];
  holeCount: number;
  currentHole: number;
  nassauAvailable: boolean;
  perspectivePlayerId: string | null;
  sideName: (side: BetSide) => string;
  onAdd: (bets: SideBet[]) => void;
  onRemove: (betId: string) => void;
}) {
  const hasBets = result.bets.length > 0;
  const [open, setOpen] = useState(!hasBets);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<BetDraft>(() => freshBetDraft(players, currentHole));

  const commit = (bets: SideBet[]) => {
    onAdd(bets);
    setCreating(false);
    setDraft(freshBetDraft(players, currentHole));
  };

  /** The one line worth reading without expanding. "None yet" rather than a
   *  zero: $0/hole is a real state a bet can be in, and this is the absence
   *  of any. */
  const summary = hasBets
    ? `${formatMoney(result.exposure.perHole)}/hole · ${result.exposure.liveBetCount} live`
    : "None yet";

  return (
    <div
      className="mt-4 overflow-hidden rounded-[11px]"
      style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}
      data-testid="side-bets-panel"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="side-bets-panel-toggle"
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)]"
      >
        <span
          className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
        >
          <Banknote size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
            Side Bets
          </span>
          <span className="mt-0.5 block text-xs leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>
            {summary}
          </span>
        </span>
        <ChevronDown
          size={17}
          className="flex-shrink-0 transition-transform"
          style={{ color: "var(--color-bt-text-dim)", transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>

      {open && (
        <div className="px-3 pb-3" style={{ borderTop: "1px solid var(--color-bt-subtle-border)" }}>
          {hasBets && (
            <div className="mt-3">
              <BetList
                result={result}
                recordedBetIds={recordedBetIds}
                holeCount={holeCount}
                perspectivePlayerId={perspectivePlayerId}
                sideName={sideName}
                onRemove={onRemove}
              />
            </div>
          )}

          {creating ? (
            <div className="mt-3">
              <BetForm
                players={players}
                draft={draft}
                setDraft={setDraft}
                sidesLocked={sidesLocked}
                lockedSides={lockedSides}
                holeCount={holeCount}
                nassauAvailable={nassauAvailable}
                sideName={sideName}
                onCancel={() => setCreating(false)}
                onCommit={commit}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(freshBetDraft(players, currentHole));
                setCreating(true);
              }}
              data-testid="side-bets-panel-add"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-[11px] py-3"
              style={{
                background: "var(--color-bt-accent-faint)",
                border: "1px solid var(--color-bt-accent-border)",
                color: "var(--color-bt-accent)",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              <Plus size={16} /> Add a bet
            </button>
          )}
        </div>
      )}
    </div>
  );
}
