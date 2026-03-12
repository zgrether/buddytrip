import { router, publicProcedure } from "./trpc";
import { usersRouter } from "./routers/users";
import { tripsRouter } from "./routers/trips";

export const appRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
  users: usersRouter,
  trips: tripsRouter,
});

export type AppRouter = typeof appRouter;
