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
});

export type AppRouter = typeof appRouter;
