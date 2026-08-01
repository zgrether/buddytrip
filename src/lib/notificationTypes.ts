/**
 * Notification type registry (Push Phase 2) — the SINGLE SOURCE OF TRUTH for
 * three consumers that must never disagree:
 *   1. the send-time preference filter (server: sendPush),
 *   2. the preferences UI (Phase 4) + the chat bell toggle,
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

export type NotificationKey = "scores" | "planning" | "invites" | "chat";

export interface NotificationTypeDef {
  key: NotificationKey;
  /** User-facing label (preferences UI + chat toggle aria). */
  label: string;
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
    key: "scores",
    label: "Scores & results",
    // Deliberately does NOT say "a result is posted" — that phrasing belongs to
    // `scores.upsertEntry` (a NEVER-marked site), so using it here would promise
    // the one thing this category must never send.
    description: "A game or round is finalized, or a cup is clinched.",
    defaultOn: true,
    excludes:
      "Per-hole score entry (scores.upsertEntry — a ~540/day firehose, NEVER-eligible), " +
      "pairing/roster setup, and any other per-write mechanical event. Milestones only.",
  },
  {
    key: "planning",
    label: "Trip planning",
    description: "Dates or the destination are locked, or the itinerary changes.",
    defaultOn: true,
    excludes:
      "One push per itinerary field-edit — itinerary changes are BATCH (coalesced/debounced " +
      "in Phase 3), never 1:1 with a schedule/logistics write.",
  },
  {
    key: "invites",
    label: "Invites & admin",
    description: "You're invited to a trip, added to a team, or an RSVP nudge goes out.",
    defaultOn: true,
    excludes:
      "Does not duplicate the existing crew-invite EMAIL — Phase 3 decides push-vs-email " +
      "per event, it is not automatically both.",
  },
  {
    key: "chat",
    label: "Chat messages",
    description: "New messages in any trip or team channel.",
    defaultOn: false,
    excludes:
      "Per-channel preferences — this is ONE global switch. High-volume (hundreds/day on a " +
      "live day), which is why it defaults OFF and carries an in-context bell toggle.",
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
