import { router, publicProcedure } from "./trpc";
import { usersRouter } from "./routers/users";
import { tripsRouter } from "./routers/trips";
import { tripMembersRouter } from "./routers/tripMembers";
import { ideasRouter } from "./routers/ideas";
import { ideaCommentsRouter } from "./routers/ideaComments";
import { datePollRouter } from "./routers/datePoll";
import { reservationsRouter } from "./routers/reservations";
import { expensesRouter } from "./routers/expenses";
import { messagesRouter } from "./routers/messages";
import { notificationsRouter } from "./routers/notifications";
import { quickInfoTilesRouter } from "./routers/quickInfoTiles";
import { eventsRouter } from "./routers/events";
import { teamsRouter } from "./routers/teams";
import { teamAssignmentsRouter } from "./routers/teamAssignments";
import { roundsRouter } from "./routers/rounds";
import { playGroupsRouter } from "./routers/playGroups";
import { groupResultsRouter } from "./routers/groupResults";
import { sideEventsRouter } from "./routers/sideEvents";
import { seriesRouter } from "./routers/series";

export const appRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
  users: usersRouter,
  trips: tripsRouter,
  tripMembers: tripMembersRouter,
  ideas: ideasRouter,
  ideaComments: ideaCommentsRouter,
  datePoll: datePollRouter,
  reservations: reservationsRouter,
  expenses: expensesRouter,
  messages: messagesRouter,
  notifications: notificationsRouter,
  quickInfoTiles: quickInfoTilesRouter,
  events: eventsRouter,
  teams: teamsRouter,
  teamAssignments: teamAssignmentsRouter,
  rounds: roundsRouter,
  playGroups: playGroupsRouter,
  groupResults: groupResultsRouter,
  sideEvents: sideEventsRouter,
  series: seriesRouter,
});

export type AppRouter = typeof appRouter;
