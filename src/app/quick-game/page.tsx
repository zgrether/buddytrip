"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RotateCcw, Table2, Zap } from "lucide-react";
import {
  hasAnyScore,
  readQuickGameState,
  writeQuickGameState,
  clearQuickGameState,
  quickGameUnits,
  quickGamePips,
  quickGameStandings,
  quickGameTitle,
  quickGameSubtitle,
  isMatchGame,
  isRackGame,
  quickSideName,
  quickMatchGroupData,
  quickMatchGlorious,
  QUICK_GAME_LABEL,
  type QuickGameState,
  type QuickGameFormat,
} from "@/lib/quickGame";
import { QuickMatchSurface } from "@/components/games/quick/QuickMatchSurface";
import { QuickGameSetupSheet } from "@/components/games/quick/QuickGameSetupSheet";
import type { HoleOutcomeResult } from "@/lib/matchPlay";
import { buildDoubleBet, type SideBet } from "@/lib/sideBets";
import {
  quickSideBets,
  quickHasBets,
  quickBetStrip,
  quickBetPerspective,
  quickBetSidesLocked,
  quickBetDefaultSides,
  quickBetSideName,
  quickBetHoles,
  quickNassauAvailable,
  quickDoubleOffers,
} from "@/lib/quickGameBets";
import { SideBetStrip } from "@/components/games/bets/SideBetStrip";
import { SideBetSheet } from "@/components/games/bets/SideBetSheet";
import { SideBetSettlementBar } from "@/components/games/bets/SideBetSettlementBar";
import { LastHoleDoublePrompt } from "@/components/games/bets/LastHoleDoublePrompt";
import { PLAYER_COLORS } from "@/lib/strokePlayConfig";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { OutcomeScorecard } from "@/components/games/OutcomeScorecard";
import { FinalStandings } from "@/components/games/FinalStandings";
import { ScorecardSheet } from "@/components/games/ScorecardSheet";
import { SectionLabel, DangerRow, DangerConfirmModal } from "@/components/DangerZone";

/**
 * Quick Stroke Play ⚡ (Slice A2, extended Phase 1 with course selection +
 * handicaps + roster editing). A context-free stroke-play game. Renamed from
 * "Quick Game" (#879 item 1a): the old name promised a format picker that
 * doesn't exist — it only ever does stroke play. The route (`/quick-game`) and
 * the localStorage key stay as they were; those are identifiers, not the
 * user-facing name.
 *
 * Reuses ScoreEntryView / StandardGrid / FinalStandings / ScorecardSheet
 * UNCHANGED — the scorecard is the SAME `Sheet`-based overlay every other golf
 * format uses (CLAUDE.md's Reuse target: "Scorecard = a Sheet overlay, not a
 * full-page route"). This page's grid view first shipped as a bespoke
 * full-screen route instead — the exact "reinvent it slightly differently"
 * this rule exists to prevent, and the mismatch with every other golf
 * surface (plus a since-fixed horizontal-scroll complaint on it) is what
 * caught it. Only the persistence backend differs from the trip-side games:
 * the whole game state lives in **local storage**,
 * no DB row, no auth beyond the standing session (the route was never public —
 * Phase 0 confirmed `/quick-game` sits behind the same middleware auth gate as
 * every other trip surface), free-text player names. Finish computes standings
 * client-side via the SAME shared helpers a handicap trip game does
 * (`quickGameStandings`) — this is exactly what the persistence-agnostic split
 * (CLAUDE.md pattern #7/#8) was built for.
 *
 * Course selection reuses `CoursePicker` AS-IS (Phase 0 found it takes only
 * `{onApply, onClose}` — no trip/game coupling, no extraction needed) and
 * CAPTURES the applied course's snapshot into local storage via the shared,
 * pure `buildCourseSnapshot` (one fetch at selection, no network on every
 * scorecard render — the round survives losing signal mid-course).
 *
 * `QuickGameState` and the derive helpers live in `@/lib/quickGame` — the
 * dashboard card (#879 item 1c) reads the same saved state, and Quick Game's
 * own readers (final standings, the subtitle) share them too so a handicap
 * round can't net differently in two places (CLAUDE.md #8/#18).
 */


/**
 * The finish screen for formats whose result is a SENTENCE, not a ranked list —
 * a match ("Zach won 3&2") and a rack ("Team A leads 3–2"). `FinalStandings` is
 * a stroke-play shape (positions over players); asking it to describe a match
 * would be the same category error the reader sweep was about. The result text
 * comes from `quickGameSubtitle`, so this screen and the dashboard card cannot
 * describe the same round differently.
 */
function QuickResultCard({
  title, subtitle, onScorecard, onPlayAgain, onDiscard,
}: {
  title: string;
  subtitle: string | null;
  onScorecard: () => void;
  onPlayAgain: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bt-base)" }}>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <span style={{ fontSize: 40 }}>🏌️</span>
        <div className="mt-3" style={{ fontSize: 22, fontWeight: 700, color: "var(--color-bt-text)", lineHeight: 1.3 }}>
          {title}
        </div>
        {subtitle && (
          <div className="mt-1.5" style={{ fontSize: 13.5, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
        )}
        <button
          type="button"
          onClick={onScorecard}
          className="mt-6 flex items-center gap-2 rounded-xl px-4 py-2.5"
          style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 14, fontWeight: 600 }}
          data-testid="quick-result-scorecard"
        >
          <Table2 size={16} /> Scorecard
        </button>
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-4 pb-8">
        <button
          type="button"
          onClick={onPlayAgain}
          className="w-full"
          style={{ height: 50, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}
        >
          Play again
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="w-full"
          style={{ height: 46, borderRadius: 12, background: "transparent", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)", fontSize: 14, fontWeight: 600 }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

/**
 * The editable roster form — player rows (name + optional handicap stepper +
 * optional rack team toggle, add/remove) plus the course-select row. Shared
 * VERBATIM by the pre-start setup screen and the post-start roster editor
 * (§1/§2) so "start a game" and "edit an in-progress roster" can't drift into
 * two different floor/cap/course rules.
 *
 * Handicap entry lives HERE, not the gear panel (decision, #1049): a stroke
 * only means anything if it's set before scoring, and the gear panel is found
 * after a round is already under way. `showHandicaps` is false for MATCH play,
 * whose strokes are relative (one side receives them) and therefore owned by
 * `MatchSetupFields` — two handicap models on one screen would contradict.
 */
const VALID_FORMATS: readonly QuickGameFormat[] = ["stroke", "match", "rack"];

/**
 * `?format=` is the tile that sent you here — `useSearchParams()` opts the
 * page out of static prerender, so it must sit under a `Suspense` boundary
 * (the same shape `/courses/new` already uses for its own `?trip=&game=`
 * return-target params). Missing/unrecognized `format` falls back to
 * `"stroke"`, matching a bare `/quick-game` (an old bookmark, or the legacy
 * link before tiles existed) at exactly the round it already used to open.
 *
 * `rack` is a valid value even though no TILE links to one — its state,
 * migration, and setup fields already work (#1050); what's missing is the
 * board, not the round. Accepting the param rather than special-casing it out
 * is what "a third tile, whenever" (the handoff's own framing) means in code.
 */
export default function QuickGamePage() {
  return (
    <Suspense fallback={<div className="fixed inset-0" style={{ background: "var(--color-bt-base)" }} />}>
      <QuickGamePageInner />
    </Suspense>
  );
}

function QuickGamePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const formatParam = searchParams.get("format");
  const format: QuickGameFormat = (
    VALID_FORMATS as readonly string[]
  ).includes(formatParam ?? "")
    ? (formatParam as QuickGameFormat)
    : "stroke";
  const [state, setState] = useState<QuickGameState | null>(null);
  const [view, setView] = useState<"entry" | "grid">("entry");
  // currentHole lives IN the persisted state so a refresh resumes on the same
  // hole (not just the scores).
  const setCurrentHole = (h: number) =>
    setState((s) => (s ? { ...s, currentHole: h } : s));
  const [hydrated, setHydrated] = useState(false);
  // Settings gear (#879 item 1b) — a lightweight panel with two actions:
  // "Players & handicaps" (below) and Reset Game (danger zone).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  /** The side-bet breakdown (§6) — behind a tap, never expanded by default. */
  const [betsOpen, setBetsOpen] = useState(false);
  /** The setup sheet, on the landing state. Opens on arrival: reaching this
   *  route with no round means setting one up is the only thing to do here. */
  const [setupOpen, setSetupOpen] = useState(true);
  /**
   * Bets staged BEFORE the round exists (§8). Side bets are agreed on the first
   * tee, not found in a settings panel after two holes — so the landing page
   * carries them, and `buildAndStart` hands them to the round it creates.
   *
   * A draft, in the same sense as the roster and the course beside it: nothing
   * is written until Start, so abandoning the setup screen leaves nothing.
   */

  // ── Format-specific setup draft ────────────────────────────────────────────
  // The FEW extra answers match and rack need beyond the shared roster. `format`
  // itself is no longer chosen here — it's fixed by which tile sent you here
  // (the URL `?format=`, resolved above), not an in-page picker. All of it lives
  // in local state (not `state`) because none of it means anything until Start
  // — the round doesn't exist yet.
  /** Signed relative handicap: <0 → side A receives |n|, >0 → side B receives n,
   *  0 → even. The trip-side model (`RelHandicapControl`) — strokes go to
   *  exactly ONE side, never split. */
  /** { [playerId]: "A" | "B" } for rack. Unassigned players default to A at build. */
  /** Set when Start is pressed while a round is already saved — one key holds one
   *  game, so starting a new one REPLACES it. That must never be silent. */
  const [confirmReplace, setConfirmReplace] = useState(false);

  /** §6 — for a match the question is not how MANY but whether both sides have
   *  someone, which the rows themselves answer. Any split is legal. */

  // Resume this FORMAT's round from its own key. Depends on `format`, not just
  // `[]`: Next.js reuses this component across a `?format=` change (same
  // pathname, different search param) rather than remounting it, so switching
  // tiles via client navigation must re-read here or the page would keep
  // showing the PREVIOUS tile's round under the new one's chrome. `null` is set
  // explicitly (not left alone) for the same reason — a format with no saved
  // round must clear whatever the last format's `state` was, not inherit it.
  // `readQuickGameState` already migrates the legacy key + validates shape, so
  // a round from before formats existed, or before course/handicaps existed,
  // resumes rather than fails.
  useEffect(() => {
    // Reading local storage IS the "subscribe to an external system" case the
    // rule allows; it just does it synchronously because storage is. Same
    // disable, same reason, as the other external-data reads in this codebase.
    //
    // Worth knowing: this rule did NOT fire on `main` and does now, with the
    // effect itself untouched — it started being reported once this file shrank
    // by ~200 lines. So the surrounding code was what kept it quiet, not the
    // effect being fine.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external data: local storage, keyed by format
    setState(readQuickGameState(format));
    setHydrated(true);
  }, [format]);

  // Persist on change — gated on `hydrated` STATE (not a ref) so the mount pass,
  // where `state` is still null before the load's setState applies, can't clear
  // a saved game. Writes go to `state.format`'s OWN key (via
  // `writeQuickGameState`) rather than the page's `format`, so a stray render
  // between a format switch and the load effect catching up can only re-write
  // a round to its own correct key, never cross-write one format's round under
  // another's — the clear branch is the one place that needs the URL's
  // `format`, since a null `state` names no format of its own.
  useEffect(() => {
    if (!hydrated) return;
    if (state) writeQuickGameState(state);
    else clearQuickGameState(format);
  }, [state, hydrated, format]);

  /** Reset game, guarded: a round with scores in it asks first. */
  function newGame() {
    if (!state) return;
    if (hasAnyScore(state)) {
      setConfirmReplace(true);
      return;
    }
    resetGame();
  }

  /** Reset game (§5) — everything goes: players, course, scores, bets. Lands
   *  on the landing state, where the setup sheet opens blank, which is what
   *  "back to a blank setup" now means. */
  function resetGame() {
    setState(null);
    setSetupOpen(true);
    setConfirmReplace(false);
    setSettingsOpen(false);
    setView("entry");
  }



  function onChange(pid: string, label: string, value: number) {
    setState((s) => (s ? { ...s, values: { ...s.values, [pid]: { ...(s.values[pid] ?? {}), [label]: value } } } : s));
  }
  function onClear(pid: string, label: string) {
    setState((s) => {
      if (!s) return s;
      const row = { ...(s.values[pid] ?? {}) };
      delete row[label];
      return { ...s, values: { ...s.values, [pid]: row } };
    });
  }
  /** Outcome-mode writes. Separate from `onChange` because an outcome belongs to
   *  the MATCH, not either side — a different storage shape, not a variant of
   *  the same one (CLAUDE.md #27's "a score has two storage shapes"). */
  function onOutcome(label: string, result: HoleOutcomeResult) {
    setState((s) => (s && isMatchGame(s) ? { ...s, outcomes: { ...s.outcomes, [label]: result } } : s));
  }
  function onClearOutcome(label: string) {
    setState((s) => {
      if (!s || !isMatchGame(s)) return s;
      const next = { ...s.outcomes };
      delete next[label];
      return { ...s, outcomes: next };
    });
  }
  function finish() {
    setState((s) => (s ? { ...s, finished: true } : s));
  }

  // ── Side bets ───────────────────────────────────────────────────────────
  // These write the RECORDED half only — the bets. Every figure the tracker
  // shows is re-derived from them on each render (`quickSideBets`), which is
  // what makes correcting an earlier score rewrite the whole tally, presses
  // included, with nothing to reconcile (handoff §4).
  function addBets(added: SideBet[]) {
    setState((s) => (s ? { ...s, bets: { ...s.bets, bets: [...s.bets.bets, ...added] } } : s));
  }
  function removeBet(betId: string) {
    setState((s) =>
      s
        ? {
            ...s,
            bets: {
              ...s.bets,
              bets: s.bets.bets.filter((b) => b.id !== betId),
              // A double recorded against a removed bet has nothing left to
              // double, and its decline no longer means anything either.
              declinedDoubles: s.bets.declinedDoubles.filter((id) => id !== betId),
            },
          }
        : s
    );
  }
  function declineDouble(parentBetId: string) {
    setState((s) =>
      s
        ? {
            ...s,
            bets: { ...s.bets, declinedDoubles: [...s.bets.declinedDoubles, parentBetId] },
          }
        : s
    );
  }
  function playAgain() {
    setState(null);
    setView("entry");
  }
  function discard() {
    setState(null);
    router.push("/dashboard");
  }
  /**
   * Clear scores (§5 — renamed; it used to be called "Reset game", which is
   * now the OTHER action). #879 item 1b; revised — feedback: hole 1 was the wrong
   * landing spot). Clears scores AND returns to the setup screen, with the
   * current players/handicaps/course staged as editable drafts — not blank
   * (that's `playAgain`) and not straight back into hole-1 scoring (the old
   * behavior). "The odds are much higher that's what you want" after a
   * reset: you're at least as likely to want to fix a handicap or swap a
   * player as you are to re-score the identical setup, and the old behavior
   * made the second case one extra trip (gear → Players & handicaps) while
   * this makes it zero. Tapping Start immediately reproduces the old
   * behavior exactly, so nothing is lost for the "just re-score it" case.
   *
   * This and the roster editor (`openRosterEditor`/`saveRoster`, below) are
   * now two INDEPENDENT affordances, not one gating the other: this clears
   * SCORES and returns to setup; that edits players/handicaps/course
   * WITHOUT touching scores, any time. Both stage via the same
   * `prefillDrafts` so they can't drift into different pre-fill rules — the
   * only difference is whether `state` gets cleared (this) or kept (that).
   *
   * Not a `useScoreSaver.clearAll` situation (#807's fix target): that bug was
   * specific to `reconcileScores`' overlay-only merge dropping an empty SERVER
   * response — there is no server here, no reconcile, no outbox. Quick Stroke
   * Play's whole state is one local object with no other writer, so replacing
   * it is atomic and there is nothing this can race against.
   */
  /**
   * Clear scores (§5) — the round STAYS, only what was played goes.
   *
   * This used to stage the roster into drafts and null the state, landing you
   * back on the setup screen with the players filled in. That stopped working
   * the moment setup became a sheet reading SAVED state (§3): a null round
   * opens a blank sheet, so "players stay" would have lost the players — the
   * label contradicting itself, silently.
   *
   * Emptying in place is what the label said all along, and it keeps you where
   * you are instead of bouncing through setup to get back. The bets are kept
   * deliberately: they derive their tally from scores, so with the scores gone
   * every figure is zero, which IS "bets will start over".
   */
  function clearScores() {
    setState((s) =>
      s
        ? {
            ...s,
            values: {},
            currentHole: 1,
            finished: false,
            ...(s.format === "match" ? { outcomes: {} } : {}),
          }
        : s
    );
    setView("entry");
    setConfirmReset(false);
    setSettingsOpen(false);
  }

  const units = quickGameUnits(state);
  const pips = state ? quickGamePips(state) : undefined;

  /**
   * The setup screen's own bet context (§8) — the same sheet, fed from drafts
   * instead of a saved round. No scores exist yet, so the tally is all zeros
   * and every bet reads as "starts hole 1": exactly right for a bet being
   * agreed before anyone has hit.
   */
  // ── Side bets, derived ────────────────────────────────────────────────────
  // Recomputed on every render from the recorded bets + the scores. There is no
  // cached tally to invalidate and no press written down anywhere, which is the
  // whole design (§4): edit a score and the next render simply says something
  // different, including about presses that should or should not have fired.
  const betResult = state ? quickSideBets(state) : null;
  const betsOn = quickHasBets(state);
  const betStrip = state && betResult ? quickBetStrip(state, betResult) : null;
  const betHoles = state ? quickBetHoles(state) : [];
  // The hole line follows the hole being VIEWED — a different question from the
  // banner's total, which is always live (§6). Both come off the same result.
  const viewedHoleLine = betResult?.holeLines.find((l) => l.hole === (state?.currentHole ?? 1)) ?? null;
  const betPlayerName = (id: string) => state?.players.find((p) => p.id === id)?.name.split(/\s+/)[0] ?? "Player";
  const doubleOffers = state && betResult ? quickDoubleOffers(state, betResult) : [];
  const doubleOffer = doubleOffers[0] ?? null;

  const betStripNode =
    betsOn && betStrip && betResult ? (
      <SideBetStrip
        perspectiveName={betStrip.perspectiveName}
        total={betStrip.total}
        exposure={betStrip.exposure}
        hole={
          viewedHoleLine && viewedHoleLine.perBet.length > 0
            ? {
                label: String(viewedHoleLine.hole),
                pot: viewedHoleLine.pot,
                decided: viewedHoleLine.decided,
                delta: betStrip.perspectivePlayerId
                  ? (viewedHoleLine.delta[betStrip.perspectivePlayerId] ?? 0)
                  : 0,
              }
            : null
        }
        presses={viewedHoleLine?.presses.map((pr) => ({ level: pr.level, exposureAfter: pr.exposureAfter })) ?? []}
        onOpen={() => setBetsOpen(true)}
      />
    ) : null;

  // The breakdown + the last-hole prompt. Rendered by BOTH the playing screen
  // and the final screen, so they are built once here rather than twice below.
  const betOverlays =
    state && betResult ? (
      <>
        {betsOpen && (
          <SideBetSheet
            players={state.players}
            result={betResult}
            recordedBetIds={state.bets.bets.map((b) => b.id)}
            sidesLocked={quickBetSidesLocked(state)}
            lockedSides={quickBetDefaultSides(state, () => crypto.randomUUID())}
            holeCount={betHoles.length}
            currentHole={state.currentHole}
            nassauAvailable={quickNassauAvailable(state)}
            perspectivePlayerId={quickBetPerspective(state)}
            sideName={(side) => quickBetSideName(state, side)}
            onAdd={addBets}
            onRemove={removeBet}
            onClose={() => setBetsOpen(false)}
          />
        )}
        {/* The last-hole double is a PROMPT, never applied for you (§9), and it
            asks once — declining is recorded so the round stops offering. */}
        {!betsOpen && doubleOffer && (
          <LastHoleDoublePrompt
            offer={doubleOffer}
            trailingName={quickBetSideName(
              state,
              doubleOffer.bet.sides.find((sd) => sd.id === doubleOffer.trailingSideId) ?? doubleOffer.bet.sides[0]
            )}
            leadingName={quickBetSideName(
              state,
              doubleOffer.bet.sides.find((sd) => sd.id === doubleOffer.leadingSideId) ?? doubleOffer.bet.sides[1]
            )}
            lastHole={betHoles[betHoles.length - 1] ?? 18}
            onAccept={() => {
              addBets([
                buildDoubleBet({
                  mkId: () => crypto.randomUUID(),
                  offer: doubleOffer,
                  lastHole: betHoles[betHoles.length - 1] ?? 18,
                }),
              ]);
              // Recorded either way: taking it must not leave the prompt open
              // to be taken a second time on the next render.
              declineDouble(doubleOffer.bet.id);
            }}
            onDecline={() => declineDouble(doubleOffer.bet.id)}
          />
        )}
      </>
    ) : null;
  /** The scorecard grid's row entities. Stroke/rack rows are PLAYERS; a match's
   *  rows are SIDES, because a side is one score column (a 2v2 enters one ball,
   *  not two) — the same split `values` and `quickGamePips` are keyed on. */
  const gridParticipants =
    state && isMatchGame(state)
      ? [
          { id: state.sideA.id, name: quickSideName(state, state.sideA), color: PLAYER_COLORS[0] },
          { id: state.sideB.id, name: quickSideName(state, state.sideB), color: PLAYER_COLORS[1] },
        ]
      : (state?.players ?? []);

  /**
   * The scorecard body for THIS round's format and entry mode (§7).
   *
   * Outcome mode was rendering `StandardGrid` — a stroke-play shape fed from
   * `state.values`, which an outcome match never writes to (CLAUDE.md #27: a
   * score has two storage shapes). So it drew a correct-looking empty grid for
   * a match that had been played all the way round. `OutcomeScorecard` is the
   * component for that shape and already existed; nothing dispatched to it.
   *
   * One function, used by both the in-round sheet and the finished screen, so
   * they cannot disagree about which card a round gets.
   */
  function scorecardBody(onCellTap?: (label: string) => void) {
    if (!state) return null;
    if (isMatchGame(state) && state.entryMode === "outcome") {
      const m = quickMatchGroupData(state);
      return (
        <OutcomeScorecard
          units={units}
          a={m.a}
          b={m.b}
          aPlayers={m.aPlayers}
          bPlayers={m.bPlayers}
          outcomes={Object.entries(state.outcomes)
            .map(([label, result]) => ({ hole: Number(label), result }))
            .filter((r) => Number.isFinite(r.hole))}
          glorious={quickMatchGlorious(state)}
        />
      );
    }
    return (
      <StandardGrid
        units={units}
        participants={gridParticipants}
        values={state.values}
        pips={pips}
        direction="low_wins"
        onCellTap={onCellTap}
      />
    );
  }

  /**
   * ── Landing ── no saved round for this format.
   *
   * The route keeps working for a direct link or a refresh, and it presents
   * the SAME setup sheet the dashboard tile opens (§3) rather than a second
   * setup screen. The 123-line form that used to live here is gone: two
   * implementations of "start a round" is how one of them stops carrying the
   * bets, or defaults a modifier the other refuses.
   *
   * The landing itself is deliberately thin. It exists because a sheet needs
   * something behind it and there is no hole to show yet — not as a screen in
   * its own right.
   */
  if (!state) {
    return (
      <div className="mx-auto max-w-md px-4 py-6" style={{ background: "var(--color-bt-base)", minHeight: "100vh" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>
          ⚡ {QUICK_GAME_LABEL[format]}
        </h1>
        <p className="mt-1" style={{ fontSize: 13.5, color: "var(--color-bt-text-dim)" }}>
          Nothing in progress. Set one up to start scoring.
        </p>
        <button
          type="button"
          onClick={() => setSetupOpen(true)}
          data-testid="quick-game-landing-setup"
          className="mt-4 w-full rounded-xl py-3"
          style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-on-accent)", fontSize: 15, fontWeight: 700 }}
        >
          Set up a round
        </button>

        {setupOpen && (
          <QuickGameSetupSheet
            format={format}
            onClose={() => setSetupOpen(false)}
            onStarted={() => {
              // Written by the sheet — pick it up and drop straight into scoring.
              setState(readQuickGameState(format));
              setSetupOpen(false);
              setView("entry");
            }}
          />
        )}
      </div>
    );
  }

  // ── Final ── FinalStandings stays mounted underneath; the scorecard is a
  // sibling `ScorecardSheet` overlay (the shared pattern every golf format
  // uses), not a separate route that replaces it.
  if (state.finished) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col">
        {/* One line: who owes whom, how much (§6). That IS the settlement —
            there is no settle action to perform, and a ceremony nobody performs
            is worse than none (§3.3). */}
        {betsOn && betResult && (
          <SideBetSettlementBar
            settlement={betResult.settlement}
            nameOf={betPlayerName}
            onOpen={() => setBetsOpen(true)}
          />
        )}
        <div className="min-h-0 flex-1">
        {isMatchGame(state) ? (
          // A match has no stroke standings to show — its result IS the margin
          // ("3&2"), which `quickGameSubtitle` already renders from the shared
          // `quickMatchState`. Feeding it through `FinalStandings` would ask a
          // stroke-shaped component to describe a match, the exact category
          // error the T0.4 sweep was about.
          <QuickResultCard
            title={quickGameSubtitle(state)}
            subtitle={state.course?.name ?? null}
            onScorecard={() => setView("grid")}
            onPlayAgain={playAgain}
            onDiscard={discard}
          />
        ) : isRackGame(state) ? (
          <QuickResultCard
            title={quickGameSubtitle(state)}
            subtitle={state.course?.name ?? null}
            onScorecard={() => setView("grid")}
            onPlayAgain={playAgain}
            onDiscard={discard}
          />
        ) : (
          <FinalStandings
            participants={state.players}
            standings={quickGameStandings(state)}
            unitCount={units.length}
            dateLabel={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            onScorecard={() => setView("grid")}
            onPlayAgain={playAgain}
            onDiscard={discard}
          />
        )}
        </div>
        {view === "grid" && (
          <ScorecardSheet subtitle={state.course?.name} onClose={() => setView("entry")}>
            {scorecardBody()}
          </ScorecardSheet>
        )}
        {betOverlays}
      </div>
    );
  }

  // ── Playing ── the surface is chosen by FORMAT. Match routes through
  // `QuickMatchSurface` (which picks score vs outcome entry); stroke and rack
  // both use `ScoreEntryView` — rack IS net stroke entry, its difference is in
  // how the results are read, not how they are entered.
  return (
    <div className="fixed inset-0 z-50">
      {isMatchGame(state) ? (
        <QuickMatchSurface
          state={state}
          onScore={onChange}
          onClearScore={onClear}
          onOutcome={onOutcome}
          onClearOutcome={onClearOutcome}
          onHoleChange={setCurrentHole}
          onFinish={finish}
          onBack={() => router.push("/dashboard")}
          onOpenGrid={() => setView("grid")}
          onConfig={() => setSettingsOpen(true)}
          banner={betStripNode}
        />
      ) : (
        <ScoreEntryView
          gameName={quickGameTitle(state)}
          units={units}
          participants={state.players}
          values={state.values}
          pips={pips}
          direction="low_wins"
          currentHole={state.currentHole}
          onHoleChange={setCurrentHole}
          onChange={onChange}
          onClear={onClear}
          onBack={() => router.push("/dashboard")}
          onOpenGrid={() => setView("grid")}
          onFinish={finish}
          onConfig={() => setSettingsOpen(true)}
          banner={betStripNode}
        />
      )}

      {betOverlays}

      {/* Scorecard — a sibling `ScorecardSheet` overlay on top of the (still
          mounted) entry screen, the SAME pattern every trip-side golf format
          uses, not a route that replaces it. Tapping a cell jumps to that
          hole AND closes the sheet (`view` back to "entry") in one action. */}
      {view === "grid" && (
        <ScorecardSheet subtitle={state.course?.name} onClose={() => setView("entry")}>
          {scorecardBody((label) => {
            setCurrentHole(Number(label) || 1);
            setView("entry");
          })}
        </ScorecardSheet>
      )}

      {/* Settings gear (#879 item 1b) — top-right of the game page header, same
          affordance every other game surface uses (`ScoreEntryView`'s existing
          `onConfig` slot — no new chrome). The roster stays editable at any
          point, scores or no, with no refusal state (feedback: "it should just
          be a label"): netting is derived at read time, so a mid-round handicap
          change is just a different answer on the next render.

          In-round settings IS the add/edit sheet, in its `settings` purpose —
          the same component the dashboard tile opens, so the round can only be
          described one way. It used to be a slide-over of nav rows leading to a
          full-screen roster editor and a bets modal: three surfaces for one
          edit, each with its own save semantics. Players, handicaps, course,
          match answers and bets are all sections of this one form now, with the
          standard Cancel / Save underneath.

          Editing mid-round is safe because netting is derived at READ time and
          never snapshotted (`quickGamePips`, mirroring CLAUDE.md #11): change a
          handicap and the next render recomputes every hole, past and future,
          with nothing to migrate. Scores survive because the sheet merges over
          the saved round rather than replacing it — and, for a match, reuses
          the SLOT ids its `values` are keyed by. */}
      {settingsOpen && (
        <QuickGameSetupSheet
          format={format}
          purpose="settings"
          onClose={() => setSettingsOpen(false)}
          onStarted={() => {
            // The sheet wrote it; pick the round back up from storage.
            setState(readQuickGameState(format));
            setSettingsOpen(false);
          }}
          danger={
            <>
              <SectionLabel danger>Danger zone</SectionLabel>
              <div className="mt-2 flex flex-col gap-2">
                <DangerRow
                  icon={<RotateCcw size={16} />}
                  tone="warning"
                  label="Clear scores"
                  blurb="Bets will start over."
                  onClick={() => setConfirmReset(true)}
                  testId="quick-game-reset-btn"
                />
                {/* The blank-slate reset: wipes players/course too, not just
                    scores. Storage is per-format, so this only ever touches
                    THIS tile's round. */}
                <DangerRow
                  icon={<Zap size={16} />}
                  tone="danger"
                  label="Reset game"
                  blurb="Clears players, course, scores and bets."
                  onClick={newGame}
                  testId="quick-game-new-btn"
                />
              </div>
            </>
          }
        />
      )}

      {/* Siblings of the sheet, rendered AFTER it: both are `fixed z-50`, so in
          one stacking context the later node paints on top. Nesting them inside
          would put a confirm inside the scrolling form it is asking about. */}
      {confirmReset && (
        <DangerConfirmModal
          tone="warning"
          icon={<RotateCcw size={18} />}
          title="Clear scores?"
          body="Clears every score and starts the round again from hole 1. Your players, handicaps, and course stay exactly as they are. Any bets start over from scratch."
          confirmLabel="Clear scores"
          pendingLabel="Clearing…"
          isPending={false}
          testId="quick-game-reset-confirm"
          onCancel={() => setConfirmReset(false)}
          onConfirm={clearScores}
        />
      )}

      {confirmReplace && (
        <DangerConfirmModal
          tone="danger"
          icon={<Zap size={18} />}
          title="Reset game?"
          body={`This round is in progress — ${quickGameSubtitle(state)}. Resetting clears the players, course, every score and every bet.`}
          confirmLabel="Reset game"
          pendingLabel="Resetting…"
          isPending={false}
          testId="quick-game-new-confirm"
          onCancel={() => setConfirmReplace(false)}
          onConfirm={resetGame}
        />
      )}
    </div>
  );
}
