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
  /** Team / identity color, e.g. "#3b82f6" or a "var(--color-bt-*)" token. */
  color: string;
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
