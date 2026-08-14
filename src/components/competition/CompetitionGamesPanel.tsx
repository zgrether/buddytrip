"use client";

import { useEffect, useState } from "react";
import { DelegatePicker } from "@/components/games/DelegatePicker";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Link2, Link2Off } from "lucide-react";
import {
  placementGroups,
  placeOfGroup,
  placementPointsByTeam,
} from "@/lib/placementGroups";
import {
  Plus, X, ListTree,
  Target, Swords, Radio, Check, Users, Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";
import { Stepper } from "@/components/games/Stepper";
import type { PointsDistribution } from "@/lib/pointsDistribution";
import { validatePlacement, placementRefusalMessage } from "@/lib/gameConfig";
import { CATEGORY_ICONS } from "@/lib/gameCategoryIcon";
// Format definitions live in code (W-PERF-01) — the catalog + its type come from
// here, read synchronously, never fetched. Re-exported below so existing
// consumers (CompetitionFace, GameSetupRows) keep their `from "./CompetitionGamesPanel"`
// import path.
import { gameTypesForScoringModel, type GameType, type ScoringModel } from "@/lib/gameTypes";

export type { GameType };

/**
 * The Game sheet — the pure light skeleton (#503): Type → Format → Title →
 * Delegate (a single role-aware grant). EVERYTHING else lives on the settings
 * page now: competition_format (non-golf: NonGolfConfigurationView; golf reads it
 * nowhere), points (golf: GameSetupRows → FormatPointsPanel / inline per-match;
 * non-golf: NonGolfConfigurationView), and course / pairings / handicaps / rules /
 * modifiers (A1 P-C/P-D). A new game is created with sensible point defaults so the
 * row is valid without the field (see persist()); a single save persists the sheet
 * and reconciles the delegate grant.
 *
 * This module also hosts shared scoring-UI bits (ManualPlacementEditor,
 * PlacementEditor, PointStepper, fmtValue, …) used by the non-golf
 * board + config views and the game-setup pages, plus the `GameRow`/`LBTeamLite`
 * row types and `DND_GAME_KEY`. (The old CompetitionGamesPanel list + RunSheet
 * post/correct modal that lived here were removed once GameSheet became Add-only
 * and the non-golf board took over the live/run path.)
 */

export interface LBTeamLite { id: string; name: string; short_name: string; color: string }

/** Drag payload key for a game id — read by the agenda drop targets. */
export const DND_GAME_KEY = "application/x-buddytrip-game-id";

export interface GameRow {
  id: string;
  competition_id: string | null;
  game_type_id: string | null;
  name: string | null;
  status: "pending" | "active" | "complete";
  points_distribution: PointsDistribution | null;
  points_total: number | null;
  competition_format: string | null;
  rules_for_today: string | null;
  modifiers: Record<string, Record<string, unknown>> | null;
  scorecard_schema: unknown | null;
  course_id: string | null;
  /** The BACK nine of a retained two-nines 18 (W-9HOLE-01); null otherwise. */
  back_course_id: string | null;
  schedule_item_id: string | null;
  corrections_open: boolean;
}


// ── Static option tables ──────────────────────────────────────────────────────

// Icons sourced from the shared `gameCategoryIcon.ts` map (leaderboard-grid
// pass) — the leaderboard board resolves the same icon per category, so this
// picker and the board can never drift. Only the label stays local (picker copy).
const CATEGORY_ORDER = ["golf", "card", "yard", "bar", "other"] as const;
const CATEGORY_META: Record<string, { label: string; Icon: LucideIcon }> = {
  golf: { label: "Golf", Icon: CATEGORY_ICONS.golf },
  card: { label: "Card", Icon: CATEGORY_ICONS.card },
  yard: { label: "Yard", Icon: CATEGORY_ICONS.yard },
  bar: { label: "Bar", Icon: CATEGORY_ICONS.bar },
  other: { label: "Other", Icon: CATEGORY_ICONS.other },
};

export const COMP_FORMATS = [
  // "Simple", not "Head-to-Head / Match". The old name described a SHAPE while the
  // action is declaring a result — and the shape it named was wrong for half the
  // games using it (a yard game with four players is not head-to-head). A
  // DISPLAY-STRING change only: the key stays `head_to_head`, which is the DB value
  // RLS and `resultStrategy` branch on.
  { key: "head_to_head", label: "Simple", desc: "Choose winner/loser of game.", Icon: Swords },
  // ONE entry. Single vs double is a SETTING inside the bracket, exactly as entry
  // mode is inside match play — two picker entries made a configuration choice
  // look like two different formats.
  { key: "bracket", label: "Bracket", desc: "We support single and double elimination.", Icon: ListTree },
  { key: "best_of_n", label: "Best of N", desc: "First to win the majority of games.", Icon: Target },
  { key: "live_results", label: "Live Results", desc: "A running tally that updates as it plays (e.g. Pick'em).", Icon: Radio },
] as const;

/**
 * The two keys that PRECEDED the collapse to one "Bracket" entry.
 *
 * They are gone from the picker but not from the data: a game saved before this
 * still carries `bracket_se` / `bracket_de` in `games.competition_format`, and
 * `formatLabel` returning null for them would fall through to the caller's
 * "Simple" default — silently relabelling a bracket as a different format.
 * Read-only compatibility; nothing offers them.
 */
const LEGACY_FORMAT_LABELS: Record<string, string> = {
  bracket_se: "Bracket",
  bracket_de: "Bracket",
};

export function formatLabel(key: string | null): string | null {
  return COMP_FORMATS.find((f) => f.key === key)?.label ?? (key ? LEGACY_FORMAT_LABELS[key] ?? null : null);
}

// ── Game sheet (A1 P-D: single tab — the light add/edit skeleton) ──────────────

export function GameSheet({
  tripId, competitionId, types, canEdit, scoringModel, onClose,
}: {
  tripId: string;
  competitionId: string;
  types: GameType[];
  canEdit: boolean;
  /** The competition's scoring-model (W-TYPE-01) — the create picker offers only
   *  formats compatible with it. Omit/null → offer everything. */
  scoringModel?: ScoringModel | null;
  onClose: () => void;
}) {
  // #509: GameSheet is Add-only (the edit-reopen path was retired in #505; #503
  // slimmed it to the skeleton). The old `isEdit`/`game` edit-mode branches were
  // structurally dead and are gone — this component only ever CREATES a game.
  const utils = trpc.useUtils();

  // W-TYPE-01: the create picker offers only formats whose scoring-model matches
  // the competition's (match_play → 1v1/2v2/rack + manual; points → Stroke + manual).
  const offerable = gameTypesForScoringModel(scoringModel, types);
  const [category, setCategory] = useState<string>("golf");
  const [gameTypeId, setGameTypeId] = useState<string>(
    offerable.find((t) => t.category === "golf")?.id ?? offerable[0]?.id ?? ""
  );
  const [title, setTitle] = useState("");
  // Single delegate for the new game (assigned at create — the one config keeper
  // with no setup-page edit-home; the setup page shows the grant read-only).
  const [delegateId, setDelegateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categoriesPresent = CATEGORY_ORDER.filter((c) => offerable.some((t) => t.category === c));
  const categoryTypes = offerable.filter((t) => t.category === category);
  const effectiveTypeId = categoryTypes.some((t) => t.id === gameTypeId) ? gameTypeId : categoryTypes[0]?.id ?? "";
  const selectedType = types.find((t) => t.id === effectiveTypeId);
  // Per-match formats: 1v1 match play AND rack-n-stack (a set of rank-paired
  // mini-matches) — both accumulate per-match points, not a placement total.
  const isMatchPlay =
    selectedType?.resultStrategy === "match_play" || selectedType?.resultStrategy === "rack_n_stack";
  const isGolf = category === "golf";

  // No crew query here any more — `DelegatePicker` fetches its own, which is what
  // let this sheet stop passing a `members` list down two levels. Same React
  // Query key either way, so the request count is unchanged.

  const create = trpc.games.create.useMutation();
  const addOrg = trpc.games.addOrganizer.useMutation();

  // Clear a submit error as soon as the user changes anything relevant.
  useEffect(() => {
    if (error) setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, effectiveTypeId]);

  async function assignDelegate(gameId: string) {
    // A new game has no prior grant — assign the chosen delegate (if any). The
    // setData below seeds the listOrganizers cache the settings page reads, so the
    // grant shows there without racing the background refetch.
    if (delegateId) await addOrg.mutateAsync({ tripId, gameId, userId: delegateId });
    utils.games.listOrganizers.setData(
      { tripId, gameId },
      delegateId
        ? ([{ user_id: delegateId, granted_by: null, created_at: null }] as never)
        : []
    );
  }

  async function persist(): Promise<boolean> {
    setError(null);
    if (canEdit && !title.trim()) { setError("Add a title to save this game"); return false; }
    if (!effectiveTypeId) { setError("Pick a format"); return false; }
    try {
      // #503: points are configured on the settings page now (golf: GameSetupRows;
      // non-golf: NonGolfConfigurationView), not in the Add modal. A new game is
      // created with sensible defaults so the row is valid without the field: a match
      // game at 0 points-per-match (the C1 default-0 that keeps the Enable gate shut
      // until set), a placement game at 0 total with no split yet (item 2 — the total
      // is configured on the settings page; 0 reads as configured, not the old
      // roster-guess 8, and scales the moment an owner sets it. A placement game's
      // null distribution is winner-takes-all by default — item 6).
      const createDistribution: PointsDistribution | null = isMatchPlay
        ? { type: "per_match", value: 0 }
        : null;
      const created = (await create.mutateAsync({
        tripId, gameTypeId: effectiveTypeId, name: title.trim(), competitionId,
        pointsDistribution: createDistribution, pointsTotal: isMatchPlay ? null : 0,
      })) as { id: string };
      const gameId = created.id;
      // Course / match rows are NOT seeded here — set on the setup pages (A1 P-C / C1).
      if (canEdit) await assignDelegate(gameId);
      utils.games.listByTrip.invalidate({ tripId });
      utils.games.listOrganizers.invalidate({ tripId, gameId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
      // #10 — NEVER the child alone. `LiveFaceClient` re-seeds
      // `competitions.leaderboard` FROM `faceBootstrap` on mount, so invalidating
      // only the child is silently undone: the re-seed writes the bootstrap's
      // stale value back AND marks the query fresh, so no refetch fires and the
      // new game doesn't appear until the 5-minute backstop poll. This was the
      // ONLY create/delete/reorder path missing it — `GameDangerZone`'s delete and
      // reset, the team mutations, and competition settings all pair the two.
      utils.competitions.faceBootstrap.invalidate({ tripId });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save game");
      return false;
    }
  }

  async function handleSave() {
    if (await persist()) onClose();
  }

  const busy = create.isPending;

  return (
    <ScrollLock>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        style={{ background: "var(--color-bt-overlay)" }}
        onClick={onClose}
      >
        <div
          className="flex max-h-[90vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
          style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ borderBottom: "1px solid var(--color-bt-border)" }}>
            <div className="flex items-center justify-between px-4 py-3">
              <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>
                Add Game
              </h3>
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: "var(--color-bt-text-dim)" }}>
                <X size={16} />
              </button>
            </div>
          </div>

          {/* A1 P-D: single tab — the Configuration tab + its now-homed/dead contents
              (Rules → setup GameRulesNote, Modifiers → setup rows, MakeItReady → dead)
              are gone. The Game tab is the whole light skeleton. */}
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <GameTab
                canEdit={canEdit}
                categoriesPresent={categoriesPresent}
                category={category}
                setCategory={(c) => { setCategory(c); const first = types.find((t) => t.category === c); if (first) setGameTypeId(first.id); }}
                categoryTypes={categoryTypes}
                effectiveTypeId={effectiveTypeId}
                setGameTypeId={setGameTypeId}
                selectedType={selectedType}
                title={title}
                setTitle={setTitle}
                isGolf={isGolf}
                tripId={tripId}
                competitionId={competitionId}
                delegateId={delegateId}
                setDelegateId={setDelegateId}
              />

            {error && <p className="text-xs" style={{ color: "var(--color-bt-danger)" }}>{error}</p>}
          </div>

          <div className="flex items-center gap-2 border-t p-4" style={{ borderColor: "var(--color-bt-border)" }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              data-testid="save-game"
              className="flex-1 rounded-xl py-3 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }}
            >
              Add game
            </button>
          </div>
        </div>
      </div>
    </ScrollLock>
  );
}

// ── Game tab ──────────────────────────────────────────────────────────────────

function GameTab({
  canEdit, categoriesPresent, category, setCategory, categoryTypes, effectiveTypeId,
  setGameTypeId, selectedType, title, setTitle, isGolf,
  delegateId, setDelegateId, tripId, competitionId,
}: {
  canEdit: boolean; categoriesPresent: readonly string[]; category: string;
  setCategory: (c: string) => void; categoryTypes: GameType[]; effectiveTypeId: string;
  setGameTypeId: (id: string) => void; selectedType: GameType | undefined; title: string;
  setTitle: (s: string) => void; isGolf: boolean;
  delegateId: string | null; setDelegateId: (id: string | null) => void;
  /** Both threaded to the shared `DelegatePicker` — it fetches the crew itself
   *  (so `members` is no longer passed down) and resolves team colours. */
  tripId: string; competitionId: string;
}) {
  const readOnly = !canEdit;
  return (
    <>
      <Field label="Type" required>
        <div className="grid grid-cols-5 gap-2">
          {categoriesPresent.map((c) => {
            const m = CATEGORY_META[c];
            return <TypeChip key={c} active={category === c} onClick={() => setCategory(c)} icon={<m.Icon size={18} />} label={m.label} />;
          })}
        </div>
      </Field>

      <Field label="Format" required>
        <div className="flex flex-wrap gap-1.5">
          {categoryTypes.map((t) => (
            <Chip key={t.id} active={effectiveTypeId === t.id} onClick={() => setGameTypeId(t.id)}>{t.name}</Chip>
          ))}
        </div>
        {selectedType && !selectedType.isEngine && (
          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
            No built-in scoring engine for this type yet — name it below and enter the result by hand.
          </p>
        )}
      </Field>

      <Field label="Title" required>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          readOnly={readOnly}
          placeholder={isGolf ? "e.g. Day 1 Scramble" : "e.g. Poker Night, Cornhole"}
          maxLength={200}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)", opacity: readOnly ? 0.7 : 1 }}
        />
      </Field>

      {/* Delegate (A1 P-A) — moved here from the retired Configuration tab. It's the
          one config keeper with no setup-page edit-home (the setup page shows the
          grant read-only in GameIdentityHeader). */}
      <DelegationBlock canEdit={canEdit} competitionId={competitionId} tripId={tripId} delegateId={delegateId} setDelegateId={setDelegateId} />

      {/* Course (A1 P-C), points (#503), and Matches (build-as-you-go) all live on
          the game's settings pages now — the Add modal is the pure skeleton
          (type/format/title/delegate). */}
    </>
  );
}

/** The integrated −/value/+ point control (matches the mock). */
export function PointStepper({
  label, caption, value, onChange, footer, max,
}: {
  label: string; caption: string; value: number; onChange: (n: number) => void; footer?: React.ReactNode; max?: number;
}) {
  // A Field + footer composition over the canonical <Stepper> (P-B). The bespoke
  // step-buttons are gone; min stays 1 and fmtValue keeps the ½-point display.
  return (
    <Field label={label} required>
      <div className="rounded-xl" style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}>
        <div className="px-3 py-3">
          <Stepper size="full" value={value} min={1} max={max} onChange={onChange} label={caption} formatValue={fmtValue} />
        </div>
        {footer && (
          <div className="px-3 py-2.5" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
            {footer}
          </div>
        )}
      </div>
    </Field>
  );
}

// ── Delegate block — a thin wrapper over the SHARED DelegatePicker ───────────
//
// This used to be its own picker, and it was the weaker of the two that existed:
// an "Assign a game organizer" button under a "Delegate" header, opening a list
// of bare names with a Users glyph and a +. No avatars, and — the real gap — no
// statement of who it is assigned to RIGHT NOW, so the owner-implicit default
// read as "unset" rather than "yours".
//
// Game settings had the better one. Rather than port its markup (a second copy
// that drifts), the picker was extracted to `DelegatePicker` and both sites now
// render it. What is left here is the surrounding Field label and the
// explanatory line, which are this surface's own framing.
function DelegationBlock({
  canEdit, tripId, competitionId, delegateId, setDelegateId,
}: {
  canEdit: boolean;
  tripId: string;
  competitionId: string;
  delegateId: string | null;
  setDelegateId: (id: string | null) => void;
}) {
  if (!canEdit) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl px-3 py-3" style={{ background: "var(--color-bt-accent-faint)", border: "1px solid var(--color-bt-accent-border)" }}>
        <Users size={16} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--color-bt-accent)" }}>You&rsquo;ve been asked to help set this up</p>
          <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
            Configure away. The owner keeps the basics (name, format, value) here.
          </p>
        </div>
      </div>
    );
  }
  return (
    <Field label="Delegate">
      <DelegatePicker
        tripId={tripId}
        competitionId={competitionId}
        canAssign={canEdit}
        value={delegateId}
        onChange={setDelegateId}
      />
      <p className="mt-1 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>
        Hand this game&rsquo;s setup and running to one person — they can configure it on the game page.
      </p>
    </Field>
  );
}

// ── Placement editor (distributes the owner total) ────────────────────────────

export function PlacementEditor({
  total, placeInputs, setPlaceInputs, placement,
}: {
  total: number; placeInputs: string[]; setPlaceInputs: (v: string[]) => void;
  placement: ReturnType<typeof validatePlacement>;
}) {
  const started = (placeInputs[0]?.trim() ?? "") !== "";
  return (
    <Field label="Point distribution">
      <p className="mb-2 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text)" }}>
        The owner set this game at <span className="font-semibold" style={{ color: "var(--color-bt-accent)" }}>{fmtValue(total)} points</span>. Spread them across team places — the split must total {fmtValue(total)} exactly.
      </p>
      <div className="space-y-2">
        {placeInputs.map((p, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-16 flex-shrink-0 text-xs font-semibold" style={{ color: "var(--color-bt-text)" }}>
              {ordinalShort(i + 1)} place
            </span>
            {/* C2: the app number picker (Stepper) — decimal tap-entry, no browser
                spinner. An untouched place stays "" in state (Stepper shows 0, but
                onChange only fires on a real edit), so the undistributed-shell/started
                semantics the validation depends on are preserved. */}
            <Stepper
              size="inline"
              value={Number(p.trim() || "0")}
              min={0}
              editable
              onChange={(n) => { const next = [...placeInputs]; next[i] = String(n); setPlaceInputs(next); }}
              testId={`place-input-${i}`}
            />
            <span className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>pts</span>
            {placeInputs.length > 1 && (
              <button
                type="button"
                onClick={() => setPlaceInputs(placeInputs.filter((_, j) => j !== i))}
                aria-label={`Remove ${ordinalShort(i + 1)} place`}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
        {started && (
          <button
            type="button"
            onClick={() => setPlaceInputs([...placeInputs, ""])}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
            style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
          >
            <Plus size={12} style={{ color: "var(--color-bt-accent)" }} />
            Add {ordinalShort(placeInputs.length + 1)} place
          </button>
        )}
        <div className="mt-1 flex items-center justify-between pt-2" style={{ borderTop: "1px solid var(--color-bt-border)" }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Allocated
          </span>
          <span
            className="flex items-center gap-1 text-sm font-bold tabular-nums"
            style={{ color: !started ? "var(--color-bt-text-dim)" : placement.saveable ? "var(--color-bt-accent)" : "var(--color-bt-danger)" }}
          >
            {started && placement.saveable && <Check size={13} />}
            {fmtValue(placement.allocated)} of {fmtValue(total)} pts
          </span>
        </div>
        {/* Places vs teams — the second half of "is this split valid", shown while
            typing rather than only at save. Read straight off `placement`, which
            `validatePlacement` already computed: no second derivation of the rule
            (a duplicate is how F4 happened).

            Rendered ONLY when the capacity is known (`capacity.count != null`) —
            a game configured before its competition has teams (or before its
            draw exists) shows nothing, matching the validator's own
            never-refuse-on-unknown behaviour. */}
        {started && placement.capacity.count != null && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
              Places
            </span>
            <span
              className="text-[11px] font-semibold tabular-nums"
              style={{
                color:
                  placement.state === "too_many_places"
                    ? "var(--color-bt-danger)"
                    : "var(--color-bt-text-dim)",
              }}
            >
              {placement.places} {placement.places === 1 ? "place" : "places"} ·{" "}
              {/* The NOUN follows the capacity's source: a bracket's ceiling is
                  its finish, not a roster, so "2 teams" would be wrong there. */}
              {placement.capacity.source === "bracket"
                ? `finishes ${placement.capacity.count}`
                : `${placement.capacity.count} ${placement.capacity.count === 1 ? "team" : "teams"}`}
            </span>
          </div>
        )}
        {!started && (
          <div className="flex items-start gap-1.5">
            <Info size={12} style={{ color: "var(--color-bt-text-dim)", flexShrink: 0, marginTop: 1 }} />
            <span className="text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
              Points haven&rsquo;t been distributed yet — it can wait until later.
            </span>
          </div>
        )}
        {started && !placement.saveable && (
          <p className="text-[11px]" style={{ color: "var(--color-bt-danger)" }}>
            {/* too-many-places uses the SHARED refusal message, so the inline
                warning and the one the save gate throws are the same sentence —
                it reads as one rule, not two. The sum case keeps its existing
                compact copy: the "N of M pts" line directly above already
                carries those numbers, so the long form would just repeat them. */}
            {placement.state === "too_many_places"
              ? placementRefusalMessage(placement)
              : placement.remaining > 0
              ? `${fmtValue(placement.remaining)} point${placement.remaining === 1 ? "" : "s"} left to allocate`
              : `${fmtValue(-placement.remaining)} point${-placement.remaining === 1 ? "" : "s"} over — must total ${fmtValue(total)}`}
          </p>
        )}
      </div>
    </Field>
  );
}

/** Manual placement entry — order the teams 1st→last; PAYS shows the configured
 *  distribution (the poster sets ORDER, never points). */
export function ManualPlacementEditor({
  order,
  dist,
  teamById,
  canEdit,
  onReorder,
  tiedWithPrev,
  onToggleTie,
}: {
  order: string[];
  dist: number[];
  teamById: (id: string) => LBTeamLite | undefined;
  canEdit: boolean;
  onReorder: (next: string[]) => void;
  /** Teams tied with the row ABOVE them. See `src/lib/placementGroups.ts`. */
  tiedWithPrev: ReadonlySet<string>;
  onToggleTie: (teamId: string) => void;
}) {
  // dnd-kit settings are NOT defaults — every one was found by device testing on
  // the matches board and the roster (`TeamsPanel`), and this reuses them rather
  // than rediscovering them: PointerSensor with a distance activation (a handle
  // drag, never a long-press), a DragOverlay with dropAnimation={null}, the
  // source row hidden while dragging, animateLayoutChanges: () => false, and
  // -webkit-tap-highlight-color cleared.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const groups = placementGroups(order, tiedWithPrev);
  const pointsByTeam = placementPointsByTeam(order, tiedWithPrev, dist);
  /** teamId → the place its GROUP finishes in (tied teams share it). */
  const placeOf = new Map<string, number>();
  groups.forEach((g, gi) => g.forEach((id) => placeOf.set(id, placeOfGroup(groups, gi))));

  return (
    <div>
      {/* "Pays" is gone — jargon, and the number under it is self-evidently the
          points. The remaining header names the thing you are editing. */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Finishing order
        </span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(e) => setDraggingId(String(e.active.id))}
        onDragCancel={() => setDraggingId(null)}
        onDragEnd={(e) => {
          setDraggingId(null);
          const { active, over } = e;
          if (!over || active.id === over.id) return;
          const from = order.indexOf(String(active.id));
          const to = order.indexOf(String(over.id));
          if (from < 0 || to < 0) return;
          onReorder(arrayMove(order, from, to));
        }}
      >
        {/* Stable ids — the team id, never the index. A positional id makes
            dnd-kit re-key every row on each move and the drag jumps. */}
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {order.map((teamId, i) => (
              <PlacementRow
                key={teamId}
                teamId={teamId}
                team={teamById(teamId)}
                place={placeOf.get(teamId) ?? i + 1}
                points={pointsByTeam.get(teamId) ?? 0}
                showPlace={!tiedWithPrev.has(teamId) || i === 0}
                tied={i > 0 && tiedWithPrev.has(teamId)}
                canTie={i > 0}
                canEdit={canEdit}
                onToggleTie={() => onToggleTie(teamId)}
                hidden={draggingId === teamId}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {draggingId ? (
            <PlacementRowBody
              team={teamById(draggingId)}
              place={placeOf.get(draggingId) ?? 1}
              points={pointsByTeam.get(draggingId) ?? 0}
              showPlace
              lifted
            />
          ) : null}
        </DragOverlay>
      </DndContext>
      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
        Drag to set the finishing order. Tap the link icon to tie a team with the one above it —
        tied teams split the points for the places they share, so the game&rsquo;s total never changes.
      </p>
    </div>
  );
}

function PlacementRow({
  teamId, team, place, points, showPlace, tied, canTie, canEdit, onToggleTie, hidden,
}: {
  teamId: string;
  team: LBTeamLite | undefined;
  place: number;
  points: number;
  showPlace: boolean;
  tied: boolean;
  canTie: boolean;
  canEdit: boolean;
  onToggleTie: () => void;
  hidden: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: teamId,
    // dnd-kit animates EVERY sortable on any list change by default, which reads
    // as the whole list breathing after a drop.
    animateLayoutChanges: () => false,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Hidden, not dimmed — the DragOverlay is the row you are dragging.
        visibility: hidden ? "hidden" : undefined,
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <PlacementRowBody
        team={team}
        place={place}
        points={points}
        showPlace={showPlace}
        tied={tied}
        handle={
          canEdit ? (
            <button
              type="button"
              aria-label="Reorder"
              className="flex h-8 w-6 cursor-grab items-center justify-center touch-none"
              style={{ color: "var(--color-bt-text-dim)", WebkitTapHighlightColor: "transparent" }}
              {...attributes}
              {...listeners}
            >
              <GripVertical size={15} />
            </button>
          ) : undefined
        }
        tieButton={
          canEdit && canTie ? (
            <button
              type="button"
              onClick={onToggleTie}
              aria-label={tied ? "Untie from the team above" : "Tie with the team above"}
              aria-pressed={tied}
              className="flex h-8 w-7 items-center justify-center rounded"
              style={{
                color: tied ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              {tied ? <Link2 size={15} /> : <Link2Off size={15} />}
            </button>
          ) : undefined
        }
      />
    </div>
  );
}

/** The row's visuals, shared by the live sortable row and the DragOverlay copy so
 *  the floating card can't drift from the list. */
function PlacementRowBody({
  team, place, points, showPlace, tied, handle, tieButton, lifted,
}: {
  team: LBTeamLite | undefined;
  place: number;
  points: number;
  showPlace: boolean;
  tied?: boolean;
  handle?: React.ReactNode;
  tieButton?: React.ReactNode;
  lifted?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-2.5 py-2"
      style={{
        background: "var(--color-bt-card-raised)",
        border: `1px solid ${tied ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
        boxShadow: lifted ? "var(--shadow-raised)" : undefined,
        // A tied row is indented so a shared place reads as one block.
        marginLeft: tied ? 14 : undefined,
      }}
    >
      <span className="w-5 text-center text-sm font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>
        {showPlace ? place : ""}
      </span>
      <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: team?.color ?? "var(--color-bt-text-dim)" }} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>
        {team?.name ?? "Team"}
      </span>
      {/* Points inline and prominent — the number that decides the cup. */}
      <span
        className="text-sm font-bold tabular-nums"
        style={{ color: points > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}
      >
        {fmtValue(points)}
      </span>
      {tieButton}
      {handle}
    </div>
  );
}

// ── small shared bits ─────────────────────────────────────────────────────────

function TypeChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-xl py-2.5 text-[10px] font-semibold"
      style={
        active
          ? { background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)", border: "1.5px solid var(--color-bt-accent-border)" }
          : { background: "var(--color-bt-card-raised)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }
      }
    >
      {icon}
      {label}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-xs font-semibold"
      style={
        active
          ? { background: "var(--color-bt-accent)", color: "var(--color-bt-base)" }
          : { background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }
      }
    >
      {children}
    </button>
  );
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>{label}</label>
        {required && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-bt-danger)" }} />}
      </div>
      {children}
    </div>
  );
}

export function ordinalShort(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Whole numbers as-is, halves as ½ (0.5 → "½", 1.5 → "1½"); other fractions kept
 *  exact to 2dp (1.25 → "1.25") so fractional shares survive display (#585). */
export function fmtValue(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const whole = Math.floor(n);
  if (Math.abs(n - whole - 0.5) < 0.001) return whole === 0 ? "½" : `${whole}½`;
  return String(Math.round(n * 100) / 100);
}
