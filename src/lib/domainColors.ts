import type { TabId } from "@/components/BottomNav";

/**
 * Domain-color system — single source of truth.
 *
 * Each trip area owns ONE color, surfaced in three reinforcing places:
 *   1. the active tab (icon + label + 2px bottom border),
 *   2. the page-header eyebrow (the small ALL-CAPS label above the H1), and
 *   3. item accents (content icon-chips, itinerary filter dots).
 *
 * Color marks, never floods: inactive tabs and all H1 titles stay neutral.
 *
 * The hex/rgba values live as `--color-bt-domain-*` tokens in globals.css;
 * this module maps each area to those tokens. Changing one entry (here or
 * the token it points at) reskins that area everywhere it appears.
 *
 * Shared hues point at where the data actually lives:
 *   - Travel borrows Crew rose — arrivals are per-person crew data.
 *   - Events borrows Competition amber — events belong to the competition.
 *
 * NOTE: per-person team-member avatar colors are a SEPARATE system
 * (team hues) and are intentionally not part of this map.
 */
export type Domain =
  | "home"
  | "crew"
  | "lodging"
  | "agenda"
  | "travel"
  | "events"
  | "receipts"
  | "competition";

export interface DomainColor {
  /** Solid hue — active tab icon/label/border, eyebrow text, item glyph. */
  color: string;
  /** Faint fill — icon-chip background, active filter-pill background. */
  faint: string;
}

export const DOMAIN_COLORS: Record<Domain, DomainColor> = {
  home: {
    color: "var(--color-bt-domain-home)",
    faint: "var(--color-bt-domain-home-faint)",
  },
  crew: {
    color: "var(--color-bt-domain-crew)",
    faint: "var(--color-bt-domain-crew-faint)",
  },
  lodging: {
    color: "var(--color-bt-domain-lodging)",
    faint: "var(--color-bt-domain-lodging-faint)",
  },
  agenda: {
    color: "var(--color-bt-domain-agenda)",
    faint: "var(--color-bt-domain-agenda-faint)",
  },
  travel: {
    color: "var(--color-bt-domain-travel)",
    faint: "var(--color-bt-domain-travel-faint)",
  },
  events: {
    color: "var(--color-bt-domain-events)",
    faint: "var(--color-bt-domain-events-faint)",
  },
  receipts: {
    color: "var(--color-bt-domain-receipts)",
    faint: "var(--color-bt-domain-receipts-faint)",
  },
  competition: {
    color: "var(--color-bt-domain-competition)",
    faint: "var(--color-bt-domain-competition-faint)",
  },
};

/**
 * Maps a TripTabBar / BottomNav TabId to its domain. Tab ids diverge from
 * domain names for historical reasons (schedule→agenda, expenses→receipts,
 * comp→competition).
 */
export const TAB_DOMAIN: Record<TabId, Domain> = {
  home: "home",
  crew: "crew",
  lodging: "lodging",
  schedule: "agenda",
  expenses: "receipts",
  comp: "competition",
};
