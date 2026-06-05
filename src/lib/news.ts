import { z } from "zod";

// ── News block model ──────────────────────────────────────────────────────
//
// A News post is an ordered stack of BLOCKS. There are exactly SIX block
// types and the set is CLOSED — do not add poll/table/quote/divider/heading/
// free-color blocks. If a use case seems unmet it maps to one of these six.
// (See design/design_handoff_news/SPEC-news.md.)
//
// Blocks are stored as a JSONB array on news_posts.blocks. This module is the
// single source of truth for their shape; the DB treats them as opaque JSON,
// so the union can evolve without a schema migration.

/** A person reference — avatar pill. `userId` links to the trip roster when
 *  the mention was picked from autocomplete; name/initials/color are
 *  denormalized so a post renders without a roster round-trip. */
export interface NewsPerson {
  userId?: string | null;
  name: string;
  initials: string;
  /** The member's competition TEAM color (hex), or null when they aren't on a
   *  team. Only a real team assignment produces a color — there's no palette
   *  fallback, so a member with no team renders the standard app avatar. */
  color?: string | null;
  /** The member's chosen Tabler avatar icon id, so the pill shows the same
   *  avatar as everywhere else in the app. Null/absent → initials fallback. */
  avatarIcon?: string | null;
}

/** A team card in the draw — synced from the Competition feature. */
export interface NewsTeam {
  name: string;
  color: string;
  players: string[];
}

/** One step in a numbered how-to. */
export interface NewsStep {
  label: string;
  body: string;
}

/** A run of text: a plain string, or a mention pill inline. */
export type NewsSegment = string | { mention: NewsPerson };

// ── The six blocks ──────────────────────────────────────────────────────

/** A paragraph. `segments` carries inline @Crew mentions; `text` is the
 *  plain-string fast path. `dim` renders it in the muted text color. */
export interface NewsTextBlock {
  type: "text";
  text?: string;
  segments?: NewsSegment[];
  dim?: boolean;
}

/** A labeled row of people pills ("Captains", "Pairing"). */
export interface NewsCrewBlock {
  type: "crew";
  label?: string;
  people: NewsPerson[];
}

/** The competition draw — team cards. Synced from Competition, never retyped. */
export interface NewsTeamsBlock {
  type: "teams";
  /** Competition event id the draw was pulled from (for re-sync). */
  eventId?: string | null;
  teams: NewsTeam[];
}

/** A photo, or a pasted video link rendered as a card. */
export interface NewsMediaBlock {
  type: "media";
  kind: "video" | "photo";
  /** Video: the source URL. Photo: the stored image URL (PR-later). */
  src?: string | null;
  /** Video card title + meta line. */
  title?: string;
  meta?: string;
  /** Photo placeholder caption when no image has been uploaded yet. */
  ph?: string;
}

/** A numbered how-to (rules, scoring, logistics). */
export interface NewsStepsBlock {
  type: "steps";
  steps: NewsStep[];
}

/** One highlighted line — preset caution-amber, no color choice. */
export interface NewsCalloutBlock {
  type: "callout";
  text: string;
}

export type NewsBlock =
  | NewsTextBlock
  | NewsCrewBlock
  | NewsTeamsBlock
  | NewsMediaBlock
  | NewsStepsBlock
  | NewsCalloutBlock;

export type NewsBlockType = NewsBlock["type"];

/** A post as returned by the news router. */
export interface NewsPost {
  id: string;
  tripId: string;
  authorId: string;
  blocks: NewsBlock[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The closed set, in composer/catalog order. */
export const NEWS_BLOCK_TYPES: NewsBlockType[] = [
  "text",
  "crew",
  "teams",
  "media",
  "steps",
  "callout",
];

// ── Validation ──────────────────────────────────────────────────────────────
//
// Server-side guard that a post's blocks are exactly the closed six types and
// well-formed. The DB stores blocks as opaque JSON, so this schema is the only
// thing enforcing the "closed set" invariant on write. Keep it in lockstep
// with the NewsBlock union above.

const personSchema = z.object({
  userId: z.string().nullish(),
  name: z.string().min(1).max(80),
  initials: z.string().min(1).max(4),
  color: z.string().min(1).max(40).nullish(),
  avatarIcon: z.string().max(50).nullish(),
});

const segmentSchema = z.union([
  z.string(),
  z.object({ mention: personSchema }),
]);

export const newsBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string().max(5000).optional(),
    segments: z.array(segmentSchema).max(200).optional(),
    dim: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("crew"),
    label: z.string().max(60).optional(),
    people: z.array(personSchema).max(50),
  }),
  z.object({
    type: z.literal("teams"),
    eventId: z.string().nullish(),
    teams: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          color: z.string().min(1).max(40),
          players: z.array(z.string().max(80)).max(40),
        })
      )
      .max(20),
  }),
  z.object({
    type: z.literal("media"),
    kind: z.enum(["video", "photo"]),
    src: z.string().max(2000).nullish(),
    title: z.string().max(200).optional(),
    meta: z.string().max(200).optional(),
    ph: z.string().max(120).optional(),
  }),
  z.object({
    type: z.literal("steps"),
    steps: z
      .array(
        z.object({
          label: z.string().max(120),
          body: z.string().max(2000),
        })
      )
      .max(30),
  }),
  z.object({
    type: z.literal("callout"),
    text: z.string().min(1).max(500),
  }),
]);

/** A post's full block stack. Capped so a single post can't be unbounded. */
export const newsBlocksSchema = z.array(newsBlockSchema).min(1).max(50);
