import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

/**
 * `AppShell` must hold an always-mounted team-chat realtime subscription, the
 * same way it already holds Crew's — not one scoped to "chat is open."
 *
 * ── The bug this guards against, reported live ──────────────────────────────
 * Team's FIRST realtime subscription was wired inside `FloatingChatPanelInner`
 * — correct for keeping an OPEN team room live, wrong for the bottom-nav
 * unread dot, because `ChatSheet` unmounts every panel entirely when chat
 * closes (`if (!open) return null`). So the dot only updated while chat
 * happened to be open on the Team tab. Reported: a team message landed with
 * the recipient's chat panel CLOSED, and the bottom-nav Chat dot never lit.
 *
 * `AppShell`'s own header comment already states the rule this violated:
 * "chat can be closed while still needing a live unread dot, so the
 * subscription can't be scoped to 'chat is open.'" That rule was written for
 * Crew and never carried over to Team.
 *
 * ── Why a SOURCE guard ───────────────────────────────────────────────────────
 * Same trade as `chatNotificationOpen.test.ts` and `chatPanelActive.test.ts`:
 * `AppShell` wires tRPC, `GameChromeProvider` and half the app's providers, so
 * a render test is disproportionate. This catches the regressions that matter
 * — a deletion, or the call moving inside a conditionally-mounted component —
 * which are invisible in normal use for weeks (the dot just stays stale) and
 * visible in five seconds of source.
 */

const src = readFileSync(path.resolve(__dirname, "./AppShell.tsx"), "utf8");

describe("AppShell holds an always-mounted team-chat subscription", () => {
  it("calls useRealtimeChat with \"team\", not only \"trip\"", () => {
    expect(src).toMatch(/useRealtimeChat\(tripId(?: \?\? "")?, "team"/);
  });

  it("derives the team id from useMyTeamId, not a prop that could be scoped to an open panel", () => {
    expect(src).toContain("useMyTeamId(");
  });

  /**
   * THE EXACT FAILURE MODE: the team call re-appearing, but inside a
   * conditionally-rendered branch (e.g. `{chatOpen && <>...useRealtimeChat...
   * </>}`) rather than at the top level of the component. A plain `toContain`
   * on the call itself would not catch that — this checks the call sits in
   * the SAME unconditional stretch as the Crew call, which is the actual
   * guarantee "always mounted" requires.
   */
  it("sits in the same unconditional block as the Crew subscription — not behind a chat-open guard", () => {
    const crewIdx = src.indexOf('useRealtimeChat(tripId ?? "", "trip");');
    const teamIdx = src.indexOf('useRealtimeChat(tripId ?? "", "team"');
    expect(crewIdx).toBeGreaterThan(-1);
    expect(teamIdx).toBeGreaterThan(-1);
    // No conditional-render marker between the two calls — a hook cannot
    // legally sit inside a JSX conditional anyway (Rules of Hooks), so this
    // is really checking no early return or `if` was introduced between them
    // that would make the second call fire less often than the first.
    const between = src.slice(crewIdx, teamIdx);
    expect(between).not.toMatch(/\breturn\b/);
    expect(between).not.toMatch(/\bif\s*\(/);
  });
});
