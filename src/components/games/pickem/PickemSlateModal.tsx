"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Plus, Trash2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { ReorderableList } from "@/components/ReorderableList";
import { Stepper } from "@/components/games/Stepper";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import { TYPE_SCALE } from "@/lib/typeScale";
import { MatchupSearch } from "@/components/matchup/MatchupSearch";
import { formatKickoff } from "@/lib/matchupApi";

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
 * Nothing here self-persists. Save sends the whole slate plus both settings
 * through ONE `save_pickem_config` (CLAUDE.md #18). The settings live in this
 * modal rather than on the settings page behind it because spec §4 freezes them
 * at the same instant as the slate and for the same reason — things that share a
 * lock point share a surface.
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
  settings,
  editable,
  showRollUp,
  saving,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  slate: SlateDraftGame[];
  settings: PickemSettingsDraft;
  /**
   * False once picks are open. The modal still OPENS — the runner needs to read
   * the slate he published — but every control is gone rather than disabled,
   * and the banner says what to do about it. Removing rather than disabling is
   * the same choice `ChecklistRow` made: a disabled control with no reason
   * attached teaches nobody why.
   */
  editable: boolean;
  /** `roll_up` is match-play only — a points competition always rolls up as
   *  team totals across N teams, so the setting is HIDDEN rather than shown
   *  inert (spec §2: hide what the format makes unreachable). */
  showRollUp: boolean;
  saving: boolean;
  onSave: (next: { slate: SlateDraftGame[]; settings: PickemSettingsDraft }) => void;
}) {
  const [draft, setDraft] = useState<SlateDraftGame[]>(slate);
  const [draftSettings, setDraftSettings] = useState<PickemSettingsDraft>(settings);
  const [touched, setTouched] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
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
      setDraftSettings(settings);
      setTouched(false);
      setReorderMode(false);
      setAddForm(blank());
      setEditForm(null);
      setEditingId(null);
    }
  }

  const ids = useMemo(() => draft.map((g) => g.id), [draft]);
  const byId = useMemo(() => new Map(draft.map((g) => [g.id, g])), [draft]);

  const mutate = (fn: (prev: SlateDraftGame[]) => SlateDraftGame[]) => {
    setTouched(true);
    setDraft(fn);
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
    mutate((prev) => [...prev, clean(addForm)]);
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

  const canSave = editable && touched && !saving;

  // `Sheet` renders when mounted — it has no `open` prop — so the gate is here,
  // AFTER the hooks above so their order never changes between renders.
  if (!open) return null;

  const formsUsable = editable && !reorderMode;

  const rows = draft.map((g, i) => (
    <div key={g.id} className="flex flex-col gap-1.5">
      <SlateRow
        index={i}
        game={g}
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
  ));

  return (
    <Sheet onClose={onClose} title="The slate" testId="pickem-slate-sheet">
      <div className="flex flex-col gap-3 pb-4">
        {!editable && (
          <div
            className="rounded-xl px-3 py-2.5"
            style={{
              background: "var(--color-bt-warning-faint)",
              border: "1px solid var(--color-bt-warning-border)",
              fontSize: TYPE_SCALE.bodyDense,
            }}
          >
            <b>Picks are open, so the slate is frozen.</b> Everyone has already ranked these
            games. Reopen the slate from settings if you have to change it — everyone will
            have to re-rank.
          </div>
        )}

        {/* ── the games ───────────────────────────────────────────────── */}
        <section>
          <ZoneHeader>Games</ZoneHeader>
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
              onReorder={(next) => mutate(() => next.map((id) => byId.get(id)!).filter(Boolean))}
              renderRow={(id, i) => (
                <SlateRow index={i} game={byId.get(id)!} editable={false} beingEdited={false} />
              )}
            />
          ) : (
            <div className="flex flex-col gap-1.5">{rows}</div>
          )}
        </section>

        {/* The ADD panel, at the end of the list — where a new game goes, and
            independent of any edit that may be open above it. */}
        {formsUsable && (
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

        {/* ── what a pick is worth ────────────────────────────────────── */}
        <section>
          <ZoneHeader>How scoring works</ZoneHeader>
          <div className="mt-2 flex flex-col gap-2">
            <ToggleRow
              title="Use confidence points"
              detail={
                draftSettings.useConfidence
                  ? "Every correct pick is worth the confidence rank it is given."
                  : "Correct picks are worth 1 point."
              }
              on={draftSettings.useConfidence}
              disabled={!editable}
              onToggle={() => {
                setTouched(true);
                setDraftSettings((s) => ({ ...s, useConfidence: !s.useConfidence }));
              }}
            />
            {showRollUp && (
              <ChoiceRow
                title="How points are awarded"
                options={[
                  {
                    value: "team_totals",
                    label: "Team totals",
                    detail: "Every sheet sums into its side's number. Higher total takes the points.",
                  },
                  {
                    value: "individual_matches",
                    label: "Individual matches",
                    detail:
                      "Each person plays one person on the other side. Points split across the matches.",
                  },
                ]}
                value={draftSettings.rollUp}
                disabled={!editable}
                onChange={(v) => {
                  setTouched(true);
                  setDraftSettings((s) => ({ ...s, rollUp: v as PickemSettingsDraft["rollUp"] }));
                }}
              />
            )}
          </div>
        </section>

        {/* ── save ────────────────────────────────────────────────────── */}
        {editable && (
          <div className="flex items-center gap-3 pt-1">
            <span
              style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", flex: 1 }}
            >
              {touched ? "Unsaved changes" : "Everything saved"}
            </span>
            <button
              type="button"
              onClick={() => onSave({ slate: draft, settings: draftSettings })}
              disabled={!canSave}
              data-testid="pickem-save-slate"
              className="rounded-xl px-4 py-2 disabled:opacity-40"
              style={{
                background: "var(--color-bt-accent)",
                color: "var(--color-bt-base)",
                fontSize: TYPE_SCALE.bodyDense,
                fontWeight: 700,
              }}
            >
              {saving ? "Saving…" : "Save"}
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
  editable,
  beingEdited,
  onEdit,
}: {
  index: number;
  game: SlateDraftGame;
  editable: boolean;
  beingEdited: boolean;
  onEdit?: () => void;
}) {
  const weighted = game.multiplier > 1;
  const meta = [game.kickoff, game.note].filter(Boolean).join(" · ");

  const body = (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <span
        style={{
          fontSize: TYPE_SCALE.caption,
          fontWeight: 700,
          color: "var(--color-bt-text-dim)",
          fontVariantNumeric: "tabular-nums",
          minWidth: 16,
          paddingTop: 1,
        }}
      >
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>
            {game.awayTeam} <span style={{ color: "var(--color-bt-text-dim)", fontWeight: 500 }}>at</span>{" "}
            {game.homeTeam}
          </span>
          {game.spread && (
            <span
              className="rounded px-1.5"
              style={{
                fontSize: TYPE_SCALE.caption,
                fontWeight: 700,
                background: "var(--color-bt-planning-faint)",
                color: "var(--color-bt-planning)",
              }}
            >
              {game.spread}
            </span>
          )}
          {weighted && (
            <span
              data-testid="pickem-multiplier-badge"
              className="rounded px-1.5"
              style={{
                fontSize: TYPE_SCALE.caption,
                fontWeight: 700,
                color: "var(--color-bt-glorious)",
                background: "color-mix(in srgb, var(--color-bt-glorious) 22%, transparent)",
                border: "1px solid var(--color-bt-glorious-border)",
              }}
            >
              {game.multiplier}×
            </span>
          )}
        </span>
        {meta && (
          <span
            className="mt-0.5 block truncate"
            style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
          >
            {meta}
          </span>
        )}
      </span>
    </div>
  );

  /**
   * A weighted game is marked by a SOLID LEFT STRIPE, not a background fill.
   *
   * The fill was a 12% tint over a card surface and it never read — which was
   * the whole job, since the point of the treatment is to make weighted games
   * findable WITHOUT reading them. Scanning a sixteen-row list is a vertical eye
   * movement down the left edge, so that edge is where the mark belongs; a solid
   * 3px rule survives the glance that a wash does not.
   *
   * The badge stays and carries the value. Colour says "this one is worth more",
   * number says how much.
   */
  const edge = beingEdited ? "var(--color-bt-accent-border)" : "var(--color-bt-border)";
  /**
   * Per-side LONGHANDS, never the `border` shorthand plus a `borderLeft`
   * override.
   *
   * React warns on that combination — "updating a style property during
   * rerender (border) when a conflicting property is set (borderLeft) can lead
   * to styling bugs" — and it is right: which one wins depends on property
   * order across a re-render, so the stripe could be silently clobbered when a
   * row toggles into or out of `beingEdited`. Caught in the dev console, not in
   * review.
   */
  const surface: React.CSSProperties = {
    background: beingEdited ? "var(--color-bt-accent-faint)" : "var(--color-bt-card)",
    borderStyle: "solid",
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: weighted ? 3 : 1,
    borderTopColor: edge,
    borderRightColor: edge,
    borderBottomColor: edge,
    borderLeftColor: weighted ? "var(--color-bt-glorious)" : edge,
  };

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
  // 16px deliberately — anything smaller and iOS Safari zooms the page on focus
  // (the fix #1062 made for the chat composer).
  const field: React.CSSProperties = {
    background: "var(--color-bt-card-raised)",
    border: "1px solid var(--color-bt-border)",
    borderRadius: 8,
    color: "var(--color-bt-text)",
    fontSize: 16,
    padding: "8px 10px",
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
          aria-label="Spread"
          value={form.spread ?? ""}
          placeholder="Spread"
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
          <span className="block" style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600 }}>
            Multiplier
          </span>
          <span
            className="block"
            style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", marginTop: 1 }}
          >
            {multiplierHelper(form.multiplier)}
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

/** A settings row. Same type as the settings rows beside it on the game settings
 *  page — Total Points, Game State — because this IS a scoring setting and the
 *  smaller type read it as a footnote. */
function ToggleRow({
  title,
  detail,
  on,
  disabled,
  onToggle,
}: {
  title: string;
  detail: string;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div className="min-w-0 flex-1">
        <div style={{ fontSize: TYPE_SCALE.body, fontWeight: 600 }}>{title}</div>
        <div
          style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", marginTop: 2 }}
        >
          {detail}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        disabled={disabled}
        onClick={onToggle}
        className="relative shrink-0 rounded-full disabled:opacity-40"
        style={{
          width: 42,
          height: 24,
          background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
          border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
        }}
      >
        <span
          className="absolute rounded-full"
          style={{
            top: 2,
            left: on ? 20 : 2,
            width: 18,
            height: 18,
            background: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            transition: "left .14s",
          }}
        />
      </button>
    </div>
  );
}

function ChoiceRow({
  title,
  options,
  value,
  disabled,
  onChange,
}: {
  title: string;
  options: { value: string; label: string; detail: string }[];
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div style={{ fontSize: TYPE_SCALE.body, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div className="flex flex-col gap-1.5">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(o.value)}
              aria-pressed={on}
              className="rounded-lg px-2.5 py-2 text-left disabled:opacity-40"
              style={{
                background: on ? "var(--color-bt-accent-faint)" : "transparent",
                border: `1px solid ${on ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
              }}
            >
              <div
                style={{
                  fontSize: TYPE_SCALE.bodyDense,
                  fontWeight: 600,
                  color: on ? "var(--color-bt-accent)" : "var(--color-bt-text)",
                }}
              >
                {o.label}
              </div>
              <div
                style={{
                  fontSize: TYPE_SCALE.caption,
                  color: "var(--color-bt-text-dim)",
                  marginTop: 1,
                }}
              >
                {o.detail}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
