"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import { CourseEntryFlow } from "@/components/games/course/CourseEntryFlow";

/**
 * Manual course-entry page (W-COURSESPLIT-01) — the heavy "place" the Course-row
 * picker steps out to. **Trip-agnostic** (`/courses/new`, not under `/trips/...`):
 * a course is a global library row the group reuses across trips, not a property
 * of one trip (migration 039 — `courses` has no `trip_id`). It already lives at
 * the right level for the future Circle layer; this route matches.
 *
 * `?trip=&game=` are the return target — on save, create the global course, apply
 * it to that game, and go back so the Course row lands resolved + checked. The
 * game already exists (it's why the row can navigate while the pre-create pickers
 * can't), so leaving and returning is safe. `?provider=` seeds a golfcourseapi
 * pull for review; absent → a blank manual build.
 */
export default function NewCoursePage() {
  const router = useRouter();
  const params = useSearchParams();
  const tripId = params.get("trip");
  const gameId = params.get("game");
  const provider = params.get("provider");

  const createCourse = trpc.courses.create.useMutation();
  const applyCourse = trpc.games.applyCourse.useMutation();
  const utils = trpc.useUtils();

  const leave = () => { if (window.history.length > 1) router.back(); else router.push(tripId ? `/trips/${tripId}` : "/dashboard"); };

  async function handleSave(payload: Parameters<React.ComponentProps<typeof CourseEntryFlow>["onSave"]>[0]) {
    const { teeName, ...createInput } = payload;
    try {
      const course = await createCourse.mutateAsync(createInput);
      const courseId = course.id as string;
      // Apply to the originating game (when we came from one) so the Course row
      // returns resolved. No game → just saved to the library.
      if (tripId && gameId) {
        await applyCourse.mutateAsync({ tripId, gameId, courseId, teeSetName: teeName });
        utils.courses.getById.invalidate({ courseId });
        utils.games.getById.invalidate({ tripId, gameId });
        utils.games.listByTrip.invalidate({ tripId });
        utils.competitions.faceBootstrap.invalidate({ tripId });
      }
      utils.courses.list.invalidate();
      leave();
    } catch {
      // Surfaced via the flow's disabled/saving state; leave the user on the page.
    }
  }

  return (
    <CourseEntryFlow
      providerId={provider}
      saving={createCourse.isPending || applyCourse.isPending}
      onSave={handleSave}
      onCancel={leave}
    />
  );
}
