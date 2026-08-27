"use client";

import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { FieldLabel, Segmented } from "@/components/games/FieldChrome";
import { Stepper } from "@/components/games/Stepper";
import { Avatar } from "@/components/Avatar";
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
  pressOnPressBlurb,
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
  onSetPerspective,
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
  onSetPerspective: (playerId: string) => void;
  onAdd: (bets: SideBet[]) => void;
  onRemove: (betId: string) => void;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(result.bets.length === 0);
  const [draft, setDraft] = useState<BetDraft>(() => emptyBetDraft(currentHole));

  const recorded = new Set(recordedBetIds);
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name.split(/\s+/)[0] ?? "Player";

  const commit = (bets: SideBet[]) => {
    onAdd(bets);
    setCreating(false);
    setDraft(emptyBetDraft(currentHole));
  };

  return (
    <Sheet
      title="Side bets"
      subtitle={`${formatMoney(result.exposure.perHole)}/hole · ${result.exposure.liveBetCount} live`}
      onClose={onClose}
      testId="side-bet-sheet"
    >
      {/* ── Whose number ── the banner reads from one player's perspective and
          Quick Play has no signed-in identity to infer it from, so it is a
          choice rather than a guess. */}
      {players.length > 1 && (
        <div className="mb-4">
          <FieldLabel>Showing</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {players.map((p) => {
              const on = p.id === perspectivePlayerId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSetPerspective(p.id)}
                  aria-pressed={on}
                  className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
                  style={{
                    background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                    border: `1px solid ${on ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
                    color: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  <Avatar name={p.name} teamColor={p.color} avatarIcon={p.avatarIcon} sizePx={20} />
                  {p.name.split(/\s+/)[0]}
                </button>
              );
            })}
          </div>
        </div>
      )}

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

      {/* ── Hole by hole — free, because the arithmetic already exists. ── */}
      <HoleHistory result={result} perspectivePlayerId={perspectivePlayerId} />

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
            setDraft(emptyBetDraft(currentHole));
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
 * The hole-by-hole money history. Rendered from `result.holeLines`, which is
 * DERIVED on every read — fixing an earlier score rewrites the hole it was on
 * and every hole after it, and this list simply shows the new answer (§6/§9:
 * never cache a hole's money line).
 */
function HoleHistory({
  result,
  perspectivePlayerId,
}: {
  result: SideBetsResult;
  perspectivePlayerId: string | null;
}) {
  const rows = result.holeLines.filter((l) => l.perBet.length > 0);
  if (rows.length === 0) return null;
  return (
    <div className="mb-4">
      <FieldLabel>Hole by hole</FieldLabel>
      <div
        className="overflow-hidden rounded-[11px]"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        {rows.map((l, i) => {
          const mine = perspectivePlayerId ? (l.delta[perspectivePlayerId] ?? 0) : 0;
          return (
            <div
              key={l.hole}
              data-testid="side-bet-hole-row"
              className="flex items-center gap-3 px-3 py-2"
              style={{ borderTop: i === 0 ? undefined : "1px solid var(--color-bt-subtle-border)" }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, width: 52, color: "var(--color-bt-text-dim)" }}>
                Hole {l.hole}
              </span>
              <span className="min-w-0 flex-1" style={{ fontSize: 13, color: "var(--color-bt-text)" }}>
                {!l.decided
                  ? `worth ${formatMoney(l.pot)}`
                  : Math.abs(mine) < 0.005
                    ? `${formatMoney(l.pot)} carried over`
                    : `${formatMoney(l.pot)} played`}
                {l.presses.length > 0 && (
                  <span style={{ color: "var(--color-bt-warning)", fontWeight: 600 }}>
                    {" · "}
                    press {l.presses.map((p) => p.level).join(", ")} → {formatMoney(l.presses[0].exposureAfter)}/hole
                  </span>
                )}
              </span>
              <span
                style={{
                  fontSize: 13,
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
                {l.decided ? formatSignedMoney(mine) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
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
  /** Everyone already in — drives the Everyone/Clear flip, so one control
   *  covers both directions rather than two that can disagree. */
  const allIn = players.length > 0 && players.every((p) => draft.whoIsIn.includes(p.id));

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
          <div className="mb-1.5 flex items-center justify-between">
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              {draft.whoIsIn.length === 0
                ? "Who’s in"
                : `${draft.whoIsIn.length} in the bet`}
            </span>
            {players.length > 2 && (
              <button
                type="button"
                onClick={() => setDraft(setWhoIsIn(draft, allIn ? [] : players.map((p) => p.id)))}
                data-testid="side-bet-everyone"
                className="rounded-full px-2.5 py-1"
                style={{
                  fontSize: 11.5,
                  fontWeight: 650,
                  background: "var(--color-bt-card-raised)",
                  border: "1px solid var(--color-bt-border)",
                  color: "var(--color-bt-text-dim)",
                }}
              >
                {allIn ? "Clear" : "Everyone"}
              </button>
            )}
          </div>
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

      {/* The kind. Head-to-head is only coherent at two — above that "who pays
          whom" has no answer, so the pot is the only option and the choice
          disappears rather than being shown disabled. */}
      {!sidesLocked && draft.whoIsIn.length >= 2 && (
        <div className="mt-3">
          <FieldLabel>Type</FieldLabel>
          {canBeHeadToHead(draft) ? (
            <Segmented
              options={[
                { value: "head_to_head", label: "Head to head" },
                { value: "skins", label: "Skins" },
              ]}
              value={draft.kind}
              onChange={(k) => setDraft(setBetKind(draft, k))}
              testId="side-bet-kind"
            />
          ) : (
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-bt-text)" }} data-testid="side-bet-kind-forced">
              Skins
            </div>
          )}
          <div className="mt-1" style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>
            {draft.kind === "skins"
              ? `Everyone in, low score takes the pot. ${formatMoney(draft.amount)} each makes the first skin ${formatMoney(draft.amount * Math.max(draft.whoIsIn.length, 2))} — a tie carries it to the next hole.`
              : "One against one. The loser can press to get back in."}
          </div>
        </div>
      )}

      {/* Stakes */}
      <div className="mt-3">
        <FieldLabel>{draft.kind === "skins" ? "Each player puts in, per hole" : "Stakes per hole"}</FieldLabel>
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
        <div className="mt-1" style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>
          Runs from there to the end of the round.
        </div>
      </div>

      {/* Nassau — one action, three bets. Hidden where there is no back nine. */}
      {nassauAvailable && draft.kind === "head_to_head" && (
        <div className="mt-3">
          <FieldLabel>Shape</FieldLabel>
          <Segmented
            options={[
              { value: "single", label: "One bet" },
              { value: "nassau", label: "Nassau (3)" },
            ]}
            value={draft.shape}
            onChange={(shape) => setDraft({ ...draft, shape })}
            testId="side-bet-shape"
          />
          {draft.shape === "nassau" && (
            <div className="mt-1" style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>
              Front nine, back nine, and overall — three bets at {formatMoney(draft.amount)} a hole each.
            </div>
          )}
        </div>
      )}

      {/* Rules. Carryover is no longer a setting (§12) — it is inherent to
          skins and absent from head-to-head, so the type IS the choice. It was
          quietly turning one game into the other. Presses are head-to-head
          only (§13): in a pot there is no "down two to someone", there are
          three other people and a running total. */}
      {draft.kind === "head_to_head" && (
        <div className="mt-3" data-testid="side-bet-rules">
          <FieldLabel>Rules</FieldLabel>
          <ToggleRow
            label="Automatic press"
            blurb={
              draft.autoPressAt == null
                ? "Go a set number of holes down and a second bet starts, from the next hole to the end of the round."
                : `Going ${draft.autoPressAt} down starts a second bet at ${formatMoney(draft.amount)} a hole — ${formatMoney(draft.amount * 2)}/hole while both run.`
            }
            on={draft.autoPressAt != null}
            onToggle={() => setDraft(setPressRules(draft, { autoPressAt: draft.autoPressAt == null ? 2 : null }))}
            testId="side-bet-autopress"
          />
          {draft.autoPressAt != null && (
            <div className="mt-2 flex items-center justify-between pl-1">
              <span style={{ fontSize: 13, color: "var(--color-bt-text-dim)" }}>Press when this far down</span>
              <Stepper
                value={draft.autoPressAt}
                min={1}
                max={9}
                onChange={(n) => setDraft(setPressRules(draft, { autoPressAt: n }))}
                size="compact"
              />
            </div>
          )}
          {/* ☠️ Only reachable with automatic press on, and off by default. */}
          {draft.autoPressAt != null && (
            <ToggleRow
              label="☠️ Presses on presses"
              blurb={pressOnPressBlurb(draft.amount, draft.autoPressAt)}
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
}: {
  label: string;
  blurb: string;
  on: boolean;
  onToggle: () => void;
  tone?: "accent" | "warning";
  testId?: string;
}) {
  const color = tone === "warning" ? "var(--color-bt-warning)" : "var(--color-bt-accent)";
  const faint = tone === "warning" ? "var(--color-bt-warning-faint)" : "var(--color-bt-accent-faint)";
  const border = tone === "warning" ? "var(--color-bt-warning-border)" : "var(--color-bt-accent-border)";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      data-testid={testId}
      className="mt-2 flex w-full items-start gap-3 rounded-[10px] px-2.5 py-2 text-left"
      style={{
        background: on ? faint : "var(--color-bt-card-raised)",
        border: `1px solid ${on ? border : "var(--color-bt-border)"}`,
      }}
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
    </button>
  );
}
