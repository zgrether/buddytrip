/**
 * The four-state model for "are notifications on for THIS device", and the one
 * place that decides what the toggle says.
 *
 * ── Why this is a module and not an inline ternary ──────────────────────────
 * Four states exist and only one of them belongs to us:
 *
 *   browser permission     — OS/browser owns it. We may REQUEST; we can never revoke.
 *   service worker         — the browser's, ours to register
 *   push subscription      — the browser's endpoint, mirrored as a row in `push_subscriptions`
 *   category preference    — purely ours (`users.notification_prefs`)
 *
 * Conflating any two produces the exact defects reported from a device pass: a
 * label that said "Enable" forever because it read NONE of them (it was a
 * constant — `busy ? "Enabling…" : "Enable notifications on this device"`), and
 * a toast that said "enabled" while the label disagreed on the same screen.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * ON requires all three of: permission granted, a LIVE browser subscription,
 * and a row on the server. Any one missing is OFF, because any one missing
 * means no notification arrives. Two of three is not "mostly on" — a live
 * subscription with no row means the sender has nothing to send to, and a row
 * with no live subscription means the endpoint is dead.
 *
 * A category preference is deliberately NOT an input here. Turning `scores` off
 * is not the same act as turning this device off, and treating a preference
 * flip as "disabled" is how a device keeps receiving what someone declined.
 */

export type DevicePushState =
  /** No Notification API, no service worker, or no VAPID key configured. */
  | "unsupported"
  /** Permission denied at the browser/OS level. WE CANNOT UNDO THIS — the only
   *  route back is the browser's own settings, so the UI must say so rather
   *  than offer a toggle that cannot work. */
  | "blocked"
  /** Everything is available; this device is simply not registered. */
  | "off"
  /** Permission granted AND a live subscription AND a row on the server. */
  | "on";

export interface DevicePushInputs {
  /** Notification API + service worker + a VAPID public key. */
  supported: boolean;
  /** `Notification.permission`, or null before it has been read. */
  permission: NotificationPermission | null;
  /** A live `PushSubscription` exists on this registration right now. */
  hasBrowserSubscription: boolean;
  /** The server holds a `push_subscriptions` row for THAT endpoint. */
  registeredOnServer: boolean;
}

export function deriveDevicePushState(i: DevicePushInputs): DevicePushState {
  if (!i.supported) return "unsupported";
  if (i.permission === "denied") return "blocked";
  return i.permission === "granted" && i.hasBrowserSubscription && i.registeredOnServer
    ? "on"
    : "off";
}

export interface DevicePushCopy {
  label: string;
  sub: string;
  /** False where tapping cannot achieve anything — the row still renders and
   *  still explains itself, it just isn't a button that lies. */
  actionable: boolean;
}

/**
 * What the row says. Co-located with the state so the label CANNOT drift from
 * the thing it describes — the previous label lived beside the handler and
 * described neither.
 *
 * ── "on" and "off": a NAME plus a STATE, not an instruction ──────────────────
 * These two used to read as status + instruction + disclaimer in one row —
 * "Notifications are on for this device" / "Tap to turn them off here. Your
 * other devices are unaffected." The second line explained how tapping the
 * control works (which the control's own affordance already says) and
 * pre-empted a worry nobody had (disclaiming scope tells someone it might NOT
 * have been scoped, which is the opposite of reassuring).
 *
 * Matches the shape of the row above it in the same card — "Idea archive" /
 * "Saved destinations for future trips" — a fixed name and a short
 * description. Here the "description" is the current STATE rather than a
 * static one, which is why `label` no longer varies between "on" and "off":
 * the identity of the control doesn't change, only what it currently is.
 *
 * `blocked` and `unsupported` are deliberately left in their older, fuller
 * shape — they name a REQUIRED external action (go to browser settings; try
 * the Home Screen install) rather than explaining a tap the row itself
 * performs, so the "don't explain the interaction" rule doesn't apply to them
 * the same way. Not an oversight; narrower in scope on purpose.
 */
export function devicePushCopy(state: DevicePushState): DevicePushCopy {
  switch (state) {
    case "unsupported":
      return {
        label: "Notifications aren't available here",
        sub: "This browser doesn't support push. Try adding BuddyTrip to your Home Screen.",
        actionable: false,
      };
    case "blocked":
      // Names the control to go and change, per #809 — "blocked" alone tells
      // someone the state and leaves them stuck, and this is the one state the
      // app genuinely cannot fix for them.
      return {
        label: "Notifications are blocked",
        sub: "Allow notifications for bbmi.app in your browser settings, then come back and turn them on.",
        actionable: false,
      };
    case "on":
      return {
        label: "Notifications",
        sub: "On for this device",
        actionable: true,
      };
    case "off":
      return {
        label: "Notifications",
        sub: "Off for this device",
        actionable: true,
      };
  }
}
