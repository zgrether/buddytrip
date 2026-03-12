import { router, publicProcedure } from "./trpc";
import { usersRouter } from "./routers/users";
import { tripsRouter } from "./routers/trips";
import { tripMembersRouter } from "./routers/tripMembers";
import { ideasRouter } from "./routers/ideas";
import { ideaCommentsRouter } from "./routers/ideaComments";
import { datePollRouter } from "./routers/datePoll";

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
});

export type AppRouter = typeof appRouter;
