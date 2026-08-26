"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { ReorderableList } from "@/components/ReorderableList";
import { TYPE_SCALE, EYEBROW } from "@/lib/typeScale";

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
 * ── Draft-then-save, one atomic commit ──────────────────────────────────────
 * Nothing here self-persists. Adding, editing, removing and reordering all
 * mutate a local draft; Save sends the whole slate plus both settings through
 * ONE `save_pickem_config` (CLAUDE.md #18). The spec's own lock sentence is the
 * reason the settings live in this modal rather than on the settings page
 * behind it: picks opening freezes the slate, its order, spreads, times,
 * multipliers, `roll_up` AND `use_confidence`, all at the same instant and for
 * the same reason. Things that share a lock point share a surface.
 *
 * ── Presentation-only ───────────────────────────────────────────────────────
 * No tRPC in here (CLAUDE.md #7). Every value arrives as a prop; the draft
 * leaves through `onSave`. The parent owns persistence, the mutation and the
 * toast.
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

/** Client-minted id. STABLE across edits by design: it is what lets the RPC
 *  upsert instead of clean-replace, and therefore what keeps a participant's
 *  picks alive through a Reopen (migration 148). */
function newSlateId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `psg_${Date.now().toString(36)}_${rand}`;
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
    }
  }

  const ids = useMemo(() => draft.map((g) => g.id), [draft]);
  const byId = useMemo(() => new Map(draft.map((g) => [g.id, g])), [draft]);

  const mutate = (fn: (prev: SlateDraftGame[]) => SlateDraftGame[]) => {
    setTouched(true);
    setDraft(fn);
  };
  const patch = (id: string, p: Partial<SlateDraftGame>) =>
    mutate((prev) => prev.map((g) => (g.id === id ? { ...g, ...p } : g)));

  /** A row is only worth sending once it names both sides. An unfinished add is
   *  not a game, and the server would reject a null team anyway — better to say
   *  so here, next to the empty field, than as a failed save. */
  const incomplete = draft.filter((g) => !g.awayTeam.trim() || !g.homeTeam.trim());
  const canSave = editable && touched && incomplete.length === 0 && !saving;

  // `Sheet` renders when mounted — it has no `open` prop — so the gate is here,
  // AFTER the hooks above so their order never changes between renders.
  if (!open) return null;

  return (
    <Sheet onClose={onClose} title="The slate" testId="pickem-slate-sheet">
      <div className="flex flex-col gap-4 pb-4">
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
          <div className="mb-2 flex items-baseline justify-between">
            <span style={EYEBROW}>Games</span>
            <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>
              {draft.length === 0
                ? "none yet"
                : `${draft.length} · confidence 1–${draft.length}`}
            </span>
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
              Add the games people will pick. The order you put them in sets the
              confidence range.
            </p>
          ) : (
            <ReorderableList
              ids={ids}
              enabled={editable}
              controlsSide="trailing"
              listClassName="flex flex-col gap-2"
              labelOf={(id) => label(byId.get(id)!)}
              onReorder={(next) =>
                mutate(() => next.map((id) => byId.get(id)!).filter(Boolean))
              }
              renderRow={(id, i) => (
                <SlateRow
                  index={i}
                  game={byId.get(id)!}
                  editable={editable}
                  onPatch={(p) => patch(id, p)}
                  onRemove={() => mutate((prev) => prev.filter((g) => g.id !== id))}
                />
              )}
            />
          )}

          {editable && (
            <button
              type="button"
              onClick={() => mutate((prev) => [...prev, blank()])}
              data-testid="pickem-add-game"
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5"
              style={{
                border: "1px dashed var(--color-bt-border)",
                color: "var(--color-bt-accent)",
                fontSize: TYPE_SCALE.bodyDense,
                fontWeight: 600,
              }}
            >
              <Plus size={15} /> Add a game
            </button>
          )}
        </section>

        {/* ── what a pick is worth ────────────────────────────────────── */}
        <section>
          <div className="mb-2" style={EYEBROW}>
            What a pick is worth
          </div>
          <div className="flex flex-col gap-2">
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
                    detail: "Each person plays one person on the other side. Points split across the matches.",
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
          <div className="flex items-center gap-3">
            <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", flex: 1 }}>
              {incomplete.length > 0
                ? `${incomplete.length} game${incomplete.length === 1 ? "" : "s"} still need both teams`
                : touched
                  ? "Unsaved changes"
                  : "Everything saved"}
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

/** One contest. Inputs are `font-size: 16px` deliberately — anything smaller and
 *  iOS Safari zooms the page on focus, which on a sixteen-row modal is
 *  disorienting (the same fix #1062 made for the chat composer). */
function SlateRow({
  index,
  game,
  editable,
  onPatch,
  onRemove,
}: {
  index: number;
  game: SlateDraftGame;
  editable: boolean;
  onPatch: (p: Partial<SlateDraftGame>) => void;
  onRemove: () => void;
}) {
  const field: React.CSSProperties = {
    background: "var(--color-bt-card-raised)",
    border: "1px solid var(--color-bt-border)",
    borderRadius: 8,
    color: "var(--color-bt-text)",
    fontSize: 16,
    padding: "7px 9px",
    width: "100%",
    minWidth: 0,
  };

  if (!editable) {
    return (
      <div
        className="rounded-xl px-3 py-2"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", minWidth: 18 }}>
            {index + 1}
          </span>
          <span style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600 }}>
            {game.awayTeam} <span style={{ color: "var(--color-bt-text-dim)" }}>at</span>{" "}
            {game.homeTeam}
          </span>
          {game.multiplier !== 1 && <MultiplierBadge value={game.multiplier} />}
        </div>
        {(game.kickoff || game.spread || game.note) && (
          <div style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", marginTop: 3 }}>
            {[game.spread, game.kickoff, game.note].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-2.5"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", minWidth: 18 }}>
          {index + 1}
        </span>
        <input
          aria-label="Away team"
          value={game.awayTeam}
          placeholder="Away"
          onChange={(e) => onPatch({ awayTeam: e.target.value })}
          style={field}
        />
        <span style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)" }}>at</span>
        <input
          aria-label="Home team"
          value={game.homeTeam}
          placeholder="Home"
          onChange={(e) => onPatch({ homeTeam: e.target.value })}
          style={field}
        />
        <button
          type="button"
          aria-label={`Remove ${label(game)}`}
          onClick={onRemove}
          className="shrink-0 rounded p-1"
          style={{ color: "var(--color-bt-text-dim)" }}
        >
          <X size={15} />
        </button>
      </div>
      <div className="flex gap-2">
        <input
          aria-label="Game time"
          value={game.kickoff ?? ""}
          placeholder="Sat 3:30p"
          onChange={(e) => onPatch({ kickoff: e.target.value || null })}
          style={{ ...field, flex: "0 0 110px" }}
        />
        <input
          aria-label="Spread"
          value={game.spread ?? ""}
          placeholder="Spread"
          onChange={(e) => onPatch({ spread: e.target.value || null })}
          style={{ ...field, flex: "0 0 84px" }}
        />
        <input
          aria-label="Multiplier"
          inputMode="numeric"
          value={String(game.multiplier)}
          onChange={(e) => {
            const n = Number(e.target.value);
            // An unparseable or non-positive entry falls back to 1 rather than
            // to NaN — spec §2.3, an unset multiplier is a normal game.
            onPatch({ multiplier: Number.isFinite(n) && n > 0 ? n : 1 });
          }}
          style={{ ...field, flex: "0 0 62px", textAlign: "center" }}
        />
      </div>
      <input
        aria-label="Note"
        value={game.note ?? ""}
        placeholder="Note (optional)"
        onChange={(e) => onPatch({ note: e.target.value || null })}
        style={{ ...field, marginTop: 8 }}
      />
    </div>
  );
}

/** The multiplier mark. Borrows Glorious Finishing Holes' TOKENS and its
 *  "fill + ring" grammar — not its diamond, which is an 18px backdrop with a
 *  hole number on top of it and has no room for a value (#1075's addendum). */
function MultiplierBadge({ value }: { value: number }) {
  return (
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
      {value}× · Worth {value === 2 ? "double" : `${value}×`}
    </span>
  );
}

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
        <div style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", marginTop: 2 }}>
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
      <div style={{ fontSize: TYPE_SCALE.bodyDense, fontWeight: 600, marginBottom: 6 }}>{title}</div>
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
              <div style={{ fontSize: TYPE_SCALE.caption, color: "var(--color-bt-text-dim)", marginTop: 1 }}>
                {o.detail}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
