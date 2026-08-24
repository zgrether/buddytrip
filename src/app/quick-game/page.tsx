"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, RotateCcw, Users, ChevronRight, Table2, Zap } from "lucide-react";
import { trpc } from "@/lib/trpc-client";
import {
  QUICK_GAME_STORAGE_KEY,
  QUICK_GAME_STATE_VERSION,
  migrateQuickGameState,
  quickGameUnits,
  quickGamePips,
  quickGameStandings,
  buildRosterFromDrafts,
  draftRowsFrom,
  buildQuickMatchSides,
  quickFormatPlayerCountError,
  quickMatchGloriousAvailable,
  quickGameTitle,
  quickGameSubtitle,
  hasAnyScore,
  isMatchGame,
  isRackGame,
  quickSideName,
  QUICK_GAME_LABEL,
  type QuickGameState,
  type QuickGameCourse,
  type QuickGameFormat,
  type DraftPlayerRow,
} from "@/lib/quickGame";
import { QuickMatchSurface } from "@/components/games/quick/QuickMatchSurface";
import type { HoleOutcomeResult } from "@/lib/matchPlay";
import type { Team } from "@/lib/rackNStack";
import { GLORIOUS_HOLES_DEFAULT, GLORIOUS_HOLES_MIN, GLORIOUS_HOLES_MAX } from "@/lib/modifiers";
import { MAX_STROKES } from "@/lib/handicap";
import { PLAYER_COLORS } from "@/lib/strokePlayConfig";
import { buildCourseSnapshot, type CourseSnapshotInput } from "@/lib/courseSnapshot";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { ScoreEntryView } from "@/components/games/ScoreEntryView";
import { StandardGrid } from "@/components/games/StandardGrid";
import { FinalStandings } from "@/components/games/FinalStandings";
import { ScorecardSheet } from "@/components/games/ScorecardSheet";
import { SettingsSlideOver } from "@/components/games/SettingsSlideOver";
import { Stepper } from "@/components/games/Stepper";
import { SectionLabel, DangerRow, DangerConfirmModal } from "@/components/DangerZone";

/**
 * Quick Stroke Play ⚡ (Slice A2, extended Phase 1 with course selection +
 * handicaps + roster editing). A context-free stroke-play game. Renamed from
 * "Quick Game" (#879 item 1a): the old name promised a format picker that
 * doesn't exist — it only ever does stroke play. The route (`/quick-game`) and
 * the localStorage key stay as they were; those are identifiers, not the
 * user-facing name.
 *
 * Reuses ScoreEntryView / StandardGrid / FinalStandings / ScorecardSheet
 * UNCHANGED — the scorecard is the SAME `Sheet`-based overlay every other golf
 * format uses (CLAUDE.md's Reuse target: "Scorecard = a Sheet overlay, not a
 * full-page route"). This page's grid view first shipped as a bespoke
 * full-screen route instead — the exact "reinvent it slightly differently"
 * this rule exists to prevent, and the mismatch with every other golf
 * surface (plus a since-fixed horizontal-scroll complaint on it) is what
 * caught it. Only the persistence backend differs from the trip-side games:
 * the whole game state lives in **local storage**,
 * no DB row, no auth beyond the standing session (the route was never public —
 * Phase 0 confirmed `/quick-game` sits behind the same middleware auth gate as
 * every other trip surface), free-text player names. Finish computes standings
 * client-side via the SAME shared helpers a handicap trip game does
 * (`quickGameStandings`) — this is exactly what the persistence-agnostic split
 * (CLAUDE.md pattern #7/#8) was built for.
 *
 * Course selection reuses `CoursePicker` AS-IS (Phase 0 found it takes only
 * `{onApply, onClose}` — no trip/game coupling, no extraction needed) and
 * CAPTURES the applied course's snapshot into local storage via the shared,
 * pure `buildCourseSnapshot` (one fetch at selection, no network on every
 * scorecard render — the round survives losing signal mid-course).
 *
 * `QuickGameState` and the derive helpers live in `@/lib/quickGame` — the
 * dashboard card (#879 item 1c) reads the same saved state, and Quick Game's
 * own readers (final standings, the subtitle) share them too so a handicap
 * round can't net differently in two places (CLAUDE.md #8/#18).
 */

function blankDraftPlayers(): DraftPlayerRow[] {
  return [
    { id: crypto.randomUUID(), name: "", strokes: 0 },
    { id: crypto.randomUUID(), name: "", strokes: 0 },
  ];
}

/** A settings-panel navigation row in the SAME visual grammar as `DangerRow`
 *  (icon-square + label + blurb + chevron) but neutral-toned — "Players &
 *  handicaps" isn't destructive, so it doesn't borrow the warning/danger
 *  vocabulary that row reserves for the danger zone. `disabled` carries its
 *  own blurb text (the caller passes the reason in via `blurb`) rather than
 *  a separate message slot — mirrors how locked rows elsewhere in the app
 *  explain themselves inline instead of failing silently. */
function SettingsNavRow({
  icon, label, blurb, onClick, disabled, testId,
}: {
  icon: React.ReactNode;
  label: string;
  blurb: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-[11px] px-3 py-3 text-left transition-colors hover:bg-[var(--color-bt-hover)] disabled:opacity-50 disabled:hover:bg-transparent"
      style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      data-testid={testId}
    >
      <span
        className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px]"
        style={{ background: "var(--color-bt-accent-faint)", color: "var(--color-bt-accent)" }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color: "var(--color-bt-text)" }}>{label}</span>
        <span className="mt-0.5 block text-xs leading-snug" style={{ color: "var(--color-bt-text-dim)" }}>{blurb}</span>
      </span>
      <ChevronRight size={17} className="flex-shrink-0" style={{ color: "var(--color-bt-text-dim)" }} />
    </button>
  );
}

/**
 * The match-only setup answers: entry mode, partnering (2v2), the RELATIVE
 * handicap, and Glorious Finishing Holes when it can apply.
 *
 * Entry mode is picked HERE, before the round starts, and is never inferred: a
 * scramble or alternate shot has no per-player stroke to enter, so outcome mode
 * is the only way to score it — not a convenience. It also drives what else is
 * offered, which is why it sits first.
 */
function MatchSetupFields({
  players, entryMode, onEntryMode, partnerId, onPartner,
  relStrokes, onRelStrokes, gloriousAvailable, glorious, onGlorious,
  gloriousHoles, onGloriousHoles,
}: {
  players: DraftPlayerRow[];
  entryMode: "score" | "outcome";
  onEntryMode: (m: "score" | "outcome") => void;
  partnerId: string | null;
  onPartner: (id: string) => void;
  relStrokes: number;
  onRelStrokes: (n: number) => void;
  gloriousAvailable: boolean;
  glorious: boolean;
  onGlorious: (on: boolean) => void;
  gloriousHoles: number;
  onGloriousHoles: (n: number) => void;
}) {
  const doubles = players.length === 4;
  const nameOf = (r: DraftPlayerRow, i: number) => r.name.trim() || `Player ${i + 1}`;
  const first = players[0];
  const partner = doubles ? players.find((p) => p.id === partnerId) ?? players[1] : null;
  const opponents = doubles ? players.filter((p) => p.id !== first?.id && p.id !== partner?.id) : [];

  // Side labels for the relative-handicap selector — the same "who gets the
  // strokes" question `RelHandicapControl` asks, in the same [A│Even│B] shape.
  const sideAName = doubles
    ? `${nameOf(first, 0).split(/\s+/)[0]} & ${nameOf(partner!, 1).split(/\s+/)[0]}`
    : nameOf(players[0] ?? { id: "", name: "", strokes: 0 }, 0);
  const sideBName = doubles
    ? opponents.map((p, i) => nameOf(p, i).split(/\s+/)[0]).join(" & ")
    : nameOf(players[1] ?? { id: "", name: "", strokes: 0 }, 1);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div>
        <FieldLabel>Scoring</FieldLabel>
        <Segmented
          options={[
            { value: "score", label: "Enter scores" },
            { value: "outcome", label: "Who won the hole" },
          ]}
          value={entryMode}
          onChange={onEntryMode}
          testId="quick-match-entry-mode"
        />
        <p className="mt-1.5" style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", lineHeight: 1.45 }}>
          {entryMode === "score"
            ? doubles
              ? "One score per side, per hole — alternate shot or scramble. For best ball, use “Who won the hole”."
              : "One score per player, per hole. Strokes come off automatically."
            : "Just tap who won each hole. Works for any format — best ball, scramble, whatever you're playing."}
        </p>
      </div>

      {doubles && (
        <div>
          <FieldLabel>Partners</FieldLabel>
          <Segmented
            options={players.slice(1).map((p, i) => ({ value: p.id, label: nameOf(p, i + 1).split(/\s+/)[0] }))}
            value={partner?.id ?? players[1]?.id ?? ""}
            onChange={onPartner}
            testId="quick-match-partner"
          />
          <p className="mt-1.5" style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)" }}>
            Who&apos;s with {nameOf(first, 0).split(/\s+/)[0]}? The other two play together.
          </p>
        </div>
      )}

      <div>
        <FieldLabel>Strokes</FieldLabel>
        {/* RELATIVE, not per-player: match play gives strokes to exactly one
            side. `RelHandicapControl` is the trip-side control for this; its
            data model is one signed value, which is what this reproduces. */}
        <Segmented
          options={[
            { value: "a", label: sideAName || "Side A" },
            { value: "even", label: "Even" },
            { value: "b", label: sideBName || "Side B" },
          ]}
          value={relStrokes < 0 ? "a" : relStrokes > 0 ? "b" : "even"}
          onChange={(v) => {
            const n = Math.max(1, Math.abs(relStrokes) || 1);
            onRelStrokes(v === "even" ? 0 : v === "a" ? -n : n);
          }}
          testId="quick-match-stroke-side"
        />
        {relStrokes !== 0 && (
          <div className="mt-2 flex justify-center">
            <Stepper
              size="full"
              value={Math.abs(relStrokes)}
              min={1}
              max={MAX_STROKES}
              onChange={(n) => onRelStrokes(relStrokes < 0 ? -n : n)}
              label="strokes"
              testId="quick-match-stroke-count"
            />
          </div>
        )}
      </div>

      {/* Glorious is HIDDEN, not disabled, when it cannot apply — in score mode
          (`gloriousConfig` refuses the combination) and on a 9-hole round
          (`holeWeight` measures against a frozen 18, so nothing would ever
          double). An inert-but-visible toggle is the silent-wrong failure this
          codebase keeps paying for; showing nothing is the honest version. */}
      {gloriousAvailable && (
        <div>
          <FieldLabel>Glorious finishing holes</FieldLabel>
          <button
            type="button"
            onClick={() => onGlorious(!glorious)}
            aria-pressed={glorious}
            className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left"
            style={{
              background: glorious ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
              border: `1px solid ${glorious ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
            }}
            data-testid="quick-match-glorious"
          >
            <span style={{ fontSize: 13.5, color: glorious ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)" }}>
              {glorious ? `Last ${gloriousHoles} holes count double` : "Off"}
            </span>
          </button>
          {glorious && (
            <div className="mt-2 flex justify-center">
              <Stepper
                size="compact"
                value={gloriousHoles}
                min={GLORIOUS_HOLES_MIN}
                max={GLORIOUS_HOLES_MAX}
                onChange={onGloriousHoles}
                label="holes"
                testId="quick-match-glorious-holes"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The finish screen for formats whose result is a SENTENCE, not a ranked list —
 * a match ("Zach won 3&2") and a rack ("Team A leads 3–2"). `FinalStandings` is
 * a stroke-play shape (positions over players); asking it to describe a match
 * would be the same category error the reader sweep was about. The result text
 * comes from `quickGameSubtitle`, so this screen and the dashboard card cannot
 * describe the same round differently.
 */
function QuickResultCard({
  title, subtitle, onScorecard, onPlayAgain, onDiscard,
}: {
  title: string;
  subtitle: string | null;
  onScorecard: () => void;
  onPlayAgain: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex h-full flex-col" style={{ background: "var(--color-bt-base)" }}>
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <span style={{ fontSize: 40 }}>🏌️</span>
        <div className="mt-3" style={{ fontSize: 22, fontWeight: 700, color: "var(--color-bt-text)", lineHeight: 1.3 }}>
          {title}
        </div>
        {subtitle && (
          <div className="mt-1.5" style={{ fontSize: 13.5, color: "var(--color-bt-text-dim)" }}>{subtitle}</div>
        )}
        <button
          type="button"
          onClick={onScorecard}
          className="mt-6 flex items-center gap-2 rounded-xl px-4 py-2.5"
          style={{ background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 14, fontWeight: 600 }}
          data-testid="quick-result-scorecard"
        >
          <Table2 size={16} /> Scorecard
        </button>
      </div>
      <div className="flex shrink-0 flex-col gap-2 px-4 pb-8">
        <button
          type="button"
          onClick={onPlayAgain}
          className="w-full"
          style={{ height: 50, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}
        >
          Play again
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="w-full"
          style={{ height: 46, borderRadius: 12, background: "transparent", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text-dim)", fontSize: 14, fontWeight: 600 }}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

/** The shared small-caps field label (STYLE_GUIDE §2b eyebrow recipe). */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
      {children}
    </label>
  );
}

/** A segmented selector in the app's established treatment (vocabulary §1/§8):
 *  the selected segment is a teal fill, unselected are recessed card-raised
 *  chips. Same look `RelHandicapControl` uses for its `[A│Even│B]` row. */
function Segmented<T extends string>({
  options, value, onChange, testId,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div className="flex gap-1.5" data-testid={testId}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={on}
            className="flex-1 rounded-[10px] py-2 text-[13px] font-semibold transition-colors"
            style={{
              background: on ? "var(--color-bt-accent-faint)" : "var(--color-bt-card-raised)",
              border: `1px solid ${on ? "var(--color-bt-accent)" : "var(--color-bt-border)"}`,
              color: on ? "var(--color-bt-accent)" : "var(--color-bt-text-dim)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The editable roster form — player rows (name + optional handicap stepper +
 * optional rack team toggle, add/remove) plus the course-select row. Shared
 * VERBATIM by the pre-start setup screen and the post-start roster editor
 * (§1/§2) so "start a game" and "edit an in-progress roster" can't drift into
 * two different floor/cap/course rules.
 *
 * Handicap entry lives HERE, not the gear panel (decision, #1049): a stroke
 * only means anything if it's set before scoring, and the gear panel is found
 * after a round is already under way. `showHandicaps` is false for MATCH play,
 * whose strokes are relative (one side receives them) and therefore owned by
 * `MatchSetupFields` — two handicap models on one screen would contradict.
 */
function RosterFields({
  draftPlayers, onChangeName, onChangeStrokes, onAdd, onRemove,
  showHandicaps = true, teams, onToggleTeam,
  draftCourse, onOpenCoursePicker, onClearCourse, courseBusy, courseError,
}: {
  draftPlayers: DraftPlayerRow[];
  onChangeName: (id: string, name: string) => void;
  onChangeStrokes: (id: string, n: number) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  showHandicaps?: boolean;
  /** Rack only: the A/B assignment, and the tap that flips it. */
  teams?: Record<string, Team>;
  onToggleTeam?: (id: string) => void;
  draftCourse: QuickGameCourse | null;
  onOpenCoursePicker: () => void;
  onClearCourse: () => void;
  courseBusy: boolean;
  courseError: string | null;
}) {
  // Matches Stepper's own "compact" sizing math (STEPPER_SIZES.compact) so the
  // "Handicaps" header centers over the stepper it labels rather than guessing.
  const STROKES_COL_WIDTH = 112;
  const REMOVE_COL_WIDTH = 32;

  const TEAM_COL_WIDTH = 44;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-0.5">
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Players</span>
          {onToggleTeam && (
            <span className="text-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)", width: TEAM_COL_WIDTH }}>Team</span>
          )}
          {showHandicaps && (
            <span className="text-center text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)", width: STROKES_COL_WIDTH }}>Handicaps</span>
          )}
          <span style={{ width: REMOVE_COL_WIDTH, flexShrink: 0 }} />
        </div>
        {draftPlayers.map((r, i) => (
          <div key={r.id} className="flex items-center gap-2">
            <input
              value={r.name}
              onChange={(e) => onChangeName(r.id, e.target.value)}
              placeholder={`Player ${i + 1}`}
              className="min-w-0 flex-1"
              style={{ height: 46, borderRadius: 12, padding: "0 14px", background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)", fontSize: 15 }}
            />
            {onToggleTeam && (
              <button
                type="button"
                onClick={() => onToggleTeam(r.id)}
                aria-label={`Team for ${r.name || `player ${i + 1}`}`}
                className="flex items-center justify-center rounded-[10px] text-[15px] font-bold transition-colors"
                style={{
                  width: TEAM_COL_WIDTH,
                  height: 40,
                  flexShrink: 0,
                  background: "var(--color-bt-accent-faint)",
                  border: "1px solid var(--color-bt-accent)",
                  color: "var(--color-bt-accent)",
                }}
                data-testid={`quick-game-team-${i}`}
              >
                {(teams?.[r.id] ?? "A")}
              </button>
            )}
            {showHandicaps && (
              <div style={{ width: STROKES_COL_WIDTH, flexShrink: 0 }}>
                <Stepper
                  size="compact"
                  value={r.strokes}
                  min={0}
                  max={MAX_STROKES}
                  onChange={(n) => onChangeStrokes(r.id, n)}
                  formatValue={(n) => (n === 0 ? "SCR" : String(n))}
                  dimValue={r.strokes === 0}
                  testId={`quick-game-strokes-${i}`}
                />
              </div>
            )}
            {/* The slot is always reserved (not conditionally rendered) so a
                solo row doesn't narrow and drift out of alignment with the
                "Players"/"Handicaps" header above it — only the button itself
                is conditional on the floor of 1. */}
            <button
              type="button"
              onClick={() => onRemove(r.id)}
              aria-label="Remove player"
              disabled={draftPlayers.length <= 1}
              className="flex h-8 items-center justify-center rounded-full disabled:invisible"
              style={{ width: REMOVE_COL_WIDTH, flexShrink: 0, color: "var(--color-bt-text-dim)" }}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      {draftPlayers.length < 4 && (
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-1.5 self-start"
          style={{ padding: "8px 12px", borderRadius: 10, border: "1.5px dashed var(--color-bt-accent)", color: "var(--color-bt-accent)", fontSize: 13, fontWeight: 600 }}
        >
          <Plus size={15} /> Add player
        </button>
      )}

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>Course</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenCoursePicker}
            disabled={courseBusy}
            className="flex min-w-0 flex-1 items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm disabled:opacity-60"
            style={{ background: "var(--color-bt-card-raised)", borderColor: "var(--color-bt-border)" }}
          >
            <span className="truncate" style={{ color: draftCourse ? "var(--color-bt-text)" : "var(--color-bt-text-dim)" }}>
              {courseBusy ? "Loading course…" : (draftCourse?.name ?? "Select a course (optional)")}
            </span>
          </button>
          {draftCourse && !courseBusy && (
            <button
              type="button"
              onClick={onClearCourse}
              aria-label="Clear course"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
              style={{ color: "var(--color-bt-text-dim)" }}
            >
              <X size={16} />
            </button>
          )}
        </div>
        {courseError && (
          <p className="mt-1.5" style={{ fontSize: 12.5, color: "var(--color-bt-danger)" }}>{courseError}</p>
        )}
      </div>
    </div>
  );
}

export default function QuickGamePage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [state, setState] = useState<QuickGameState | null>(null);
  const [view, setView] = useState<"entry" | "grid" | "roster">("entry");
  // currentHole lives IN the persisted state so a refresh resumes on the same
  // hole (not just the scores).
  const setCurrentHole = (h: number) =>
    setState((s) => (s ? { ...s, currentHole: h } : s));
  const [hydrated, setHydrated] = useState(false);
  // Settings gear (#879 item 1b) — a lightweight panel with two actions:
  // "Players & handicaps" (below) and Reset Game (danger zone).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  // Draft roster — shared by the pre-start setup screen (blank) and the
  // post-start roster editor (pre-populated from `state` in openRosterEditor).
  const [draftPlayers, setDraftPlayers] = useState<DraftPlayerRow[]>(() => blankDraftPlayers());
  const [draftCourse, setDraftCourse] = useState<QuickGameCourse | null>(null);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [courseBusy, setCourseBusy] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);

  // ── Format-specific setup draft ────────────────────────────────────────────
  // Which game is being set up, plus the few extra answers match and rack need.
  // All of it lives here (not in `state`) because none of it means anything
  // until Start — the round doesn't exist yet.
  const [draftFormat, setDraftFormat] = useState<QuickGameFormat>("stroke");
  const [draftEntryMode, setDraftEntryMode] = useState<"score" | "outcome">("score");
  /** Which of the other three is with player one (2v2 only). One tap, no matrix. */
  const [draftPartnerId, setDraftPartnerId] = useState<string | null>(null);
  /** Signed relative handicap: <0 → side A receives |n|, >0 → side B receives n,
   *  0 → even. The trip-side model (`RelHandicapControl`) — strokes go to
   *  exactly ONE side, never split. */
  const [draftRelStrokes, setDraftRelStrokes] = useState(0);
  const [draftGlorious, setDraftGlorious] = useState(false);
  const [draftGloriousHoles, setDraftGloriousHoles] = useState(GLORIOUS_HOLES_DEFAULT);
  /** { [playerId]: "A" | "B" } for rack. Unassigned players default to A at build. */
  const [draftTeams, setDraftTeams] = useState<Record<string, Team>>({});
  /** Set when Start is pressed while a round is already saved — one key holds one
   *  game, so starting a new one REPLACES it. That must never be silent. */
  const [confirmReplace, setConfirmReplace] = useState(false);

  const namedDraftPlayers = draftPlayers.filter((r) => r.name.trim().length > 0);
  const playerCountError = quickFormatPlayerCountError(draftFormat, namedDraftPlayers.length);
  const gloriousAvailable = quickMatchGloriousAvailable({ entryMode: draftEntryMode, course: draftCourse });

  // Resume any in-progress game from local storage. Must be in an effect (not a
  // useState initializer) so it stays client-only — localStorage is undefined
  // during SSR. The set-state-in-effect rule over-flags this legitimate case.
  // Reads through `migrateQuickGameState` — a saved game from before course/
  // handicaps existed must resume as a scratch, no-course round, not fail.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUICK_GAME_STORAGE_KEY);
      const migrated = raw ? migrateQuickGameState(JSON.parse(raw)) : null;
      if (migrated) setState(migrated);
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  // Persist on change — gated on `hydrated` STATE (not a ref) so the mount pass,
  // where `state` is still null before the load's setState applies, can't
  // removeItem and wipe a saved game.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (state) localStorage.setItem(QUICK_GAME_STORAGE_KEY, JSON.stringify(state));
      else localStorage.removeItem(QUICK_GAME_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [state, hydrated]);

  // ── Draft roster editing (shared by setup + roster editor) ────────────────
  function setDraftName(id: string, name: string) {
    setDraftPlayers((rows) => rows.map((r) => (r.id === id ? { ...r, name } : r)));
  }
  function setDraftStrokes(id: string, n: number) {
    setDraftPlayers((rows) => rows.map((r) => (r.id === id ? { ...r, strokes: n } : r)));
  }
  function addDraftRow() {
    setDraftPlayers((rows) => (rows.length < 4 ? [...rows, { id: crypto.randomUUID(), name: "", strokes: 0 }] : rows));
  }
  function removeDraftRow(id: string) {
    setDraftPlayers((rows) => (rows.length > 1 ? rows.filter((r) => r.id !== id) : rows));
  }
  const canSubmitRoster = buildRosterFromDrafts(draftPlayers) !== null;

  // Course picker → CAPTURE (Phase 0 T0.3): fetch once, build the snapshot via
  // the shared pure `buildCourseSnapshot` (the exact function the trip-side
  // draft path runs), freeze it into the draft. No re-fetch after this.
  function applyCourseToDraft(c: { id: string; name: string; teeName?: string }) {
    setCourseBusy(true);
    setCourseError(null);
    void (async () => {
      try {
        const course = await utils.courses.getById.fetch({ courseId: c.id });
        const snap = buildCourseSnapshot(course as unknown as CourseSnapshotInput, "gtt_stroke_play", c.teeName);
        if (!snap.ok) {
          setCourseError(
            snap.reason === "bad_index"
              ? "That course's stroke index isn't a valid permutation — fix it before use."
              : "That course can't be used for stroke play."
          );
          return;
        }
        setDraftCourse({ id: c.id, name: c.name, teeName: c.teeName, schema: snap.schema });
      } catch {
        setCourseError("Couldn't load that course — try again.");
      } finally {
        setCourseBusy(false);
        setCoursePickerOpen(false);
      }
    })();
  }

  /**
   * Start the round. The setup screen only renders when nothing is saved, so
   * this never destroys a round on its own — the REPLACE path is
   * `newGame`/`confirmReplace` below, which is the only way to reach setup while
   * a round is in progress and is confirmed before it clears anything.
   */
  function start() {
    if (playerCountError) return;
    buildAndStart();
  }

  /**
   * Start a DIFFERENT game while one is in progress. ONE storage key holds ONE
   * round (the dashboard card and the rail each have a single slot), so this
   * genuinely destroys what's saved — and without it a crew member part-way
   * through a stroke round would have no way to start a match at all.
   *
   * Confirmed when there is anything to lose, silent when there isn't: an
   * unscored round is just a setup someone changed their mind about, and making
   * them confirm that would train the confirm away. Same threshold
   * (`hasAnyScore`) the roster-edit and reset paths use, so all three agree
   * about what "in progress" means.
   */
  function newGame() {
    if (!state) return;
    if (hasAnyScore(state)) {
      setConfirmReplace(true);
      return;
    }
    clearToSetup();
  }

  function clearToSetup() {
    setState(null);
    setDraftPlayers(blankDraftPlayers());
    setDraftCourse(null);
    setDraftPartnerId(null);
    setDraftRelStrokes(0);
    setDraftGlorious(false);
    setDraftTeams({});
    setConfirmReplace(false);
    setSettingsOpen(false);
    setView("entry");
  }

  function buildAndStart() {
    const roster = buildRosterFromDrafts(draftPlayers);
    if (!roster) return;
    const common = {
      version: QUICK_GAME_STATE_VERSION,
      players: roster.players,
      course: draftCourse,
      values: {},
      finished: false,
      currentHole: 1,
    };

    if (draftFormat === "match") {
      const sides = buildQuickMatchSides(roster.players.map((p) => p.id), draftPartnerId);
      if (!sides) return; // unreachable — playerCountError already gates 2-or-4
      // The signed relative value resolves to strokes on exactly ONE side.
      const n = Math.abs(draftRelStrokes);
      sides.sideA.strokes = draftRelStrokes < 0 ? n : 0;
      sides.sideB.strokes = draftRelStrokes > 0 ? n : 0;
      setState({
        ...common,
        format: "match",
        entryMode: draftEntryMode,
        sideA: sides.sideA,
        sideB: sides.sideB,
        outcomes: {},
        // Only persist the modifier when it can actually apply — `gloriousConfig`
        // would ignore it otherwise, and a stored-but-inert key is the kind of
        // "on but does nothing" state this build is trying not to create.
        modifiers:
          draftGlorious && gloriousAvailable ? { glorious_holes: { holes: draftGloriousHoles } } : {},
      });
    } else if (draftFormat === "rack") {
      const teams: Record<string, Team> = {};
      for (const p of roster.players) teams[p.id] = draftTeams[p.id] ?? "A";
      setState({ ...common, format: "rack", strokes: roster.strokes, teams });
    } else {
      setState({ ...common, format: "stroke", strokes: roster.strokes });
    }
    setConfirmReplace(false);
    setView("entry");
  }

  function onChange(pid: string, label: string, value: number) {
    setState((s) => (s ? { ...s, values: { ...s.values, [pid]: { ...(s.values[pid] ?? {}), [label]: value } } } : s));
  }
  function onClear(pid: string, label: string) {
    setState((s) => {
      if (!s) return s;
      const row = { ...(s.values[pid] ?? {}) };
      delete row[label];
      return { ...s, values: { ...s.values, [pid]: row } };
    });
  }
  /** Outcome-mode writes. Separate from `onChange` because an outcome belongs to
   *  the MATCH, not either side — a different storage shape, not a variant of
   *  the same one (CLAUDE.md #27's "a score has two storage shapes"). */
  function onOutcome(label: string, result: HoleOutcomeResult) {
    setState((s) => (s && isMatchGame(s) ? { ...s, outcomes: { ...s.outcomes, [label]: result } } : s));
  }
  function onClearOutcome(label: string) {
    setState((s) => {
      if (!s || !isMatchGame(s)) return s;
      const next = { ...s.outcomes };
      delete next[label];
      return { ...s, outcomes: next };
    });
  }
  function finish() {
    setState((s) => (s ? { ...s, finished: true } : s));
  }
  function playAgain() {
    setState(null);
    setDraftPlayers(blankDraftPlayers());
    setDraftCourse(null);
    setView("entry");
  }
  function discard() {
    setState(null);
    router.push("/dashboard");
  }
  /** Stage a `state`'s roster/course into the editable drafts — shared by
   *  `openRosterEditor` (edit in place) and `resetGame` (edit via a return to
   *  setup), so the two can't drift into different pre-fill rules. */
  function prefillDrafts(s: QuickGameState) {
    setDraftPlayers(draftRowsFrom(s));
    setDraftCourse(s.course);
    setCourseError(null);
  }

  /**
   * Reset Game (#879 item 1b; revised — feedback: hole 1 was the wrong
   * landing spot). Clears scores AND returns to the setup screen, with the
   * current players/handicaps/course staged as editable drafts — not blank
   * (that's `playAgain`) and not straight back into hole-1 scoring (the old
   * behavior). "The odds are much higher that's what you want" after a
   * reset: you're at least as likely to want to fix a handicap or swap a
   * player as you are to re-score the identical setup, and the old behavior
   * made the second case one extra trip (gear → Players & handicaps) while
   * this makes it zero. Tapping Start immediately reproduces the old
   * behavior exactly, so nothing is lost for the "just re-score it" case.
   *
   * This and the roster editor (`openRosterEditor`/`saveRoster`, below) are
   * now two INDEPENDENT affordances, not one gating the other: this clears
   * SCORES and returns to setup; that edits players/handicaps/course
   * WITHOUT touching scores, any time. Both stage via the same
   * `prefillDrafts` so they can't drift into different pre-fill rules — the
   * only difference is whether `state` gets cleared (this) or kept (that).
   *
   * Not a `useScoreSaver.clearAll` situation (#807's fix target): that bug was
   * specific to `reconcileScores`' overlay-only merge dropping an empty SERVER
   * response — there is no server here, no reconcile, no outbox. Quick Stroke
   * Play's whole state is one local object with no other writer, so replacing
   * it is atomic and there is nothing this can race against.
   */
  function resetGame() {
    if (!state) return;
    prefillDrafts(state);
    setState(null);
    setView("entry");
    setConfirmReset(false);
    setSettingsOpen(false);
  }

  /**
   * Roster editor (§1) — REVISED: no longer gated on `hasAnyScore`. The
   * original design refused this once a score existed and pointed at Reset
   * Game instead ("refuse, and point at the existing affordance"). Feedback,
   * after using it: "I don't think we need to worry about disabling players
   * & handicaps... it should just be a label and whether a score gets netted
   * or not... meaning they can change on the fly during the round." So this
   * is now a plain, always-available edit — same screen, same
   * `buildRosterFromDrafts` floor/cap rules, no refusal state to render.
   *
   * Editing mid-round is SAFE here in a way it isn't for most persisted
   * state, because netting is derived at READ time, never snapshotted
   * (`quickGamePips`, mirroring CLAUDE.md #11's "derived, never snapshotted"
   * discipline for Glorious Finishing Holes): changing a handicap changes
   * what the next render computes for EVERY hole, past and future, with no
   * migration. A renamed/kept player keeps their id (from `prefillDrafts`),
   * so their scores stay attached; a removed player's old score-values just
   * go unread (their id drops out of `state.players`, and nothing keys off
   * player ids that aren't in that list). `saveRoster` therefore does NOT
   * touch `values`/`currentHole` any more — that clear was only safe under
   * the old before-any-score invariant, and wiping scores on a plain roster
   * tweak would contradict "on the fly during the round".
   *
   * The one thing this does NOT relitigate: a COURSE swap mid-round still
   * goes through the same screen/save path, and a hole-count change (18↔9)
   * after scores exist on the dropped holes is unaddressed — nobody has
   * asked for it, and guarding against it wasn't part of this ask.
   */
  function openRosterEditor() {
    if (!state) return;
    prefillDrafts(state);
    setSettingsOpen(false);
    setView("roster");
  }
  function cancelRosterEdit() {
    setView("entry");
  }
  function saveRoster() {
    if (!state) return;
    const roster = buildRosterFromDrafts(draftPlayers);
    if (!roster) return;
    setState((s) => (s ? { ...s, players: roster.players, strokes: roster.strokes, course: draftCourse } : s));
    setView("entry");
  }

  const units = quickGameUnits(state);
  const pips = state ? quickGamePips(state) : undefined;
  /** The scorecard grid's row entities. Stroke/rack rows are PLAYERS; a match's
   *  rows are SIDES, because a side is one score column (a 2v2 enters one ball,
   *  not two) — the same split `values` and `quickGamePips` are keyed on. */
  const gridParticipants =
    state && isMatchGame(state)
      ? [
          { id: state.sideA.id, name: quickSideName(state, state.sideA), color: PLAYER_COLORS[0] },
          { id: state.sideB.id, name: quickSideName(state, state.sideB), color: PLAYER_COLORS[1] },
        ]
      : (state?.players ?? []);

  // ── Setup ──
  if (!state) {
    return (
      <div className="mx-auto max-w-md px-4 py-6" style={{ background: "var(--color-bt-base)", minHeight: "100vh" }}>
        <div className="flex items-center justify-between">
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--color-bt-text)" }}>⚡ {QUICK_GAME_LABEL[draftFormat]}</h1>
          <button onClick={() => router.push("/dashboard")} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full" style={{ color: "var(--color-bt-text-dim)" }}>
            <X size={18} />
          </button>
        </div>

        <div className="mt-4">
          <FieldLabel>Game</FieldLabel>
          <Segmented
            options={[
              { value: "stroke", label: "Stroke" },
              { value: "match", label: "Match" },
              { value: "rack", label: "Rack" },
            ]}
            value={draftFormat}
            onChange={(v) => setDraftFormat(v as QuickGameFormat)}
            testId="quick-game-format"
          />
        </div>

        {/* No separate instructional line — the "Players"/"Handicaps" column
            headers inside RosterFields communicate the same thing (feedback:
            the prose subtitle was redundant with them). Match hides the
            per-player handicap column entirely: its strokes are RELATIVE (one
            side gets them), so a per-player 0–18 control there would be a
            second, contradictory handicap model on one screen. */}
        <div className="mt-4">
          <RosterFields
            draftPlayers={draftPlayers}
            onChangeName={setDraftName}
            onChangeStrokes={setDraftStrokes}
            onAdd={addDraftRow}
            onRemove={removeDraftRow}
            showHandicaps={draftFormat !== "match"}
            teams={draftFormat === "rack" ? draftTeams : undefined}
            onToggleTeam={
              draftFormat === "rack"
                ? (id) => setDraftTeams((t) => ({ ...t, [id]: (t[id] ?? "A") === "A" ? "B" : "A" }))
                : undefined
            }
            draftCourse={draftCourse}
            onOpenCoursePicker={() => setCoursePickerOpen(true)}
            onClearCourse={() => setDraftCourse(null)}
            courseBusy={courseBusy}
            courseError={courseError}
          />
        </div>

        {draftFormat === "match" && (
          <MatchSetupFields
            players={namedDraftPlayers}
            entryMode={draftEntryMode}
            onEntryMode={setDraftEntryMode}
            partnerId={draftPartnerId}
            onPartner={setDraftPartnerId}
            relStrokes={draftRelStrokes}
            onRelStrokes={setDraftRelStrokes}
            gloriousAvailable={gloriousAvailable}
            glorious={draftGlorious}
            onGlorious={setDraftGlorious}
            gloriousHoles={draftGloriousHoles}
            onGloriousHoles={setDraftGloriousHoles}
          />
        )}

        {playerCountError && (
          <p className="mt-4" style={{ fontSize: 13, color: "var(--color-bt-warning)" }} data-testid="quick-game-count-error">
            {playerCountError}
          </p>
        )}

        <button
          onClick={start}
          disabled={!canSubmitRoster || !!playerCountError}
          className="mt-5 w-full disabled:opacity-40"
          style={{ height: 50, borderRadius: 12, background: "var(--color-bt-accent)", color: "#0d1f1a", fontSize: 16, fontWeight: 600 }}
          data-testid="quick-game-start"
        >
          Start game
        </button>

        {coursePickerOpen && (
          <CoursePicker onClose={() => setCoursePickerOpen(false)} onApply={applyCourseToDraft} />
        )}
      </div>
    );
  }

  // ── Roster editor (§1) — reachable any time, mid-round included; scores
  // are untouched by a save here (only Reset Game clears them). ──
  if (view === "roster") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "var(--color-bt-base)" }}>
        <div className="flex shrink-0 items-center justify-between gap-3" style={{ height: 52, padding: "0 16px", background: "var(--color-bt-nav-bg)", borderBottom: "1px solid var(--color-bt-subtle-border)" }}>
          <button onClick={cancelRosterEdit} style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 600 }}>Cancel</button>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--color-bt-text)" }}>Players &amp; handicaps</span>
          <button onClick={saveRoster} disabled={!canSubmitRoster} className="disabled:opacity-40" style={{ color: "var(--color-bt-accent)", fontSize: 14, fontWeight: 700 }}>Save</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <RosterFields
            draftPlayers={draftPlayers}
            onChangeName={setDraftName}
            onChangeStrokes={setDraftStrokes}
            onAdd={addDraftRow}
            onRemove={removeDraftRow}
            draftCourse={draftCourse}
            onOpenCoursePicker={() => setCoursePickerOpen(true)}
            onClearCourse={() => setDraftCourse(null)}
            courseBusy={courseBusy}
            courseError={courseError}
          />
        </div>
        {coursePickerOpen && (
          <CoursePicker onClose={() => setCoursePickerOpen(false)} onApply={applyCourseToDraft} />
        )}
      </div>
    );
  }

  // ── Final ── FinalStandings stays mounted underneath; the scorecard is a
  // sibling `ScorecardSheet` overlay (the shared pattern every golf format
  // uses), not a separate route that replaces it.
  if (state.finished) {
    return (
      <div className="fixed inset-0 z-50">
        {isMatchGame(state) ? (
          // A match has no stroke standings to show — its result IS the margin
          // ("3&2"), which `quickGameSubtitle` already renders from the shared
          // `quickMatchState`. Feeding it through `FinalStandings` would ask a
          // stroke-shaped component to describe a match, the exact category
          // error the T0.4 sweep was about.
          <QuickResultCard
            title={quickGameSubtitle(state)}
            subtitle={state.course?.name ?? null}
            onScorecard={() => setView("grid")}
            onPlayAgain={playAgain}
            onDiscard={discard}
          />
        ) : isRackGame(state) ? (
          <QuickResultCard
            title={quickGameSubtitle(state)}
            subtitle={state.course?.name ?? null}
            onScorecard={() => setView("grid")}
            onPlayAgain={playAgain}
            onDiscard={discard}
          />
        ) : (
          <FinalStandings
            participants={state.players}
            standings={quickGameStandings(state)}
            unitCount={units.length}
            dateLabel={new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            onScorecard={() => setView("grid")}
            onPlayAgain={playAgain}
            onDiscard={discard}
          />
        )}
        {view === "grid" && (
          <ScorecardSheet subtitle={state.course?.name} onClose={() => setView("entry")}>
            <StandardGrid units={units} participants={gridParticipants} values={state.values} pips={pips} direction="low_wins" />
          </ScorecardSheet>
        )}
      </div>
    );
  }

  // ── Playing ── the surface is chosen by FORMAT. Match routes through
  // `QuickMatchSurface` (which picks score vs outcome entry); stroke and rack
  // both use `ScoreEntryView` — rack IS net stroke entry, its difference is in
  // how the results are read, not how they are entered.
  return (
    <div className="fixed inset-0 z-50">
      {isMatchGame(state) ? (
        <QuickMatchSurface
          state={state}
          onScore={onChange}
          onClearScore={onClear}
          onOutcome={onOutcome}
          onClearOutcome={onClearOutcome}
          onHoleChange={setCurrentHole}
          onFinish={finish}
          onBack={() => router.push("/dashboard")}
          onOpenGrid={() => setView("grid")}
          onConfig={() => setSettingsOpen(true)}
        />
      ) : (
        <ScoreEntryView
          gameName={quickGameTitle(state)}
          units={units}
          participants={state.players}
          values={state.values}
          pips={pips}
          direction="low_wins"
          currentHole={state.currentHole}
          onHoleChange={setCurrentHole}
          onChange={onChange}
          onClear={onClear}
          onBack={() => router.push("/dashboard")}
          onOpenGrid={() => setView("grid")}
          onFinish={finish}
          onConfig={() => setSettingsOpen(true)}
        />
      )}

      {/* Scorecard — a sibling `ScorecardSheet` overlay on top of the (still
          mounted) entry screen, the SAME pattern every trip-side golf format
          uses, not a route that replaces it. Tapping a cell jumps to that
          hole AND closes the sheet (`view` back to "entry") in one action. */}
      {view === "grid" && (
        <ScorecardSheet subtitle={state.course?.name} onClose={() => setView("entry")}>
          <StandardGrid
            units={units}
            participants={state.players}
            values={state.values}
            pips={pips}
            direction="low_wins"
            onCellTap={(label) => {
              setCurrentHole(Number(label) || 1);
              setView("entry");
            }}
          />
        </ScorecardSheet>
      )}

      {/* Settings gear (#879 item 1b) — top-right of the game page header, same
          affordance every other game surface uses (`ScoreEntryView`'s existing
          `onConfig` slot — no new chrome). "Players & handicaps" opens the
          roster editor at any point, scores or no — always available, no
          refusal state (feedback: "it should just be a label" — see
          `openRosterEditor`'s doc comment for the reversal this replaced). */}
      {settingsOpen && (
        <SettingsSlideOver
          title={`${quickGameTitle(state)} settings`}
          onClose={() => setSettingsOpen(false)}
          testId="quick-game-settings-panel"
        >
          <SectionLabel>Game</SectionLabel>
          <div className="mt-2">
            <SettingsNavRow
              icon={<Users size={16} />}
              label="Players & handicaps"
              blurb="Add, remove, or rename players · set handicaps."
              onClick={openRosterEditor}
              testId="quick-game-edit-roster-btn"
            />
          </div>

          <div className="mt-5">
            <SectionLabel danger>Danger zone</SectionLabel>
            <div className="mt-2">
              <DangerRow
                icon={<RotateCcw size={16} />}
                tone="warning"
                label="Reset game"
                blurb="Clears all scores. Players stay — it's ready to score again."
                onClick={() => setConfirmReset(true)}
                testId="quick-game-reset-btn"
              />
            </div>
            {/* The ONLY route back to setup while a round is live — and the only
                way to switch format mid-round. One key holds one game, so this
                really does end the current round; the confirm below is what
                keeps that from being a surprise. */}
            <div className="mt-2">
              <DangerRow
                icon={<Zap size={16} />}
                tone="danger"
                label="New game"
                blurb="Ends this round and starts a different one."
                onClick={newGame}
                testId="quick-game-new-btn"
              />
            </div>
          </div>

          {/* Nested INSIDE the panel, not a sibling — `SettingsSlideOver` portals
              to `document.body` and `DangerConfirmModal` does not, so a sibling
              render loses the stacking fight (same z-50, but the portal's DOM
              node lands later in `body` and paints over it). `GameConfigurationView`
              nests `GameDangerZone`'s confirm the same way; this follows it. */}
          {confirmReset && (
            <DangerConfirmModal
              tone="warning"
              icon={<RotateCcw size={18} />}
              title="Reset this game?"
              body="Clears every score and returns to hole 1. Your players stay — it's ready to score again."
              confirmLabel="Reset game"
              pendingLabel="Resetting…"
              isPending={false}
              testId="quick-game-reset-confirm"
              onCancel={() => setConfirmReset(false)}
              onConfirm={resetGame}
            />
          )}

          {confirmReplace && (
            <DangerConfirmModal
              tone="danger"
              icon={<Zap size={18} />}
              title="Start a new game?"
              body={`This round is in progress — ${quickGameSubtitle(state)}. Starting a new game ends it and clears its scores. There's only room for one at a time.`}
              confirmLabel="End it and start over"
              pendingLabel="Starting…"
              isPending={false}
              testId="quick-game-new-confirm"
              onCancel={() => setConfirmReplace(false)}
              onConfirm={clearToSetup}
            />
          )}
        </SettingsSlideOver>
      )}
    </div>
  );
}
