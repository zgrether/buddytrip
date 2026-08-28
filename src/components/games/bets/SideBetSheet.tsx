"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { FieldLabel } from "@/components/games/FieldChrome";
import { buildManualPress, formatMoney, type BetSide, type SideBet, type SideBetsResult } from "@/lib/sideBets";
import { BetForm, BetList, freshBetDraft } from "@/components/games/bets/betControls";
import type { BetDraft } from "@/lib/betDraft";
import type { Participant } from "@/components/games/types";

/**
 * The side-bet breakdown — behind the strip's tap, never expanded by default
 * (§6/§9): three concurrent bets is a table, and a table is not glanceable.
 *
 * Holds four things, in the order they get asked about: what each bet is doing,
 * who owes whom, the hole-by-hole money history (which the derived design gives
 * away for free — scroll back and see where it went wrong), and the form for
 * starting another bet.
 *
 * Persistence-agnostic (CLAUDE.md #7): every figure is a prop already derived by
 * `sideBets.ts`, and every change leaves by a callback. It knows nothing about
 * local storage — the same split that lets `ScoreEntryView` back a trip game and
 * a Quick round with one component.
 */
export function SideBetSheet({
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
  onClose,
}: {
  players: Participant[];
  result: SideBetsResult;
  /** Ids of the bets that were WRITTEN DOWN. A derived press has no row to
   *  delete — it exists because the rule fired, and removing it would mean
   *  editing history rather than a decision. */
  recordedBetIds: string[];
  /** A match round's sides are the match's; see `quickBetSidesLocked`. */
  sidesLocked: boolean;
  lockedSides: BetSide[];
  holeCount: number;
  currentHole: number;
  nassauAvailable: boolean;
  perspectivePlayerId: string | null;
  sideName: (side: BetSide) => string;
  onAdd: (bets: SideBet[]) => void;
  onRemove: (betId: string) => void;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(result.bets.length === 0);
  const freshDraft = () => freshBetDraft(players, currentHole);
  const [draft, setDraft] = useState<BetDraft>(freshDraft);

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name.split(/\s+/)[0] ?? "Player";

  /**
   * A press starts on the hole you are about to play — the first one not yet
   * decided — because that is when it gets agreed, on the tee. An automatic
   * press differs (`makePressBet` adds one to its trigger) because its rule
   * fires on a hole that is already in the books.
   */
  const pressFromHole = result.playedThrough + 1;
  const press = (parent: SideBet) => {
    onAdd([
      buildManualPress({
        parent,
        fromHole: pressFromHole,
        mkId: () => `press-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      }),
    ]);
  };

  const commit = (bets: SideBet[]) => {
    onAdd(bets);
    setCreating(false);
    setDraft(freshDraft());
  };

  return (
    <Sheet
      title="Side bets"
      subtitle={`${formatMoney(result.exposure.perHole)}/hole · ${result.exposure.liveBetCount} live`}
      onClose={onClose}
      testId="side-bet-sheet"
    >
      {/* The per-player "Showing" switcher used to sit here. Removed: it read
          as unexplained tabs, and at the two players a Quick round usually has
          it is a choice between one answer and its negative. The banner still
          reads from a perspective — it just defaults to the first player and
          is no longer a control (#1083). */}

      {/* ── The bets ── */}
      {result.bets.length > 0 && (
        <div className="mb-4">
          <FieldLabel>Bets</FieldLabel>
          <BetList
            result={result}
            recordedBetIds={recordedBetIds}
            holeCount={holeCount}
            perspectivePlayerId={perspectivePlayerId}
            sideName={sideName}
            onRemove={onRemove}
            onPress={press}
            pressFromHole={pressFromHole}
          />
        </div>
      )}

      {/* ── Who owes whom — the settlement line (§6). ── */}
      {result.settlement.length > 0 && (
        <div className="mb-4">
          <FieldLabel>Where it stands</FieldLabel>
          <div
            className="rounded-[11px] px-3 py-2.5"
            style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
          >
            {result.settlement.map((s) => (
              <div
                key={`${s.fromPlayerId}:${s.toPlayerId}`}
                data-testid="side-bet-settlement"
                style={{ fontSize: 14, color: "var(--color-bt-text)" }}
              >
                <strong>{nameOf(s.fromPlayerId)}</strong> owes <strong>{nameOf(s.toPlayerId)}</strong>{" "}
                {formatMoney(s.amount)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Add a bet ── */}
      {creating ? (
        <BetForm
          players={players}
          draft={draft}
          setDraft={setDraft}
          sidesLocked={sidesLocked}
          lockedSides={lockedSides}
          holeCount={holeCount}
          nassauAvailable={nassauAvailable}
          sideName={sideName}
          onCancel={result.bets.length === 0 ? onClose : () => setCreating(false)}
          onCommit={commit}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(freshDraft());
            setCreating(true);
          }}
          data-testid="side-bet-add"
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-[11px] py-3"
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
    </Sheet>
  );
}

/**
 * The create form. Every answer §2 says a bet holds — sides, stakes, rules, a
 * start hole — and nothing else: there is no end-hole question, because a bet
 * runs to the end of the round (§2/§3.3).
 *
 * Validation lives in `betDraft.ts`, not here, so what the form refuses is
 * asserted against the rule rather than against a disabled attribute.
 */
