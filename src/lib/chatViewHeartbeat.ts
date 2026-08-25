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
 * ── Why a heartbeat is needed at all ────────────────────────────────────────
 * The only server-visible evidence that someone is looking at a channel is
 * `chat_reads.last_read_at`, and `markRead` normally advances it only when a
 * MESSAGE ARRIVES and renders. So during an active conversation an open panel
 * looks open — but a panel left open through a ten-minute lull looks closed,
 * and the next message would buzz at someone staring straight at it.
 *
 * The heartbeat closes that by re-stamping the read mark on an interval while
 * the panel is open and the tab is actually visible, so an open panel is always
 * inside the window even in silence.
 *
 * ── The invariant ───────────────────────────────────────────────────────────
 * HEARTBEAT must stay COMFORTABLY smaller than WINDOW. The margin absorbs a slow
 * request, a throttled background timer waking late, and the gap between the
 * last heartbeat and the message. At 2 min against 5 min there is room for two
 * missed beats before a viewer becomes notifiable. Pinned by a test, so this
 * paragraph is not the only thing holding it.
 *
 * The cost is a single upsert per open panel per interval, and it lands only
 * during QUIET periods — while a conversation is active, `markRead` is already
 * firing more often than this on message arrival, and the heartbeat's own
 * "has it been an interval since the last mark?" check means it adds nothing.
 */

/** How recently `last_read_at` must have moved to read as "watching it now". */
export const CHAT_ACTIVE_VIEWING_WINDOW_MS = 5 * 60 * 1000;

/** How often an open, visible chat panel re-stamps its read mark. */
export const CHAT_VIEW_HEARTBEAT_MS = 2 * 60 * 1000;
