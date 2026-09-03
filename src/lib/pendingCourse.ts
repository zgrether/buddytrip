"use client";

/**
 * pendingCourse — the hand-off that lets `/courses/new` STAGE a course into an
 * open settings draft instead of writing it to the game (#1226).
 *
 * ── The bug this exists for ─────────────────────────────────────────────────
 *
 * The Course row's "search the wider database" NAVIGATES to `/courses/new`,
 * which unmounts the settings page. That page used to finish by calling
 * `games.applyCourse` — a server write, from inside a draft-then-save flow,
 * which CLAUDE.md #18 says should not happen. Two things followed:
 *
 *   1. #1227: the write moved `games.configHash` and the returning page froze
 *      its baseline on the cached pre-course value, so Save was refused with
 *      "This game changed on another device". Fixed there by resetting the hash.
 *   2. #1226, THIS one, and the reset did not fix it: `draftOutboxRecover`
 *      returns the stored draft only when `stored.base === currentServerFinger-
 *      print`. The course write moved the fingerprint, so on return the base no
 *      longer matched and the draft was DISCARDED — silently. Set the points,
 *      import a course, come back, and the points are gone.
 *
 * The no-clobber rule in `draftOutbox` is correct and is not what changed. The
 * problem was that the thing invalidating the draft was the USER'S OWN ACTION
 * inside the same flow, not another device.
 *
 * ── Why staging rather than re-seeding the outbox base ──────────────────────
 *
 * The obvious smaller fix — after applying the course, rewrite the stored
 * entry's `base` to the post-write hash — has a latent clobber. The draft
 * carries its own `course` slice, so restoring a draft whose course slice
 * predates the write and then saving it would put the OLD course back over the
 * new one. Re-seeding the base would have to patch that slice too, which is
 * staging with extra steps and a server round trip in the middle.
 *
 * Staging instead makes the "wider database" path behave exactly like picking a
 * SAVED course, which has always gone through `onApplyFront` into the draft. One
 * path, one model: nothing about the game is written until Save.
 *
 * ── Why sessionStorage and not the URL ──────────────────────────────────────
 *
 * `leave()` returns via `router.back()`, which preserves the settings panel and
 * the back-stack. A URL parameter cannot survive a `back()`, and switching to a
 * forward navigation would need the game's `game_type_id` (to build `gameHref`)
 * and would lose that nicety. sessionStorage is same-tab, survives the
 * navigation, and dies with the tab — which is the exact lifetime of a hand-off.
 *
 * It is NOT durable state and must never be treated as any: `take` consumes,
 * and a stale entry expires. If the hand-off is lost, the user has a course in
 * the global library that they can pick from the saved list — the ordinary path,
 * not a broken one.
 */

/** The course chosen on `/courses/new`, waiting for the settings page to stage it. */
export interface PendingCourse {
  courseId: string;
  teeName?: string;
  /** `back` composes onto the existing front nine (W-9HOLE-01's `slot=back`). */
  slot: "front" | "back";
  ts: number;
}

const NS = "bt.pendingCourse.v1";
const key = (gameId: string) => `${NS}:${gameId}`;

/**
 * How long a hand-off stays valid.
 *
 * Bounded because the write and the read are separated by a navigation the user
 * can abandon — closing the tab is covered by sessionStorage's own lifetime, but
 * wandering off to another game and coming back an hour later is not. Long
 * enough for any real return trip (the user is mid-import), short enough that a
 * forgotten entry cannot surprise someone with a course they picked earlier.
 */
const MAX_AGE_MS = 10 * 60 * 1000;

/** Record the chosen course for the settings page to stage on return. */
export function pendingCoursePut(
  gameId: string,
  entry: Omit<PendingCourse, "ts">
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      key(gameId),
      JSON.stringify({ ...entry, ts: Date.now() } satisfies PendingCourse)
    );
  } catch {
    /* storage disabled / quota — best-effort; never throw into the save path. */
  }
}

/**
 * Consume the hand-off, if there is a fresh one.
 *
 * CONSUMES on read — the staging action is not idempotent (it overwrites the
 * draft's course slice), so a second mount must not re-apply it. Returns null
 * for a missing, unparseable or expired entry, and clears the expired one so a
 * stale key cannot sit in storage for the tab's life.
 */
export function pendingCourseTake(gameId: string): PendingCourse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key(gameId));
    if (!raw) return null;
    window.sessionStorage.removeItem(key(gameId));
    const parsed = JSON.parse(raw) as PendingCourse;
    if (typeof parsed?.courseId !== "string" || !parsed.courseId) return null;
    if (parsed.slot !== "front" && parsed.slot !== "back") return null;
    if (typeof parsed.ts !== "number" || Date.now() - parsed.ts > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
