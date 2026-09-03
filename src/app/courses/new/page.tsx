"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { pendingCoursePut } from "@/lib/pendingCourse";
import { CourseEntryFlow } from "@/components/games/course/CourseEntryFlow";

/**
 * Manual course-entry page (W-COURSESPLIT-01) — the heavy "place" the Course-row
 * picker steps out to. **Trip-agnostic** (`/courses/new`, not under `/trips/...`):
 * a course is a global library row the group reuses across trips, not a property
 * of one trip (migration 039 — `courses` has no `trip_id`). It already lives at
 * the right level for the future Circle layer; this route matches.
 *
 * `?trip=&game=` are the return target — on save, create the global course, HAND
 * IT BACK to that game's settings draft (`pendingCourse`, #1226) and go back so
 * the Course row lands resolved + checked. It is not applied to the game here:
 * that was a server write from inside a draft-then-save flow, and it silently
 * destroyed the rest of the draft. The game already exists (it's why the row can
 * navigate while the pre-create pickers can't), so leaving and returning is safe.
 * `?provider=` seeds a golfcourseapi pull for review; absent → a blank manual
 * build.
 */
// useSearchParams() forces client-side rendering, so the page that calls it must
// sit under a Suspense boundary (Next.js bails out of static prerender otherwise).
export default function NewCoursePage() {
  return (
    <Suspense fallback={<div className="fixed inset-0" style={{ background: "var(--color-bt-base)" }} />}>
      <NewCourseInner />
    </Suspense>
  );
}

function NewCourseInner() {
  const router = useRouter();
  const params = useSearchParams();
  const tripId = params.get("trip");
  const gameId = params.get("game");
  const provider = params.get("provider");
  // slot=back (W-9HOLE-01): the saved course is the BACK nine — the settings page
  // composes it onto the game's front rather than staging it as the course.
  const isBack = params.get("slot") === "back";

  const createCourse = trpc.courses.create.useMutation();
  const utils = trpc.useUtils();

  const leave = () => { if (window.history.length > 1) router.back(); else router.push(tripId ? `/trips/${tripId}` : "/dashboard"); };

  async function handleSave(payload: Parameters<React.ComponentProps<typeof CourseEntryFlow>["onSave"]>[0]) {
    const { teeName, ...createInput } = payload;
    try {
      const course = await createCourse.mutateAsync(createInput);
      const courseId = course.id as string;
      /**
       * ── STAGE, do not apply (#1226) ────────────────────────────────────────
       *
       * This used to finish with `games.applyCourse` / `games.setBackNine` — a
       * server write to the game, issued from a page reached FROM an open
       * settings draft by a navigation that unmounted it. Two bugs came out of
       * that, and the second survived the first's fix:
       *
       *   #1227 — the write moved `games.configHash`, so the returning page
       *   froze its baseline on the cached pre-course value and Save was refused
       *   with "This game changed on another device". Fixed by resetting the
       *   hash here, which is why that call used to sit on this line.
       *
       *   #1226 — `draftOutboxRecover` restores the stored draft ONLY when
       *   `stored.base === currentServerFingerprint`. The write moved the
       *   fingerprint, so on return the base no longer matched and the whole
       *   draft was discarded, SILENTLY. Set the points, import a course, come
       *   back, and the points are gone. Resetting the hash did not help: it
       *   made the client see the NEW fingerprint, which is precisely the value
       *   the stored base fails to match.
       *
       * So the course is now handed BACK instead. `courses.create` above is a
       * global-library write (`courses` has no `trip_id` and none of its columns
       * are in `HASH_COLS`), so nothing here moves the game's fingerprint any
       * more — which is also why `resetGameConfigHash` is gone rather than kept
       * as a belt-and-braces no-op: a refresh call on a page that cannot move
       * the hash would teach the next reader that it can.
       *
       * The settings page stages it through the same `onApplyFront` /
       * `onApplyBack` path that picking a SAVED course has always used, so both
       * halves of the Course row now behave identically: nothing about the game
       * is written until Save.
       */
      if (gameId) {
        pendingCoursePut(gameId, {
          courseId,
          teeName,
          slot: isBack ? "back" : "front",
        });
      }
      utils.courses.getById.invalidate({ courseId });
      utils.courses.list.invalidate();
      leave();
    } catch {
      // Surfaced via the flow's disabled/saving state; leave the user on the page.
    }
  }

  return (
    <CourseEntryFlow
      providerId={provider}
      defaultHoleCount={isBack ? 9 : 18}
      saving={createCourse.isPending}
      onSave={handleSave}
      onCancel={leave}
    />
  );
}
