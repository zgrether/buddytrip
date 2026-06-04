import { router, publicProcedure } from "./trpc";
import { usersRouter } from "./routers/users";
import { tripsRouter } from "./routers/trips";
import { tripMembersRouter } from "./routers/tripMembers";
import { ghostCrewRouter } from "./routers/ghostCrew";
import { ideasRouter } from "./routers/ideas";
import { datePollRouter } from "./routers/datePoll";
import { expensesRouter } from "./routers/expenses";
import { messagesRouter } from "./routers/messages";
import { quickInfoTilesRouter } from "./routers/quickInfoTiles";
import { competitionsRouter } from "./routers/competitions";
import { eventsRouter } from "./routers/events";
import { teamsRouter } from "./routers/teams";
import { teamAssignmentsRouter } from "./routers/teamAssignments";
import { logisticsRouter } from "./routers/logistics";
import { scheduleRouter } from "./routers/schedule";
import { golfCoursesRouter } from "./routers/golfCourses";
import { ideaLodgingRouter } from "./routers/ideaLodging";
import { archivedIdeasRouter } from "./routers/archivedIdeas";
import { feedbackRouter } from "./routers/feedback";

export const appRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
  users: usersRouter,
  trips: tripsRouter,
  tripMembers: tripMembersRouter,
  ghostCrew: ghostCrewRouter,
  ideas: ideasRouter,
  datePoll: datePollRouter,
  expenses: expensesRouter,
  messages: messagesRouter,
  quickInfoTiles: quickInfoTilesRouter,
  competitions: competitionsRouter,
  events: eventsRouter,
  teams: teamsRouter,
  teamAssignments: teamAssignmentsRouter,
  logistics: logisticsRouter,
  schedule: scheduleRouter,
  golfCourses: golfCoursesRouter,
  ideaLodging: ideaLodgingRouter,
  archivedIdeas: archivedIdeasRouter,
  feedback: feedbackRouter,
});

export type AppRouter = typeof appRouter;
