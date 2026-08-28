"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { ReorderableList } from "@/components/ReorderableList";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";
import { useDraftOutbox } from "@/hooks/useDraftOutbox";
import { draftOutboxRecover } from "@/lib/draftOutbox";
import {
  reconcileSheet,
  applyOrder,
  rankedOrder,
  setPick,
  sheetsEqual,
  explanationCopy,
  type SheetPick,
  type SheetSettings,
} from "@/lib/pickemSheet";
import { MatchupLine, pickemRowSurface } from "./slateRowVisual";
import { formatCountdown, type PickemClosure } from "@/lib/pickemLifecycle";

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
  pointsMode = false,
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
   * The competition is a points cup (Phase 7). Changes the EXPLAINER only —
   * head-to-head is a match-play mechanic and saying "you have to be right
   * where they're wrong" is false when you are contributing to a total.
   *
   * Nothing else about this component differs by model, deliberately: a
   * participant cannot tell which competition format they are in from the
   * picking experience, and should not need to.
   */
  pointsMode?: boolean;
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

  const [step, setStep] = useState<"pick" | "rank">("pick");
  // Open by default for someone who has never submitted — the Cadence question
  // is "can a person who has never seen this finish it without asking how it
  // works", and a collapsed explainer is one tap away from failing it. Collapsed
  // once they have a sheet in, because by then it is in the way.
  const [howOpen, setHowOpen] = useState(!server.submitted);

  const picks = working ?? server.picks;
  const dirty = working != null && !sheetsEqual(working, server.picks);

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
  const copy = useMemo(
    () => explanationCopy(settings, slate, { pointsMode }),
    [settings, slate, pointsMode]
  );

  const twoPass = settings.useConfidence && editable;
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

      <HowThisWorks open={howOpen} onToggle={() => setHowOpen((v) => !v)} paragraphs={copy} />

      {/* ABSENT when confidence is off, never a disabled tab (§11). */}
      {twoPass && (
        <div
          className="flex overflow-hidden rounded-lg"
          data-testid="pickem-step-nav"
          style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        >
          <StepButton active={step === "pick"} onClick={() => setStep("pick")}>
            1 · Pick winners
          </StepButton>
          <StepButton active={step === "rank"} onClick={() => setStep("rank")}>
            2 · Rank them
          </StepButton>
        </div>
      )}

      {step === "pick" || !twoPass ? (
        <PickPass
          slate={slate}
          picks={picks}
          editable={editable}
          confidenceOn={settings.useConfidence}
          subject={subject}
          onPick={(id, side) => editPicks((p) => setPick(p, id, side))}
        />
      ) : (
        <RankPass
          subject={subject}
          order={order}
          picks={picks}
          gameById={gameById}
          editable={editable}
          onReorder={(next) => editPicks((p) => applyOrder(p, next))}
        />
      )}

      {/* Read-only sheets show the ranking inline rather than behind a step nav
          that no longer exists — the person is reading, not navigating. */}
      {!editable && settings.useConfidence && (
        <RankPass
          subject={subject}
          order={order}
          picks={picks}
          gameById={gameById}
          editable={false}
          onReorder={() => {}}
        />
      )}

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
          twoPass={twoPass}
          step={step}
          onNext={() => setStep("rank")}
          onSave={() => onSave(picks)}
        />
      )}
    </div>
  );
}

// ── pass 1 ─────────────────────────────────────────────────────────────────

function PickPass({
  slate,
  picks,
  editable,
  confidenceOn,
  subject,
  onPick,
}: {
  slate: PickemSheetGame[];
  picks: SheetPick[];
  editable: boolean;
  confidenceOn: boolean;
  /** Threaded down rather than defaulted: a section heading that says "Your
   *  picks" over someone else's sheet is the mixed message the banner exists to
   *  prevent, and a default here would reintroduce it silently. */
  subject: SheetSubject;
  onPick: (slateGameId: string, side: "away" | "home") => void;
}) {
  const byGame = new Map(picks.map((p) => [p.slateGameId, p]));
  return (
    <div className="flex flex-col gap-1.5" data-testid="pickem-pick-pass">
      <SectionHeading
        left={editable ? "Pick a winner" : subject.isSelf ? "Your picks" : `${subject.name}'s picks`}
        right={`${slate.length} games`}
      />
      {slate.map((g) => {
        const chosen = byGame.get(g.id)?.pick;
        const rank = byGame.get(g.id)?.confidence;
        return (
          <div
            key={g.id}
            className="rounded-xl px-2.5 py-2"
            style={pickemRowSurface({ weighted: g.multiplier > 1 })}
            data-testid="pickem-pick-row"
          >
            <MatchupLine
              game={g}
              trailing={
                // On a read-only sheet the rank belongs on the row: there is no
                // second pass to go and look at it in.
                !editable && confidenceOn && rank != null ? <RankChip rank={rank} of={picks.length} /> : undefined
              }
            />
            <div className="mt-2 flex gap-1.5">
              <SideButton
                side="away"
                label={g.awayTeam}
                selected={chosen === "away"}
                editable={editable}
                onClick={() => onPick(g.id, "away")}
              />
              <SideButton
                side="home"
                label={g.homeTeam}
                selected={chosen === "home"}
                editable={editable}
                onClick={() => onPick(g.id, "home")}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SideButton({
  side,
  label,
  selected,
  editable,
  onClick,
}: {
  side: "away" | "home";
  label: string;
  selected: boolean;
  editable: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!editable}
      data-testid={`pickem-side-${side}`}
      data-selected={selected ? "true" : "false"}
      className="flex-1 truncate rounded-lg px-1.5 py-2.5"
      style={{
        fontSize: TYPE_SCALE.body,
        fontWeight: 600,
        // 44px of target on a phone — sixteen of these get tapped in a hurry.
        minHeight: 44,
        background: selected ? "var(--color-bt-accent-faint)" : "var(--color-bt-raised)",
        border: `1px solid ${selected ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
        color: selected ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
        opacity: !editable && !selected ? 0.45 : 1,
      }}
    >
      {label}
    </button>
  );
}

// ── pass 2 ─────────────────────────────────────────────────────────────────

function RankPass({
  subject,
  order,
  picks,
  gameById,
  editable,
  onReorder,
}: {
  subject: SheetSubject;
  order: string[];
  picks: SheetPick[];
  gameById: Map<string, PickemSheetGame>;
  editable: boolean;
  onReorder: (next: string[]) => void;
}) {
  const pickOf = new Map(picks.map((p) => [p.slateGameId, p.pick]));
  const n = order.length;

  const row = (id: string, i: number) => {
    const g = gameById.get(id);
    if (!g) return null;
    const side = pickOf.get(id);
    const chosen = side === "away" ? g.awayTeam : g.homeTeam;
    return (
      <div
        className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-2"
        style={pickemRowSurface({ weighted: g.multiplier > 1 })}
        data-testid="pickem-rank-row"
      >
        <RankChip rank={n - i} of={n} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5">
            <span className="truncate" style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>
              {chosen}
            </span>
            {g.multiplier > 1 && (
              <span
                className="rounded px-1"
                style={{
                  fontSize: TYPE_SCALE.caption,
                  fontWeight: 700,
                  color: "var(--color-bt-glorious)",
                  background: "color-mix(in srgb, var(--color-bt-glorious) 22%, transparent)",
                }}
              >
                {g.multiplier}×
              </span>
            )}
          </span>
          <span
            className="block truncate"
            style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
          >
            {g.awayTeam} at {g.homeTeam}
            {g.kickoff ? ` · ${g.kickoff}` : ""}
          </span>
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-1.5" data-testid="pickem-rank-pass">
      <SectionHeading
        left={
          editable
            ? subject.isSelf
              ? "Rank your picks"
              : `Rank ${subject.name}'s picks`
            : subject.isSelf
              ? "Your ranking"
              : `${subject.name}'s ranking`
        }
        right={editable ? "Drag, or use the arrows" : undefined}
      />
      <div
        className="flex justify-between px-1 pb-1"
        style={{ ...EYEBROW, color: "var(--color-bt-text-dim)" }}
      >
        <span>{n} · surest</span>
        <span>coin flip · 1</span>
      </div>
      {/* Phase 1's primitive, which was extracted for exactly this list.
          Arrows alongside the grip because sixteen rows on a phone is the
          hardest drag in the app, and the arrows are what make it possible
          one-handed and with a keyboard. */}
      <ReorderableList
        ids={order}
        labelOf={(id) => {
          const g = gameById.get(id);
          return g ? `${g.awayTeam} at ${g.homeTeam}` : id;
        }}
        renderRow={row}
        onReorder={onReorder}
        enabled={editable}
        arrows
        controlsSide="trailing"
        listClassName="flex flex-col gap-1.5"
      />
    </div>
  );
}

function RankChip({ rank, of }: { rank: number; of?: number }) {
  // The bottom third dims. The gradient IS the information — where a person put
  // their conviction, readable down the column without reading numbers — so the
  // cut is proportional to the slate rather than a literal 5. A fixed threshold
  // would dim every row of a four-game slate and none of a fifty-game one.
  const low = of != null && of > 2 && rank <= Math.max(1, Math.floor(of / 3));
  return (
    <span
      data-testid="pickem-rank-chip"
      className="flex flex-none items-center justify-center rounded-lg"
      style={{
        width: 32,
        height: 32,
        fontSize: 14,
        fontWeight: 800,
        fontVariantNumeric: "tabular-nums",
        background: low ? "var(--color-bt-raised)" : "var(--color-bt-accent-faint)",
        color: low ? "var(--color-bt-text-dim)" : "var(--color-bt-accent)",
        border: `1px solid ${low ? "var(--color-bt-border)" : "var(--color-bt-accent-border)"}`,
      }}
    >
      {rank}
    </span>
  );
}

// ── chrome ─────────────────────────────────────────────────────────────────

function HowThisWorks({
  open,
  onToggle,
  paragraphs,
}: {
  open: boolean;
  onToggle: () => void;
  paragraphs: { id: string; text: string }[];
}) {
  return (
    <div
      className="overflow-hidden rounded-xl"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <button
        type="button"
        onClick={onToggle}
        data-testid="pickem-how-toggle"
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}
      >
        How this works
        <ChevronRight
          size={14}
          style={{
            color: "var(--color-bt-text-dim)",
            transform: open ? "rotate(90deg)" : undefined,
            transition: "transform .15s",
          }}
        />
      </button>
      {open && (
        <div
          className="flex flex-col gap-2 px-3 pb-3"
          data-testid="pickem-how-body"
          style={{ fontSize: TYPE_SCALE.bodyDense, color: "var(--color-bt-text-dim)", lineHeight: 1.6 }}
        >
          {paragraphs.map((p) => (
            <p key={p.id} data-para={p.id}>
              {p.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function SaveBar({
  subject,
  needsSave,
  submitted,
  rankingReset,
  dirty,
  saving,
  error,
  count,
  twoPass,
  step,
  onNext,
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
  twoPass: boolean;
  step: "pick" | "rank";
  onNext: () => void;
  onSave: () => void;
}) {
  /**
   * On pass 1 the primary action is "go and rank them" — but ONLY while the
   * ranking is one nobody has chosen. A sheet saved from pass 1 is legal and
   * carries the DEFAULT order, so offering Save there to a first-time picker
   * invites them to submit an order they never looked at.
   *
   * Once they HAVE ranked, that stops being true and the nudge becomes a lie:
   * the first version of this branched on `step` alone, so returning to a
   * submitted sheet greeted the person with "All 16 picked · rank them next"
   * and a Next button, as though nothing had been saved. Caught by the test
   * below, not by looking — the state needs a saved sheet to reach.
   *
   * `rankingReset` puts them back in the first case, which is the whole point
   * of clearing it (§7.2).
   */
  const unranked = !submitted || rankingReset;
  const advancing = twoPass && step === "pick" && unranked;

  const status = advancing
    ? `All ${count} picked · rank them next`
    : rankingReset
      ? "Ranking cleared — save to confirm"
      : dirty
        ? "Unsaved changes"
        : submitted
          ? "Saved · change it any time"
          : // "and ranked" is a claim about a mechanic this game may not have.
            // `twoPass` is `useConfidence` here — the bar only renders while
            // editable — and with confidence off the line read "All 16 picked
            // and ranked" on a sheet with no ranking at all. Found by looking at
            // the off variant, which is the entire reason §10 asks for two looks.
            `All ${count} picked${twoPass ? " and ranked" : ""}`;

  return (
    <div
      // Negative margins cancel the sheet's own side inset so the gradient
      // reaches the panel edges — the bar should look like it belongs to the
      // viewport, while the rows it floats over stay inset.
      className="sticky bottom-0 z-10 -mx-4 -mb-1 mt-1 px-4 pb-3 pt-2 lg:-mx-1 lg:px-1"
      data-testid="pickem-save-bar"
      style={{
        // Anchored to the bottom of the scroller rather than sitting at the end
        // of the content (CLAUDE.md #14): with sixteen games the end of the
        // content is a long way below the fold.
        background:
          "linear-gradient(to top, var(--color-bt-base) 70%, color-mix(in srgb, var(--color-bt-base) 0%, transparent))",
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
          onClick={advancing ? onNext : onSave}
          disabled={saving || (!advancing && !needsSave)}
          data-testid={advancing ? "pickem-next-step" : "pickem-submit"}
          className="flex-none rounded-xl px-4 disabled:opacity-40"
          style={{
            height: 40,
            fontSize: TYPE_SCALE.bodyDense,
            fontWeight: 700,
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
          }}
        >
          {advancing
            ? "Next: rank"
            : saving
              ? "Saving…"
              : !needsSave
                ? "Saved"
                : submitted
                  ? "Save changes"
                  : "Submit sheet"}
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

function SectionHeading({ left, right }: { left: string; right?: string }) {
  return (
    <div className="flex items-baseline justify-between px-1" style={EYEBROW}>
      <span>{left}</span>
      {right && (
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>{right}</span>
      )}
    </div>
  );
}

function StepButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex-1 py-2"
      style={{
        fontSize: TYPE_SCALE.bodyDense,
        fontWeight: active ? 600 : 500,
        background: active ? "var(--color-bt-accent-faint)" : "transparent",
        color: active ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
      }}
    >
      {children}
    </button>
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
