"use client";

import { useEffect, useState } from "react";
import {
  Plus, X, Trophy,
  Target, Swords, Radio, ChevronUp, ChevronDown, Check, Users, Info,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import { ScrollLock } from "@/hooks/useScrollLock";
import { Stepper } from "@/components/games/Stepper";
import type { PointsDistribution } from "@/lib/pointsDistribution";
import { validatePlacement } from "@/lib/gameConfig";
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
 * PlacementEditor, PointStepper, FormatSheet, fmtValue, …) used by the non-golf
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

interface Member { memberId: string; displayName: string }

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

const COMP_FORMATS = [
  { key: "head_to_head", label: "Head-to-Head / Match", desc: "One-off matchup, winner takes the points.", Icon: Swords },
  { key: "bracket_se", label: "Bracket — Single Elimination", desc: "Lose once, you're out.", Icon: Trophy },
  { key: "bracket_de", label: "Bracket — Double Elimination", desc: "Two lives — a losers' bracket.", Icon: Trophy },
  { key: "best_of_n", label: "Best of N", desc: "First to win the majority of games.", Icon: Target },
  { key: "live_results", label: "Live Results", desc: "A running tally that updates as it plays (e.g. Pick'em).", Icon: Radio },
] as const;

export function formatLabel(key: string | null): string | null {
  return COMP_FORMATS.find((f) => f.key === key)?.label ?? null;
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

  // Members for the delegate picker + name resolution.
  const { data: members = [] } = trpc.tripMembers.list.useQuery({ tripId }, { enabled: canEdit });

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
      // until set), a placement game at the owner default 8 with no split yet
      // (FormatPointsPanel reads `points_total ?? 8`).
      const createDistribution: PointsDistribution | null = isMatchPlay
        ? { type: "per_match", value: 0 }
        : null;
      const created = (await create.mutateAsync({
        tripId, gameTypeId: effectiveTypeId, name: title.trim(), competitionId,
        pointsDistribution: createDistribution, pointsTotal: isMatchPlay ? null : 8,
      })) as { id: string };
      const gameId = created.id;
      // Course / match rows are NOT seeded here — set on the setup pages (A1 P-C / C1).
      if (canEdit) await assignDelegate(gameId);
      utils.games.listByTrip.invalidate({ tripId });
      utils.games.listOrganizers.invalidate({ tripId, gameId });
      utils.competitions.leaderboard.invalidate({ tripId, competitionId });
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
                members={members as Member[]}
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
  members, delegateId, setDelegateId,
}: {
  canEdit: boolean; categoriesPresent: readonly string[]; category: string;
  setCategory: (c: string) => void; categoryTypes: GameType[]; effectiveTypeId: string;
  setGameTypeId: (id: string) => void; selectedType: GameType | undefined; title: string;
  setTitle: (s: string) => void; isGolf: boolean;
  members: Member[]; delegateId: string | null; setDelegateId: (id: string | null) => void;
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
      <DelegationBlock canEdit={canEdit} members={members} delegateId={delegateId} setDelegateId={setDelegateId} />

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

// ── Delegate picker (on the Game tab since A1 P-A) ─────────────────────────────

function DelegationBlock({
  canEdit, members, delegateId, setDelegateId,
}: {
  canEdit: boolean; members: Member[]; delegateId: string | null; setDelegateId: (id: string | null) => void;
}) {
  const [picking, setPicking] = useState(false);

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

  const assigned = members.find((m) => m.memberId === delegateId);
  return (
    <Field label="Delegate">
      {assigned ? (
        <div
          className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
        >
          <span className="flex items-center gap-2"><Users size={14} style={{ color: "var(--color-bt-accent)" }} />{assigned.displayName}</span>
          <button type="button" onClick={() => { setDelegateId(null); setPicking(false); }} aria-label="Remove delegate" className="flex h-6 w-6 items-center justify-center rounded-md" style={{ color: "var(--color-bt-text-dim)" }}>
            <X size={13} />
          </button>
        </div>
      ) : !picking ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm"
          style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
        >
          <Users size={15} style={{ color: "var(--color-bt-accent)" }} />
          Assign a game organizer
        </button>
      ) : (
        <div className="space-y-1.5">
          {members.map((m) => (
            <button
              key={m.memberId}
              type="button"
              onClick={() => { setDelegateId(m.memberId); setPicking(false); }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
            >
              <span>{m.displayName}</span>
              <Plus size={13} style={{ color: "var(--color-bt-accent)" }} />
            </button>
          ))}
          {members.length === 0 && (
            <p className="text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>No crew to assign yet.</p>
          )}
        </div>
      )}
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
            <input
              type="number" min={0} value={p}
              onChange={(e) => { const next = [...placeInputs]; next[i] = e.target.value; setPlaceInputs(next); }}
              className="w-20 rounded-lg px-2 py-1.5 text-sm outline-none"
              style={{ background: "var(--color-bt-card-raised)", color: "var(--color-bt-text)", border: "1px solid var(--color-bt-border)" }}
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
            {placement.remaining > 0
              ? `${fmtValue(placement.remaining)} point${placement.remaining === 1 ? "" : "s"} left to allocate`
              : `${fmtValue(-placement.remaining)} point${-placement.remaining === 1 ? "" : "s"} over — must total ${fmtValue(total)}`}
          </p>
        )}
      </div>
    </Field>
  );
}

// ── "How's it played?" format sheet ───────────────────────────────────────────

export function FormatSheet({
  current, onPick, onClose,
}: {
  current: string | null; onPick: (k: string) => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" style={{ background: "var(--color-bt-overlay)" }} onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-t-2xl sm:rounded-2xl"
        style={{ background: "var(--color-bt-card-float)", border: "1px solid var(--color-bt-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--color-bt-border)" }}>
          <h3 className="text-base font-bold" style={{ color: "var(--color-bt-text)" }}>How&rsquo;s it played?</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color: "var(--color-bt-text-dim)" }}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {COMP_FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onPick(f.key)}
              className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left"
              style={{
                background: current === f.key ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
                border: `1px solid ${current === f.key ? "var(--color-bt-accent-border)" : "var(--color-bt-border)"}`,
              }}
            >
              <f.Icon size={16} style={{ color: "var(--color-bt-accent)", flexShrink: 0, marginTop: 1 }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>{f.label}</span>
                  <span className="rounded px-1 py-0.5 text-[9px] font-bold uppercase" style={{ background: "var(--color-bt-card)", color: "var(--color-bt-text-dim)", border: "1px solid var(--color-bt-border)" }}>Manual</span>
                  {current === f.key && <Check size={13} style={{ color: "var(--color-bt-accent)", marginLeft: "auto" }} />}
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: "var(--color-bt-text-dim)" }}>{f.desc}</p>
              </div>
            </button>
          ))}
          <p className="px-1 pt-1 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
            However it runs, you can always enter the result by hand — picking a format never leaves you stuck on &ldquo;coming soon.&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}

/** Manual placement entry — order the teams 1st→last; PAYS shows the configured
 *  distribution (the poster sets ORDER, never points). */
export function ManualPlacementEditor({
  order, dist, teamById, move,
}: {
  order: string[]; dist: number[];
  teamById: (id: string) => LBTeamLite | undefined; move: (i: number, dir: -1 | 1) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Finishing order</span>
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Pays</span>
      </div>
      <div className="space-y-1.5">
        {order.map((teamId, i) => {
          const team = teamById(teamId);
          const pays = dist[i] ?? 0;
          return (
            <div key={teamId} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)" }}>
              <span className="w-5 text-center text-sm font-bold tabular-nums" style={{ color: "var(--color-bt-text-dim)" }}>{i + 1}</span>
              <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: team?.color ?? "var(--color-bt-text-dim)" }} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>{team?.name ?? "Team"}</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: pays > 0 ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}>{fmtValue(pays)}</span>
              <div className="ml-1 flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="flex h-4 w-6 items-center justify-center rounded disabled:opacity-30" style={{ color: "var(--color-bt-text-dim)" }}>
                  <ChevronUp size={13} />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Move down" className="flex h-4 w-6 items-center justify-center rounded disabled:opacity-30" style={{ color: "var(--color-bt-text-dim)" }}>
                  <ChevronDown size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--color-bt-text-dim)" }}>
        Order the teams by finish — points come from the game&rsquo;s configured distribution, so you set the order, not the points.
      </p>
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

/** Whole numbers as-is, halves as ½ (0.5 → "½", 1.5 → "1½"). */
export function fmtValue(n: number): string {
  const whole = Math.floor(n);
  const isHalf = Math.abs(n - whole - 0.5) < 0.001;
  if (!isHalf) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}
