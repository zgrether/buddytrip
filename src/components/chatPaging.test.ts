import { describe, it, expect } from "vitest";
import { CHAT_PAGE_SIZE, CHAT_FETCH_SIZE, olderCursor, dedupeById } from "./FloatingChatPanel";

/**
 * The paging arithmetic, which is the part of this change most likely to be
 * subtly wrong and least likely to be noticed if it is.
 *
 * The old test was `lastPage.length === CHAT_PAGE_SIZE`, which cannot tell
 * "exactly a page exists" from "more than a page exists" — so a channel with
 * exactly 50 messages claimed older history and spent a fetch discovering it had
 * none. 50 is the size of the largest real channel in production, so that was
 * the ordinary case rather than an edge one.
 *
 * The fix asks for one row MORE than a page and uses it purely as a signal. That
 * buys an exact answer at the cost of a one-row overlap between consecutive
 * pages, which `dedupeById` removes — the two are a pair, and a test for either
 * alone would let the other regress.
 */

const row = (n: number) => ({ id: `m${n}`, created_at: `2026-08-09T00:${String(n).padStart(2, "0")}:00Z` });
const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => row(from + i));

describe("olderCursor — exact has-more, no boundary guess", () => {
  it("a SHORT page ends the history", () => {
    expect(olderCursor(page(0, 10))).toBeUndefined();
  });

  it("EXACTLY a page ends the history — the case the old test got wrong", () => {
    // 50 rows back from a 51-row request proves there is no 51st.
    expect(olderCursor(page(0, CHAT_PAGE_SIZE))).toBeUndefined();
  });

  it("a page PLUS the signal row continues", () => {
    const p = page(0, CHAT_FETCH_SIZE);
    expect(olderCursor(p)).toBe(p[CHAT_PAGE_SIZE - 1].created_at);
  });

  it("the cursor is the 50th row, NOT the over-fetched 51st", () => {
    // Using the 51st would SKIP it: the next page is `created_at < cursor`, so a
    // cursor at row 51 would exclude row 51 from both pages and silently lose a
    // message at every page boundary. Using row 50 re-fetches row 51 instead,
    // which is a duplicate — recoverable, where a gap is not.
    const p = page(0, CHAT_FETCH_SIZE);
    expect(olderCursor(p)).not.toBe(p[p.length - 1].created_at);
    expect(olderCursor(p)).toBe(p[49].created_at);
  });

  it("an empty page ends the history", () => {
    expect(olderCursor([])).toBeUndefined();
  });
});

describe("dedupeById — what makes the overlap safe", () => {
  it("drops the row consecutive pages share", () => {
    // Page 1 holds rows 0..50 (51 back); its cursor is row 49, so page 2 begins
    // at row 50 — the overlap this exists to absorb.
    const p1 = page(0, CHAT_FETCH_SIZE);
    const p2 = page(CHAT_PAGE_SIZE, CHAT_FETCH_SIZE);
    const flat = dedupeById([...p1, ...p2]);
    expect(flat.filter((r) => r.id === `m${CHAT_PAGE_SIZE}`)).toHaveLength(1);
    expect(flat).toHaveLength(p1.length + p2.length - 1);
  });

  it("keeps the FIRST occurrence — pages are newest-first, so the newer copy wins", () => {
    const older = { id: "x", created_at: "old" };
    const newer = { id: "x", created_at: "new" };
    expect(dedupeById([newer, older])[0].created_at).toBe("new");
  });

  it("preserves order and leaves a clean list untouched", () => {
    const p = page(0, 5);
    expect(dedupeById(p)).toEqual(p);
  });

  it("absorbs a realtime prepend racing a refetch that already carried the row", () => {
    // The other reason this is load-bearing: `useRealtimeChat` prepends the row
    // into page 0 while an in-flight refetch may return a page that already
    // contains it. Without the dedupe that renders twice.
    const fresh = page(0, 3);
    const withPrepend = [row(3), ...fresh, row(3)];
    expect(dedupeById(withPrepend).filter((r) => r.id === "m3")).toHaveLength(1);
  });
});
