import { initTRPC, TRPCError } from "@trpc/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import superjson from "superjson";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface TRPCContext {
  supabase: SupabaseClient;
  user: User | null;
}

/**
 * Creates context for the API route handler.
 * Uses the server-side Supabase client (cookie-based auth).
 */
export const createTRPCContext = async (): Promise<TRPCContext> => {
  // Dynamic import to avoid pulling in next/headers at module scope
  // (breaks tests and non-Next.js contexts)
  const { createClient } = await import("@/lib/supabase-server");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
};

// ---------------------------------------------------------------------------
// tRPC init
// ---------------------------------------------------------------------------

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const middleware = t.middleware;
export const createCallerFactory = t.createCallerFactory;

// ---------------------------------------------------------------------------
// Base procedures
// ---------------------------------------------------------------------------

/** Unprotected — available to anyone. */
export const publicProcedure = t.procedure;

/** Requires an authenticated session. Narrows ctx.user to non-null. */
export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// Backwards compat alias
export const protectedProcedure = authedProcedure;
