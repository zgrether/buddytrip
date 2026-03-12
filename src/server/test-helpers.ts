/**
 * Shared test utilities for tRPC router tests.
 *
 * Uses the Supabase service role client (bypasses RLS) for setup/teardown
 * and creates tRPC callers with simulated auth contexts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createCallerFactory, type TRPCContext } from "./trpc";
import { appRouter } from "./router";

// ---------------------------------------------------------------------------
// Supabase admin client (service role — bypasses RLS)
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function getAdminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

export function getAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY);
}

export function hasServiceKey(): boolean {
  return !!SERVICE_KEY;
}

// ---------------------------------------------------------------------------
// tRPC caller factory
// ---------------------------------------------------------------------------

const factory = createCallerFactory(appRouter);

/**
 * Create a tRPC caller with a given user context.
 * The supabase client uses the service role key to bypass RLS,
 * but `ctx.user` simulates the authenticated user for middleware checks.
 */
export function createTestCaller(userId: string) {
  const supabase = getAdminClient();
  const ctx: TRPCContext = {
    supabase,
    user: { id: userId } as TRPCContext["user"],
  };
  return factory(ctx);
}

/** Create a tRPC caller with no user (unauthenticated). */
export function createAnonCaller() {
  const supabase = getAnonClient();
  const ctx: TRPCContext = {
    supabase,
    user: null,
  };
  return factory(ctx);
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

/** Delete test rows by ID from a table. */
export async function cleanupRows(
  table: string,
  column: string,
  values: string[]
) {
  const admin = getAdminClient();
  await admin.from(table).delete().in(column, values);
}
