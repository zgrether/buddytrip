/**
 * Chat history paging — the page size, the over-fetch, the cursor, and the
 * de-duplication that the over-fetch makes necessary.
 *
 * Extracted from `FloatingChatPanel` so `chatCache` can bound itself by the
 * SAME `CHAT_PAGE_SIZE` the first fetch uses without importing the panel — the
 * panel imports the cache, so the cache importing the panel back would be a
 * cycle. Its test was already called `chatPaging.test.ts`; this is just the
 * code moving to where the test always said it lived.
 */

// Chat history page size — how many messages each lazy "load older" fetch pulls.
export const CHAT_PAGE_SIZE = 50;

/**
 * What we actually ASK the server for: one more than a page.
 *
 * The extra row is a has-more SIGNAL, not content. Asking for exactly
 * `CHAT_PAGE_SIZE` makes "is there older history?" unanswerable at the boundary:
 * a full page means either "exactly this many exist" or "more exist", and the
 * old `length === CHAT_PAGE_SIZE` test guessed the second. A channel with
 * exactly 50 messages therefore reported more history and spent a fetch proving
 * otherwise — and 50 is, as it happens, the size of the largest real channel in
 * production, so this was the common case rather than a corner.
 *
 * Asking for 51 makes the test exact: >50 rows back means at least one message
 * exists beyond the page, full stop.
 */
export const CHAT_FETCH_SIZE = CHAT_PAGE_SIZE + 1;

/**
 * Cursor for the next (older) page, or `undefined` when the history is exhausted.
 *
 * The cursor is the 50th row's timestamp — the last row of the PAGE, not of the
 * over-fetched response. The 51st row is therefore re-fetched as the first row of
 * the next page, which is why the flattened list is de-duplicated by id below.
 * Paying one duplicated row per page is what buys an exact has-more answer.
 */
export const olderCursor = (lastPage: { created_at: string }[]): string | undefined =>
  lastPage.length > CHAT_PAGE_SIZE ? lastPage[CHAT_PAGE_SIZE - 1].created_at : undefined;

/** First occurrence wins — the pages are newest-first, so that keeps the copy
 *  from the newer page and drops the overlapped one from the older page. */
export function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}
