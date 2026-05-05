import { router, publicProcedure } from "./trpc";
import { usersRouter } from "./routers/users";
import { tripsRouter } from "./routers/trips";
import { tripMembersRouter } from "./routers/tripMembers";
import { ghostCrewRouter } from "./routers/ghostCrew";
import { ideasRouter } from "./routers/ideas";
import { ideaCommentsRouter } from "./routers/ideaComments";
import { datePollRouter } from "./routers/datePoll";
import { reservationsRouter } from "./routers/reservations";
import { expensesRouter } from "./routers/expenses";
import { messagesRouter } from "./routers/messages";
import { notificationsRouter } from "./routers/notifications";
import { quickInfoTilesRouter } from "./routers/quickInfoTiles";
import { competitionsRouter } from "./routers/competitions";
import { venuesRouter } from "./routers/venues";
import { eventsRouter } from "./routers/events";
import { teamsRouter } from "./routers/teams";
import { teamAssignmentsRouter } from "./routers/teamAssignments";
import { playGroupsRouter } from "./routers/playGroups";
import { groupResultsRouter } from "./routers/groupResults";
import { seriesRouter } from "./routers/series";
import { scoreboardSharesRouter } from "./routers/scoreboardShares";
import { logisticsRouter } from "./routers/logistics";
import { scheduleRouter } from "./routers/schedule";
import { golfCoursesRouter } from "./routers/golfCourses";
import { ideaLodgingRouter } from "./routers/ideaLodging";
import { archivedIdeasRouter } from "./routers/archivedIdeas";

export const appRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
  users: usersRouter,
  trips: tripsRouter,
  tripMembers: tripMembersRouter,
  ghostCrew: ghostCrewRouter,
  ideas: ideasRouter,
  ideaComments: ideaCommentsRouter,
  datePoll: datePollRouter,
  reservations: reservationsRouter,
  expenses: expensesRouter,
  messages: messagesRouter,
  notifications: notificationsRouter,
  quickInfoTiles: quickInfoTilesRouter,
  competitions: competitionsRouter,
  venues: venuesRouter,
  events: eventsRouter,
  teams: teamsRouter,
  teamAssignments: teamAssignmentsRouter,
  playGroups: playGroupsRouter,
  groupResults: groupResultsRouter,
  series: seriesRouter,
  scoreboardShares: scoreboardSharesRouter,
  logistics: logisticsRouter,
  schedule: scheduleRouter,
  golfCourses: golfCoursesRouter,
  ideaLodging: ideaLodgingRouter,
  archivedIdeas: archivedIdeasRouter,
});

export type AppRouter = typeof appRouter;
