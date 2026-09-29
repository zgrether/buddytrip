/**
 * Vitest globalSetup — creates shared persistent test users and signs them in.
 *
 * Architecture:
 *   - 4 shared users (owner, planner, member, outsider) — created idempotently
 *   - signInWithPassword called exactly 4 times per run (once per user)
 *   - Tokens saved to .test-auth.json for test files to read
 *   - Users persist across runs — never deleted
 *   - Test isolation comes from unique trips, not unique users
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { assertLocalTestDatabase } from "./assertLocalTestDatabase";
import { loadTestEnv, resolvedSupabaseUrl } from "./testEnv";
import { sweepRunLeftovers } from "./runLeakSweep";

// The SAME loader `vitest.config.mts` uses — `.env.test` (local stack) ahead of
// `.env.local` (the app's own environment, which points at prod). Two callers
// resolving the environment separately is how the guard below ends up judging
// something other than what the clients are built from.
loadTestEnv(resolve(__dirname, "../../.."));

const SUPABASE_URL = resolvedSupabaseUrl()!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const AUTH_FILE = resolve(__dirname, "../../../.test-auth.json");

export interface SharedUser {
  id: string;
  email: string;
  access_token: string;
  refresh_token: string;
}

export interface AuthData {
  owner: SharedUser;
  planner: SharedUser;
  member: SharedUser;
  outsider: SharedUser;
}

const USERS = [
  { key: "owner", email: "test-owner@buddytrip.app", name: "Test Owner" },
  { key: "planner", email: "test-planner@buddytrip.app", name: "Test Planner" },
  { key: "member", email: "test-member@buddytrip.app", name: "Test Member" },
  { key: "outsider", email: "test-outsider@buddytrip.app", name: "Test Outsider" },
] as const;

const PASSWORD = "BuddyTripTest2026!";

/** When this run began: the teardown sweep only touches rows created after it. */
let RUN_STARTED_AT: string | null = null;

export async function setup() {
  // BEFORE any client is built, and before the first write. This is the single
  // chokepoint every run passes through, which is why the guard lives here
  // rather than in `test-setup.ts` (per-file) or in a convention nobody can
  // enforce. See `assertLocalTestDatabase` for what it caught.
  assertLocalTestDatabase(SUPABASE_URL);
  RUN_STARTED_AT = new Date().toISOString();

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const result: Record<string, SharedUser> = {};

  // List all users once, outside the loop
  const { data: existing, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    throw new Error(
      `Failed to list users: ${listError.message}. ` +
      `If "Legacy API keys are disabled", update SUPABASE_SERVICE_ROLE_KEY to the new format from your Supabase dashboard.`
    );
  }

  for (const u of USERS) {
    let userId: string | undefined;
    const found = existing?.users?.find((x) => x.email === u.email);

    if (found) {
      userId = found.id;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { name: u.name },
      });
      if (error) {
        const hint = error.message.includes("Legacy API keys")
          ? " Update SUPABASE_SERVICE_ROLE_KEY to the new format from your Supabase dashboard."
          : "";
        throw new Error(`Failed to create ${u.key}: ${error.message}.${hint}`);
      }
      userId = data.user.id;
    }

    // Sign in (exactly 1 call per user)
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY },
      body: JSON.stringify({ email: u.email, password: PASSWORD }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to sign in ${u.key}: ${res.status} ${body}`);
    }
    const session = await res.json();

    result[u.key] = {
      id: userId!,
      email: u.email,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    };
  }

  writeFileSync(AUTH_FILE, JSON.stringify(result));
  console.log("[global-setup] Signed in 4 shared test users");
}

export async function teardown() {
  // The shared users persist across runs. What a run CREATED does not (#1516):
  // find it, say what it was, and remove it. See `sweepRunLeftovers`.
  if (!RUN_STARTED_AT) return;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const report = await sweepRunLeftovers(admin, RUN_STARTED_AT);

  if (report.guestsRemoved || report.sendLogRemoved) {
    console.log(
      `[global-teardown] removed this run's ${report.guestsRemoved} orphaned guest(s) and ` +
        `${report.sendLogRemoved} push_send_log row(s)`
    );
  }
  if (report.failures.length > 0) {
    console.warn(`[global-teardown] ${report.failures.length} cleanup step(s) failed:\n  ${report.failures.join("\n  ")}`);
  }
  if (report.leakedTrips.length > 0) {
    const list = report.leakedTrips.map((t) => `${t.id}  "${t.title}"`).join("\n  ");
    const message =
      `[global-teardown] ${report.leakedTrips.length} trip(s) survived their file's cleanup ` +
      `(removed now). The title names the file; its TestContext did not clean what it made:\n  ${list}`;
    // In CI a leak FAILS the run, so a new one is loud rather than silently swept
    // (Zach, #1516: "a new leak fails loudly instead of growing silently").
    // Locally it is swept and reported, because a local run may be interrupted.
    if (process.env.CI) throw new Error(message);
    console.warn(message);
  }
}
