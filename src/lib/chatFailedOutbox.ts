/**
 * Messages whose send FAILED, kept in localStorage so a bad connection can't
 * silently destroy what someone wrote.
 *
 * ── The rule this implements ────────────────────────────────────────────────
 * CLAUDE.md #15: "A failed save keeps the value and flags the cell `error` —
 * NEVER roll back to blank." That rule is implemented twice already —
 * `useScoreSaver` and `useOutcomeSaver` both keep the value, keep the durable
 * outbox entry, and clear only on server confirm. Chat was the one write path
 * that still rolled back: `messages.send`'s `onError` dropped the optimistic
 * row and `handleSend` had already emptied the composer, so the text existed
 * nowhere.
 *
 * ── Why this is a THIRD door, not the draft fix again ───────────────────────
 * `chatDraft` covers "closed the panel mid-compose". This covers "tapped send
 * on the 12th tee with one bar" — which on a golf course is the normal
 * operating condition rather than an edge case, and unlike a draft there is
 * nothing left in the composer to fall back on.
 *
 * ── Why the id is the whole design ──────────────────────────────────────────
 * The id is minted CLIENT-SIDE (`crypto.randomUUID()` in `handleSend`) and
 * `messages.send` inserts it verbatim into a table whose primary key is that
 * column. Three properties fall out of that one fact, and every one of them is
 * load-bearing here:
 *
 *   1. A RETRY REUSES THE ID, so it cannot duplicate the message. The primary
 *      key refuses the second insert. Minting a fresh id on retry WOULD
 *      duplicate — that is the mistake this module exists to make impossible,
 *      which is why the id is stored rather than regenerated.
 *   2. If the original actually landed and only the response was lost, the real
 *      row carries the SAME id, so `buildDisplayed`'s dedup (optimistic rows
 *      whose id is in `realIds` are dropped) removes the failed twin on its own
 *      the moment the row arrives — by realtime, by refetch, or from another
 *      device. Nothing here has to reconcile that case.
 *   3. Which is also why a stale entry is self-limiting: recovery on mount
 *      re-renders it as failed, and the first successful fetch that contains
 *      that id makes it disappear.
 *
 * Same `bt.<name>.v1` idiom, same per-trip AND per-visibility keying as
 * `chatDraft` — Crew and Organizers are different conversations, and a failed
 * message must reappear in the room it was written for.
 */

/** Bumped when the stored SHAPE changes. A mismatch discards, never migrates. */
const NS = "bt.chatFailed.v1";

const storeKey = (tripId: string, visibility: string) => `${NS}:${tripId}:${visibility}`;

/** Matches `messages.send`'s `text: z.string().min(1).max(5000)`. */
const MAX_TEXT_LENGTH = 5000;

/**
 * How many failed messages to keep per channel.
 *
 * Bounded because this is the one outbox whose entries are NOT self-clearing on
 * a good connection: a score cell retries as soon as you touch it again, but a
 * failed message sits until someone taps retry or discard. An offline stretch
 * with a chatty sender would otherwise grow without limit, in a storage budget
 * `chatCache` is also spending. Oldest are dropped first — the newest failure is
 * the one still in mind.
 */
const MAX_ENTRIES = 20;

export interface FailedMessage {
  /** The id the send used, and the id a retry MUST reuse. See the header. */
  id: string;
  text: string;
  /** The optimistic row's `created_at`, so recovery keeps its place in order. */
  createdAt: string;
  /**
   * Who wrote it.
   *
   * Redundant in the ordinary case — you can only fail to send your own
   * message — and stored anyway for the shared-device case: two accounts on one
   * phone share this key, and without an author the recovered bubble would
   * render as whoever happens to be signed in. The caller filters on it, so a
   * leftover from the other account stays invisible rather than being
   * attributed to the wrong person.
   *
   * It also removes the reason recovery would otherwise need an effect: with
   * the author stored, the whole set can be seeded in a lazy initializer
   * instead of waiting for the session read to resolve.
   */
  userId: string;
}

interface OutboxEnvelope {
  v: 1;
  messages: FailedMessage[];
}

/**
 * Field-by-field, not trusted from the version tag: a bumped version catches a
 * shape WE changed, and this catches everything else — a half-written entry
 * from a killed tab, a key collision, a shape that drifted without the tag
 * being bumped (which is the one a version tag cannot catch, since forgetting
 * to bump it is the whole failure).
 *
 * A row missing its `id` is the dangerous one and is why this is strict rather
 * than salvaging: retrying without the original id is the single action that
 * can duplicate a message.
 */
function isFailedMessage(row: unknown): row is FailedMessage {
  if (typeof row !== "object" || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.text === "string" &&
    r.text.length > 0 &&
    typeof r.createdAt === "string" &&
    r.createdAt.length > 0 &&
    typeof r.userId === "string" &&
    r.userId.length > 0
  );
}

/**
 * Every failed message for one channel, oldest first, or `[]`.
 *
 * `[]` on every failure — absent, unparseable, wrong version, storage disabled.
 * Unlike `readChatCache`'s null there is no "empty vs missing" distinction to
 * preserve: both mean the same thing to the only caller (nothing to recover),
 * and an empty list renders as an unremarkable chat rather than as a claim.
 *
 * A SINGLE bad row discards only that row, not the batch. This is the opposite
 * of `chatDraft`, deliberately: there, a partial string is a fragment that
 * reads as something you wrote and is one tap from being sent. Here the entries
 * are discrete whole messages, so keeping the four that survived is strictly
 * better than throwing away someone's afternoon because one entry is malformed.
 */
export function readFailedOutbox(tripId: string, visibility: string): FailedMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storeKey(tripId, visibility));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return [];
    const env = parsed as Partial<OutboxEnvelope>;
    if (env.v !== 1) return []; // a different version: discard, never migrate
    if (!Array.isArray(env.messages)) return [];
    return env.messages
      .filter(isFailedMessage)
      .map((m) => ({ ...m, text: m.text.slice(0, MAX_TEXT_LENGTH) }))
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** Replace one channel's list wholesale. Empty clears the key outright. */
function writeFailedOutbox(
  tripId: string,
  visibility: string,
  messages: readonly FailedMessage[]
): void {
  if (typeof window === "undefined") return;
  try {
    if (messages.length === 0) {
      window.localStorage.removeItem(storeKey(tripId, visibility));
      return;
    }
    const env: OutboxEnvelope = { v: 1, messages: messages.slice(-MAX_ENTRIES) };
    window.localStorage.setItem(storeKey(tripId, visibility), JSON.stringify(env));
  } catch {
    /* quota exceeded / storage disabled — best-effort; never throw into chat. */
  }
}

/**
 * Record a failed send, or refresh one already recorded.
 *
 * Keyed by id so a second failure of the SAME message (a retry that failed
 * again) updates in place rather than stacking a duplicate bubble.
 */
export function putFailedMessage(
  tripId: string,
  visibility: string,
  message: FailedMessage
): void {
  const existing = readFailedOutbox(tripId, visibility).filter((m) => m.id !== message.id);
  writeFailedOutbox(tripId, visibility, [
    ...existing,
    { ...message, text: message.text.slice(0, MAX_TEXT_LENGTH) },
  ]);
}

/**
 * Drop one entry — on a successful retry, or on an explicit discard.
 *
 * The two callers are deliberately the same function: "it sent" and "I don't
 * want it" leave identical state, and giving them separate paths would be two
 * places to keep in step for no gain.
 */
export function clearFailedMessage(tripId: string, visibility: string, id: string): void {
  const remaining = readFailedOutbox(tripId, visibility).filter((m) => m.id !== id);
  writeFailedOutbox(tripId, visibility, remaining);
}
