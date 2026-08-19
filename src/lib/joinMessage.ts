/**
 * The crew-join line — ONE row, rendered two ways.
 *
 * | Audience              | Text                                                          |
 * |-----------------------|---------------------------------------------------------------|
 * | Everyone else         | `Antman has now joined the chat`                              |
 * | The person who joined | `Hey Antman, welcome to the chat, feel free to introduce yourself.` |
 *
 * Two rows would be the obvious build and would be wrong: it doubles the
 * transcript, and it means everyone reads a greeting addressed to someone
 * else. So the row is written once (third person, in `text`) with the JOINER
 * on `messages.user_id`, and the viewer-specific wording is derived at render.
 *
 * **What this copy deliberately does NOT say.** A new member's Crew chat opens
 * empty — `chat_visible_from` gates history, and that gate is correct: someone
 * scrolling back through sixteen people's unfiltered conversation may find
 * discussion about themselves, and that can't be undone. The tempting fix is
 * to explain the emptiness ("earlier messages aren't shown"), and it makes a
 * claim that is often FALSE — on a trip that just went live, or a quiet group,
 * there was never any prior conversation, and the sentence invents a mystery
 * that doesn't exist. A welcome reads as a beginning and is true either way.
 *
 * Names resolve at render, not at write, so a nickname change doesn't leave a
 * stale name in the transcript.
 */

/** The stored, third-person form. What everyone but the joiner reads. */
export function joinNoticeText(name: string): string {
  return `${name} has now joined the chat`;
}

/**
 * The greeting the joiner reads in place of their own notice.
 *
 * First name only — "Hey Zach," is how a person writes and "Hey Zach Grether,"
 * is not, while the third-person line keeps the full display name because that
 * is how you refer to someone rather than address them. With no resolvable
 * name it drops the address entirely rather than greeting "Hey Unknown".
 */
export function joinWelcomeText(name: string | null | undefined): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first
    ? `Hey ${first}, welcome to the chat, feel free to introduce yourself.`
    : "Welcome to the chat, feel free to introduce yourself.";
}

/**
 * What a given viewer should read for a system row.
 *
 * The branch, not just the strings, lives here — a render-time `if` inside a
 * component is the part that can't be tested without a DOM, and it is the part
 * that decides whether someone is greeted or told about a stranger.
 *
 * `subjectUserId` is `messages.user_id` on a system row: null for lifecycle
 * lines that are about the trip rather than a person (a promotion notice, a
 * game going live), which fall through to the stored text unchanged.
 */
export function systemLineForViewer(args: {
  /** The row's stored text — the third-person form. */
  text: string;
  /** `messages.user_id` on the system row: who it is ABOUT, or null. */
  subjectUserId: string | null | undefined;
  /** The signed-in viewer, or undefined before auth resolves. */
  viewerId: string | null | undefined;
  /** The subject's current display name, resolved from the roster at render. */
  subjectName: string | null | undefined;
}): string {
  const { text, subjectUserId, viewerId, subjectName } = args;
  if (!subjectUserId || !viewerId || subjectUserId !== viewerId) return text;
  return joinWelcomeText(subjectName);
}
