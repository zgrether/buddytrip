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
import { config } from "dotenv";

config({ path: resolve(__dirname, "../../../.env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
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

export async function setup() {
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
  // Users persist across runs — nothing to tear down.
}
