// golfcourseapi.com free tier: 50 requests/day, keyed to 0000 UTC. The counter
// is provider-scoped so a future second provider gets its own row + cap.
export const GOLF_API_PROVIDER = "golfcourseapi";
export const GOLF_API_DAILY_LIMIT = 50;

/** Thrown by `searchCourses` when the server refused the search at the cap. */
export class CourseApiAtCapError extends Error {
  constructor() {
    super("course search is at today's limit");
    this.name = "CourseApiAtCapError";
  }
}
