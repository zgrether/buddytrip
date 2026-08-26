/**
 * Chat text size — S · M · L, a per-account reading preference for the
 * transcript, and the direct version of the argument that decided the iOS
 * input-zoom fix: several BBMI crew are older, chat is the densest reading
 * surface in the app, and that isn't a hypothetical audience — it's specific
 * people on this trip.
 *
 * ── Scope: CHAT ONLY, and that is a decision, not an oversight ────────────
 * Every other surface in the app is laid out against the shared type scale
 * (`src/lib/typeScale.ts`) — a global multiplier would mean re-checking every
 * one of those layouts. Chat is bounded (one component tree,
 * `FloatingChatPanel`/`ChatBody`) and is where the dense reading actually
 * happens, so the scope stays there. If this works well, app-wide is a later,
 * separate conversation — not a larger version of this change.
 *
 * ── Scope: MESSAGE TEXT ONLY, not the composer ─────────────────────────────
 * The composer textarea is deliberately UNCHANGED by this setting. Two
 * reasons, not one:
 *   1. No safety floor to protect — the composer already sits at 16px on
 *      mobile (the iOS input-zoom fix), and this ladder only goes UP from S.
 *      Nothing here can push it below that floor regardless.
 *   2. It's the right reading of what the control is FOR: you're changing
 *      what you READ, not what you TYPE. The composer is muscle memory at a
 *      fixed size; the transcript is the thing eyesight actually struggles
 *      with.
 *
 * ── Global, not per-trip ────────────────────────────────────────────────
 * One stored value, no `tripId`/`visibility` in the key — unlike
 * `chatBannerCollapse`'s per-channel keys. Eyesight doesn't change when you
 * switch trips or channels, so scoping this any narrower would mean
 * re-picking L on every new trip for no reason.
 *
 * ── The idiom ────────────────────────────────────────────────────────────
 * `bt.<name>.v1`, matching `chatDraft` / `chatCache` / `chatFailedOutbox` /
 * `chatBannerCollapse`. Deliberately not a second pattern.
 */

export type ChatTextSize = "S" | "M" | "L";

export const CHAT_TEXT_SIZES: readonly ChatTextSize[] = ["S", "M", "L"];

/**
 * S is not "the small option" — S IS today's rendering, byte-identical.
 * Defaulting here is what makes the whole feature a no-op for anyone who
 * never touches the control: `chatTextScale("S") === 1`, so every derived
 * pixel value below equals the value already shipping.
 */
export const DEFAULT_CHAT_TEXT_SIZE: ChatTextSize = "S";

const NS = "bt.chatTextSize.v1";

interface SizeEnvelope {
  v: 1;
  size: ChatTextSize;
}

function isChatTextSize(v: unknown): v is ChatTextSize {
  return v === "S" || v === "M" || v === "L";
}

/**
 * The stored size, or `DEFAULT_CHAT_TEXT_SIZE` on ANY failure — absent,
 * unparseable, wrong version, or a value outside S/M/L. Unlike
 * `chatBannerCollapse`, this DOES read the stored content (the value itself
 * is the whole point), so it needs real validation rather than presence-only
 * — a corrupt entry here must fall back to a value the render code actually
 * knows how to draw, not merely to "some string that happened to be there".
 */
export function readChatTextSize(): ChatTextSize {
  if (typeof window === "undefined") return DEFAULT_CHAT_TEXT_SIZE;
  try {
    const raw = window.localStorage.getItem(NS);
    if (raw === null) return DEFAULT_CHAT_TEXT_SIZE;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_CHAT_TEXT_SIZE;
    const env = parsed as Partial<SizeEnvelope>;
    if (env.v !== 1) return DEFAULT_CHAT_TEXT_SIZE; // a different version: discard, never migrate
    return isChatTextSize(env.size) ? env.size : DEFAULT_CHAT_TEXT_SIZE;
  } catch {
    return DEFAULT_CHAT_TEXT_SIZE;
  }
}

/** Persist the chosen size. Best-effort — a failed write just means the next
 *  load falls back to S, which is a real, working state, not a broken one. */
export function writeChatTextSize(size: ChatTextSize): void {
  if (typeof window === "undefined") return;
  try {
    const env: SizeEnvelope = { v: 1, size };
    window.localStorage.setItem(NS, JSON.stringify(env));
  } catch {
    // best-effort
  }
}

/**
 * The multiplier for a size: 1× / 1.5× / 2×.
 *
 * ONE ratio, applied uniformly to every scaled role (message text, timestamp,
 * sender name, day-separator label) — not a separate hand-picked pixel value
 * per role per size. That's what guarantees a day separator can never read
 * "Tuesday" at a size visually out of step with the message stamped "Wed"
 * beneath it: both are the same base pixel value times the same factor.
 *
 * 1 / 1.5 / 2 rather than a gentler curve, because the brief for this control
 * was explicit that L needs to be STARTLING to someone who doesn't need it —
 * "L should look startlingly large to a 40-year-old and normal to a
 * 70-year-old" — and a modest step optimises for the person the control isn't
 * for. 3x was considered and rejected: past 2x you're probably not playing
 * golf, and the layout cost stops being worth it for a size nobody asked for.
 *
 * Verified against a rendered mock at both a 390px (mobile sheet) and 340px
 * (the persistent desktop aside, which is actually the NARROWER of the two
 * real containers) width before this ladder was finalized: bubbles, padding,
 * timestamps and day separators all hold up at 2x without breaking into a
 * different layout mode. See the PR description for the screenshots — L stays
 * a font-size multiplier, not a layout change.
 */
export function chatTextScale(size: ChatTextSize): number {
  switch (size) {
    case "S":
      return 1;
    case "M":
      return 1.5;
    case "L":
      return 2;
  }
}

/**
 * Base (S-size, i.e. today's) pixel values for each role in the transcript
 * that scales. Deliberately off the app-wide `TYPE_SCALE` (`typeScale.ts`) —
 * this is an accessibility ladder, not a density choice, and STYLE_GUIDE §2a
 * already says an off-scale size is fine as long as it says why: this is why.
 */
export const CHAT_BASE_PX = {
  /** The bubble text itself — Tailwind's `text-sm` today (14px). */
  message: 14,
  /** Timestamp, sender name, and the "Not sent / Retry / Discard" row —
   *  all the same size today (`text-[10px]`), so they share one base. */
  meta: 10,
  /** The day-separator and "New"-divider uppercase labels — also 10px today,
   *  kept as its own named constant rather than reusing `meta` because the
   *  two roles are visually unrelated even though they start at the same
   *  number; a future change to one should not have to remember it also
   *  changes the other. */
  label: 10,
} as const;

/** `base` scaled to `size` and rounded to a whole pixel. Every pairing here
 *  (14/1, 14/1.5, 14/2, 10/1, 10/1.5, 10/2) happens to land on an exact
 *  integer already — rounding is defensive, not currently load-bearing. */
export function chatPx(basePx: number, size: ChatTextSize): number {
  return Math.round(basePx * chatTextScale(size));
}
