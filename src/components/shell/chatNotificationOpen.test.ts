import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * `?chat=1[&channel=]` — the one-shot instruction a chat notification's link
 * now carries, consumed in `AppShell`.
 *
 * ── Why a SOURCE guard ───────────────────────────────────────────────────────
 * `AppShell` wires tRPC, `GameChromeProvider`, `useCupPanel` and
 * `useRealtimeChat` — a render test would need most of the app's providers to
 * mount at all, which is disproportionate to this fix. Same trade as
 * `chatPanelActive.test.ts`: weaker than a render test, but it catches the
 * regressions that matter — a deletion or a guard that quietly stops firing —
 * which are visible in the source and produce no symptom anyone would notice
 * for weeks.
 */

const src = readFileSync(
  path.resolve(__dirname, "./AppShell.tsx"),
  "utf8"
);

/** The effect body, isolated so assertions can't accidentally match unrelated
 *  code elsewhere in a 600+ line file. */
const effect = src.slice(
  src.indexOf('useEffect(() => {\n    if (!chat) return;'),
  src.indexOf("}, [searchParams, pathname]);") + 30
);

describe("AppShell consumes the notification's chat instruction", () => {
  it("is guarded on the `chat` prop existing", () => {
    // The dashboard host is never given `chat` — see the prop's own doc — so a
    // stray `?chat=1` there must be inert, not open a sheet around nothing.
    expect(effect.slice(0, 40)).toContain("if (!chat) return;");
  });

  it("reads the flag and the channel from the URL, not from anywhere else", () => {
    expect(effect).toContain('searchParams.get("chat")');
    expect(effect).toContain('searchParams.get("channel")');
  });

  it("only accepts crew or planning as a channel — never news, never garbage", () => {
    expect(effect).toMatch(
      /requestedChannel === "crew" \|\| requestedChannel === "planning"/
    );
  });

  it("seeds the SAME session-memory key ChatView already reads, not a new one", () => {
    expect(effect).toContain("CHAT_SEGMENT_KEY");
    expect(effect).toContain("sessionStorage.setItem");
  });

  it("actually opens chat", () => {
    expect(effect).toContain("openChat();");
  });

  /**
   * THE STRIP. Left in the URL, `?chat=1` would re-open on every reload and
   * travel with the link to anyone it's shared with — the two behaviours the
   * brief explicitly ruled out.
   */
  it("strips both params via replace, never push", () => {
    expect(effect).toContain('params.delete("chat")');
    expect(effect).toContain('params.delete("channel")');
    expect(effect).toContain("router.replace(");
    expect(effect).not.toMatch(/router\.push\(/);
  });

  /**
   * `?tab=`/`?view=` are ADDRESSES and must survive the strip — a notification
   * landing on `?tab=comp&chat=1` should leave `?tab=comp` in place. Asserted
   * by checking the rebuild starts from the CURRENT params rather than a bare
   * pathname.
   */
  it("rebuilds from the current params rather than discarding them", () => {
    expect(effect).toContain("new URLSearchParams(searchParams.toString())");
  });
});
