// ── Shared types for the date-poll UI ─────────────────────────────────────
//
// The poll's wire shapes (windows, votes, member context) used by the
// presentation layer (DatePollStackedCards) and the surrounding
// DatePollCard. Kept in their own file so the presentation layer can
// own these types without bringing in any component code.
//
// Server-side equivalents live on the `date_polls` / `date_windows` /
// `date_poll_votes` tables; these client-facing types deliberately drop
// columns the UI never reads (e.g. created_at on votes is kept since
// the cache writes use it, but feel free to slim further if a future
// refactor wants to).

/** One of the three real answers plus `null` for "no answer yet". */
export type VoteAnswer = "yes" | "maybe" | "no" | null;

/** A single vote row. `answer` is a string at the wire layer because
 *  the column stores raw text; consumers narrow to `VoteAnswer` after
 *  reading. */
export interface PollWindowVote {
  window_id: string;
  user_id: string;
  answer: string;
  created_at: string;
}

/** A proposed date window the crew can vote on. */
export interface PollWindow {
  id: string;
  trip_id: string;
  start_date: string;
  end_date: string;
  created_at: string;
  votes: PollWindowVote[];
}

/** A poll-eligible member. `user_id` is null for placeholder identities
 *  (name-only entries the owner manages). `avatarIcon` is the Tabler
 *  icon id from `users.avatar_icon` when the member is a real account. */
export interface PollMember {
  user_id: string | null;
  displayName: string;
  avatarIcon?: string | null;
}
