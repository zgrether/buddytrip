"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReorderableList } from "@/components/ReorderableList";
import { PickemSheetRow } from "./PickemSheetRow";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import { useDraftOutbox } from "@/hooks/useDraftOutbox";
import { draftOutboxRecover } from "@/lib/draftOutbox";
import { PickemFinalizePrompt } from "./PickemFinalizePrompt";
import {
  reconcileSheet,
  applyOrder,
  confirmEmptySheetSave,
  emptySheetWarning,
  fillAll,
  rankedOrder,
  setPick,
  sheetsEqual,
  submittablePicks,
  unpickedCount,
  type PickSide,
  type SheetPick,
  type SheetSettings,
  type SubmittedPick,
} from "@/lib/pickemSheet";
import { draftLostToLock, formatCountdown, type PickemClosure } from "@/lib/pickemLifecycle";
import { paysOut, type SlateResult } from "@/lib/pickemScoring";
import { isPlayedOutcome, type PickOutcome } from "./PickemSheetRow";

/** "Sat 11:00 AM" — a weekday and a clock time, because a deadline people are
 *  told about is spoken that way. No year: a sheet is read within days of it. */
export function formatClosedAt(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * §8.4's closed message, as its own component because it has TWO homes.
 *
 * ── Why it had to come out of the sheet ────────────────────────────────────
 *
 * Watching a real deadline pass caught this: at 0:00 the page switches to the
 * reveal branch, where the sheet collapses behind a "See my picks" button. The
 * banner lived INSIDE the sheet, so the one moment it exists to explain — the
 * countdown hitting zero and everything changing — was the one moment it was
 * hidden. What a person actually saw was their sheet vanish, replaced by a
 * matches panel they had not asked for, with no sentence anywhere saying picks
 * had closed.
 *
 * That is the same falsehood-by-omission §8.4 was written against, arriving
 * through the collapse rather than through the copy. So the reveal branch shows
 * this at the top of the page and tells the nested sheet not to repeat it
 * (`closedBannerHoisted`), which keeps ONE statement on screen in both states.
 */
/**
 * ── THE CLAUSE IS GONE, BECAUSE IT WAS NOT TRUE ───────────────────────────
 *
 * It read "Nobody can change a sheet now, not even whoever's running it." The
 * runner CAN reopen — Start picking is on their panel — so the sentence was
 * false to the one person who could act on it, and told everybody else that a
 * thing they might reasonably ask for is impossible.
 *
 * What is left is the fact and nothing else: when picks closed, and whether the
 * clock or a person did it. Those are different — telling somebody the deadline
 * passed when the runner ended it early is a small lie about why they lost the
 * chance — so the two sentences stay two.
 *
 * The "ended early" phrasing goes with the clause. Without a second sentence to
 * contrast against, "Picks are closed." is the whole statement for a hand lock,
 * and the moment is not knowable there anyway.
 */
export function PickemClosedBanner({ closure }: { closure: PickemClosure | null }) {
  return (
    <Banner tone="info" testId="pickem-sheet-locked">
      <b>
        {closure?.reason === "deadline"
          ? `Picks closed at ${formatClosedAt(closure.at)}.`
          : "Picks are closed."}
      </b>
    </Banner>
  );
}

/**
 * The sheet — sixteen people, once, under time pressure, on a phone.
 *
 * That is the entire design constraint (HANDOFF §1) and everything below is
 * downstream of it.
 *
 * ── Two passes, because they are two different decisions ───────────────────
 * Picking winners is sixteen fast taps down a list you are reading anyway.
 * Ranking is slow, comparative, and needs the whole list visible at once — and
 * by then the rows show only YOUR picks, so you are ordering your own opinions
 * rather than re-reading matchups. Putting a rank control on each pick row
 * instead would interleave the two and make both worse.
 *
 * **With confidence off there is ONE pass and the step navigation does not
 * render at all** (§11: absent, not disabled). A disabled tab advertises a
 * mechanic the game does not have, which is the same defect as the "Not live —
 * scoring disabled" line Phase 2's look caught.
 *
 * ── Everything on the row, because the runner put it there ─────────────────
 * Matchup, spread, kickoff, note, multiplier. Rendered through the SAME module
 * the slate uses (`slateRowVisual`), so the sixteen contests look identical in
 * both places. The multiplier especially: it is visible before picking because
 * a 2× game changes where you spend confidence, and hiding it until the ranking
 * pass would make the first pass a guess.
 *
 * ── This screen never knows who is looking ─────────────────────────────────
 * There is no "runner's sheet". The Owner picks on this component, with this
 * countdown, against this deadline — and `pickem_picks_write` refuses him after
 * it passes exactly as it refuses everyone. Nothing here reads a role, and no
 * submission count appears anywhere (§7.3: that is the runner's number, and
 * showing it to participants manufactures pressure and answers a question
 * nobody asked).
 */

export interface PickemSheetGame {
  id: string;
  awayTeam: string;
  homeTeam: string;
  spread: string | null;
  kickoff: string | null;
  note: string | null;
  multiplier: number;
  /**
   * The outcome, once there is one.
   *
   * Optional because the EDITABLE sheet has no use for it — every caller
   * already passes the slate row that carries it, and the type simply did not
   * admit it. Absent and null both mean "not played", which is safe here for
   * once: this field only ever ADDS a treatment, so a caller that omits it
   * renders exactly the sheet that existed before.
   */
  result?: SlateResult | null;
}

/**
 * What became of one pick — null while the game is unplayed.
 *
 * A push or a cancellation is `void`: DECIDED, and paid nobody. Folding it in
 * with "not played yet" would put the two states that look identical in every
 * number on the row under the same treatment, which is the mistake this
 * feature has now made five times.
 *
 * ── The absence of a pick is answered FIRST, and that ordering is the fix ───
 *
 * It used to fall through to `pick === result`, which is false for a null pick,
 * so an unpicked game on a resolved slate came out "lost" — a struck-through
 * stake on a bet nobody placed. And on an UNRESOLVED game it came out null,
 * which rendered as a plain row indistinguishable from one still waiting to be
 * filled in.
 *
 * ONLY MEANINGFUL ON A CLOSED SHEET, which is why the sole caller gates it on
 * `!editable`: while picks are open an unpicked row is a thing to do, not a
 * result, and stamping it would be scolding somebody mid-sheet.
 */
export function pickOutcome(
  result: SlateResult | null | undefined,
  pick: "away" | "home" | null
): PickOutcome | null {
  if (pick == null) return "unpicked";
  if (result == null) return null;
  if (!paysOut(result)) return "void";
  return pick === result ? "won" : "lost";
}

/**
 * WHOSE sheet this is.
 *
 * Proxy entry (migration 163) means the sheet is no longer always about the
 * person looking at it. `isSelf` is not derived from comparing ids here on
 * purpose — the caller knows, and a component that guesses its own subject is
 * one refactor away from guessing wrong.
 */
export interface SheetSubject {
  userId: string;
  /** Shown in the banner and woven through the copy. */
  name: string;
  isSelf: boolean;
  /** A placeholder can never enter their own — worth saying, not implying. */
  isGuest: boolean;
}

export function PickemSheet({
  gameId,
  slate,
  settings,
  picks: serverPicks,
  subject,
  editable,
  saving,
  saveError,
  deadlineMs,
  closedBannerHoisted = false,
  closure,
  onSave,
  onDirtyChange,
}: {
  gameId: string;
  slate: PickemSheetGame[];
  settings: SheetSettings;
  /**
   * The SUBJECT's stored picks, raw. Reconciled here — see `reconcileSheet`.
   *
   * Renamed from `serverPicks`: in proxy mode that name is a lie, and a name that
   * becomes untrue under a new mode is exactly what `tsc` should be made to
   * find. Same instinct as the copy sweep below.
   */
  picks: SheetPick[];
  /** Whose sheet this is. Defaults to the viewer at every existing call site. */
  subject: SheetSubject;
  /**
   * NOTE — there is deliberately no `pointsMode` here any more.
   *
   * It existed for one reason: the explainer, which said head-to-head things
   * that are false in a points cup. The explainer has moved to the shared rules
   * sheet, and the derivation with it, so this component no longer knows or
   * needs to know what kind of competition it is in.
   *
   * That is the stronger version of what the prop was documenting: a
   * participant cannot tell which competition format they are in from the
   * picking experience, and now neither can the picking experience.
   */
  /** False once picks lock. The whole surface goes read-only; nothing is hidden. */
  editable: boolean;
  saving: boolean;
  saveError: string | null;
  deadlineMs: number | null;
  /** The CALLER is already showing `PickemClosedBanner` above this sheet, so
   *  do not render a second one. Set by the reveal branch, where the sheet is
   *  collapsed behind a button and the message has to live outside it. */
  closedBannerHoisted?: boolean;
  /** Why and when picks closed, for §8.4's message. Null while open. */
  closure: PickemClosure | null;
  /**
   * Takes `SubmittedPick[]`, not `SheetPick[]` — the COMPLETE shape.
   *
   * That is the enforcement, not the disabled button. `completedPicks` returns
   * null for a sheet with a hole in it, so an incomplete sheet cannot be turned
   * into an argument for this callback at all; a caller cannot forget the rule
   * because `tsc` will not let them express breaking it.
   */
  onSave: (picks: SubmittedPick[]) => void;
  /**
   * Fired when the sheet gains or loses unsaved changes.
   *
   * The draft lives in here — it has to, because the outbox and the
   * fingerprint-stamped edit are this component's own machinery — so the parent
   * cannot compute this. It is a report, not a control: nothing here changes
   * behaviour on it.
   */
  onDirtyChange?: (dirty: boolean, picks: SubmittedPick[]) => void;
}) {
  const server = useMemo(
    () => reconcileSheet(slate, serverPicks, settings),
    [slate, serverPicks, settings]
  );

  /**
   * The server sheet as a string — the identity of "what the server currently
   * holds", and the pivot the whole edit model turns on.
   */
  const fingerprint = useMemo(() => JSON.stringify(server.picks), [server.picks]);

  /**
   * The local edit, STAMPED with the server state it diverged from.
   *
   * The stamp is what removes the two effects this used to need. A landed save
   * (or another device's save, or a reopen) moves the fingerprint, at which
   * point the edit no longer matches and `working` falls back to the server
   * sheet on the very next render — no `useEffect`, no `setState` during
   * render, nothing to get the ordering wrong. It also fixes the case an effect
   * handles badly: an edit made against a slate that has since changed is
   * DISCARDED rather than replayed onto a sheet it was never about.
   *
   * Discarding rather than clearing is also what makes a FAILED save keep the
   * sheet (CLAUDE.md #15). A failure leaves the server unchanged, so the
   * fingerprint does not move, so the edit is still here with its error beside
   * it — the "roll back to blank" outcome is not expressible in this shape.
   */
  const [edit, setEdit] = useState<{ base: string; picks: SheetPick[] } | null>(() => {
    // Recovered from the outbox on the FIRST render rather than in an effect.
    // Safe on the server (the helper is SSR-guarded and returns null) and never
    // a hydration mismatch, because this component only mounts once the tRPC
    // query has resolved, which is client-side.
    const stored = draftOutboxRecover("pickem", gameId, JSON.stringify(server.picks)) as
      | SheetPick[]
      | null;
    return stored ? { base: JSON.stringify(server.picks), picks: stored } : null;
  });
  const working = edit && edit.base === fingerprint ? edit.picks : null;

  /**
   * Every edit is a FUNCTION of the previous sheet, never of the sheet captured
   * at render time.
   *
   * React batches updates inside one tick, so `setEdit({ picks: setPick(picks,
   * …) })` computes all of a batch from the same stale `picks` and only the last
   * one survives. Two taps landing in the same tick is not the common case — a
   * person tapping sixteen buttons gets a render between each — but it is
   * reachable on a fast double-tap, and it costs nothing to make unreachable.
   *
   * Found by clicking three away buttons in one script turn and getting one
   * selection. That specific probe was the same shape as Phase 2's synthetic
   * pointermoves — too synchronous to be a real user — so it is worth being
   * clear that the FIX is not for the probe: the functional form is simply the
   * correct one, and a state derived from a render-time snapshot is a bug
   * waiting for a slower phone.
   */
  const editPicks = (fn: (prev: SheetPick[]) => SheetPick[]) =>
    setEdit((prev) => ({
      base: fingerprint,
      picks: fn(prev && prev.base === fingerprint ? prev.picks : server.picks),
    }));

  /**
   * A DRAFT CAUGHT BY THE LOCK — survived, or discarded VISIBLY.
   *
   * The complaint that got read as "the Save button is the problem" was never
   * the button. It was the silence: a person mid-edit when the deadline lands
   * had the sheet go read-only under them and their typing vanish with nothing
   * on screen saying so. Autosave would have hidden the same moment differently.
   *
   * The picks genuinely cannot be kept — `pickem_picks_write` gates on
   * `pickem_picks_open`, so the server refuses them the instant the clock
   * turns. So this is the honest half: notice the transition, and SAY it.
   *
   * Latched, not derived. Once it has happened it stays said, because
   * `editable` going false also clears the conditions that produced it.
   */
  const [lostToLock, setLostToLock] = useState(false);
  const wasEditable = useRef(editable);

  const picks = working ?? server.picks;
  const dirty = working != null && !sheetsEqual(working, server.picks);
  /**
   * Reads the EDGE — editable going true→false — not the state, because once
   * the sheet is read-only `dirty` stops meaning anything and the banner still
   * has to be true about a moment that has passed.
   *
   * `dirty` is in the deps and the ref is written INSIDE the effect: a ref
   * assigned during render is a rules-of-hooks violation, and eslint says so.
   * The guard is what keeps the extra runs harmless — once `wasEditable` is
   * false the branch cannot fire again, so a later `dirty` change cannot latch
   * this after the fact.
   */
  useEffect(() => {
    // Disabled deliberately: this is a one-shot EDGE latch, not a cascade.
    // The guard means it can fire at most once per mount, and the alternative —
    // deriving it — is impossible, because the fact being recorded is that a
    // value USED to be true.
    if (draftLostToLock({ wasEditable: wasEditable.current, editable, dirty })) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLostToLock(true);
    }
    wasEditable.current = editable;
  }, [editable, dirty]);

  /**
   * Durability, through the EXISTING outbox (§7.4: do not build a fifth).
   *
   * Someone picks twelve of sixteen on the 12th tee and the phone dies. The
   * hook mirrors on every edit and commits synchronously on `pagehide` /
   * `visibilitychange`, which is the one window React cleanup structurally
   * cannot reach.
   *
   * Nothing here CLEARS the entry after a save, and that is the hook's design
   * rather than an omission: `serverFingerprint` is the base, so a stored draft
   * whose base no longer matches is dropped by `draftOutboxRecover` on read.
   * A saved sheet has moved the fingerprint, so its stale entry can never come
   * back — and neither can a draft written before the runner reopened the slate,
   * which would otherwise restore the exact ranking the reopen invalidated.
   */
  useDraftOutbox<SheetPick[]>({
    view: "pickem",
    gameId,
    draft: picks,
    touched: working != null,
    serverFingerprint: fingerprint,
    enabled: editable,
    /**
     * WHOSE draft. Required here, not optional in spirit.
     *
     * One game can now hold several drafts — a captain part-way through a
     * teammate's sheet and their own. Keyed on `(view, gameId)` alone those
     * share a slot, and `serverFingerprint` cannot separate them: it is
     * `JSON.stringify(server.picks)`, and two people who have never submitted
     * have identical empty sheets. So the guard built to reject a mismatched
     * draft is blind exactly here, and the teammate's draft restores into the
     * captain's own sheet with nothing on screen able to say so.
     */
    scope: subject.userId,
  });

  const gameById = useMemo(() => new Map(slate.map((g) => [g.id, g])), [slate]);
  const order = useMemo(() => rankedOrder(picks), [picks]);


  /**
   * The sheet as a PAYLOAD — the games actually picked, and only those.
   *
   * Computed once and threaded to both the gate and the handler, so "can I
   * save" and "what do I save" cannot answer differently — the shape of every
   * one-of-two-checks bug in this file's history.
   */
  const ready = submittablePicks(picks);
  /**
   * Saving nothing is legal, and nobody was telling them.
   *
   * It is the same as not submitting — `submitted` is `stored.length > 0`, so an
   * empty sheet reads as "nothing submitted" on the board and in the count a
   * captain chases from. That is the right model; the gap was that pressing Save
   * on an empty sheet said nothing about it. Before the client floor came off it
   * was refused with a raw validation payload; after, it was a press that
   * quietly did nothing. Neither tells a person they are about to have no picks.
   */
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const needsEmptyConfirm = confirmEmptySheetSave({
    picked: ready.length,
    submitted: server.submitted,
  });
  const remaining = unpickedCount(picks);

  /**
   * Report the edge, not the state, and report it to a ref-stable callback.
   *
   * `dirty` is already the honest predicate — it is false until the working
   * sheet actually DIFFERS from the server's, so an opened-but-untouched sheet
   * never raises it. That is what keeps the confirm-on-leave prompt from firing
   * on a sheet nobody edited, which is the failure that trains people to
   * dismiss the prompt without reading it.
   */
  useEffect(() => {
    onDirtyChange?.(dirty, ready);
  }, [dirty, ready, onDirtyChange]);

  /**
   * SAVE ENABLES ON ANY CHANGE, not on completeness.
   *
   * It used to require a full sheet, which is what migration 150's server gate
   * demanded. Both are gone (166): a sheet can be saved at any point, so
   * progress lives on the server rather than only in a localStorage draft that
   * a lost phone takes with it.
   *
   * The condition is unchanged apart from dropping that requirement — there
   * still has to be something to save, or the button is offering to write what
   * is already there.
   */
  const needsSave = editable && (!server.submitted || server.rankingReset || dirty);

  return (
    /**
     * ── Horizontal inset, and why it is not only cosmetic ─────────────────
     *
     * Below `lg` the game panel is `fixed inset-x-0` with no side padding, so
     * every row ran edge to edge — measured at 390: row left 0, right 0, width
     * 390. That looks cramped, and on the RANK pass it is a functional problem:
     * `controlsSide="trailing"` puts the drag grip against the right edge,
     * inside the zone where the OS reads a horizontal drag as a back gesture.
     * Reported as the drag "leaking through to the page behind, or triggering
     * back". Moving the grip inboard is the fix actually available to a web
     * page: a system edge-swipe cannot be cancelled from inside one, whatever
     * `touch-action` says. 16px puts the grip's right edge 16px in — measured —
     * which is at the boundary of the zone rather than clear of it, so if a
     * drag started ON the grip still fights the gesture on a real device, the
     * next move is to widen further or drop the grip and keep the arrows, which
     * sit 32px further in and have never been part of this problem.
     *
     * `lg:px-0` because at `lg+` the panel is a normal-flow child of the shell's
     * `CONTENT_INSET` and already has padding; adding more would double it.
     *
     * `overscrollBehaviorX: contain` stops a horizontal drag that escapes the
     * list from chaining into the scroll container behind it, which is the other
     * half of what "leaks through" describes.
     */
    <div
      className="flex flex-col gap-3 px-4 lg:px-0"
      style={{ overscrollBehaviorX: "contain" }}
    >

      {/* §8.4 — a control that stopped working with no explanation is the
          falsehood pattern. A silently read-only sheet reads as a broken app;
          naming the moment reads as a rule. */}
      {!editable && !closedBannerHoisted && <PickemClosedBanner closure={closure} />}

      {/*
        A draft the lock caught. NOT dismissible, and it outranks everything
        below it because it is the only thing on the page reporting a loss.

        The picks cannot be recovered — `pickem_picks_write` gates on
        `pickem_picks_open`, so the server refuses them the moment the clock
        turns, and pretending otherwise would be worse than the silence this
        replaces. What was wrong before was that it happened invisibly: the
        sheet went read-only and the typing vanished with nothing said.

        Named as what it is, and it says what DID survive, because "your changes
        are gone" without that reads as though the whole sheet went.
      */}
      {lostToLock && (
        <Banner tone="warn" testId="pickem-lost-to-lock">
          <b>Picks closed while you were editing.</b>{" "}
          {subject.isSelf ? "Your unsaved changes" : "The unsaved changes"} could not be
          saved — the last sheet {subject.isSelf ? "you" : "they"} saved is the one that
          counts.
        </Banner>
      )}

      {editable && server.rankingReset && (
        <Banner tone="warn" testId="pickem-ranking-reset">
          <b>The slate changed.</b>{" "}
          {subject.isSelf ? "Your winners were" : `${subject.name}'s winners were`} kept,
          but {subject.isSelf ? "your" : "their"} ranking was cleared
          — put them back in order and save.
        </Banner>
      )}

      {editable && deadlineMs != null && (
        <Countdown ms={deadlineMs} />
      )}



      {saveError && (
        <p
          className="rounded-lg px-3 py-2"
          data-testid="pickem-save-error"
          style={{
            fontSize: TYPE_SCALE.caption,
            background: "var(--color-bt-danger-faint)",
            border: "1px solid var(--color-bt-danger-border)",
            color: "var(--color-bt-danger)",
          }}
        >
          {saveError} {subject.isSelf ? "Your sheet is" : "The sheet is"} still here — try
          again.
        </p>
      )}

      {/*
        ── THE SAVE BUTTON SITS ON THE HINT LINE ────────────────────────────

        It had a band of its own — a sticky bar with a hairline, its own
        padding and a status sentence — which is a lot of screen for one button
        on a page whose entire job is a list. Two rows already existed above the
        list with room to their right, so the two things that bar carried moved
        onto them: the BUTTON here, the COUNT on the shortcuts row.

        Nothing was lost with the status line. It said four things and three had
        somewhere better: whose sheet it is, which the proxy banner says in a
        treatment this could not compete with; that the ranking was cleared,
        which has its own banner; and that there are unsaved changes, which is
        the button reading "Save changes" rather than "Saved". The fourth was
        the count, which is now beside the shortcuts.

        The hint WRAPS and the button does not — `min-w-0` on the text, `shrink-0`
        on the control. A wrapped sentence is fine; a Save button that has lost
        half its label is not.
      */}
      {editable && (
        <div className="flex items-start gap-2.5 px-1">
          <p
            data-testid="pickem-sheet-hint"
            className="min-w-0 flex-1"
            style={{ fontSize: 11, color: "var(--color-bt-text-dim)", lineHeight: 1.45 }}
          >
            {/* Two sentences rather than three clauses joined by middots. The
                old line ran "Tap a team to pick it · drag to reorder — the top
                of the list is worth 16 · line shown is the home team's", which
                is three unrelated facts at one weight, and the one that
                mattered least was the one with the number in it.

                The spread's ownership moved out of here because it is on the
                ROW, next to the team it belongs to — a legend for a badge
                sitting six pixels away is a legend nobody needs. */}
            {settings.useConfidence
              ? "Tap a team to make it your pick. Order with confidence where each pick earns the points shown."
              : "Tap a team to make it your pick. Every game is worth the same."}
          </p>
          <button
            type="button"
            /* `ready` is the PICKED games, which is exactly what the RPC
               stores. A game left out is a game whose pick is cleared, because
               the write replaces the sheet rather than merging into it. */
            /* Intercepted when the sheet is empty — the confirm is a question
               ABOUT this save, so it sits in front of the same handler rather
               than becoming a second way to submit. */
            onClick={() => (needsEmptyConfirm ? setConfirmingEmpty(true) : onSave(ready))}
            disabled={saving || !needsSave}
            data-testid="pickem-submit"
            className="shrink-0 rounded-xl px-4 disabled:opacity-40"
            style={{
              height: 36,
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 700,
              background: "var(--color-bt-accent)",
              color: "var(--color-bt-base)",
            }}
          >
            {/*
              UNFINISHED IS NOT SAVED, and the first build of this said it was.

              `needsSave` is false for two opposite reasons — there is nothing
              to save, and there is something to save that cannot be sent yet —
              so a label keyed on it alone read "Saved" over an empty sheet.
              That is the falsehood pattern in three letters: the one word on
              screen a person would take as confirmation, on a sheet holding
              nothing at all.

              `ready` separates them, and it is checked FIRST for that reason.

              ── AND CLEARING IS NOT SAVING ──────────────────────────────────

              An empty sheet over stored rows is a real act — "I have unpicked
              everything" — and the write replaces rather than merges, so
              pressing it DELETES what the server holds. That must not look
              identical to saving a full sheet.

              Gated on `server.submitted` as well as on the sheet being empty,
              because with nothing stored there is nothing to clear: the same
              press would then be an ordinary first save of nothing, and
              offering to clear would name an act that does not happen.

              (Until this change the press was refused outright — the client
              schema carried a `min(1)` the server never had — and the refusal
              rendered the raw zod payload on screen. Both halves are gone.)
            */}
            {saving
              ? "Saving…"
              : !needsSave
                ? "Saved"
                : ready.length === 0 && server.submitted
                  ? "Clear my picks"
                  : server.submitted
                    ? "Save changes"
                    : "Save picks"}
          </button>
        </div>
      )}

      {/*
        THE SHORTCUTS, and they are what makes removing the default safe.

        The old sheet opened on every home team, which is a real position — a
        sheet of favourites — and taking it away would have made the honest
        version cost sixteen taps. These put it back at one, with the difference
        that somebody chose it: "All home, then Save" reproduces the old default
        sheet exactly, ranking included.

        They set PICKS ONLY. Re-ordering the list as a side effect would be a
        second decision nobody asked for, and it is also what keeps that
        equivalence exact.

        Quiet, and deliberately not primary: the sheet is sixteen decisions and
        these are the way to skip them, which is a legitimate move and not the
        one to advertise. They sit ABOVE the list, where they are read before
        the work rather than offered after it.

        The COUNT rides the far end of this row, directly over the top-right of
        the games it is counting. It reads "9 of 16 picked" and stops there —
        "7 to go" was the same fact subtracted, printed beside itself.
      */}
      {editable && (
        <div className="flex items-center gap-2 px-1" data-testid="pickem-sheet-shortcuts">
          <span style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}>Or take</span>
          {(
            [
              ["home", "All home"],
              ["away", "All away"],
            ] as const
          ).map(([side, label]) => (
            <button
              key={side}
              type="button"
              data-testid={`pickem-sheet-all-${side}`}
              onClick={() => editPicks((prev) => fillAll(prev, side as PickSide))}
              className="rounded-lg px-2.5"
              style={{
                minHeight: 30,
                fontSize: 11.5,
                fontWeight: 600,
                background: "transparent",
                border: "1px solid var(--color-bt-border)",
                color: "var(--color-bt-text)",
              }}
            >
              {label}
            </button>
          ))}
          <span className="flex-1" />
          <span
            data-testid="pickem-sheet-progress"
            style={{
              fontSize: 11.5,
              fontWeight: remaining > 0 ? 600 : 400,
              fontVariantNumeric: "tabular-nums",
              color: remaining > 0 ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
            }}
          >
            {slate.length - remaining} of {slate.length} picked
          </span>
        </div>
      )}

      {/*
        ONE LIST, and the row is the control.

        This replaces a two-pass step nav — "1 · Pick winners" then "2 · Rank
        them" — which split one sheet into two screens over the same sixteen
        games. The rank chip and the tap targets now live in the same row, so
        the order you are building is visible while you are picking.

        `ReorderableList` owns the drag: pointer events with
        `setPointerCapture` and `touch-action: none`, the seven-point recipe
        that already exists. `enabled` is the confidence switch — false gives
        plain rows with no grip and no sortable wrappers at all, which IS the
        confidence-off product rather than a disabled version of this one.
      */}
      <ReorderableList
        ids={order}
        enabled={settings.useConfidence && editable}
        controlsSide="trailing"
        listClassName="flex flex-col gap-1.5"
        labelOf={(id) => {
          const g = gameById.get(id);
          return g ? `${g.awayTeam} at ${g.homeTeam}` : "game";
        }}
        onReorder={(next) => editPicks((p) => applyOrder(p, next))}
        renderRow={(id, index) => {
          const g = gameById.get(id);
          if (!g) return null;
          const p = picks.find((x) => x.slateGameId === id);
          /**
           * Only on the READ-ONLY sheet.
           *
           * The dimming says "this is settled". On a sheet that can still be
           * edited that reads as disabled, and the row is not — a resolved game
           * is still tappable while picks are open, because nothing stops a
           * runner entering a Thursday result on a Wednesday-opened slate.
           */
          const outcome = editable ? null : pickOutcome(g.result, p?.pick ?? null);
          /**
           * ── The chip answers a different question either side of the result ──
           *
           * UNPLAYED, it is the RANK: what this position is worth, renumbering
           * as the row is dragged. It must not carry the multiplier there — the
           * hint line one screen up promises "the top of the list is worth 16",
           * and a number that moves with the drag has to be the thing the drag
           * changes.
           *
           * PLAYED, the drag is over and the question becomes what the game was
           * worth, which is the rank TIMES the multiplier. A 2× game at the top
           * of a sixteen-game slate was worth 32, and 32 is the number a person
           * reading a finished sheet is looking for.
           *
           * Applied to every resolved row rather than only the correct ones. The
           * stake does not depend on how it went — a 2× game missed cost 32, not
           * 16 — and gating the multiplier on correctness would print two
           * different numbers for the same position depending on the outcome,
           * which stops the column being readable as a column. The ×2 badge
           * stays on the row either way, because it is what explains the 32.
           *
           * Confidence off gives every game 1, and with the game unplayed the
           * chip stays absent — a "1" nobody chose is noise. Once it HAS been
           * played the chip appears either way, because it is carrying the
           * outcome and there is nowhere else on the row for that to go.
           */
          const rank = settings.useConfidence ? slate.length - index : 1;
          const played = isPlayedOutcome(outcome);
          const stake = played ? rank * (g.multiplier ?? 1) : rank;
          /**
           * NO CHIP on a row nobody picked — the stamp is standing in for it.
           *
           * The chip is the STAKE, and an unpicked game carries none. Printing
           * the position's value there would be the same decided-nothing-as-a-
           * number mistake one column over from the one the stamp just fixed:
           * a person scanning a finished sheet would read 3 and conclude three
           * points were on this game.
           */
          const points =
            outcome === "unpicked" ? null : settings.useConfidence || played ? stake : null;
          return (
            <PickemSheetRow
              game={{
                id: g.id,
                awayTeam: g.awayTeam,
                homeTeam: g.homeTeam,
                spread: g.spread ?? null,
                multiplier: g.multiplier ?? 1,
                kickoff: g.kickoff ?? null,
                note: g.note ?? null,
              }}
              pick={p?.pick ?? null}
              // The chip shows what THIS POSITION is worth, derived from the
              // index — never a stored confidence beside the order.
              points={points}
              outcome={outcome}
              editable={editable}
              onPick={(side) => editPicks((prev) => setPick(prev, id, side))}
            />
          );
        }}
      />

      {/* Asked at the tap, never standing on the page — an empty sheet is an
          ordinary thing to be looking at, and a permanent notice about it would
          be the banner mistake the finalize confirm already had to undo. */}
      {confirmingEmpty && (
        <PickemFinalizePrompt
          title="No picks to save"
          message={emptySheetWarning(server.submitted)}
          confirmLabel={server.submitted ? "Clear my picks" : "Save an empty sheet"}
          pendingLabel="Saving…"
          cancelLabel="Keep picking"
          pending={saving}
          onConfirm={() => {
            setConfirmingEmpty(false);
            onSave(ready);
          }}
          onCancel={() => setConfirmingEmpty(false)}
        />
      )}
    </div>
  );
}

// ── pass 1 ─────────────────────────────────────────────────────────────────

// ── pass 2 ─────────────────────────────────────────────────────────────────

// ── chrome ─────────────────────────────────────────────────────────────────

/**
 * DELETED: `SaveBar`.
 *
 * A sticky band with a hairline, its own padding, a status sentence and the
 * button. That is a lot of screen for one control on a page whose entire job is
 * a list of sixteen rows — and with the band gone the two rows above the list
 * had room for both things it carried.
 *
 * Its "all chalk / N road teams taken" line went with it, and its reason went
 * first: it existed because the sheet opened pre-filled, so "16 of 16 picked"
 * was true the instant it rendered and counting DEPARTURES from the default was
 * the only honest measure of whether a sheet had been thought about. Nothing is
 * pre-filled now, so the plain count means what it says.
 */
function Countdown({ ms }: { ms: number }) {
  // `ms` re-derives from the page's ticking clock every second (`useNow` in
  // PickemGameView), and so does the `editable` flag that gates this whole
  // block — one source, so the timer cannot reach zero on a sheet that is still
  // accepting picks.
  const urgent = ms < 3_600_000;
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5"
      data-testid="pickem-countdown"
      style={{
        background: "var(--color-bt-card)",
        border: `1px solid ${urgent ? "var(--color-bt-warning-border)" : "var(--color-bt-border)"}`,
      }}
    >
      <span className="min-w-0 flex-1">
        {/* THE EYEBROW AND THE CLOCK, and nothing else.
            The line under it said "Change anything until then" before a sheet
            was saved and "Your sheet is in — you can still change it" after,
            which is the same promise twice: that nothing is final until the
            clock runs out. That is what a countdown MEANS, and a countdown that
            has to explain itself is one nobody would have needed. */}
        <span className="block" style={EYEBROW}>
          Picks close in
        </span>
      </span>
      <span
        style={{
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          color: urgent ? "var(--color-bt-warning)" : undefined,
        }}
      >
        {formatCountdown(ms)}
      </span>
    </div>
  );
}

function Banner({
  tone,
  testId,
  children,
}: {
  tone: "info" | "warn";
  testId: string;
  children: React.ReactNode;
}) {
  const info = tone === "info";
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      data-testid={testId}
      style={{
        fontSize: TYPE_SCALE.caption,
        lineHeight: 1.5,
        background: info ? "var(--color-bt-planning-faint)" : "var(--color-bt-warning-faint)",
        border: `1px solid ${info ? "var(--color-bt-planning-border)" : "var(--color-bt-warning-border)"}`,
        color: "var(--color-bt-text)",
      }}
    >
      {children}
    </div>
  );
}
