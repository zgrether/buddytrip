"use client";

import { Plus, X, ChevronRight } from "lucide-react";
import { Stepper } from "@/components/games/Stepper";
import { FieldLabel, Segmented } from "@/components/games/FieldChrome";
import { MAX_STROKES } from "@/lib/handicap";
import { GLORIOUS_HOLES_MIN, GLORIOUS_HOLES_MAX } from "@/lib/modifiers";
import type { Team } from "@/lib/rackNStack";
import type { DraftPlayerRow, QuickGameCourse } from "@/lib/quickGame";

/**
 * The Quick Game setup FIELDS — roster (flat or the two-side match layout),
 * course row, match-only answers, and the settings nav row.
 *
 * Moved out of `app/quick-game/page.tsx` so the setup can be rendered in two
 * places without being written twice: the page itself, and the add/edit sheet
 * the dashboard tile opens (device pass §3). Pure presentation — every value
 * arrives as a prop and every change leaves by a callback, so neither caller
 * teaches these anything about where the draft lives.
 */

/** A settings-panel navigation row in the SAME visual grammar as `DangerRow`
 *  (icon-square + label + blurb + chevron) but neutral-toned — "Players &
 *  handicaps" isn't destructive, so it doesn't borrow the warning/danger
 *  vocabulary that row reserves for the danger zone. `disabled` carries its
 *  own blurb text (the caller passes the reason in via `blurb`) rather than
 *  a separate message slot — mirrors how locked rows elsewhere in the app
 *  explain themselves inline instead of failing silently. */
export function SettingsNavRow({
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
export function MatchSetupFields({
  players, entryMode, onEntryMode,
  relStrokes, onRelStrokes, gloriousAvailable, glorious, onGlorious,
  gloriousHoles, onGloriousHoles,
}: {
  players: DraftPlayerRow[];
  entryMode: "score" | "outcome";
  onEntryMode: (m: "score" | "outcome") => void;
  relStrokes: number;
  onRelStrokes: (n: number) => void;
  gloriousAvailable: boolean;
  glorious: boolean;
  onGlorious: (on: boolean) => void;
  gloriousHoles: number;
  onGloriousHoles: (n: number) => void;
}) {
  // Side labels for the relative-handicap selector — the same "who gets the
  // strokes" question `RelHandicapControl` asks, in the same [A│Even│B] shape.
  // Read off the rows' OWN sides now (§6): with partnering structural there is
  // nothing to reconstruct, and any split labels itself.
  const nameOf = (r: DraftPlayerRow, i: number) => (r.name.trim() || `Player ${i + 1}`).split(/\s+/)[0];
  const sideNames = (side: "A" | "B") =>
    players
      .filter((r) => (side === "B" ? r.side === "B" : r.side !== "B"))
      .map(nameOf)
      .join(" & ") || (side === "A" ? "Side A" : "Side B");
  const sideAName = sideNames("A");
  const sideBName = sideNames("B");
  /** Either side holding more than one player — the count IS the shape, and
   *  after §6 that includes 1v2, which the old `players.length === 4` missed. */
  const doubles =
    players.filter((r) => r.side !== "B").length > 1 || players.filter((r) => r.side === "B").length > 1;

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

/** The course-select row — one copy, shared by the flat roster and the two-
 *  side match layout (§6). Extracted rather than duplicated: two copies of a
 *  picker is how the busy/error states drift apart. */
export function CourseRow({
  draftCourse, onOpenCoursePicker, onClearCourse, courseBusy, courseError,
}: {
  draftCourse: QuickGameCourse | null;
  onOpenCoursePicker: () => void;
  onClearCourse: () => void;
  courseBusy: boolean;
  courseError: string | null;
}) {
  return (
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
  );
}

export function RosterFields({
  draftPlayers, onChangeName, onChangeStrokes, onAdd, onRemove,
  showHandicaps = true, teams, onToggleTeam, sided = false,
  draftCourse, onOpenCoursePicker, onClearCourse, courseBusy, courseError,
}: {
  draftPlayers: DraftPlayerRow[];
  onChangeName: (id: string, name: string) => void;
  onChangeStrokes: (id: string, n: number) => void;
  /** Match passes the side the new row belongs to (§6). */
  onAdd: (side?: "A" | "B") => void;
  onRemove: (id: string) => void;
  /** MATCH only: split the rows into two sides with a `vs` between them, each
   *  with its own Add player. This is what makes partnering structural and
   *  retires the Partners picker — who is with whom is which list you are in,
   *  and any split falls out of it (1v1, 1v2, 2v2) with no count rule. */
  sided?: boolean;
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

  /** One side's rows plus its own Add — the unit the `vs` sits between. */
  const sideBlock = (side: "A" | "B") => {
    const rows = draftPlayers.filter((r) => (side === "B" ? r.side === "B" : r.side !== "B"));
    return (
      <div
        className="rounded-xl p-2.5"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
        data-testid={`match-side-${side}`}
      >
        {rows.map((r, i) => (
          <div key={r.id} className="mb-1.5 flex items-center gap-2">
            <input
              value={r.name}
              onChange={(e) => onChangeName(r.id, e.target.value)}
              placeholder={`Player ${i + 1}`}
              className="min-w-0 flex-1 text-[15px]"
              style={{ height: 44, borderRadius: 10, padding: "0 12px", background: "var(--color-bt-card-raised)", border: "1px solid var(--color-bt-border)", color: "var(--color-bt-text)" }}
            />
            {draftPlayers.length > 2 && (
              <button
                type="button"
                onClick={() => onRemove(r.id)}
                aria-label={`Remove ${r.name.trim() || "player"}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ color: "var(--color-bt-text-dim)" }}
              >
                <X size={15} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onAdd(side)}
          data-testid={`match-add-player-${side}`}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg py-2"
          style={{ border: "1.5px dashed var(--color-bt-border)", color: "var(--color-bt-text-dim)", fontSize: 13, fontWeight: 600 }}
        >
          <Plus size={14} /> Add player
        </button>
      </div>
    );
  };

  if (sided) {
    return (
      <div>
        <FieldLabel>Players</FieldLabel>
        {sideBlock("A")}
        <div className="my-2 flex items-center gap-3">
          <span className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.1em", color: "var(--color-bt-text-dim)" }}>vs</span>
          <span className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
        </div>
        {sideBlock("B")}
        <div className="mt-4">
          <CourseRow
            draftCourse={draftCourse}
            onOpenCoursePicker={onOpenCoursePicker}
            onClearCourse={onClearCourse}
            courseBusy={courseBusy}
            courseError={courseError}
          />
        </div>
      </div>
    );
  }

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
          onClick={() => onAdd()}
          className="flex items-center gap-1.5 self-start"
          style={{ padding: "8px 12px", borderRadius: 10, border: "1.5px dashed var(--color-bt-accent)", color: "var(--color-bt-accent)", fontSize: 13, fontWeight: 600 }}
        >
          <Plus size={15} /> Add player
        </button>
      )}

      <CourseRow
        draftCourse={draftCourse}
        onOpenCoursePicker={onOpenCoursePicker}
        onClearCourse={onClearCourse}
        courseBusy={courseBusy}
        courseError={courseError}
      />
    </div>
  );
}

