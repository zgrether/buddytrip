import type { SupabaseClient } from "@supabase/supabase-js";
import { rowsOrThrow } from "./rowOrThrow";

/** One row of `lookup_user_by_email` (migration 133): never the full record. */
export type EmailLookupRow = {
  id: string;
  name: string;
  is_guest: boolean;
  avatar_icon: string | null;
};

/**
 * The account holding `email`, or null when no account does. A FAILED lookup
 * throws a retryable error; it never reads as "no account" (#1537).
 *
 * Every caller writes on the strength of this answer: a new placeholder with the
 * address, or the invite path for a person who has no account. Read as "no
 * account", a failed lookup took that branch and the write was refused by the
 * unique email with a raw duplicate-key error, for what a retry would have fixed.
 */
export async function lookupAccountByEmail(
  supabase: SupabaseClient,
  email: string
): Promise<EmailLookupRow | null> {
  const rows = rowsOrThrow<EmailLookupRow>(
    await supabase.rpc("lookup_user_by_email", { p_email: email }),
    "email address"
  );
  return rows[0] ?? null;
}
