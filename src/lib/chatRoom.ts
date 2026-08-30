import { z } from "zod";

/**
 * A chat ROOM — the thing a person reads, is notified about, and has a read
 * position in.
 *
 * ── Why this exists rather than a `visibility` string threaded everywhere ──
 *
 * Team chat added a fourth room, and four separate sites key on which room they
 * are talking about: the notification audience query, the `chat_reads` filter,
 * the deep-link URL, and the notification tag. Before this module each of those
 * held its own `"crew" | "planning"` literal, so the delta between four lists
 * that happened to agree WAS the bug waiting to happen — the same shape
 * CLAUDE.md #22 records for chat's realtime invalidation, where two key lists
 * that matched by coincidence produced "you don't see it until you post".
 *
 * One type, one key function, one row mapping. A fifth room is added here.
 *
 * ── Why `visibility` names the room, and the vocabulary hazard ─────────────
 *
 * `chat_reads.visibility` carries the room ('crew' | 'planning' | 'team').
 * `messages.visibility` carries the trip channel's SUB-CHANNEL ('crew' |
 * 'planning') and never 'team' — a team message is `channel='team'` with
 * `visibility='crew'`, because team chat does not split.
 *
 * So the two columns share a name and do NOT share a value set, which is a real
 * trap for anyone who assumes they can be compared. They are never joined:
 * read state is filtered on `chat_reads`, messages on `channel` + `team_id`.
 * `chatRoomReadRow` is the ONLY place that turns a room into `chat_reads`
 * columns, and `chatRoomMessageFilter` the only place it becomes a `messages`
 * filter — so the mapping is written once and the trap has one place to be
 * sprung rather than four.
 */

export const CHAT_ROOM_KINDS = ["crew", "planning", "team"] as const;
export type ChatRoomKind = (typeof CHAT_ROOM_KINDS)[number];

export type ChatRoom =
  | { kind: "crew" }
  | { kind: "planning" }
  | { kind: "team"; teamId: string };

/**
 * Wire shape for a room, and the pairing invariant.
 *
 * The refine mirrors the DB's `chk_chat_reads_team_channel`
 * (`(visibility = 'team') = (team_id IS NOT NULL)`) — deliberately the same rule
 * stated at both ends, so a caller that gets it wrong is refused by zod with a
 * readable message instead of by a CHECK with a constraint name.
 *
 * Note it refuses BOTH halves: a team room with no team, and a crew/planning
 * room that has acquired one. Only checking the first would let a stray teamId
 * ride along on a Crew read and silently write a row nothing reads back.
 */
/**
 * The wire field is `visibility`, NOT `kind`, deliberately: it is the name of
 * the `chat_reads` column it lands in, and every existing caller
 * (`markRead({ visibility: "crew" })`) keeps working unchanged. Renaming it
 * would have been a display-string-tier churn across a dozen call sites and
 * every chat test, to make the wire disagree with the column it writes.
 *
 * `ChatRoom` uses `kind` internally so the union discriminates cleanly and so
 * nothing confuses a ROOM with `messages.visibility`, which is a different value
 * set — see the header.
 */
export const ChatRoomInput = z
  .object({
    visibility: z.enum(CHAT_ROOM_KINDS).default("crew"),
    teamId: z.string().optional(),
  })
  .refine((v) => (v.visibility === "team") === (v.teamId != null), {
    message: "teamId is required for the team room, and allowed only there",
    path: ["teamId"],
  });

export type ChatRoomInputShape = z.infer<typeof ChatRoomInput>;

/** Narrow the wire shape to the discriminated union. */
export function toChatRoom(input: ChatRoomInputShape): ChatRoom {
  return input.visibility === "team"
    ? { kind: "team", teamId: input.teamId! }
    : { kind: input.visibility };
}

/**
 * A stable string identifying the room.
 *
 * Used for React Query keys, the notification `tag`, the deep-link `channel`
 * param, and as the key of the per-room maps `readState` / unread counts
 * return. One function so a tag and a query key cannot describe the same room
 * differently — which is how a notification replaces the wrong one.
 */
export function chatRoomKey(room: ChatRoom): string {
  return room.kind === "team" ? `team:${room.teamId}` : room.kind;
}

/** Inverse of `chatRoomKey`, for reading a room back out of a URL param. */
export function parseChatRoomKey(key: string): ChatRoom | null {
  if (key === "crew" || key === "planning") return { kind: key };
  if (key.startsWith("team:")) {
    const teamId = key.slice("team:".length);
    return teamId ? { kind: "team", teamId } : null;
  }
  return null;
}

export function isTeamRoom(room: ChatRoom): room is { kind: "team"; teamId: string } {
  return room.kind === "team";
}

/**
 * The room as `chat_reads` columns — the ONE place a room becomes read-state.
 *
 * `team_key` is generated in the database and must never be written here; it is
 * the conflict target, not a payload column.
 */
export function chatRoomReadRow(room: ChatRoom): {
  visibility: ChatRoomKind;
  team_id: string | null;
} {
  return {
    visibility: room.kind,
    team_id: room.kind === "team" ? room.teamId : null,
  };
}

/**
 * The room as a `messages` filter — the ONE place a room becomes a message
 * query.
 *
 * Note the asymmetry with `chatRoomReadRow` and why it is not a bug: a team
 * message is `channel='team'` + `visibility='crew'`, so `visibility` here is
 * the trip channel's sub-channel and is only meaningful when `channel='trip'`.
 * Callers filter on `visibility` only in that case; see `messages.list`.
 */
export function chatRoomMessageFilter(room: ChatRoom): {
  channel: "trip" | "team";
  visibility: "crew" | "planning";
  team_id: string | null;
} {
  if (room.kind === "team") {
    return { channel: "team", visibility: "crew", team_id: room.teamId };
  }
  return { channel: "trip", visibility: room.kind, team_id: null };
}

/** Human label for the room's tab and notification title. */
export function chatRoomLabel(room: ChatRoom, teamName?: string | null): string {
  if (room.kind === "team") return teamName ?? "Team";
  // "Organizers" is the ratified term (glossary + NOTIFICATIONS.md). It is not
  // shortened to fit a four-tab bar — the bar is made to fit instead.
  return room.kind === "planning" ? "Organizers" : "Crew";
}
