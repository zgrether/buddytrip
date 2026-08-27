"use client";

import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { FieldLabel, Segmented } from "@/components/games/FieldChrome";
import { Stepper } from "@/components/games/Stepper";
import {
  betLabel,
  betTotalForPlayer,
  formatMoney,
  formatSignedMoney,
  type BetSide,
  type SideBet,
  type SideBetsResult,
} from "@/lib/sideBets";
import {
  MIN_STAKE,
  STAKE_PRESETS,
  betDraftError,
  buildBetsFromDraft,
  canBeHeadToHead,
  emptyBetDraft,
  setBetKind,
  setPressRules,
  setWhoIsIn,
  sidesFromWhoIsIn,
  toggleWhoIsIn,
  type BetDraft,
} from "@/lib/betDraft";
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
  /** Everyone is in by default (§4 of the refinements) — the common case is
   *  the whole group, and the Everyone button that used to do this was a tap
   *  spent reaching the state you almost always wanted. Deselect to narrow.
   *  Routed through `setWhoIsIn` so the kind lands correctly: four players
   *  pre-selected means the bet opens as a pot, not a head-to-head it cannot
   *  be. */
  const freshDraft = () => setWhoIsIn(emptyBetDraft(currentHole), players.map((p) => p.id));
  const [draft, setDraft] = useState<BetDraft>(freshDraft);

  const recorded = new Set(recordedBetIds);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name.split(/\s+/)[0] ?? "Player";

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
          <div className="flex flex-col gap-1.5">
            {result.bets.map((t) => {
              const mine = betTotalForPlayer(t, perspectivePlayerId);
              const to = t.bet.endHole == null ? holeCount : t.bet.endHole;
              const rules = [
                `${formatMoney(t.bet.amount)}/hole`,
                `holes ${t.bet.startHole}–${to}`,
                t.bet.carryover ? "carryover" : null,
                t.bet.autoPressAt != null ? `auto press at ${t.bet.autoPressAt}` : null,
                t.bet.pressOnPress ? "☠️ presses on presses" : null,
              ].filter(Boolean);
              return (
                <div
                  key={t.bet.id}
                  data-testid="side-bet-row"
                  className="flex items-center gap-3 rounded-[11px] px-3 py-2.5"
                  style={{
                    background: "var(--color-bt-card)",
                    border: "1px solid var(--color-bt-border)",
                    opacity: t.started ? 1 : 0.55,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-bt-text)" }}>
                        {betLabel(t.bet)}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
                        {t.bet.sides.map(sideName).join(" v ")}
                      </span>
                      {!t.started && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-bt-text-dim)" }}>
                          · starts hole {t.bet.startHole}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5" style={{ fontSize: 12, color: "var(--color-bt-text-dim)" }}>
                      {rules.join(" · ")}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color:
                        mine > 0.004
                          ? "var(--color-bt-place-1-text)"
                          : mine < -0.004
                            ? "var(--color-bt-danger)"
                            : "var(--color-bt-text-dim)",
                    }}
                  >
                    {formatSignedMoney(mine)}
                  </span>
                  {recorded.has(t.bet.id) && (
                    <button
                      type="button"
                      onClick={() => onRemove(t.bet.id)}
                      aria-label={`Remove ${betLabel(t.bet)}`}
                      data-testid="side-bet-remove"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ color: "var(--color-bt-text-dim)" }}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
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
function BetForm({
  players,
  draft,
  setDraft,
  sidesLocked,
  lockedSides,
  holeCount,
  nassauAvailable,
  sideName,
  onCancel,
  onCommit,
}: {
  players: Participant[];
  draft: BetDraft;
  setDraft: (d: BetDraft) => void;
  sidesLocked: boolean;
  lockedSides: BetSide[];
  holeCount: number;
  nassauAvailable: boolean;
  sideName: (side: BetSide) => string;
  onCancel: () => void;
  onCommit: (bets: SideBet[]) => void;
}) {
  const sides = sidesLocked
    ? lockedSides
    : sidesFromWhoIsIn(
        players.map((p) => p.id),
        draft.whoIsIn,
        // A PREVIEW list, rebuilt on every keystroke and never recorded — the
        // ids that last are minted in `commit`. Numbered anyway so no two
        // sides in this list ever share one.
        previewIds()
      );
  const error = betDraftError(draft, sides, { holeCount });

  const commit = () => {
    if (error) return;
    let n = 0;
    const mkId = () => `bet-${Date.now().toString(36)}-${++n}`;
    const built = sidesLocked
      ? sides
      : sidesFromWhoIsIn(players.map((p) => p.id), draft.whoIsIn, () => `side-${Date.now().toString(36)}-${++n}`);
    onCommit(buildBetsFromDraft(draft, built, { holeCount, mkId }));
  };

  return (
    <div
      className="mt-2 rounded-[12px] p-3"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid="side-bet-form"
    >
      {/* Who's in — the chip treatment `BracketFieldPicker` uses for picking a
          field (§10, revised). Full-width checkbox rows made four players look
          like a form to fill in; a wrap of chips reads as a roster you tap,
          and it is the selection idiom this app already has. No team grouping
          here — Quick Play has no teams, so the sections that picker draws
          would be one unnamed group. */}
      {sidesLocked ? (
        <>
          <FieldLabel>Who&rsquo;s in</FieldLabel>
          <div style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }} data-testid="side-bet-sides-locked">
            {sides.map(sideName).join(" v ")} — a match is scored side against side, so the bet is too.
          </div>
        </>
      ) : (
        <>
          <FieldLabel>Who is betting</FieldLabel>
          <div className="flex flex-wrap" style={{ gap: 6 }}>
            {players.map((p) => {
              const on = draft.whoIsIn.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDraft(toggleWhoIsIn(draft, p.id))}
                  aria-pressed={on}
                  data-testid="side-bet-player-chip"
                  className="flex items-center rounded-full"
                  style={{
                    gap: 5,
                    padding: "6px 11px",
                    fontSize: 12.5,
                    fontWeight: on ? 650 : 500,
                    background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                    border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
                    color: "var(--color-bt-text)",
                  }}
                >
                  {on && <Check size={11} strokeWidth={3} style={{ color: "var(--color-bt-accent)" }} />}
                  {p.name}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* The kind. Head to Head is DISABLED rather than removed above two
          players (§6 of the refinements): a control that disappears leaves no
          trace of why, while a greyed one says "not for this many people". */}
      {!sidesLocked && draft.whoIsIn.length >= 2 && (
        <div className="mt-3">
          <Segmented
            options={[
              { value: "head_to_head", label: "Head to Head", disabled: !canBeHeadToHead(draft) },
              { value: "skins", label: "Skins" },
            ]}
            value={draft.kind}
            onChange={(k) => setDraft(setBetKind(draft, k))}
            testId="side-bet-kind"
          />
          <div className="mt-1" style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>
            {draft.kind === "skins"
              ? "Low score takes the skin. Ties carryover."
              : "Low score wins the hole. Ties do not carryover."}
          </div>

          {/* Single vs Nassau sits directly under the type it modifies, with no
              header of its own — it is a shape OF the bet above, not a separate
              question. Head-to-head only; a Nassau of pots is not a thing. */}
          {nassauAvailable && draft.kind === "head_to_head" && (
            <div className="mt-3">
              <Segmented
                options={[
                  { value: "single", label: "Single Bet" },
                  { value: "nassau", label: "Nassau" },
                ]}
                value={draft.shape}
                onChange={(shape) => setDraft({ ...draft, shape })}
                testId="side-bet-shape"
              />
              {draft.shape === "nassau" && (
                <div className="mt-1" style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>
                  Three separate bets for Front 9, Back 9, and Overall
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stakes */}
      <div className="mt-3">
        <FieldLabel>{draft.kind === "skins" ? "Stakes (per skin)" : "Stakes (per hole)"}</FieldLabel>
        <div className="flex items-center gap-2">
          {STAKE_PRESETS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setDraft({ ...draft, amount: v })}
              aria-pressed={draft.amount === v}
              className="rounded-[10px] px-3 py-1.5"
              style={{
                background: draft.amount === v ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                border: `1px solid ${draft.amount === v ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                color: draft.amount === v ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              ${v}
            </button>
          ))}
          <div className="ml-auto">
            <Stepper
              value={draft.amount}
              min={MIN_STAKE}
              step={1}
              onChange={(amount) => setDraft({ ...draft, amount })}
              size="compact"
              formatValue={(n) => `$${n}`}
            />
          </div>
        </div>
      </div>

      {/* Start hole */}
      <div className="mt-3">
        <FieldLabel>Starts on hole</FieldLabel>
        <Stepper
          value={draft.startHole}
          min={1}
          max={holeCount}
          onChange={(startHole) => setDraft({ ...draft, startHole })}
          size="compact"
        />
      </div>

      {/* Nassau — one action, three bets. Hidden where there is no back nine. */}
      {/* PRESSES — head-to-head only (§13). Carryover is not here at all: it is
          inherent to skins and absent from head-to-head, so the type is the
          choice and there is nothing to toggle. */}
      {draft.kind === "head_to_head" && (
        <div className="mt-3" data-testid="side-bet-rules">
          <FieldLabel>Presses</FieldLabel>
          <ToggleRow
            label="Automatic"
            /* Deliberately the SAME sentence whether or not it is on: once
               enabled the stepper below states the number, and rewriting the
               description to repeat it just makes the panel move under you. */
            blurb="When someone goes down a set number of holes, an additional bet will automatically start."
            on={draft.autoPressAt != null}
            onToggle={() => setDraft(setPressRules(draft, { autoPressAt: draft.autoPressAt == null ? 2 : null }))}
            testId="side-bet-autopress"
          >
            {draft.autoPressAt != null && (
              <div className="mt-2 flex items-center justify-between">
                <span style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)" }}>Holes down</span>
                <Stepper
                  value={draft.autoPressAt}
                  min={1}
                  max={9}
                  onChange={(n) => setDraft(setPressRules(draft, { autoPressAt: n }))}
                  size="compact"
                />
              </div>
            )}
          </ToggleRow>
          {/* ☠️ Only reachable with Automatic on, and off by default. */}
          {draft.autoPressAt != null && (
            <ToggleRow
              label="☠️ Presses on presses"
              blurb="Beware of compounding!"
              on={draft.pressOnPress}
              onToggle={() => setDraft(setPressRules(draft, { pressOnPress: !draft.pressOnPress }))}
              tone="warning"
              testId="side-bet-pressonpress"
            />
          )}
        </div>
      )}

      {error && (
        <div className="mt-3" style={{ fontSize: 12, color: "var(--color-bt-warning)" }} data-testid="side-bet-error">
          {error}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-[10px] py-2.5"
          style={{
            background: "var(--color-bt-card-raised)",
            border: "1px solid var(--color-bt-border)",
            color: "var(--color-bt-text-dim)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={commit}
          disabled={error != null}
          data-testid="side-bet-save"
          className="flex-1 rounded-[10px] py-2.5 disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-on-accent)",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {draft.shape === "nassau" ? "Start Nassau" : "Start bet"}
        </button>
      </div>
    </div>
  );
}

/** Distinct throwaway ids for the preview side list (see `BetForm`). */
function previewIds(): () => string {
  let n = 0;
  return () => `preview-${n++}`;
}

/** A labelled switch row in the settings grammar the game surfaces use. */
function ToggleRow({
  label,
  blurb,
  on,
  onToggle,
  tone = "accent",
  testId,
  children,
}: {
  label: string;
  blurb: string;
  on: boolean;
  onToggle: () => void;
  tone?: "accent" | "warning";
  testId?: string;
  /** Rendered INSIDE the panel, under the blurb — for a control that
   *  configures this toggle rather than sitting beside it. */
  children?: React.ReactNode;
}) {
  const color = tone === "warning" ? "var(--color-bt-warning)" : "var(--color-bt-accent)";
  const faint = tone === "warning" ? "var(--color-bt-warning-faint)" : "var(--color-bt-accent-faint)";
  const border = tone === "warning" ? "var(--color-bt-warning-border)" : "var(--color-bt-accent-border)";
  return (
    <div
      className="mt-2 rounded-[10px] px-2.5 py-2"
      style={{
        background: on ? faint : "var(--color-bt-card-raised)",
        border: `1px solid ${on ? border : "var(--color-bt-border)"}`,
      }}
      data-testid={testId}
    >
      {/* role=button, not <button>: `children` can carry a Stepper, and a
          button inside a button is invalid markup (the same reason
          `ScoreEntryView`'s player rows are role=button). */}
      <div
        role="button"
        tabIndex={0}
        aria-pressed={on}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex w-full cursor-pointer items-start gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block" style={{ fontSize: 13, fontWeight: 700, color: on ? color : "var(--color-bt-text)" }}>
            {label}
          </span>
          <span className="mt-0.5 block leading-snug" style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>
            {blurb}
          </span>
        </span>
        <span
          className="mt-0.5 flex shrink-0 items-center rounded-full"
          style={{
            width: 34,
            height: 20,
            padding: 2,
            background: on ? color : "var(--color-bt-border)",
            justifyContent: on ? "flex-end" : "flex-start",
          }}
        >
          <span className="block rounded-full" style={{ width: 16, height: 16, background: "var(--color-bt-card)" }} />
        </span>
      </div>
      {children}
    </div>
  );
}
