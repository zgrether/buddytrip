"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReorderableList } from "@/components/ReorderableList";
import { PickemSheetRow } from "./PickemSheetRow";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import { useDraftOutbox } from "@/hooks/useDraftOutbox";
import { draftOutboxRecover } from "@/lib/draftOutbox";
import {
  reconcileSheet,
  applyOrder,
  rankedOrder,
  setPick,
  sheetsEqual,
  type SheetPick,
  type SheetSettings,
} from "@/lib/pickemSheet";
import { draftLostToLock, formatCountdown, type PickemClosure } from "@/lib/pickemLifecycle";

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
export function PickemClosedBanner({ closure }: { closure: PickemClosure | null }) {
  return (
    <Banner tone="info" testId="pickem-sheet-locked">
      <b>
        {closure?.reason === "deadline"
          ? `Picks closed at ${formatClosedAt(closure.at)}.`
          : closure?.reason === "locked"
            ? "Picks are closed — they were ended early."
            : "Picks are closed."}
      </b>{" "}
      {/* The "not even the runner" clause appears ONCE. The first draft put it
          in both sentences, which read as "whoever's running it closed them
          early. Nobody can change one now, including whoever's running it" —
          visible only once rendered. */}
      Nobody can change a sheet now, not even whoever&rsquo;s running it.
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
  onSave: (picks: SheetPick[]) => void;
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
        <Countdown ms={deadlineMs} submitted={server.submitted} subject={subject} />
      )}



      {/* The hint line — what the controls DO, said once at the top rather
          than discovered. Different sentence per variant, because with
          confidence off there is nothing to drag and no top of the list to be
          worth anything. */}
      {editable && (
      <p
        data-testid="pickem-sheet-hint"
        className="px-1"
        style={{ fontSize: 11, color: "var(--color-bt-text-dim)", lineHeight: 1.45 }}
      >
        {settings.useConfidence
          ? `Tap a team to pick it · drag to reorder — the top of the list is worth ${slate.length} · line shown is the home team's`
          : "Tap a team to pick it · every game is worth 1 · line shown is the home team's"}
      </p>
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
              points={settings.useConfidence ? slate.length - index : null}
              editable={editable}
              onPick={(side) => editPicks((prev) => setPick(prev, id, side))}
            />
          );
        }}
      />

      {/* Clearance for the sticky save bar.
          `position: sticky` pins the bar inside the scroller's padding box and
          the list scrolls UNDER it, so at the very bottom of a sixteen-game
          sheet the bar covered the last row — measured at 40px of overlap on the
          final game, which is the one you scrolled all that way to reach. The
          bar's own height plus a little air, reserved so nothing can sit
          beneath it. */}
      {editable && <div aria-hidden style={{ height: 68 }} />}

      {editable && (
        <SaveBar
          subject={subject}
          needsSave={needsSave}
          submitted={server.submitted}
          rankingReset={server.rankingReset}
          dirty={dirty}
          saving={saving}
          error={saveError}
          count={slate.length}
          roadCount={picks.filter((p) => p.pick === "away").length}
          onSave={() => onSave(picks)}
        />
      )}
    </div>
  );
}

// ── pass 1 ─────────────────────────────────────────────────────────────────

// ── pass 2 ─────────────────────────────────────────────────────────────────

// ── chrome ─────────────────────────────────────────────────────────────────

function SaveBar({
  subject,
  needsSave,
  submitted,
  rankingReset,
  dirty,
  saving,
  error,
  count,
  roadCount,
  onSave,
}: {
  subject: SheetSubject;
  needsSave: boolean;
  submitted: boolean;
  rankingReset: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  count: number;
  /**
   * How many ROAD teams have been taken — the one number that says whether a
   * sheet has actually been thought about.
   *
   * A sheet opens on all-home by default (derived, never stored), so "16 of 16
   * picked" is true the instant it renders and measures nothing. That is why
   * there is no progress bar, and why this counts the picks that DEPART from
   * the default instead.
   */
  roadCount: number;
  onSave: () => void;
}) {
  /**
   * What the sheet SAYS about itself, not how many boxes are ticked.
   *
   * The two-pass nudge is gone with the two passes — there is one list now, so
   * there is nowhere to advance to. What replaces it is a description of the
   * sheet: how far it has departed from all-home, which is the only reading
   * that distinguishes a considered sheet from an untouched one.
   *
   * "all chalk" is the phrase for taking every home team. It is the honest
   * default state and reads as a position rather than an omission, because it
   * IS one — a sheet of favourites is a legitimate sheet.
   */
  const roads =
    roadCount === 0
      ? "all chalk, nothing off the home teams yet"
      : `${roadCount} road team${roadCount === 1 ? "" : "s"} taken`;

  /**
   * On somebody else's sheet the footer says WHOSE, and says it in every state.
   *
   * This is the last thing under the thumb that is about to press Save, and the
   * only way this feature goes badly is a person editing what they think is
   * their own sheet. The save STATE is not lost by giving the line up: the
   * button already carries it ("Save picks" / "Save changes" / "Saved" /
   * "Saving…"), so the one line with no other job takes the warning.
   */
  const status = !subject.isSelf
    ? `Entering for ${subject.name} · not your sheet`
    : rankingReset
      ? "Ranking cleared — save to confirm"
      : dirty
        ? `${roads} · unsaved changes`
        : submitted
          ? `Saved · ${roads}`
          : `All ${count} picked · ${roads}`;

  return (
    <div
      // Negative margins cancel the sheet's own side inset so the gradient
      // reaches the panel edges — the bar should look like it belongs to the
      // viewport, while the rows it floats over stay inset.
      className="sticky bottom-0 z-10 -mx-4 -mb-1 mt-1 px-4 pb-3 pt-2 lg:-lg:px-1"
      data-testid="pickem-save-bar"
      style={{
        // Anchored to the bottom of the scroller rather than sitting at the end
        // of the content (CLAUDE.md #14): with sixteen games the end of the
        // content is a long way below the fold.
        // The SAME treatment as the settings slide-over's footer — solid
        // base with a hairline above it — checked against that component
        // rather than guessed. The gradient here was pick'em's own invention
        // and read as a different surface from every other sticky footer.
        background: "var(--color-bt-base)",
        borderTop: "1px solid var(--color-bt-border)",
      }}
    >
      {error && (
        <p
          className="mb-2 rounded-lg px-3 py-2"
          data-testid="pickem-save-error"
          style={{
            fontSize: TYPE_SCALE.caption,
            background: "var(--color-bt-danger-faint)",
            border: "1px solid var(--color-bt-danger-border)",
            color: "var(--color-bt-danger)",
          }}
        >
          {error} {subject.isSelf ? "Your sheet is" : "The sheet is"} still here — try again.
        </p>
      )}
      <div className="flex items-center gap-2.5">
        <span
          className="min-w-0 flex-1 truncate"
          data-testid="pickem-save-status"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
        >
          {status}
        </span>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !needsSave}
          data-testid="pickem-submit"
          className="flex-none rounded-xl px-4 disabled:opacity-40"
          style={{
            height: 40,
            fontSize: TYPE_SCALE.bodyDense,
            fontWeight: 700,
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          {saving
            ? "Saving…"
            : !needsSave
              ? "Saved"
              : submitted
                ? "Save changes"
                : "Save picks"}
        </button>
      </div>
    </div>
  );
}

function Countdown({
  ms,
  submitted,
  subject,
}: {
  ms: number;
  submitted: boolean;
  subject: SheetSubject;
}) {
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
        <span className="block" style={EYEBROW}>
          Picks close in
        </span>
        <span
          className="mt-0.5 block"
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
        >
          {submitted
            ? subject.isSelf
              ? "Your sheet is in — you can still change it"
              : `${subject.name}'s sheet is in — you can still change it`
            : "Change anything until then"}
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
