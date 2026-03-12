import { router, publicProcedure } from "./trpc";
import { usersRouter } from "./routers/users";

export const appRouter = router({
  health: publicProcedure.query(() => {
    return { status: "ok" };
  }),
  users: usersRouter,
});

export type AppRouter = typeof appRouter;
