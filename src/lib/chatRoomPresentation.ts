import { TYPE_SCALE } from "@/lib/typeScale";
import type { ChatRoom } from "@/lib/chatRoom";

/**
 * How a `ChatRoom` is PAINTED, as opposed to `chatRoom.ts`'s vocabulary of what
 * a room IS.
 *
 * Deliberately a separate module. `chatRoom.ts` is imported by server code
 * (`messages.ts`, `chatNotify.ts`) for the room's keys and filters — the parts
 * a server has legitimate business with. Presentation (a font size, a colour
 * fallback string meant for `style={}`) has none, and folding it into the
 * shared module would mean every server import quietly carries a styling
 * dependency it never asked for. `FloatingChatPanel` is the only consumer here.
 */

/**
 * Should the message list's top fade render in this room?
 *
 * The fade (`FloatingChatPanel`'s `chat-top-fade`) paints a flat, opaque
 * `--chat-surface` colour fading to transparent, so scrolled-off content reads
 * as tucked under the chrome above rather than hard-cut. That surface is flat
 * in Crew and Organizers — the fade blends. The team room's surface is the team
 * glow, a radial gradient that is NOT a single colour and is strongest in the
 * exact corner the fade sits over, so painting the fade there doesn't blend —
 * it lays a flat, off-colour rectangle across the brightest part of the glow, a
 * hard-edged band where a soft transition belongs.
 *
 * Both devices exist to answer "is there more above, tucked under the chrome" —
 * the glow already answers it (a distinct field of colour is its own boundary),
 * so team suppresses the fade rather than inventing a third `--chat-surface`
 * value that could never be a single colour. ONE condition on the room kind,
 * not a per-surface value or a z-index reorder.
 */
export function chatRoomShowsTopFade(room: ChatRoom): boolean {
  return room.kind !== "team";
}

/**
 * The team header's text style — the team's colour on the TEXT (not only the
 * dot beside it) at `TYPE_SCALE.emphasis`, no uppercase.
 *
 * Shipped once already at 10px/uppercase/dim, which read as a section label
 * ("you are in the Team section") for a header whose actual job is closer to a
 * name, and is the one thing on the team room's chrome telling the reader this
 * room is private. Extracted as its own function — rather than left as inline
 * JSX style props — so "is this 14px in the team's colour, not 10px dim and
 * uppercase" is a value this file can assert without rendering anything.
 *
 * `color` falls back to the accent token, matching the dot beside it and
 * `myTeamColor`'s own fallback story — a team should always carry a real
 * colour by the time this renders, but a header is not where that assumption
 * should ever produce `undefined` in a style object.
 */
export function chatRoomTeamHeaderStyle(teamColor: string | null | undefined): {
  fontSize: number;
  color: string;
  textTransform: "none";
} {
  return {
    fontSize: TYPE_SCALE.emphasis,
    color: teamColor ?? "var(--color-bt-accent)",
    // Explicit "none" — not merely the absence of `uppercase` — because this
    // function replaced a literal `uppercase` class, and the previous
    // treatment is worth being able to grep for and rule out here rather than
    // only by its absence.
    textTransform: "none",
  };
}
