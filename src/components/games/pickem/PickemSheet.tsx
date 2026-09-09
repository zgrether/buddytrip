"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
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
import { draftLostToLock, formatCountdownParts, type PickemClosure } from "@/lib/pickemLifecycle";
import { ValueUnitParts } from "@/components/ValueUnit";
import { sheetStateColor, sheetStateLine } from "./PickemOtherPicks";
import { paysOut, type SlateResult } from "@/lib/pickemScoring";
import { TRIP_TIME_ZONE, TRIP_TIME_ZONE_LABEL, tripZoneNote } from "@/lib/tripTimeZone";
import { isPlayedOutcome, type PickOutcome } from "./PickemSheetRow";

/** "Sat 11:00 AM" — a weekday and a clock time, because a deadline people are
 *  told about is spoken that way. No year: a sheet is read within days of it. */
/**
 * IS THIS ROW'S PICK ACTUALLY SAVED?
 *
 * ── Why a per-row answer was needed ──────────────────────────────────────
 *
 * The header count now reads the server, so "Submitted 5/16" is true again.
 * It says nothing about WHICH five. A row you picked a moment ago and a row
 * saved yesterday are drawn identically — the same teal name, the same
 * selected segment — so a sheet mid-edit looks entirely submitted, which is
 * the half of the report the counter fix did not reach.
 *
 * ── Equality, not a dirty flag ───────────────────────────────────────────
 *
 * Saved means THIS game's pick matches what the server holds for it. Picking
 * home, changing to away, and changing back to home leaves the row saved —
 * because it is: the stored value and the drafted value agree, and there is
 * nothing outstanding for this game however much tapping happened.
 *
 * A row with no pick is never marked. There is nothing to have saved, and a
 * tick on an empty row would be claiming an absence was stored — the
 * empty-is-not-unknown mistake in its cheapest form.
 */
export function pickIsSaved(
  slateGameId: string,
  draft: SheetPick[],
  stored: SheetPick[]
): boolean {
  const mine = draft.find((x) => x.slateGameId === slateGameId)?.pick ?? null;
  if (mine == null) return false;
  return mine === (stored.find((x) => x.slateGameId === slateGameId)?.pick ?? null);
}

/**
 * When picks closed, in the TRIP zone and labelled "ET".
 *
 * Device-local before, which put it in a different frame from the kickoff
 * strings on the same screen — "Picks closed at Wed 8:10 PM" one state east
 * and "Wed 7:10 PM" one state west, against an unmoved "8:20p". The instant
 * was right both times; only one of the two clocks on the screen could move,
 * so neither should.
 */
export function formatClosedAt(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  const stamp = d.toLocaleString("en-US", {
    timeZone: TRIP_TIME_ZONE,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${stamp} ${TRIP_TIME_ZONE_LABEL}`;
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
  /**
   * The contest score (migration 180), for a game that has finished.
   *
   * Optional for the same reason `result` is: an editable sheet has no use
   * for it, and absent renders the sheet that existed before scores did.
   * BOTH OR NEITHER is enforced downstream, in `MatchupLine` — one number is
   * not a score, and manual entry passes through that state.
   */
  awayScore?: number | null;
  homeScore?: number | null;
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
    //
    // ── THE SCOPE, WITHOUT WHICH THIS READS A KEY NOTHING EVER WROTE ─────
    //
    // The write below passes `scope: subject.userId`, and `storeKey` appends
    // it: `bt.draft.v1:pickem:<game>:<user>`. This read omitted it, so it
    // looked under `bt.draft.v1:pickem:<game>` — a key with nothing in it,
    // ever. Recovery for this sheet was dead from the moment the scope was
    // added for proxy entry, and dead silently: a miss and an absent draft
    // are the same `null`, so the machinery looked wired and restored
    // nothing.
    //
    // Pick'em is the ONLY view that calls `draftOutboxRecover` directly —
    // every other format goes through `useDraftOutbox`'s own `recover`,
    // which forwards the scope it was given. Bypassing the hook is what let
    // the two sides of one key drift apart.
    const stored = draftOutboxRecover("pickem", gameId, JSON.stringify(server.picks), subject.userId) as
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
   * Does THIS slate carry a weighted game?
   *
   * The hint line branches on it, because a sentence about multipliers on a
   * flat slate points at a chip that is not drawn: `MatchupLine` renders no
   * multiplier markup at all at 1× (pinned in `pickemConvergence.test.tsx`,
   * "draws none at all on an ordinary game"). Telling a reader to look for
   * something absent is the same defect as a refusal naming an action that
   * cannot be performed — they go looking, find nothing, and conclude the
   * screen is broken rather than that the sentence is.
   *
   * Absent reads as 1, never as 0, exactly as `pickemMatchCard` has it.
   */
  const anyWeighted = useMemo(() => slate.some((g) => (g.multiplier ?? 1) > 1), [slate]);

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
  /** The DRAFT's unpicked count — what is on screen, saved or not. */
  const remaining = unpickedCount(picks);
  /**
   * THE SUBMITTED COUNT, AND IT READS THE SERVER BECAUSE THAT IS WHAT THE
   * WORD MEANS.
   *
   * ── The bug ────────────────────────────────────────────────────────────
   *
   * This was `slate.length - remaining` — the DRAFT. Save five of sixteen and
   * the line correctly read "Submitted 5/16"; carry on picking without
   * saving and it counted up with every tap, all the way to "Submitted
   * 16/16", while the server still held five. Leaving then lost eleven picks
   * the screen had just said were submitted.
   *
   * That is the staged-state lie (#18) in its purest form: a value repointed
   * at the draft while the WORD around it still promises the server. The
   * reader is not wrong to believe it — "Submitted" is a claim about what
   * was stored, and there is no reading of it that means "typed".
   *
   * ── Why the server count and not a re-wording ──────────────────────────
   *
   * The other repair is to keep the draft number and rename the line, which
   * is what the PROXY branch below already does — it says "N of M picked",
   * claims nothing about storage, and has always been honest. That would fix
   * the lie and lose the fact: on your OWN sheet, how much of it is actually
   * saved is the thing worth knowing, and it is the only place it is said.
   *
   * So the count moves to the server and the word stays true. While a draft
   * is outstanding the line holds still at what was stored — which reads as
   * a discrepancy, and IS one: the Save bar is showing at the same time
   * (`needsSave` is dirty-driven), and those two together are the honest
   * description of the state.
   *
   * `server.picks` is slate-length by construction — `reconcileSheet` maps over
   * the slate and fills an unstored game with `pick: null` — so this subtraction
   * is exact and does not depend on how much was stored.
   */
  const submittedCount = slate.length - unpickedCount(server.picks);

  /**
   * MY PICKS' status line — Other Picks' three tones (`sheetStateLine`), with
   * the phase branch INVERTED (`invertPhaseTone: true`).
   *
   * Why inverted, and not the same branch Other Picks uses: the rule
   * underneath both is "flag incompleteness when it is consequential to the
   * READER right now". For somebody else's sheet that moment is after the
   * lock — half-finished is none of your business while they can still change
   * it, and worth knowing once they can't. For YOUR OWN sheet it is the
   * opposite moment: partial is actionable exactly while picks are open (you
   * can still finish it), so THAT is when it gets amber. Once closed it is
   * settled and amber would be nagging about something no longer fixable — the
   * text still reads "Submitted 12/16" so the fact survives, only the tone
   * drops to neutral. Copying Other Picks' branch here would leave an
   * incomplete sheet looking calm at exactly the moment you could still fix
   * it, which is the likeliest way this ships wrong.
   *
   * Scoped to `subject.isSelf` at the render site, not here — this component
   * also renders a PROXY sheet (`isSelf: false`, filling in for somebody else)
   * through the exact same shortcuts row, and that surface is out of this
   * change's scope ("My Picks only"). Computed unconditionally because it is
   * cheap and reading it does not commit to rendering it.
   */
  const myStatus = sheetStateLine(
    { picked: submittedCount, total: slate.length, isGuest: subject.isGuest },
    editable,
    { invertPhaseTone: true },
  );

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
          {/*
            ── "TRY AGAIN" ONLY WHERE TRYING AGAIN CAN WORK ─────────────────

            The tail was unconditional, so the one refusal a retry can never
            clear got it too: a save that failed because PICKS ARE CLOSED came
            back as "Picks are closed — the deadline passed or the runner
            closed them. Your sheet is still here — try again." Pressing Save
            again produces the identical sentence, for ever.

            That is the refusal rule — a message must name an action the reader
            can take — and this one named the single action guaranteed to fail.

            `editable` is the right condition rather than matching on the
            message: it is the same predicate the server gates the write on, so
            the copy cannot promise a retry the RPC would refuse. Every OTHER
            failure here — a network drop, a conflict, a validation refusal —
            happens on a still-open sheet and IS worth retrying, so those keep
            the tail they had.
          */}
          {saveError}{" "}
          {editable ? (
            <>{subject.isSelf ? "Your sheet is" : "The sheet is"} still here — try again.</>
          ) : (
            /* No instruction, because there is no longer an action. Saying so
               is the whole of what this reader needs — and inventing one ("ask
               the runner to reopen") would be the same mistake again, since
               migration 165 refuses reopening once anything is scored. */
            <>
              {subject.isSelf ? "Your unsaved picks were" : "These unsaved picks were"} not
              recorded.
            </>
          )}
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
                sitting six pixels away is a legend nobody needs.

                ── FOUR SENTENCES, NOT TWO, AND THE MULTIPLIER IS WHY ────────

                The weight applies in BOTH modes — `pickPoints` is confidence ×
                multiplier with confidence on and 1 × multiplier with it off —
                so "Every game is worth the same" was false on a weighted slate
                and "each pick earns the points shown" is false on one too. The
                chip beside a row is the RANK while the sheet is editable, on
                purpose (see the stake comment down in the list): a 2× game at
                the top of sixteen shows 16 and pays 32.

                Both sentences are still the right ones on a FLAT slate, which
                is why this branches on the slate rather than replacing them —
                see `anyWeighted`. */}
            {settings.useConfidence
              ? anyWeighted
                ? "Tap a team to make it your pick. Order with confidence where each pick earns the points shown, times any multiplier on the row."
                : "Tap a team to make it your pick. Order with confidence where each pick earns the points shown."
              : anyWeighted
                ? "Tap a team to make it your pick. Check for a multiplier — some games are worth more than others."
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
          {/* MY sheet gets the tone-based status (`myStatus`, computed above).
              A PROXY sheet (`isSelf: false` — a delegate filling in for
              somebody else) keeps the old plain rendering unchanged: this
              change is My Picks only, and retrofitting the tone system onto
              proxy entry is scope this spec did not ask for. */}
          {subject.isSelf ? (
            myStatus && (
              <span
                data-testid="pickem-sheet-progress"
                data-tone={myStatus.tone}
                style={{
                  fontSize: 11.5,
                  fontWeight: myStatus.tone === "none" ? 400 : 600,
                  fontVariantNumeric: "tabular-nums",
                  color: sheetStateColor(myStatus.tone),
                }}
              >
                {myStatus.text}
              </span>
            )
          ) : (
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
          )}
        </div>
      )}

      {/* CLOSED, and it is MY sheet — the case that did not exist before this
          change. The shortcuts row above is `editable`-gated (there is
          nothing to shortcut once picks are locked), which used to take the
          status line down with it: a partial sheet said NOTHING once closed,
          rather than saying it calmly. Same `myStatus`, same text — only the
          tone moved, from amber (while you could still act) to neutral (now
          that you can't). Proxy sheets and a truly read-only OTHER sheet
          never reach this: both pass `subject.isSelf: false`. */}
      {!editable && subject.isSelf && myStatus && (
        <div className="flex items-center justify-end px-1">
          <span
            data-testid="pickem-sheet-progress"
            data-tone={myStatus.tone}
            style={{
              fontSize: 11.5,
              fontWeight: myStatus.tone === "none" ? 400 : 600,
              fontVariantNumeric: "tabular-nums",
              color: sheetStateColor(myStatus.tone),
            }}
          >
            {myStatus.text}
          </span>
        </div>
      )}

      {/* WHICH CLOCK THE ROWS ARE ON.
          Every kickoff below is frozen text (`pickem_slate_games.kickoff` is
          `text`, migration 146) rendered in the trip's zone when the runner
          built the slate — it does not follow the reader, and nothing on the
          row says so. Read from a zone west of Eastern that silently turns a
          10-minute cushion before an 8:20 kickoff into an apparent 70.

          Gated on a slate that actually has one: a slate of TBDs would be
          claiming a frame for times that are not there, which is the
          empty-is-not-unknown mistake with a label on it.

          `tripZoneNote()` takes no argument by design. Its first version took
          an instant so it could say EDT or EST, and this call site passed
          `deadlineMs` — which is milliseconds REMAINING, not an epoch instant.
          21 hours read as 1 January 1970, so the note said EST directly beneath
          a deadline reading EDT. */}
      {slate.some((g) => g.kickoff) && (
        <div className="flex justify-end px-1">
          <span
            data-testid="pickem-sheet-zone-note"
            style={{ fontSize: 11, color: "var(--color-bt-text-dim)" }}
          >
            {tripZoneNote()}
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
           * as the row is dragged. It must not carry the multiplier there — a
           * number that moves with the drag has to be the thing the drag
           * changes, and folding the weight in would make it move for a second
           * reason nobody touched.
           *
           * (This used to cite the hint line as the reason — "the top of the
           * list is worth 16" — and that sentence has not been on screen for
           * some time. The decision survives its old justification; the hint
           * now carries the multiplier in WORDS instead, on a weighted slate,
           * which is the other half of this trade.)
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
          /**
           * ── THE SAVED MARK, IN A GUTTER OUTSIDE THE CARD ─────────────────
           *
           * Left of the row and outside its surface, so it reads as a note
           * ABOUT the card rather than a field on it. The card gives up the
           * gutter's width, which is the trade: a little less room for two
           * team names, in exchange for the row saying whether it is stored.
           *
           * ONLY WHILE EDITABLE. Once picks lock nothing can be unsaved, so a
           * column of ticks down a settled sheet would be sixteen rows
           * confirming a thing that is no longer in question — and it would
           * take the width from the surface that has the most to say (score,
           * both lines, the cover box).
           *
           * A TICK OR NOTHING, rather than a tick and a pending dot. The row
           * itself already says whether it is picked — the teal name, the
           * selected segment — so an empty gutter beside a picked row reads
           * as "picked, not stored" without a second glyph to learn. A
           * second mark is the obvious extension if this proves too quiet.
           */
          const saved = editable && pickIsSaved(id, picks, server.picks);
          const row = (
            <PickemSheetRow
              game={{
                id: g.id,
                awayTeam: g.awayTeam,
                homeTeam: g.homeTeam,
                spread: g.spread ?? null,
                multiplier: g.multiplier ?? 1,
                kickoff: g.kickoff ?? null,
                note: g.note ?? null,
                /* Gated on `!editable` exactly as `result` is. While picks are
                   open nothing has been played, and a score printed beside
                   a team you are still choosing between would be asserting
                   an outcome the row is there to precede. */
                awayScore: editable ? null : (g.awayScore ?? null),
                homeScore: editable ? null : (g.homeScore ?? null),
              }}
              pick={p?.pick ?? null}
              // The chip shows what THIS POSITION is worth, derived from the
              // index — never a stored confidence beside the order.
              points={points}
              outcome={outcome}
              /**
               * The GAME's own result, so the row can draw a CANCELLATION.
               * `outcome` cannot: `pickOutcome` folds push and cancelled into
               * one `void`, which is right for the chip (both pay nobody) and
               * wrong for the names (only one of them voids the contest).
               *
               * Gated on `!editable` like `outcome` is — while picks are open
               * nothing has resolved, and a status line would be describing a
               * game that has not been played.
               */
              result={editable ? null : (g.result ?? null)}
              /* With confidence off the chip shows what was EARNED rather
                 than a crossed-out 1 — see `chipValue`. */
              ranksMatter={settings.useConfidence}
              editable={editable}
              onPick={(side) => editPicks((prev) => setPick(prev, id, side))}
            />
          );
          if (!editable) return row;
          return (
            /* ── THE GUTTER HANGS INTO THE SHEET'S OWN PADDING ──────────────
               The sheet is `px-4`, so the row block started at 32px and the
               tick sat hard against the card with all that space unused to
               its left. `-ml-4` lets the mark hang outside the text column —
               the typographic gutter this is, rather than a first column of
               the row — and the card keeps the left edge it already had, so
               nothing shrinks twice. `lg:ml-0` mirrors the container's own
               `lg:px-0`: with no padding to hang into, hanging would put the
               tick outside the panel. */
            <div className="-ml-4 flex min-w-0 items-center gap-1.5 lg:ml-0">
              {/* Fixed width whether or not the tick is there, so the cards
                  keep ONE left edge down the list. A gutter that collapsed on
                  unsaved rows would make every save nudge the row sideways,
                  which is movement carrying no meaning. */}
              <span
                data-testid="pickem-row-saved"
                data-saved={saved ? "true" : "false"}
                aria-hidden={!saved}
                aria-label={saved ? "Saved" : undefined}
                className="flex shrink-0 justify-center"
                style={{ width: 30, color: "var(--color-bt-accent)" }}
              >
                {saved && <Check size={14} strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">{row}</span>
            </div>
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
        {/* STYLE_GUIDE 2c: the digits are the value, h/m are labels. Both
            segments keep EQUAL weight — at "00h 47m" the hours have stopped
            mattering, and emphasis that moves with the value is unpredictable.

            `unitSize={14}` — a size difference, not colour alone. Colour-only
            read as too weak at this 24px value: "h"/"m" are wide enough next to
            two digits to look like a second value rather than a label. This is
            the ONE call site that passes `unitSize`; every `PTS` chip and the
            "worth N pts" ribbon omit it and render unchanged — see
            `ValueUnit.tsx`'s header for why that had to be true before this
            shipped. Checked at both extremes ("120h 05m", "00h 47m") in a real
            render: 14 stays legible and does not read as debris at either. */}
        <ValueUnitParts
          parts={formatCountdownParts(ms)}
          size={24}
          unitSize={14}
          weight={800}
          color={urgent ? "var(--color-bt-warning)" : undefined}
          unitColor={urgent ? "color-mix(in srgb, var(--color-bt-warning) 55%, transparent)" : "var(--color-bt-text-dim)"}
        />
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
