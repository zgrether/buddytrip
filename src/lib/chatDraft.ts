/**
 * The unsent chat draft for one channel, kept in localStorage so closing the
 * panel doesn't throw away what you typed.
 *
 * ── What this fixes ─────────────────────────────────────────────────────────
 * `FloatingChatPanel` returns `null` when `isOpen` is false, so the inner
 * component UNMOUNTS on close and `drafts` — ordinary component state — goes
 * with it. Type half a message, tap away to check a tee time, come back: gone.
 *
 * Same class as the Add Team modal discarding a rename on a backdrop tap. An
 * exit that looks non-destructive and isn't. Nothing warns you, because from
 * the app's point of view nothing happened.
 *
 * ── Per trip AND per visibility ─────────────────────────────────────────────
 * Crew and Organizers are different conversations that happen to share a
 * composer, and the panel already keeps their drafts apart in memory
 * (`Record<Visibility, string>`) for exactly that reason. Persisting them under
 * one key would collapse that distinction on the way to disk and hand someone's
 * half-written Organizers note to the Crew tab — the drafts would survive the
 * close and arrive in the wrong room.
 *
 * ── The `bt.<name>.v1` idiom ────────────────────────────────────────────────
 * Namespaced, versioned, best-effort, SSR-safe — the same shape as
 * `chatCache`, `draftOutbox`, `outcomeOutbox` and `scoreOutbox`. Deliberately
 * not a new pattern: this is the fifth of these, and the value of the idiom is
 * that the fifth one needs no explaining.
 */

/** Bumped when the stored SHAPE changes. A mismatch discards, never migrates. */
const NS = "bt.chatDraft.v1";

const storeKey = (tripId: string, visibility: string) => `${NS}:${tripId}:${visibility}`;

/**
 * Matches `messages.send`'s `text: z.string().min(1).max(5000)`.
 *
 * A draft longer than the server will ever accept cannot become a message, so
 * storing it would persist something unsendable — and localStorage is a shared,
 * small budget that `chatCache` is also spending. Truncation happens on READ as
 * well as write, so an oversized entry from an older build (or another tab)
 * still comes back usable rather than being discarded whole.
 */
const MAX_DRAFT_LENGTH = 5000;

interface DraftEnvelope {
  /** Schema version, checked on read. */
  v: 1;
  text: string;
}

/**
 * The stored draft for one channel, or `""` when there isn't a usable one.
 *
 * ── Why `""` and not `null` ─────────────────────────────────────────────────
 * The opposite call to `readChatCache`, deliberately, because the consumers are
 * not alike. There, null and `[]` mean genuinely different things — "no cache,
 * show the placeholder" versus "a channel with no messages" — and collapsing
 * them would render a discarded cache as "no messages yet".
 *
 * Here there is only one destination: the value of a text field. "No draft" and
 * "an empty draft" are the same empty composer, and every caller would
 * immediately `?? ""` a null. So the ambiguity has nowhere to cause harm, and a
 * single return type keeps the seeding call site a plain expression.
 *
 * ANY failure — absent, unparseable, wrong version, wrong type, storage
 * disabled — returns `""`. A malformed entry must never surface as a partial
 * string: half of a sentence you don't remember writing is worse than an empty
 * field, because it reads as something you typed and invites you to send it.
 */
export function readChatDraft(tripId: string, visibility: string): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(storeKey(tripId, visibility));
    if (!raw) return "";
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return "";
    const env = parsed as Partial<DraftEnvelope>;
    if (env.v !== 1) return ""; // a different version: discard, never migrate
    // Checked rather than trusted: a version tag cannot catch a shape that
    // drifted without the tag being bumped, which is the failure that forgetting
    // to bump it produces.
    if (typeof env.text !== "string") return "";
    return env.text.slice(0, MAX_DRAFT_LENGTH);
  } catch {
    return "";
  }
}

/**
 * Persist one channel's unsent draft.
 *
 * Stores the text VERBATIM (bar the length cap) — trailing spaces included,
 * because they are part of what someone is mid-way through typing and coming
 * back to a silently trimmed draft is its own small wrongness.
 *
 * Emptiness is judged on the TRIMMED value, though: a composer holding only
 * whitespace is an empty composer, and leaving an entry for it would keep a row
 * per channel per trip alive forever for nothing.
 */
export function writeChatDraft(tripId: string, visibility: string, text: string): void {
  if (typeof window === "undefined") return;
  try {
    if (text.trim() === "") {
      clearChatDraft(tripId, visibility);
      return;
    }
    const env: DraftEnvelope = { v: 1, text: text.slice(0, MAX_DRAFT_LENGTH) };
    window.localStorage.setItem(storeKey(tripId, visibility), JSON.stringify(env));
  } catch {
    /* quota exceeded / storage disabled — best-effort; never throw into chat. */
  }
}

/** Drop one channel's draft. */
export function clearChatDraft(tripId: string, visibility: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storeKey(tripId, visibility));
  } catch {
    /* best-effort */
  }
}
