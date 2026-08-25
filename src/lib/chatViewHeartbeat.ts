/**
 * The two constants that make "don't notify someone with the chat open" true.
 *
 * They are A PAIR, and they live in one client-safe module for that reason: the
 * window is read by the SERVER gate (`src/server/lib/chatNotify.ts`) and the
 * heartbeat by the CLIENT panel (`FloatingChatPanel`), and a rule that only
 * holds while two numbers in two files stay in the right relationship is a rule
 * that drifts. Defined together, the relationship is visible at the point of
 * change. (Client-safe — no server/DB deps — so the server module can import it
 * without the client dragging `supabase-admin` into its bundle.)
 *
 * ── These are now the WHOLE rule, not one term in a formula ─────────────────
 * The read-state gate and the 30-minute re-arm are gone. Chat notifies on every
 * message except two: you sent it, or your panel is open. So a mistake in these
 * two numbers is no longer a mistake in how aggressively pushes coalesce — it is
 * the difference between hearing about a message and not.
 *
 * ── Why a heartbeat is needed at all ────────────────────────────────────────
 * The server decides who to push BEFORE the recipient's device has been told
 * anything, so it cannot ask the device whether the panel is open; a timestamp
 * the device leaves behind is the only evidence available. (Realtime Presence
 * was evaluated as the alternative and rejected: it tracks socket liveness
 * rather than attention, so a pocketed phone reads as present until Phoenix's
 * reaper notices — a false present is a silently dropped notification, on a
 * schedule we do not control.)
 *
 * A message arriving cannot be that evidence on its own: a panel left open
 * through a ten-minute lull would look closed, and the next message would buzz
 * at someone staring straight at it. So an open, visible panel re-stamps
 * `viewing_at` on an interval, and is inside the window even in silence.
 *
 * ── `viewing_at`, NOT `last_read_at` ────────────────────────────────────────
 * The heartbeat writes its OWN column (migration 145). It used to write the read
 * mark, which meant one column answered both "how far have they read" and "were
 * they just looking" — and every bug this subsystem produced came from those two
 * meanings diverging. With them split, a heartbeat cannot mark an undelivered
 * message read, because it no longer touches the column that would.
 *
 * ── The invariant ───────────────────────────────────────────────────────────
 * HEARTBEAT must stay COMFORTABLY smaller than WINDOW. The margin absorbs a slow
 * request, a throttled background timer waking late, and the gap between the
 * last beat and the message. At 15s against 40s there is room for one missed
 * beat plus slack. Pinned by a test, so this paragraph is not the only thing
 * holding it.
 */

/**
 * How recently `viewing_at` must have moved to read as "watching it now".
 *
 * ── This is the ONLY suppression left, besides "you sent it" ────────────────
 * The read-state gate and the 30-minute re-arm are gone (they are not tuned
 * smaller — they are deleted). The rule is now: notify on every message, unless
 * you sent it or your chat panel is open. So this window is no longer one term
 * in a coalescing formula; it is the whole of the remaining logic, and every
 * second of it is a second in which someone who has POCKETED THE PHONE is
 * mistaken for someone staring at the screen.
 *
 * ── Sized off the heartbeat, at the tightest ratio that still tolerates a
 *    dropped beat ──────────────────────────────────────────────────────────
 * 40s against a 15s heartbeat is 2.6 beats: room for one missed beat plus a
 * slow request. It was 150s against 60s, which was the same ratio at four times
 * the cost in silence.
 *
 * Tightening this far is affordable only because `viewing_at` is its own column
 * (migration 145). The old heartbeat wrote through `markRead`, whose success
 * handler invalidates three queries — so a beat cost one write and three
 * refetches, and quadrupling the rate would have quadrupled all four. Nothing
 * renders from `viewing_at`, so a beat is now one write and no reads: 15/40
 * costs about what 60/150 did.
 */
export const CHAT_ACTIVE_VIEWING_WINDOW_MS = 40 * 1000;

/**
 * How often an open, visible chat panel re-stamps `viewing_at`.
 *
 * The window can only shrink as far as the heartbeat allows, so the two move
 * together and live in one file — that pairing is the reason this module exists.
 *
 * Four writes per minute per OPEN panel, and only while the tab is visible and
 * the view is current. They are writes nothing reads back: `viewing_at` feeds
 * one server-side comparison and no UI, so a beat invalidates no queries and
 * triggers no refetch. That is what makes this rate cheaper than the 60s beat it
 * replaces, which went through `markRead` and pulled three query invalidations
 * with it.
 */
export const CHAT_VIEW_HEARTBEAT_MS = 15 * 1000;

