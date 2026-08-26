"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, Plus, X } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { ReorderableList } from "@/components/ReorderableList";
import { Stepper } from "@/components/games/Stepper";
import { ZoneHeader } from "@/components/games/ZoneHeader";
import { TYPE_SCALE } from "@/lib/typeScale";

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
});

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
  /** The form's working values. Always present; `editingId` says whether
   *  submitting it adds or updates. */
  const [form, setForm] = useState<SlateDraftGame>(blank);
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
      setForm(blank());
      setEditingId(null);
    }
  }

  const ids = useMemo(() => draft.map((g) => g.id), [draft]);
  const byId = useMemo(() => new Map(draft.map((g) => [g.id, g])), [draft]);

  const mutate = (fn: (prev: SlateDraftGame[]) => SlateDraftGame[]) => {
    setTouched(true);
    setDraft(fn);
  };

  const formValid = form.awayTeam.trim().length > 0 && form.homeTeam.trim().length > 0;

  function submitForm() {
    if (!formValid) return;
    const clean: SlateDraftGame = {
      ...form,
      awayTeam: form.awayTeam.trim(),
      homeTeam: form.homeTeam.trim(),
      spread: form.spread?.trim() || null,
      kickoff: form.kickoff?.trim() || null,
      note: form.note?.trim() || null,
    };
    mutate((prev) =>
      editingId ? prev.map((g) => (g.id === editingId ? clean : g)) : [...prev, clean]
    );
    setForm(blank());
    setEditingId(null);
  }

  function editRow(id: string) {
    const g = byId.get(id);
    if (!g) return;
    setForm({ ...g });
    setEditingId(id);
  }

  const canSave = editable && touched && !saving;

  // `Sheet` renders when mounted — it has no `open` prop — so the gate is here,
  // AFTER the hooks above so their order never changes between renders.
  if (!open) return null;

  const rows = draft.map((g, i) => (
    <SlateRow
      key={g.id}
      index={i}
      game={g}
      editable={editable && !reorderMode}
      beingEdited={editingId === g.id}
      onEdit={() => editRow(g.id)}
      onRemove={() => {
        if (editingId === g.id) {
          setForm(blank());
          setEditingId(null);
        }
        mutate((prev) => prev.filter((x) => x.id !== g.id));
      }}
    />
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
            <span
              className="flex-1"
              style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}
            >
              {draft.length === 0
                ? "The order you add them in sets the confidence range."
                : `${draft.length} game${draft.length === 1 ? "" : "s"} · confidence 1–${draft.length}`}
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

        {/* ── the one form ────────────────────────────────────────────── */}
        {editable && !reorderMode && (
          <SlateForm
            form={form}
            editing={editingId != null}
            valid={formValid}
            onChange={(p) => setForm((f) => ({ ...f, ...p }))}
            onSubmit={submitForm}
            onCancel={() => {
              setForm(blank());
              setEditingId(null);
            }}
          />
        )}

        {/* ── what a pick is worth ────────────────────────────────────── */}
        <section>
          <ZoneHeader>What a pick is worth</ZoneHeader>
          <div className="mt-2 flex flex-col gap-2">
            <ToggleRow
              title="Confidence ranking"
              detail={
                draftSettings.useConfidence
                  ? "Everyone ranks the games 1–N. A correct pick scores what they ranked it."
                  : "Every correct pick is worth 1. There is no ranking step at all."
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
                title="How it's scored"
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
  onRemove,
}: {
  index: number;
  game: SlateDraftGame;
  editable: boolean;
  beingEdited: boolean;
  onEdit?: () => void;
  onRemove?: () => void;
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

  const surface: React.CSSProperties = {
    background: weighted
      ? "var(--color-bt-glorious-faint)"
      : beingEdited
        ? "var(--color-bt-accent-faint)"
        : "var(--color-bt-card)",
    border: `1px solid ${
      weighted
        ? "var(--color-bt-glorious-border)"
        : beingEdited
          ? "var(--color-bt-accent-border)"
          : "var(--color-bt-border)"
    }`,
  };

  if (!editable) {
    return (
      <div className="flex items-start rounded-xl px-2.5 py-2" style={surface}>
        {body}
      </div>
    );
  }

  return (
    <div className="flex items-start rounded-xl px-2.5 py-2" style={surface}>
      <button
        type="button"
        onClick={onEdit}
        data-testid="pickem-slate-row"
        aria-label={`Edit ${label(game)}`}
        className="flex min-w-0 flex-1 items-start text-left"
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        {body}
      </button>
      <button
        type="button"
        aria-label={`Remove ${label(game)}`}
        onClick={onRemove}
        className="-mr-0.5 shrink-0 rounded p-1"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        <X size={14} />
      </button>
    </div>
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
}: {
  form: SlateDraftGame;
  editing: boolean;
  valid: boolean;
  onChange: (patch: Partial<SlateDraftGame>) => void;
  onSubmit: () => void;
  onCancel: () => void;
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

      {/* The multiplier lives HERE, as a stepper — never in the row. */}
      <div className="mt-3 flex items-center justify-between">
        <span className="min-w-0 pr-3">
          <span className="block" style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600 }}>
            Worth extra
          </span>
          <span
            className="block"
            style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", marginTop: 1 }}
          >
            {form.multiplier > 1
              ? `Every pick on this game scores ${form.multiplier}×`
              : "A normal game"}
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
        {editing && (
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
