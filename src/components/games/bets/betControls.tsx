"use client";

import { Check, Coins, Trash2 } from "lucide-react";
import { FieldLabel, Segmented } from "@/components/games/FieldChrome";
import { Stepper } from "@/components/games/Stepper";
import {
  betLabel,
  betRate,
  canManuallyPress,
  betTotalForPlayer,
  formatMoney,
  formatSignedMoney,
  sideStake,
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
 * The bet CONTROLS — the list of bets in play, and the form that adds one.
 *
 * Extracted from `SideBetSheet` because they now have two homes: that sheet
 * (the in-round breakdown, reached from the money strip) and `SideBetsPanel`,
 * the collapsible section inside the setup / settings modal. Setting a bet up
 * is part of setting the round up, so the controls belong in the same modal as
 * the roster rather than behind a modal of their own.
 *
 * Persistence-agnostic (CLAUDE.md #7): every figure arrives already derived by
 * `sideBets.ts` and every change leaves by a callback.
 */

/**
 * Everyone is in by default — the common case is the whole group. Routed
 * through `setWhoIsIn` so the KIND lands correctly: four pre-selected players
 * open as a pot, not as a head-to-head they cannot be.
 *
 * `sidesLocked` is a MATCH round, whose sides are the match's and whose bet is
 * therefore side against side — a head-to-head, at any roster size. Without
 * this, a 2v2 opened as SKINS purely because `setWhoIsIn` counted four players:
 * the kind control is hidden when the sides are locked, so nothing on screen
 * said so and nothing could change it, and the bet was recorded, labelled and
 * priced as a four-way pot between two sides.
 */
export function freshBetDraft(
  players: Participant[],
  currentHole: number,
  sidesLocked = false
): BetDraft {
  const base = emptyBetDraft(currentHole);
  // `whoIsIn` is unused when the sides are locked, and `emptyBetDraft` is
  // already head-to-head.
  if (sidesLocked) return base;
  return setWhoIsIn(base, players.map((p) => p.id));
}

/** The bets in play, recorded and derived-press alike. */
export function BetList({
  result,
  recordedBetIds,
  holeCount,
  perspectivePlayerId,
  sideName,
  onRemove,
  onPress,
  pressFromHole,
}: {
  result: SideBetsResult;
  /** Ids of the bets that were WRITTEN DOWN. A derived press has no row to
   *  delete — it exists because the rule fired, and removing it would mean
   *  editing history rather than a decision. */
  recordedBetIds: string[];
  holeCount: number;
  perspectivePlayerId: string | null;
  sideName: (side: BetSide) => string;
  onRemove: (betId: string) => void;
  /**
   * Press this bet by hand. Omitted where pressing makes no sense — the setup
   * sheet, where no hole has been played and there is nothing to be down by.
   */
  onPress?: (bet: SideBet) => void;
  /** The first hole a press would cover. Required when `onPress` is given. */
  pressFromHole?: number;
}) {
  const recorded = new Set(recordedBetIds);
  if (result.bets.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {result.bets.map((t) => {
        const mine = betTotalForPlayer(t, perspectivePlayerId);
        const to = t.bet.endHole == null ? holeCount : t.bet.endHole;
        const rules = [
          // `betRate`, not a hardcoded "/hole": a skins bet is priced per SKIN,
          // and the recorded figure is the skin rather than a per-person stake
          // (`sideStake`). This row printed "$10/hole" for a $10 skin, naming
          // the wrong unit and, once the pot is split, the wrong number too.
          betRate(t.bet),
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
            {onPress && canManuallyPress(t, { fromHole: pressFromHole ?? holeCount + 1, holeCount }) && (
              <button
                type="button"
                onClick={() => onPress(t.bet)}
                aria-label={`Press ${betLabel(t.bet)}`}
                data-testid="side-bet-press"
                className="shrink-0 rounded-lg px-2.5 py-1"
                style={{
                  background: "var(--color-bt-warning-faint)",
                  border: "1px solid var(--color-bt-warning-border)",
                  color: "var(--color-bt-warning)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Press
              </button>
            )}
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
  );
}

export function BetForm({
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
  onPlaySkinsRound,
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
  /**
   * Offered when the person picks Skins BEFORE a round has started: switch the
   * setup to a Quick Skins round instead.
   *
   * Omitted mid-round, where it would be an offer to abandon what is being
   * played, and by any caller that has nowhere to switch TO. The nudge is a
   * real action rather than a sentence, because "you could play the format
   * instead" is only useful if the next tap does it.
   */
  onPlaySkinsRound?: () => void;
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
  const error = betDraftError(draft, sides, { holeCount, sidesLocked });

  const commit = () => {
    if (error) return;
    let n = 0;
    const mkId = () => `bet-${Date.now().toString(36)}-${++n}`;
    const built = sidesLocked
      ? sides
      : sidesFromWhoIsIn(players.map((p) => p.id), draft.whoIsIn, () => `side-${Date.now().toString(36)}-${++n}`);
    // `sidesLocked` goes to the BUILDER, which owns the "a match's bet is a
    // head-to-head" rule — the form is not the place for it, since the form is
    // exactly what does not render in that branch. See `buildBetsFromDraft`.
    onCommit(buildBetsFromDraft(draft, built, { holeCount, mkId, sidesLocked }));
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
              ? "Low NET score takes the skin. Ties carry the whole skin to the next hole."
              : "Low score wins the hole. Ties do not carryover."}
          </div>

          {/* The nudge. A skins SIDE BET derives its hole winner from net
              scores, which means everybody has to card every hole — and people
              pick up. The FORMAT records who took the hole instead, which is
              the whole reason `src/lib/skins.ts` exists beside this module and
              says so in its own header. Same money either way, so this is an
              offer about how the round is SCORED, not about the stakes. */}
          {draft.kind === "skins" && onPlaySkinsRound && (
            <button
              type="button"
              onClick={onPlaySkinsRound}
              data-testid="side-bet-play-skins-round"
              className="mt-2 flex w-full items-start gap-2 rounded-[10px] px-2.5 py-2 text-left"
              style={{
                background: "var(--color-bt-accent-faint)",
                border: "1px solid var(--color-bt-accent-border)",
              }}
            >
              <Coins size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-bt-accent)" }} />
              <span className="min-w-0 flex-1">
                <span className="block" style={{ fontSize: 12.5, fontWeight: 650, color: "var(--color-bt-accent)" }}>
                  Play the whole round as skins?
                </span>
                <span className="mt-0.5 block leading-snug" style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>
                  Quick Skins scores it by hole — tap who won or Tied, no cards to fill in when someone picks
                  up. Same money.
                </span>
              </span>
            </button>
          )}

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

      {/* Stakes. The label has always said "per skin" and the arithmetic used
          to price it per PERSON, so four people at $10 were in for $40 a hole
          and nothing on the screen said so. `sideStake` settles it (the skin is
          the skin) and the line below states the consequence in the only terms
          anyone hands money over in — what each of them puts in. */}
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
        {draft.kind === "skins" && sides.length >= 2 && (
          <div
            className="mt-1"
            style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}
            data-testid="side-bet-skin-share"
          >
            {formatMoney(draft.amount)} a skin — {formatMoney(sideStake({ ...PREVIEW_BET, kind: "skins", sides, amount: draft.amount }))}{" "}
            each from {sides.length}. A tie carries the whole skin to the next hole.
          </div>
        )}
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

/**
 * The non-money fields `sideStake` does not read, so the form can ask it what a
 * draft would cost each person without building a whole `SideBet`. Passing the
 * REAL function rather than dividing here is the point: the hint and the tally
 * cannot disagree about what a skin costs, which is the split that produced the
 * bug this line explains (CLAUDE.md #8).
 */
const PREVIEW_BET = {
  id: "preview",
  startHole: 1,
  endHole: null,
  carryover: true,
  autoPressAt: null,
  pressOnPress: false,
  origin: { kind: "manual" },
} satisfies Omit<SideBet, "kind" | "sides" | "amount">;

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
