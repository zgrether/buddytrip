"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { AddEditSheet } from "@/components/AddEditSheet";
import { DangerConfirmModal } from "@/components/DangerZone";
import { CoursePicker } from "@/components/games/course/CoursePicker";
import { SideBetsPanel } from "@/components/games/bets/SideBetsPanel";
import { MatchSetupFields, RosterFields } from "@/components/games/quick/setupFields";
import { buildCourseSnapshot, type CourseSnapshotInput } from "@/lib/courseSnapshot";
import { trpc } from "@/lib/trpc-client";
import { GLORIOUS_HOLES_DEFAULT } from "@/lib/modifiers";
import { PLAYER_COLORS, unitsFromSchema } from "@/lib/strokePlayConfig";
import {
  betLabel,
  betsInvolvingPlayer,
  computeSideBets,
  EMPTY_SIDE_BETS,
  type SideBetsState,
} from "@/lib/sideBets";
import type { Team } from "@/lib/rackNStack";
import {
  buildQuickGameFromDrafts,
  buildQuickMatchSides,
  draftRowsFrom,
  hasAnyScore,
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
 * Owns the whole draft, and is now the ONLY roster editor — the in-round gear
 * opens this same component in its `settings` purpose rather than a screen of
 * its own, so a round cannot be described two ways.
 */
export function QuickGameSetupSheet({
  format,
  onClose,
  onStarted,
  navigatesOnCommit = false,
  purpose = "start",
  danger,
}: {
  format: QuickGameFormat;
  onClose: () => void;
  /** The round exists and is written — take the user to it. */
  onStarted: (format: QuickGameFormat) => void;
  /**
   * `onStarted` ROUTES somewhere rather than just revealing the round in place.
   *
   * It cannot be inferred, because the two callers genuinely differ: the
   * dashboard tile navigates to `/quick-game`, while the quick-game page's own
   * landing state is already there and only swaps its view. The sheet's history
   * entry has to be handed to the destination in the first case and popped in
   * the second, so the caller that knows says so. A navigating caller MUST use
   * `router.replace` — see `consumeMarker` in `useModalBackButton`.
   */
  navigatesOnCommit?: boolean;
  /**
   * What this sheet IS on the surface that opened it.
   *
   * `"start"` — the dashboard tile and the landing page: you are beginning or
   * picking up a round, so the button starts it.
   * `"settings"` — the in-round gear: you are already in the round, so the
   * button just saves and the "pick up where you left off" line would be
   * telling you about the screen you are looking at.
   *
   * It is ONE prop rather than a label prop and a subtitle prop, because they
   * are not independent choices — they are two expressions of the same fact,
   * and splitting them is how a sheet ends up saying "Save" under "pick up
   * where you left off".
   */
  purpose?: "start" | "settings";
  /** Destructive actions for the settings context — the caller owns them
   *  because their confirms and handlers are the round's, not the form's. */
  danger?: React.ReactNode;
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

  const [pendingRemoval, setPendingRemoval] = useState<{
    id: string;
    betIds: string[];
    labels: string[];
  } | null>(null);
  const [coursePickerOpen, setCoursePickerOpen] = useState(false);
  const [courseBusy, setCourseBusy] = useState(false);
  const [courseError, setCourseError] = useState<string | null>(null);

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

  /**
   * Removing a player takes their bets with them — so if they are in any, ask
   * first.
   *
   * A bet whose side no longer exists is not a smaller bet, it is an
   * unreadable one, and money is the wrong thing to change silently. When they
   * are in none there is nothing to warn about and the row just goes: a confirm
   * that always fires is one nobody reads.
   *
   * Recorded bets only. A derived press has no independent existence — it stops
   * being derived the moment its parent is gone.
   */
  function requestRemovePlayer(id: string) {
    if (players.length <= (format === "match" ? 2 : 1)) return;
    const affected = betsInvolvingPlayer(bets.bets, id);
    if (affected.length > 0) {
      setPendingRemoval({ id, betIds: affected.map((b) => b.id), labels: affected.map(betLabel) });
      return;
    }
    removePlayer(id, []);
  }

  function removePlayer(id: string, betIds: string[]) {
    setPlayers((rows) => rows.filter((r) => r.id !== id));
    if (betIds.length > 0) {
      const doomed = new Set(betIds);
      setBets((b) => ({ ...b, bets: b.bets.filter((x) => !doomed.has(x.id)) }));
    }
    setPendingRemoval(null);
  }

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
      // Keep the round's SLOT ids so its scores stay attached — `values` is
      // keyed by side id for a match, so rebuilding with fresh ones wipes it.
      sideIds:
        existing && existing.format === "match"
          ? { a: existing.sideA.id, b: existing.sideB.id }
          : undefined,
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
        subtitle={
          purpose === "settings" ? undefined : isEdit ? "In progress — pick up where you left off" : undefined
        }
        mode={isEdit ? "edit" : "add"}
        onClose={onClose}
        testId="quick-game-setup-sheet"
        primary={{
          label: purpose === "settings" ? "Save" : isEdit ? "Resume round" : "Start round",
          onClick: commit,
          disabled: countError != null,
          navigatesAway: navigatesOnCommit,
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
          onRemove={requestRemovePlayer}
          // A handicap is an allocation of strokes to HOLES, so it needs a
          // stroke index to allocate against. With no course there is nothing
          // for `strokeHoles` to read and the number changes no score — an
          // inert control that looks live. Pick a course and it appears.
          showHandicaps={format !== "match" && course != null}
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
            entryModeLocked={existing != null && hasAnyScore(existing)}
            relStrokes={relStrokes}
            onRelStrokes={setRelStrokes}
            gloriousAvailable={gloriousAvailable}
            glorious={glorious}
            onGlorious={setGlorious}
            gloriousHoles={gloriousHoles}
            onGloriousHoles={setGloriousHoles}
          />
        )}

        {/* Bets are agreed before anyone hits, in the same conversation as the
            roster — so they are a SECTION of this modal, not a modal behind a
            nav row. Hidden below two players, who have nobody to bet with
            (§10). */}
        {betPlayers.length >= 2 && (
          <SideBetsPanel
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
              side.playerIds
                .map((id) => betPlayers.find((p) => p.id === id)?.name.split(/\s+/)[0] ?? "Player")
                .join(" & ")
            }
            onAdd={(added) => setBets((b) => ({ ...b, bets: [...b.bets, ...added] }))}
            onRemove={(betId) => setBets((b) => ({ ...b, bets: b.bets.filter((x) => x.id !== betId) }))}
          />
        )}

        {danger && <div className="mt-5">{danger}</div>}

        {countError && (
          <p className="mt-3" style={{ fontSize: 12.5, color: "var(--color-bt-danger)" }} data-testid="quick-game-setup-error">
            {countError}
          </p>
        )}
      </AddEditSheet>

      {coursePickerOpen && <CoursePicker onClose={() => setCoursePickerOpen(false)} onApply={applyCourse} />}

      {pendingRemoval && (
        <DangerConfirmModal
          tone="warning"
          icon={<TriangleAlert size={18} />}
          title="Remove player and their bets?"
          body={`${
            players.find((r) => r.id === pendingRemoval.id)?.name.trim() || "This player"
          } is in ${pendingRemoval.labels.length === 1 ? "a bet" : `${pendingRemoval.labels.length} bets`}: ${pendingRemoval.labels.join(
            ", "
          )}. Removing them removes ${pendingRemoval.labels.length === 1 ? "it" : "those"} too — a bet with a missing side cannot be settled.`}
          confirmLabel="Remove"
          pendingLabel="Removing…"
          isPending={false}
          testId="quick-game-remove-player-confirm"
          onCancel={() => setPendingRemoval(null)}
          onConfirm={() => removePlayer(pendingRemoval.id, pendingRemoval.betIds)}
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
