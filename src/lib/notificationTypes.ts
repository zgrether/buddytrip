/**
 * Notification type registry (Push Phase 2) — the SINGLE SOURCE OF TRUTH for
 * three consumers that must never disagree:
 *   1. the send-time preference filter (server: sendPush),
 *   2. the preferences UI — profile → Preferences, the ONE entry point,
 *   3. Phase 3's call sites at domain write points.
 * A call site sending a key the UI doesn't toggle = someone gets notified
 * about something they switched off, which is how people disable notifications
 * at the OS level, permanently. So NOTHING hardcodes a type string — everything
 * imports from here.
 *
 * Client-safe (no server/DB deps): both the browser UI and the server helper
 * import this module.
 *
 * The `excludes` field is LOAD-BEARING, not documentation. Categories are
 * coarse on purpose (4 switches, not 30), which means a category can contain
 * both a milestone (`games.finish`, ~5-15/day) and a firehose
 * (`scores.upsertEntry`, ~540/day). `excludes` names what must NEVER be wired
 * to the category so the firehose can't drift into it. The per-write-site
 * eligibility (ELIGIBLE / BATCH / NEVER) lives in NOTIFICATIONS.md.
 */

export type NotificationKey = "game_results" | "planning" | "invites" | "chat" | "news";

export interface NotificationTypeDef {
  key: NotificationKey;
  /** User-facing label (preferences UI + chat toggle aria). */
  label: string;
  /**
   * The same name, short enough to LIST. The settings row summarises what is on
   * ("Game events, Chat"), and the full labels do not fit — "Competition & game
   * alerts, Chat messages" truncates to nonsense in a row that is already
   * `truncate`d.
   *
   * A second field rather than a second literal at the call site, for the reason
   * the registry exists at all: two names for one category, maintained in two
   * places, is how a rename lands in one of them. The key is still never shown.
   */
  shortLabel: string;
  /** One-line description shown under the label. */
  description: string;
  /** Registry default when the user has no stored preference for this key. */
  defaultOn: boolean;
  /** LOAD-BEARING: what this category does NOT cover. Guards against a
   *  high-frequency mechanical write drifting into a milestone category. */
  excludes: string;
}

export const NOTIFICATION_TYPES: readonly NotificationTypeDef[] = [
  {
    // NOT `scores` — the old name WAS the bug. It reads as "every score
    // entered", which is precisely what this category must never send:
    // `scores.upsertEntry` / `deleteEntry` are NEVER-marked (~540/day), and
    // wiring one is how you lose thirty phones' permissions in an afternoon.
    // `game_results` says what actually fires and cannot be misread.
    // No stored row ever held the old key (verified against production: 0 of 88
    // users), so the rename needed no jsonb migration.
    key: "game_results",
    label: "Competition & game alerts",
    shortLabel: "Game events",
    // Deliberately does NOT say "a result is posted" — that phrasing belongs to
    // `scores.upsertEntry` (a NEVER-marked site), so using it here would promise
    // the one thing this category must never send.
    description: "A game finishes, or the cup is decided.",
    defaultOn: true,
    excludes:
      "Per-hole score entry (scores.upsertEntry — a ~540/day firehose, NEVER-eligible), " +
      "pairing/roster setup, and any other per-write mechanical event. Milestones only.",
  },
  {
    key: "planning",
    label: "Trip planning",
    shortLabel: "Trip planning",
    description: "Dates or the destination are locked, or the itinerary changes.",
    defaultOn: true,
    excludes:
      "One push per itinerary field-edit — itinerary changes are BATCH (coalesced/debounced " +
      "in Phase 3), never 1:1 with a schedule/logistics write.",
  },
  {
    key: "invites",
    label: "Invites & admin",
    shortLabel: "Invites",
    description: "You're invited to a trip, added to a team, or an RSVP nudge goes out.",
    defaultOn: true,
    excludes:
      "Does not duplicate the existing crew-invite EMAIL — Phase 3 decides push-vs-email " +
      "per event, it is not automatically both.",
  },
  {
    key: "chat",
    label: "Chat messages",
    shortLabel: "Chat",
    description: "New messages in any trip or team channel.",
    // ON, like every other category. THE DEVICE TOGGLE IS THE CONSENT GATE:
    // enabling notifications is a deliberate act, and the category list shown at
    // that moment is a menu of what you can MUTE — not a set of things to hunt
    // for and switch on. A category defaulting OFF means someone enables
    // notifications and receives nothing, which reads as broken rather than as
    // respectful.
    //
    // This flipped from OFF, which was set when volume was the only
    // consideration. Free to change: the only stored `chat` values in production
    // are two test rows, both already `true`.
    defaultOn: true,
    excludes:
      "Per-channel preferences — this is ONE global switch, muted from profile → Preferences " +
      "and nowhere else. High-volume (hundreds/day on a live day), which is why muting it has " +
      "to be easy to find rather than why it starts off.",
  },
  {
    // NOTIFICATIONS.md's own history is worth repeating here: this category
    // was filed under `planning` until an Aug 2026 correction, on the
    // reasoning that folding News into `chat` (or `planning`) mutes the
    // highest-signal non-scoring notification in the app for anyone who mutes
    // the firehose it would be sharing a switch with. It gets its own key for
    // the same reason `game_results` was split out of a generic `scores` name
    // — a category has to be nameable by what it actually sends, or someone
    // reading the settings list can't predict what toggling it does.
    key: "news",
    label: "News posts",
    shortLabel: "News",
    description: "An organizer posts to the Trip Board.",
    defaultOn: true,
    excludes:
      "Nothing else rides this key — News is the ONLY write site. ~1-5/trip, " +
      "organizer-authored, and there is no mechanical/per-write event anywhere " +
      "near this category the way scores.upsertEntry sits near game_results.",
  },
];

/** All valid keys, in registry order. */
export const NOTIFICATION_KEYS: readonly NotificationKey[] = NOTIFICATION_TYPES.map(
  (t) => t.key
);

const BY_KEY = new Map<string, NotificationTypeDef>(
  NOTIFICATION_TYPES.map((t) => [t.key, t])
);

/** Narrowing guard — reject anything not in the registry (used by setPreference
 *  so an unknown key can never be stored). */
export function isNotificationKey(key: string): key is NotificationKey {
  return BY_KEY.has(key);
}

/** The registry default for a key (false for an unknown key). */
export function notificationDefault(key: NotificationKey): boolean {
  return BY_KEY.get(key)?.defaultOn ?? false;
}

/** Stored preferences map (partial — only keys the user explicitly set). */
export type NotificationPrefs = Partial<Record<NotificationKey, boolean>>;

/**
 * Effective on/off for a key: the user's stored value if set, else the registry
 * default. This is why the migration stores `{}` and never backfills — an unset
 * key resolves to its default here, so adding a new type needs no migration.
 */
export function isTypeEnabled(
  prefs: NotificationPrefs | null | undefined,
  key: NotificationKey
): boolean {
  const stored = prefs?.[key];
  return typeof stored === "boolean" ? stored : notificationDefault(key);
}

/** Full effective map for every registry key (for the preferences UI). */
export function resolvePrefs(
  prefs: NotificationPrefs | null | undefined
): Record<NotificationKey, boolean> {
  const out = {} as Record<NotificationKey, boolean>;
  for (const key of NOTIFICATION_KEYS) out[key] = isTypeEnabled(prefs, key);
  return out;
}
