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

/**
 * How recently `last_read_at` must have moved to read as "watching it now".
 *
 * ── This was 5 minutes, and 5 minutes was wrong ─────────────────────────────
 * The window has to be wide enough that an OPEN panel is always inside it, and
 * no wider — every second beyond that is a second in which someone who has
 * CLOSED the app is mistaken for someone staring at the screen, and hears
 * nothing.
 *
 * At 5 minutes against a 2-minute heartbeat, the margin was more than twice
 * what it needed to be, and production showed the cost: a message 17 seconds
 * after a recipient closed the chat was suppressed as "watching". Reading the
 * chat — the most ordinary thing a person does — bought five minutes of
 * silence afterwards.
 *
 * Now sized directly off the heartbeat: two beats plus a grace period, which
 * tolerates one dropped beat and a slow request while getting a closed app back
 * to notifiable inside ~2.5 minutes.
 */
export const CHAT_ACTIVE_VIEWING_WINDOW_MS = 150 * 1000;

/**
 * How often an open, visible chat panel re-stamps its read mark.
 *
 * Tightened from 2 minutes alongside the window above — the window can only
 * shrink as far as the heartbeat allows, so the two move together. One small
 * upsert per open panel per minute, and only while a panel is actually open and
 * the tab is visible.
 */
export const CHAT_VIEW_HEARTBEAT_MS = 60 * 1000;

/**
 * TIME-BASED RE-ARM: how long a recipient who is behind stays silent before the
 * gate notifies them anyway.
 *
 * ── Why the read-only re-arm was not enough ─────────────────────────────────
 * The gate's first rule is that reading re-arms you. It is correct and it is
 * not sufficient, because it assumes people open the chat between bursts. On a
 * four-day trip with sixteen people, most will not — so under reading alone
 * they get one push on the first day and silence for the rest of the week.
 * Production bore this out immediately: of 14 chat sends in one morning, 3
 * delivered and 11 were suppressed, the survivors all inside the first 35
 * minutes.
 *
 * So: behind, but nothing has been SENT to this person for this long, notify
 * anyway. Someone who never opens chat still hears about the dinner plan.
 *
 * ── Why 30 minutes, and what it costs ───────────────────────────────────────
 * It is a rate limit, so the honest way to pick it is the worst case. A person
 * who NEVER opens the chat, in a trip where conversation never stops, gets at
 * most one push per window — about 32 across a 16-hour day. That is the ceiling,
 * it is far below the ~500 an ungated wiring would send, and it is roughly what
 * any group chat already produces for someone who ignores it.
 *
 * The realistic case is much lower: a push that gets read re-arms via the read
 * rule and the next message is a single push, so an engaged person gets about
 * one per session rather than one per window.
 */
export const CHAT_REARM_AFTER_MS = 30 * 60 * 1000;
