"use client";

import { useState } from "react";
import { Banknote } from "lucide-react";
import { AddEditSheet } from "@/components/AddEditSheet";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { SideBetSheet } from "@/components/games/bets/SideBetSheet";
import { MatchSetupFields, RosterFields, SettingsNavRow } from "@/components/games/quick/setupFields";
import { buildCourseSnapshot, type CourseSnapshotInput } from "@/lib/courseSnapshot";
import { trpc } from "@/lib/trpc-client";
import { GLORIOUS_HOLES_DEFAULT } from "@/lib/modifiers";
import { PLAYER_COLORS, unitsFromSchema } from "@/lib/strokePlayConfig";
import { computeSideBets, EMPTY_SIDE_BETS, type SideBetsState } from "@/lib/sideBets";
import type { Team } from "@/lib/rackNStack";
import {
  buildQuickGameFromDrafts,
  buildQuickMatchSides,
  draftRowsFrom,
  quickFormatPlayerCountError,
  quickMatchGloriousAvailable,
  readQuickGameState,
  writeQuickGameState,
  QUICK_GAME_LABEL,
  type DraftPlayerRow,
  type QuickGameCourse,
  type QuickGameFormat,
} from "@/lib/quickGame";

/**
 * Quick Game setup, as the app's add/edit sheet (device pass §3).
 *
 * Tapping a dashboard tile opens THIS rather than navigating to a setup page:
 * a bottom sheet on mobile, a right drawer on desktop, the same surface used to
 * add crew, lodging, receipts and agenda items. Starting a round is the same
 * kind of act as adding an agenda item, and it should not feel like a different
 * app.
 *
 * **Add or edit is read, not passed.** The mode comes from whether this format
 * already has a saved round — the one question that decides both what the
 * fields start as and what the primary button does. A caller cannot get it
 * wrong, because a caller does not answer it.
 *
 * Owns the whole draft. The page keeps its own drafts for the in-round roster
 * editor, which is a different job on a round that already exists; the shared
 * halves are the FIELDS (`setupFields`) and the BUILD
 * (`buildQuickGameFromDrafts`), so the two paths cannot construct a round
 * differently.
 */
export function QuickGameSetupSheet({
  format,
  onClose,
  onStarted,
}: {
  format: QuickGameFormat;
  onClose: () => void;
  /** The round exists and is written — take the user to it. */
  onStarted: (format: QuickGameFormat) => void;
}) {
  const utils = trpc.useUtils();
  // Read ONCE on mount: re-reading would fight the user's own edits.
  const [existing] = useState(() => readQuickGameState(format));
  const isEdit = existing != null;

  const [players, setPlayers] = useState<DraftPlayerRow[]>(() =>
    existing ? draftRowsFrom(existing) : blankRows(format)
  );
  const [course, setCourse] = useState<QuickGameCourse | null>(existing?.course ?? null);
  const [bets, setBets] = useState<SideBetsState>(existing?.bets ?? EMPTY_SIDE_BETS);
  const [entryMode, setEntryMode] = useState<"score" | "outcome">(
    existing && existing.format === "match" ? existing.entryMode : "score"
  );
  const [relStrokes, setRelStrokes] = useState(() =>
    existing && existing.format === "match" ? existing.sideB.strokes - existing.sideA.strokes : 0
  );
  const [glorious, setGlorious] = useState(
    () => !!(existing && existing.format === "match" && existing.modifiers.glorious_holes)
  );
  const [gloriousHoles, setGloriousHoles] = useState(GLORIOUS_HOLES_DEFAULT);
  const [teams, setTeams] = useState<Record<string, Team>>(() =>
    existing && existing.format === "rack" ? existing.teams : {}
  );

  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [courseBusy, setCourseBusy] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);
  const [betsOpen, setBetsOpen] = useState(false);

  const named = players.filter((r) => r.name.trim().length > 0);
  const countError =
    format === "match"
      ? buildQuickMatchSides(named)
        ? null
        : "Match play needs a player on each side."
      : quickFormatPlayerCountError(format, named.length);
  const gloriousAvailable = quickMatchGloriousAvailable({ entryMode, course });

  // Side bets, from the drafts — no scores yet, so every figure is a zero and
  // every bet reads as starting at hole 1.
  const holeCount = unitsFromSchema(course?.schema).length;
  const betPlayers = named.slice(0, 4).map((r, i) => ({
    id: r.id,
    name: r.name.trim(),
    color: PLAYER_COLORS[i % PLAYER_COLORS.length],
  }));
  const betResult = computeSideBets({
    holes: Array.from({ length: holeCount }, (_, i) => i + 1),
    bets: bets.bets,
    scoring: { mode: "net", net: {} },
  });

  function applyCourse(c: { id: string; name: string; teeName?: string }) {
    setCourseBusy(true);
    setCourseError(null);
    void (async () => {
      try {
        const row = await utils.courses.getById.fetch({ courseId: c.id });
        const snap = buildCourseSnapshot(row as unknown as CourseSnapshotInput, "gtt_stroke_play", c.teeName);
        if (!snap.ok) {
          setCourseError(
            snap.reason === "bad_index"
              ? "That course's stroke index isn't a valid permutation — fix it before use."
              : "That course can't be used for stroke play."
          );
          return;
        }
        setCourse({ id: c.id, name: c.name, teeName: c.teeName, schema: snap.schema });
      } catch {
        setCourseError("Couldn't load that course — try again.");
      } finally {
        setCourseBusy(false);
        setCoursePickerOpen(false);
      }
    })();
  }

  /**
   * Commit and leave. In EDIT mode the round already has scores, so the built
   * state is merged OVER the existing one rather than replacing it — resuming
   * must not be a way to quietly wipe a round you were editing the roster of.
   */
  function commit() {
    if (countError) return;
    const built = buildQuickGameFromDrafts({
      format,
      players,
      course,
      bets,
      entryMode,
      relStrokes,
      glorious,
      gloriousHoles,
      gloriousAvailable,
      teams,
    });
    if (!built) return;
    if (existing) {
      // Keep what only the round has: its scores, its place, its outcomes.
      writeQuickGameState({
        ...built,
        values: existing.values,
        currentHole: existing.currentHole,
        finished: existing.finished,
        ...(built.format === "match" && existing.format === "match" ? { outcomes: existing.outcomes } : {}),
      } as typeof built);
    } else {
      writeQuickGameState(built);
    }
    onStarted(format);
  }

  return (
    <>
      <AddEditSheet
        title={QUICK_GAME_LABEL[format]}
        subtitle={isEdit ? "In progress — pick up where you left off" : undefined}
        mode={isEdit ? "edit" : "add"}
        onClose={onClose}
        testId="quick-game-setup-sheet"
        primary={{
          label: isEdit ? "Resume round" : "Start round",
          onClick: commit,
          disabled: countError != null,
        }}
      >
        <RosterFields
          draftPlayers={players}
          onChangeName={(id, name) => setPlayers((rows) => rows.map((r) => (r.id === id ? { ...r, name } : r)))}
          onChangeStrokes={(id, n) => setPlayers((rows) => rows.map((r) => (r.id === id ? { ...r, strokes: n } : r)))}
          onAdd={(side) =>
            setPlayers((rows) =>
              rows.length < 4 ? [...rows, { id: crypto.randomUUID(), name: "", strokes: 0, side }] : rows
            )
          }
          onRemove={(id) =>
            setPlayers((rows) => (rows.length > (format === "match" ? 2 : 1) ? rows.filter((r) => r.id !== id) : rows))
          }
          showHandicaps={format !== "match"}
          sided={format === "match"}
          teams={format === "rack" ? teams : undefined}
          onToggleTeam={
            format === "rack"
              ? (id) => setTeams((t) => ({ ...t, [id]: t[id] === "B" ? "A" : "B" }))
              : undefined
          }
          draftCourse={course}
          onOpenCoursePicker={() => setCoursePickerOpen(true)}
          onClearCourse={() => setCourse(null)}
          courseBusy={courseBusy}
          courseError={courseError}
        />

        {format === "match" && (
          <MatchSetupFields
            players={players}
            entryMode={entryMode}
            onEntryMode={setEntryMode}
            relStrokes={relStrokes}
            onRelStrokes={setRelStrokes}
            gloriousAvailable={gloriousAvailable}
            glorious={glorious}
            onGlorious={setGlorious}
            gloriousHoles={gloriousHoles}
            onGloriousHoles={setGloriousHoles}
          />
        )}

        {/* Bets are agreed before anyone hits, so they are set up here — and
            hidden below two players, who have nobody to bet with (§10). */}
        {betPlayers.length >= 2 && (
          <div className="mt-4">
            <SettingsNavRow
              icon={<Banknote size={16} />}
              label="Side Bets"
              onClick={() => setBetsOpen(true)}
              testId="quick-game-sheet-side-bets-btn"
            />
          </div>
        )}

        {countError && (
          <p className="mt-3" style={{ fontSize: 12.5, color: "var(--color-bt-danger)" }} data-testid="quick-game-setup-error">
            {countError}
          </p>
        )}
      </AddEditSheet>

      {coursePickerOpen && <CoursePicker onClose={() => setCoursePickerOpen(false)} onApply={applyCourse} />}

      {betsOpen && (
        <SideBetSheet
          players={betPlayers}
          result={betResult}
          recordedBetIds={bets.bets.map((b) => b.id)}
          sidesLocked={false}
          lockedSides={[]}
          holeCount={holeCount}
          currentHole={1}
          nassauAvailable={holeCount >= 18}
          perspectivePlayerId={bets.perspectivePlayerId ?? betPlayers[0]?.id ?? null}
          sideName={(side) =>
            side.playerIds.map((id) => betPlayers.find((p) => p.id === id)?.name.split(/\s+/)[0] ?? "Player").join(" & ")
          }
          onAdd={(added) => setBets((b) => ({ ...b, bets: [...b.bets, ...added] }))}
          onRemove={(betId) => setBets((b) => ({ ...b, bets: b.bets.filter((x) => x.id !== betId) }))}
          onClose={() => setBetsOpen(false)}
        />
      )}
    </>
  );
}

/** Match opens with one row per side — the `vs` needs two sides to sit between
 *  and a match needs an opponent. Everything else opens with one (§4). */
function blankRows(format: QuickGameFormat): DraftPlayerRow[] {
  if (format === "match") {
    return [
      { id: crypto.randomUUID(), name: "", strokes: 0, side: "A" },
      { id: crypto.randomUUID(), name: "", strokes: 0, side: "B" },
    ];
  }
  return [{ id: crypto.randomUUID(), name: "", strokes: 0 }];
}
