"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Plus, Trash2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { useModalBackButton } from "@/hooks/useModalBackButton";
import { ReorderableList } from "@/components/ReorderableList";
import {
  compareSlateKickoffs,
  groupSlateByDay,
  slateCrossesNewYear,
  splitKickoffDay,
} from "@/lib/pickemSlateDays";
import { Stepper } from "@/components/games/Stepper";
import { TYPE_SCALE } from "@/lib/typeScale";
import { MatchupSearch } from "@/components/matchup/MatchupSearch";
import { formatKickoff } from "@/lib/matchupApi";
import { MatchupLine, RowOrdinal, pickemRowSurface } from "./slateRowVisual";

/**
 * The slate — the contests being predicted.
 *
 * ── Why a modal, and why it is not the game page ────────────────────────────
 * Spec §5.1: the runner does not get a different game page, he gets a modal. The
 * page a member opens and the page the runner opens are the same page; what the
 * runner has extra is a door. That is what keeps 1a and 1b indistinguishable
 * from the outside — there is no "runner view" whose presence or shape leaks
 * whether a slate exists.
 *
 * ── The list is DISPLAY rows. One form, two entry points. ───────────────────
 * The first build made every row a live form: five inputs and their padding,
 * times sixteen games. It worked and it read as a spreadsheet — the "96 fields"
 * problem the Cadence look named.
 *
 * So a row is one line of text plus its note, and nothing else. Adding happens
 * in ONE form at the bottom; EDITING opens that same form, populated. Two entry
 * points, one form, one set of validation rules — rather than an add form plus
 * sixteen inline editors that have to agree with it.
 *
 * ── Reorder is a MODE, not a permanent affordance ───────────────────────────
 * Same shape as the leaderboard's game reordering: a Reorder button that puts
 * the list into drag mode. Grips are clutter the rest of the time, and they are
 * the second thing (after inputs) that makes a row look like a control panel.
 * Drag mode is `ReorderableList` — Phase 1's primitive, and this is its first
 * real consumer.
 *
 * ── The multiplier is the row, not a control in it ──────────────────────────
 * A weighted game wears the Glorious tokens; the number rides along inside that
 * treatment ("2×") rather than sitting in a field of its own. The colour says
 * "this one is worth more", the number says how much. It is SET in the form,
 * with a stepper — the realistic range is 2–4 and a free numeric field invites
 * someone to type 25.
 *
 * ── Draft-then-save, one atomic commit ──────────────────────────────────────
 * Nothing here self-persists. Save sends the whole slate through ONE
 * `save_pickem_config` (CLAUDE.md #18), with no `settings` key — the RPC
 * already treats an absent half as "leave it alone".
 *
 * ── The scoring settings USED to live here, and no longer do ────────────────
 * They were placed here because spec §4 freezes them at the same instant as the
 * slate, so "things that share a lock point share a surface". That reasoning was
 * about the FREEZE and wrong about the JOB: the slate is a list you build and
 * reorder, the settings are two switches deciding what the game is. Stacking
 * them behind one door meant scrolling past sixteen rows to answer a question
 * about none of them — and put the switches behind THIS modal's Save, so
 * toggling confidence and closing discarded it silently. They now sit on the
 * settings page (`PickemScoringRows`), still frozen by the same predicate.
 *
 * ── Presentation-only ───────────────────────────────────────────────────────
 * No tRPC (CLAUDE.md #7). Every value arrives as a prop; the draft leaves
 * through `onSave`.
 */

export interface SlateDraftGame {
  id: string;
  awayTeam: string;
  homeTeam: string;
  spread: string | null;
  kickoff: string | null;
  note: string | null;
  multiplier: number;
  /** Set when the row was filled from the matchup search. Carried so the same
   *  contest cannot be added twice from two different teams' schedules — and so
   *  that survives a reload, which a client-side set would not. */
  espnEventId?: string | null;
}

export interface PickemSettingsDraft {
  rollUp: "team_totals" | "individual_matches";
  useConfidence: boolean;
}

/** 1 is a normal game. The ceiling is judgement, not arithmetic: 2× and 3× are
 *  what a runner actually wants and a free field invites 25, which would let one
 *  contest outweigh the rest of the slate combined. */
export const MULTIPLIER_MIN = 1;
export const MULTIPLIER_MAX = 4;

/** Client-minted id. STABLE across edits by design: it is what lets the RPC
 *  upsert instead of clean-replace, and therefore what keeps a participant's
 *  picks alive through a Reopen (migration 148). */
function newSlateId(): string {
  return `psg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const blank = (): SlateDraftGame => ({
  id: newSlateId(),
  awayTeam: "",
  homeTeam: "",
  spread: null,
  kickoff: null,
  note: null,
  multiplier: 1,
  espnEventId: null,
});

/** The helper under the Multiplier stepper. The LABEL stays neutral; this is the
 *  thing that changes, so the two never contradict each other. */
function multiplierHelper(n: number): string {
  if (n <= 1) return "Normal game";
  if (n === 2) return "Worth double";
  return `Worth ${n}×`;
}

const label = (g: SlateDraftGame) =>
  g.awayTeam || g.homeTeam ? `${g.awayTeam || "Away"} at ${g.homeTeam || "Home"}` : "this game";

export function PickemSlateModal({
  open,
  onClose,
  slate,
  editable,
  rankedSheetsExist,
  saving,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  slate: SlateDraftGame[];
  /**
   * False once picks are open. The modal still OPENS — the runner needs to read
   * the slate he published — but every control is gone rather than disabled,
   * and the banner says what to do about it. Removing rather than disabling is
   * the same choice `ChecklistRow` made: a disabled control with no reason
   * attached teaches nobody why.
   */
  editable: boolean;
  /**
   * True when ranked sheets may exist — picks have been opened at least once
   * and confidence is on.
   *
   * Only used to decide whether to WARN. The clear itself is server-side, in
   * `save_pickem_config`, keyed on the id set actually changing (migration
   * 156). This flag deliberately cannot suppress it: a screen that decides
   * whether data is destroyed is how the two get out of step.
   */
  rankedSheetsExist: boolean;
  saving: boolean;
  onSave: (next: { slate: SlateDraftGame[] }) => void;
}) {
  /**
   * The shared `Sheet` primitive has NO back handling of its own — it closes on
   * the scrim and the cross and nothing else — so every Sheet in the app eats a
   * back-press by letting it fall through to whatever is underneath. Registered
   * here rather than in `Sheet`, because fixing it there would change the
   * behaviour of the golf scorecard overlay in the same breath, which is not
   * this change. Filed separately.
   */
  useModalBackButton(onClose, open);

  const [draft, setDraft] = useState<SlateDraftGame[]>(slate);
  const [touched, setTouched] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  /**
   * Has the runner put the list in an order of their own?
   *
   * Until they do, a new game lands where its kickoff says it belongs, which is
   * what people expect and what stops sixteen additions needing sixteen drags.
   * The moment they drag anything, the order is THEIRS — re-sorting after that
   * would silently undo the thing they just did — so new games append and they
   * move them.
   *
   * Deliberately NOT explained on screen. It behaves the way people expect;
   * describing it would be noise.
   */
  const [manuallyOrdered, setManuallyOrdered] = useState(false);

  /**
   * Will saving this draft clear everyone's ranking?
   *
   * The SAME test the server applies — the id SET, not the count and not the
   * content. A ranking is a permutation of 1..N over the slate, so gaining or
   * losing a game invalidates it while reordering, re-spreading or re-weighting
   * one does not.
   *
   * Stated here because this is where the cause is. It used to be attached to
   * "Reopen the slate", a mode change that destroyed every ranking whether or
   * not the runner went on to change anything — so the warning appeared for
   * people who were about to lose nothing, and the actual edit that did the
   * damage carried no warning at all.
   */
  /**
   * ── THE WARNING COMES FIRST NOW, BECAUSE THE WRITE DOES ───────────────────
   *
   * It used to be `rankedSheetsExist && slateSetChanged(slate, draft)` — shown
   * beside the Save button once an edit had already changed the set. With every
   * change persisting there is no such moment: by the time the set has changed,
   * the rankings are already cleared.
   *
   * So it is the STATE that makes it true, not the edit that would trigger it:
   * rankings exist and this slate is editable. That is the window where a slate
   * change costs something — after a lock, with sheets already ranked — and it
   * is a caution to read before touching anything rather than a confirmation
   * after.
   *
   * Not per-change, deliberately. A warning that reappears on every tap is the
   * one people learn to look past, which is the failure this feature has already
   * corrected twice.
   */
  const warnAboutRankings = editable && rankedSheetsExist;
  /**
   * TWO independent forms, one component.
   *
   * Adding and editing used to share a single form instance, which made them
   * mutually exclusive: start typing a new game, tap a row to fix a typo, and
   * the half-typed one was gone. Forcing a choice between "adjust" and "add"
   * is the confusing part, so they are now separate panels that can both be
   * open at once.
   *
   * They remain ONE COMPONENT with one set of validation rules — what is
   * duplicated is the state, not the behaviour. An add form and sixteen inline
   * editors that each had their own idea of "valid" is the thing this avoids.
   */
  const [addForm, setAddForm] = useState<SlateDraftGame>(blank);
  const [editForm, setEditForm] = useState<SlateDraftGame | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Re-seed when the modal is (re)opened against different server data. Keyed on
  // the closed→open transition rather than on every prop change, so a background
  // refetch cannot wipe an in-progress edit.
  const [seedKey, setSeedKey] = useState(open);
  if (seedKey !== open) {
    setSeedKey(open);
    if (open) {
      setDraft(slate);
      setTouched(false);
      setReorderMode(false);
      setAddForm(blank());
      setEditForm(null);
      setEditingId(null);
    }
  }

  const ids = useMemo(() => draft.map((g) => g.id), [draft]);
  const byId = useMemo(() => new Map(draft.map((g) => [g.id, g])), [draft]);

  /**
   * ── EVERY CHANGE PERSISTS. THERE IS NO SAVE. ──────────────────────────────
   *
   * The modal used to draft and commit on a Save button, which meant opening it
   * to LOOK at the slate presented a disabled control — a screen whose only
   * affordance is greyed out reads as broken, and it had read that way for four
   * rounds.
   *
   * Option A of the two on the table: close-only, write on change. The other was
   * to stage the slate into the game-settings draft, which needs
   * `pickem_slate_games` in `configHash` (with a total order it has no unique
   * column for), a migration teaching `save_game_config` to write the slate, a
   * coverage classification, and `save_pickem_config`'s slate arm retired so
   * there are not two writers. Six things against this one.
   *
   * `save_pickem_config` already REPLACES the whole slate in one statement, so
   * this needs no new endpoint and no migration — each edit sends the same
   * payload the Save button used to send. Concurrency is unchanged rather than
   * worsened: that write never carried a base hash either.
   *
   * ── NOT the updater form, and not a ref either ────────────────────────────
   *
   * `setDraft(prev => …)` with the write inside would fire TWICE under
   * StrictMode, which double-invokes updaters — two whole-slate replaces per
   * tap. A ref mirroring the draft avoids that and trips the "no refs during
   * render" rule instead.
   *
   * So the next slate is computed from the render's own `draft`. Every caller is
   * a discrete user action — add, edit, delete, drop — each of which re-renders
   * before the next one can happen, so there is no batch for a stale closure to
   * form in. Two mutations in one tick would be the exception, and none of these
   * four can produce one.
   */
  const mutate = (fn: (prev: SlateDraftGame[]) => SlateDraftGame[]) => {
    const next = fn(draft);
    setDraft(next);
    setTouched(true);
    onSave({ slate: next });
  };

  const isValid = (f: SlateDraftGame) =>
    f.awayTeam.trim().length > 0 && f.homeTeam.trim().length > 0;
  /** Has the add form been touched at all? Drives the Clear button — there is
   *  nothing to abandon on an untouched form. */
  const addDirty =
    addForm.awayTeam !== "" || addForm.homeTeam !== "" || addForm.kickoff != null ||
    addForm.spread != null || addForm.note != null || addForm.multiplier !== 1 ||
    addForm.espnEventId != null;

  /**
   * Event ids already on the slate — so the same real-world contest cannot be
   * added twice from two different teams' schedules. Read from the DRAFT, not
   * the server: a game added a moment ago and not yet saved counts too, which
   * is exactly the window a runner adds sixteen games in.
   */
  const takenEventIds = useMemo(
    () => draft.map((g) => g.espnEventId).filter((id): id is string => !!id),
    [draft]
  );

  const clean = (f: SlateDraftGame): SlateDraftGame => ({
    ...f,
    awayTeam: f.awayTeam.trim(),
    homeTeam: f.homeTeam.trim(),
    spread: f.spread?.trim() || null,
    kickoff: f.kickoff?.trim() || null,
    note: f.note?.trim() || null,
  });

  function submitAdd() {
    if (!isValid(addForm)) return;
    const next = clean(addForm);
    mutate((prev) => {
      const appended = [...prev, next];
      if (manuallyOrdered) return appended;
      const januaryIsLater = slateCrossesNewYear(appended.map((g) => g.kickoff));
      // A stable sort, so games this cannot read a date from keep their
      // positions instead of being shuffled to an end they did not ask for.
      return appended
        .map((g, i) => ({ g, i }))
        .sort(
          (a, b) =>
            compareSlateKickoffs(a.g.kickoff, b.g.kickoff, januaryIsLater) || a.i - b.i
        )
        .map((x) => x.g);
    });
    setAddForm(blank());
  }

  function submitEdit() {
    if (!editForm || !isValid(editForm) || !editingId) return;
    const next = clean(editForm);
    mutate((prev) => prev.map((g) => (g.id === editingId ? next : g)));
    setEditForm(null);
    setEditingId(null);
  }

  function editRow(id: string) {
    const g = byId.get(id);
    if (!g) return;
    // Tapping the row already being edited closes it — a second tap undoes the
    // first, rather than doing nothing.
    if (editingId === id) {
      setEditForm(null);
      setEditingId(null);
      return;
    }
    setEditForm({ ...g });
    setEditingId(id);
  }


  // `Sheet` renders when mounted — it has no `open` prop — so the gate is here,
  // AFTER the hooks above so their order never changes between renders.
  if (!open) return null;

  const formsUsable = editable && !reorderMode;

  const rowFor = (g: SlateDraftGame, i: number, kickoffOverride?: string | null) => (
    <div key={g.id} className="flex flex-col gap-1.5">
      <SlateRow
        index={i}
        game={g}
        kickoffOverride={kickoffOverride}
        editable={formsUsable}
        beingEdited={editingId === g.id}
        onEdit={() => editRow(g.id)}
      />
      {/* The EDIT panel drops beneath its own row — tap game 1 of sixteen and
          the form is right there, rather than off-screen at the bottom with
          nothing to suggest scrolling. */}
      {formsUsable && editingId === g.id && editForm && (
        <SlateForm
          form={editForm}
          editing
          valid={isValid(editForm)}
          onChange={(patch) => setEditForm((f) => (f ? { ...f, ...patch } : f))}
          onSubmit={submitEdit}
          onCancel={() => {
            setEditForm(null);
            setEditingId(null);
          }}
          onDelete={() => {
            const id = editingId;
            setEditForm(null);
            setEditingId(null);
            if (id) mutate((prev) => prev.filter((x) => x.id !== id));
          }}
          takenEventIds={takenEventIds}
        />
      )}
    </div>
  );

  // NOT `draft.map(rowFor)`: map passes the ARRAY as a third argument, which
  // would land in `kickoffOverride`.
  const rows = draft.map((g, i) => rowFor(g, i));

  /**
   * The slate as day runs, or null when it cannot be read that way.
   *
   * NOT while reordering: drag is over ONE list, and headings interleaved with
   * the thing being dragged would say the groups are boundaries when they are
   * not. The runner is editing the order itself there, so the order is the only
   * structure worth showing.
   */
  const dayGroups = reorderMode ? null : groupSlateByDay(draft);

  return (
    <Sheet onClose={onClose} title="The Picks" testId="pickem-slate-sheet">
      <div className="flex flex-col gap-3 pb-4">
        {warnAboutRankings && (
          <p
            data-testid="pickem-slate-clears-rankings"
            className="rounded-xl px-3 py-2.5"
            style={{
              background: "var(--color-bt-warning-faint)",
              border: "1px solid var(--color-bt-warning-border)",
              fontSize: TYPE_SCALE.caption,
              lineHeight: 1.5,
              color: "var(--color-bt-text)",
            }}
          >
            Sheets are already ranked. Adding or removing a game clears
            everyone&rsquo;s ranking — their picks are kept, but they will need to
            put them back in order. Editing a game&rsquo;s details does not.
          </p>
        )}

        {!editable && (
          <div
            className="rounded-xl px-3 py-2.5"
            style={{
              background: "var(--color-bt-warning-faint)",
              border: "1px solid var(--color-bt-warning-border)",
              fontSize: TYPE_SCALE.bodyDense,
            }}
          >
            {/* IT NAMED A CONTROL THAT DOES NOT EXIST. This read "Reopen the
                slate from settings" — `reopen` was retired in migration 156,
                and the only way back is Stop on the game page, which is where
                the runner already is.

                And it overstated the cost. Rankings clear when the slate's ID
                SET changes, not when it is unfrozen: `save_pickem_config`
                compares before and after, so reordering, re-pricing or renaming
                every game on the slate costs nobody a re-rank. Saying otherwise
                deters a runner from a fix that is free. */}
            <b>Picks are open, so the slate is frozen.</b> Close picking on the
            game page to change it. Nothing is lost unless you add or remove a game —
            that is what clears everyone&rsquo;s ranking.
          </div>
        )}

        {/* ── the games ───────────────────────────────────────────────── */}
        <section>
          <div className="mb-2 mt-1 flex items-center gap-2">
            {/* Just the count. "confidence 1–16" used to ride along here and
                said nothing useful in setup — it showed whether or not
                confidence ranking was even switched on, and the range is a
                property of the finished slate rather than a thing the runner
                is deciding while building it. */}
            <span
              className="flex-1"
              style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
            >
              {draft.length === 0
                ? "Add the games people will pick."
                : `${draft.length} game${draft.length === 1 ? "" : "s"}`}
            </span>
            {editable && draft.length > 1 && (
              <button
                type="button"
                onClick={() => setReorderMode((v) => !v)}
                data-testid="pickem-reorder-toggle"
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5"
                style={{
                  background: reorderMode
                    ? "var(--color-bt-accent-faint)"
                    : "var(--color-bt-card-raised)",
                  border: `1px ${reorderMode ? "solid var(--color-bt-accent-border)" : "dashed var(--color-bt-border)"}`,
                  color: reorderMode ? "var(--color-bt-accent)" : "var(--color-bt-text)",
                  fontSize: TYPE_SCALE.bodyDense,
                  fontWeight: 600,
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <ArrowUpDown size={14} /> {reorderMode ? "Done" : "Reorder"}
              </button>
            )}
          </div>

          {draft.length === 0 ? (
            <p
              className="rounded-xl px-3 py-4 text-center"
              style={{
                fontSize: TYPE_SCALE.bodyDense,
                color: "var(--color-bt-text-dim)",
                border: "1px dashed var(--color-bt-border)",
              }}
            >
              No games yet. Add the first one below.
            </p>
          ) : reorderMode ? (
            // Phase 1's primitive — the ONLY drag implementation here. Grips and
            // arrows exist in this mode and nowhere else.
            <ReorderableList
              ids={ids}
              controlsSide="trailing"
              listClassName="flex flex-col gap-1.5"
              labelOf={(id) => label(byId.get(id)!)}
              onReorder={(next) => {
                // From here the order is the runner's, and new games append.
                setManuallyOrdered(true);
                mutate(() => next.map((id) => byId.get(id)!).filter(Boolean));
              }}
              renderRow={(id, i) => (
                <SlateRow index={i} game={byId.get(id)!} editable={false} beingEdited={false} />
              )}
            />
          ) : dayGroups ? (
            /* Sixteen rows become four short lists, and the day stops repeating
               on every line — which is what was eating the row width. */
            <div className="flex flex-col gap-3" data-testid="pickem-slate-days">
              {dayGroups.map((group, gi) => {
                // The running index across groups, so the ordinal on a row is
                // still its position in the SLATE — the number every ranking is
                // against — rather than its position within its day.
                const before = dayGroups
                  .slice(0, gi)
                  .reduce((n, x) => n + x.games.length, 0);
                return (
                  <div key={`${group.key}-${gi}`} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 px-1">
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "var(--color-bt-text-dim)",
                        }}
                      >
                        {group.day}
                        {group.date ? ` ${group.date}` : ""}
                      </span>
                      <span className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
                      <span
                        style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
                      >
                        {group.games.length} game{group.games.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    {group.games.map((g, i) =>
                      rowFor(g, before + i, splitKickoffDay(g.kickoff)?.time ?? null)
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">{rows}</div>
          )}
        </section>

        {/* The ADD panel, at the end of the list — where a new game goes, and
            independent of any edit that may be open above it. */}
        {/* Visible in reorder mode too. Hiding it produced a "where did the
            form go" moment for a mode people enter and leave constantly — and
            the add form is not what reordering is about, so there was never a
            conflict to avoid. Row EDITING stays gated: a row cannot sensibly
            be draggable and tap-to-edit at once. */}
        {editable && (
          <SlateForm
            form={addForm}
            editing={false}
            valid={isValid(addForm)}
            dirty={addDirty}
            onChange={(patch) => setAddForm((f) => ({ ...f, ...patch }))}
            onSubmit={submitAdd}
            onCancel={() => setAddForm(blank())}
            onDelete={() => {}}
            takenEventIds={takenEventIds}
          />
        )}

        {editable && (
          /**
           * ANCHORED to the bottom of the scroller, not placed at the end of
           * the content (CLAUDE.md #14).
           *
           * With sixteen games the end of the content is a long way below the
           * fold, so the save state and the button scrolled out of reach — the
           * runner could not see whether their work was saved without going to
           * find out. The gradient lets the list slide under it rather than
           * stopping at a hard edge.
           *
           * Negative side margins cancel the sheet's own inset so the gradient
           * reaches the edges, while the rows above stay inset — the same
           * treatment the picks sheet's save bar uses.
           */
          <div
            data-testid="pickem-slate-footer"
            className="sticky bottom-0 z-10 -mx-4 mt-1 flex items-center gap-3 px-4 pb-2 pt-3"
            /**
             * ── THE SHEET'S OWN SURFACE, not the page's ────────────────────
             *
             * This painted `--color-bt-base` — Level 0, the page background —
             * inside a `Sheet`, which is Level 3 (`--color-bt-card-float`). So
             * the bar read as a differently-coloured band across the bottom of a
             * floating panel, which is what it was.
             *
             * The comment that used to sit here explained it as "one treatment
             * for every anchored footer in the app", and that is exactly how it
             * went wrong: the footers it was copied from sit on the PAGE, where
             * Level 0 is correct. Same treatment, different surface. A footer
             * inside a floating sheet has to match the sheet.
             *
             * (The picks save bar it named has since been deleted, so half the
             * justification had stopped existing too.)
             *
             * Set explicitly rather than left transparent: the list scrolls
             * UNDER this bar, so it has to be opaque. `AddEditSheet`'s footer
             * inherits instead, which works there because it is a flex sibling
             * with nothing passing beneath it.
             */
            style={{
              background: "var(--color-bt-card-float)",
              borderTop: "1px solid var(--color-bt-border)",
            }}
          >
            {/*
              ── ONE BUTTON, AND IT ALWAYS WORKS ───────────────────────────

              The Save that used to sit here was DISABLED on arrival, which is
              what somebody opening the slate to look at it saw first. A screen
              whose only affordance is greyed out reads as broken.

              Every edit persists now, so there is nothing to commit and the one
              control is the way out. Its label does not change with state —
              "Done" is true whether or not a write is in flight, where "Save"
              had to lie in one direction or the other.
            */}
            <span
              data-testid="pickem-slate-status"
              style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", flex: 1 }}
            >
              {saving ? "Saving…" : touched ? "Changes saved" : "Changes save as you make them"}
            </span>
            <button
              type="button"
              onClick={onClose}
              data-testid="pickem-slate-done"
              className="rounded-xl px-4 py-2"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-base)",
                fontSize: TYPE_SCALE.bodyDense,
                fontWeight: 700,
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/**
 * One contest, as a line of text.
 *
 * NO INPUTS. A weighted game wears the Glorious tokens — the same
 * `{color, faint, border}` + "fill + ring" grammar the scorecard uses, minus its
 * diamond, which is an 18px backdrop with a hole number on it and has nowhere to
 * put a value (#1075's addendum).
 */
function SlateRow({
  index,
  game,
  kickoffOverride,
  editable,
  beingEdited,
  onEdit,
}: {
  index: number;
  game: SlateDraftGame;
  /**
   * The kickoff with its day removed, when a day HEADING is carrying it.
   *
   * Undefined leaves the row's own string alone. This is the second half of the
   * grouping's width win — "Sat 3:30p" under a SAT heading says Saturday twice,
   * and the repetition is what was eating the room the matchup needs.
   */
  kickoffOverride?: string | null;
  editable: boolean;
  beingEdited: boolean;
  onEdit?: () => void;
}) {
  // The stripe, the badges and the matchup text all live in `slateRowVisual`
  // now — the SHEET renders the same sixteen contests and must not re-parse
  // them (HANDOFF §3). This markup is the original; the module is where it went.
  const body = (
    <MatchupLine
      game={kickoffOverride === undefined ? game : { ...game, kickoff: kickoffOverride }}
      leading={<RowOrdinal>{index + 1}</RowOrdinal>}
    />
  );
  const surface = pickemRowSurface({ weighted: game.multiplier > 1, active: beingEdited });

  if (!editable) {
    return (
      <div className="flex items-start rounded-xl px-2.5 py-2" style={surface}>
        {body}
      </div>
    );
  }

  // The whole row is the edit target and there is NOTHING else in it. Delete
  // used to sit a few pixels from that target, on a sixteen-row list, on a
  // phone, with no confirmation — so it moved inside the form, where reaching it
  // costs a deliberate second tap.
  return (
    <button
      type="button"
      onClick={onEdit}
      data-testid="pickem-slate-row"
      aria-label={`Edit ${label(game)}`}
      className="flex w-full items-start rounded-xl px-2.5 py-2 text-left"
      style={{ ...surface, WebkitTapHighlightColor: "transparent" }}
    >
      {body}
    </button>
  );
}

/** The ONE form. Adding and editing are the same fields, the same validation and
 *  the same code — only the verb on the button changes. */
function SlateForm({
  form,
  editing,
  valid,
  onChange,
  onSubmit,
  onCancel,
  onDelete,
  takenEventIds,
  dirty = false,
}: {
  form: SlateDraftGame;
  editing: boolean;
  valid: boolean;
  onChange: (patch: Partial<SlateDraftGame>) => void;
  onSubmit: () => void;
  /** Editing: discard the edit. Adding: clear the half-filled form. */
  onCancel: () => void;
  onDelete: () => void;
  takenEventIds: string[];
  /** ADD only — has anything been entered? There is nothing to clear on an
   *  untouched form, so the control does not appear until there is. */
  dirty?: boolean;
}) {
  /**
   * The form's fields: 42px tall, radius 11 — the slate design's metrics, so
   * these and the team-search field above them read as one form.
   *
   * ── fontSize 16 is NOT the design's 13.5, and must not be 'corrected' ───
   *
   * The design package specifies 13.5px text for every field on this screen.
   * It is the one measurement here that is not followed, because below 16px
   * iOS Safari ZOOMS THE PAGE on focus — the whole layout jumps as soon as
   * somebody taps a box — which #1062 already fixed once for the chat
   * composer.
   *
   * The design could not have known that; it is a platform behaviour, not a
   * taste question, and the handoff's own rule is that where a measurement
   * differs from what the app already does, the app wins. Reading the spec
   * and setting this to 13.5 would reintroduce a fixed bug.
   */
  const field: React.CSSProperties = {
    background: "var(--color-bt-card-raised)",
    border: "1px solid var(--color-bt-border)",
    borderRadius: 11,
    color: "var(--color-bt-text)",
    fontSize: 16,
    height: 42,
    padding: "0 12px",
    width: "100%",
    minWidth: 0,
  };

  return (
    <div
      className="rounded-xl p-3"
      data-testid="pickem-slate-form"
      style={{ border: "1px dashed var(--color-bt-border)" }}
    >
      <div
        className="mb-2"
        style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}
      >
        {editing ? "Edit game" : "Add a game"}
      </div>

      {/* Search FILLS the fields below; it does not replace them. Manual entry
          stays the base case — Div 3 field hockey is in no API, and an
          unofficial one can go away without notice. Only shown while ADDING:
          re-pointing an existing row at a different real-world contest is a
          different act from fixing its spelling, and quietly swapping the
          teams under a row that may already carry picks is not something a
          typo-fix flow should be able to do. */}
      {!editing && (
        <div className="mb-3">
          <MatchupSearch
            takenEventIds={takenEventIds}
            onPick={(m) =>
              onChange({
                awayTeam: m.away,
                homeTeam: m.home,
                kickoff: formatKickoff(m.startsAt, m.startTimeKnown),
                espnEventId: m.espnEventId,
                // spread and note stay untouched — the line is the runner's
                // editorial call, and setting it is part of the game.
              })
            }
          />
        </div>
      )}

      <div className="mb-2 flex items-center gap-2">
        <input
          aria-label="Away team"
          value={form.awayTeam}
          placeholder="Away"
          onChange={(e) => onChange({ awayTeam: e.target.value })}
          style={field}
        />
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>at</span>
        <input
          aria-label="Home team"
          value={form.homeTeam}
          placeholder="Home"
          onChange={(e) => onChange({ homeTeam: e.target.value })}
          style={field}
        />
      </div>

      <div className="mb-2 flex gap-2">
        <input
          aria-label="Game time"
          value={form.kickoff ?? ""}
          placeholder="Sat 3:30p"
          onChange={(e) => onChange({ kickoff: e.target.value || null })}
          style={{ ...field, flex: "1 1 0" }}
        />
        <input
          /* WHOSE line it is, in the label — it is shown beside the home team
             everywhere it is read, and the form was the one place that made a
             runner remember which side the number was for. */
          aria-label="Spread Home"
          value={form.spread ?? ""}
          placeholder="Spread Home"
          onChange={(e) => onChange({ spread: e.target.value || null })}
          style={{ ...field, flex: "0 0 96px" }}
        />
      </div>

      <input
        aria-label="Note"
        value={form.note ?? ""}
        placeholder="Note (optional)"
        onChange={(e) => onChange({ note: e.target.value || null })}
        style={field}
      />

      {/* The multiplier lives HERE, as a stepper — never in the row.
          The LABEL is neutral and the HELPER carries the state. "Worth extra"
          above "A normal game" had the label asserting something the helper
          immediately denied. */}
      <div className="mt-3 flex items-center justify-between">
        <span className="min-w-0 pr-3">
          {/* The explanation sits INLINE with the label rather than stacked
              under it, which is what was forcing "Multiplier" down to 12px to
              keep the row short. On one line it can read at the row size the
              rest of the form uses. */}
          <span style={{ fontSize: TYPE_SCALE.emphasis, fontWeight: 600 }}>
            Multiplier{" "}
            <span
              style={{
                fontSize: TYPE_SCALE.caption,
                fontWeight: 400,
                color: "var(--color-bt-text-dim)",
              }}
            >
              · {multiplierHelper(form.multiplier)}
            </span>
          </span>
        </span>
        <Stepper
          size="compact"
          value={form.multiplier}
          min={MULTIPLIER_MIN}
          max={MULTIPLIER_MAX}
          onChange={(n) => onChange({ multiplier: n })}
          // Always the number, never a dash. At the default the decrement is
          // already disabled, and "—" beside a greyed minus read as two dashes
          // rather than as a value — noticed on the rendered page, not in review.
          formatValue={(n) => `${n}×`}
          dimValue={form.multiplier === 1}
          testId="pickem-multiplier-stepper"
        />
      </div>

      <div className="mt-3 flex items-center gap-2">
        {/* Abandoning a half-filled ADD. Without it, a game you started and
            thought better of can only be got rid of by adding it and deleting
            it, or by closing the whole modal. */}
        {!editing && dirty && (
          <button
            type="button"
            onClick={onCancel}
            data-testid="pickem-form-clear"
            className="shrink-0 rounded-lg px-3 py-2"
            style={{
              fontSize: TYPE_SCALE.bodyDense,
              fontWeight: 600,
              color: "var(--color-bt-text-dim)",
              border: "1px solid var(--color-bt-border)",
            }}
          >
            Clear
          </button>
        )}
        {editing && (
          <>
            {/* Destructive, so it lives behind the row tap rather than beside
                it — two deliberate taps, and never adjacent to the edit target. */}
            <button
              type="button"
              onClick={onDelete}
              data-testid="pickem-form-delete"
              aria-label="Remove this game"
              className="flex shrink-0 items-center justify-center rounded-lg px-3 py-2"
              style={{
                color: "var(--color-bt-danger)",
                border: "1px solid var(--color-bt-danger)",
              }}
            >
              <Trash2 size={15} />
            </button>
            <button
              type="button"
              onClick={onCancel}
              data-testid="pickem-form-cancel"
              className="rounded-lg px-3 py-2"
              style={{
                fontSize: TYPE_SCALE.bodyDense,
                fontWeight: 600,
                color: "var(--color-bt-text-dim)",
                border: "1px solid var(--color-bt-border)",
              }}
            >
              Cancel
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={!valid}
          data-testid="pickem-add-game"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 disabled:opacity-40"
          style={{
            background: "var(--color-bt-accent)",
            color: "var(--color-bt-base)",
            fontSize: TYPE_SCALE.bodyDense,
            fontWeight: 700,
          }}
        >
          {editing ? "Save changes" : (<><Plus size={15} /> Add game</>)}
        </button>
      </div>
    </div>
  );
}
