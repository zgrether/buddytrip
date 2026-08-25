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
 * THE ACTIVATION CONTROL, inside the notifications modal — the parent that the
 * category checkboxes sit under.
 *
 * ── Why a parent control exists at all ──────────────────────────────────────
 * The simpler design was to DERIVE activation from the categories: no parent,
 * check a box and it turns on. It cannot work. Browser push needs an OS
 * permission prompt, the prompt needs a user gesture, and it can be refused
 * PERMANENTLY. So the first check fires a prompt, the person taps Block, and
 * the result is a checked box with no notifications behind it — a control
 * asserting a state it does not have.
 *
 * The parent is also the only place the awkward states can live. Two of the
 * four are not controls at all: `blocked` and `unsupported` are EXPLANATIONS,
 * and without a parent element there is nowhere to put them. `blocked` is the
 * one most likely to be skipped and the one most needed — someone who dismissed
 * the prompt six months ago has no other way to discover why nothing arrives,
 * and nothing in the app can fix it for them.
 *
 * ── Why this is separate from `devicePushCopy` ──────────────────────────────
 * That one is the SETTINGS ROW: a name plus its current value, read at a
 * glance from a list. This is the control inside the modal, where there is room
 * to say what the act is and what happens next. Same state, two registers.
 * Sharing one string would force the row to carry the modal's explanation, or
 * the modal to carry the row's shorthand.
 */
export function activationCopy(state: DevicePushState): DevicePushCopy {
  switch (state) {
    case "unsupported":
      return {
        label: "This device doesn't support push notifications",
        sub: "Try adding BuddyTrip to your Home Screen, then open it from there.",
        actionable: false,
      };
    case "blocked":
      // Said plainly, and it names the control to go and change. The app cannot
      // re-prompt — browsers will not show the prompt again after a denial — so
      // the copy IS the entire fix available here.
      return {
        label: "Blocked in your browser settings",
        sub: "Allow notifications for bbmi.app in your browser settings, then come back here.",
        actionable: false,
      };
    case "on":
      return {
        label: "Push notifications are activated",
        sub: "Categories below are live on this device.",
        actionable: true,
      };
    case "off":
      return {
        // No sub. It said "Your browser will ask permission first", which
        // narrated the next screen instead of the control — the same class as
        // the "tap to turn them off here" line already removed from
        // `devicePushCopy`. The prompt announces itself perfectly well.
        label: "Activate push notifications on this device",
        sub: "",
        actionable: true,
      };
  }
}

/**
 * What the SETTINGS ROW says under "Notifications", so the state is readable
 * without opening the modal.
 *
 * `activeLabels` is the short name of every category currently ON, in registry
 * order — resolved by the caller, since this module deliberately knows nothing
 * about `users.notification_prefs`.
 *
 * ── This does not violate the rule at the top of this file ──────────────────
 * `deriveDevicePushState` excludes category preferences as an input, and must:
 * muting a category is not the same act as turning this device off. That rule
 * is about deriving STATE. This is a SUMMARY of an already-derived state plus
 * what it is currently delivering, which is exactly what someone wants to read
 * off a row before deciding whether to tap it.
 *
 * The `on`-with-nothing-on case is why this is a function rather than a
 * template. It must NOT say "Off": the device is activated and the sender is
 * being turned away at the preference gate, which is a different state with a
 * different fix, and collapsing the two would send someone to re-activate a
 * device that is already on.
 */
export function notificationsRowSummary(
  state: DevicePushState,
  activeLabels: readonly string[]
): string {
  switch (state) {
    case "unsupported":
      return "Not supported on this device";
    case "blocked":
      return "Blocked in browser settings";
    case "off":
      return "Off";
    case "on":
      return activeLabels.length > 0 ? activeLabels.join(", ") : "On, but every category is muted";
  }
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

// ── The self-test ───────────────────────────────────────────────────────────

/**
 * What `notifications.testSend` reports back.
 *
 * Mirrored here rather than imported from `src/server/lib/sendPush.ts`: this
 * module is client-safe and that one pulls in `web-push` and the service-role
 * client. The fields are the subset the copy below actually branches on.
 */
export interface TestSendOutcome {
  /** Successful per-DEVICE sends. */
  sent: number;
  /** Device rows found for this account. */
  subscriptionsFound: number;
  /** Sends that failed for a reason other than a dead endpoint. */
  failed: number;
  /** Dead endpoints (404/410) pruned during this send. */
  removedDead: number;
  /** VAPID keys absent — nothing was sent, and that is not an error. */
  notConfigured: boolean;
}

export interface TestSendMessage {
  message: string;
  tone: "success" | "error";
}

/**
 * What to tell someone who just tapped "Send a test notification".
 *
 * ── The distinction this copy exists to make ────────────────────────────────
 * A successful send is NOT a delivered notification, and conflating the two is
 * exactly what made the chat investigation cost a morning. `push_send_log`
 * showed 14 sends, 3 delivered, ZERO failures — every one of those "delivered"
 * rows means the push service returned 2xx, and nothing more. Whether a handset
 * ever rendered it is invisible from the server, permanently.
 *
 * So the success string does not say "it worked". It says how many devices were
 * handed a push and then names the thing the person is looking at as the real
 * result: if nothing appears, the failure is on THIS device, below the layer any
 * log can see. That sentence is the entire diagnostic value of the button —
 * without it the toast is one more thing that says success while the phone stays
 * silent.
 *
 * Ordered most-specific first: every branch above `sent > 0` is a state in which
 * the count would be zero for a reason worth naming separately, since "0 devices"
 * and "2 devices, both rejected" have completely different fixes.
 */
export function testSendMessage(r: TestSendOutcome): TestSendMessage {
  if (r.notConfigured) {
    return {
      message: "Push isn't configured on the server, so nothing was sent.",
      tone: "error",
    };
  }

  // No rows at all for this account. The activation control above is the fix,
  // and it is on the same screen — so point at it rather than explaining push.
  if (r.subscriptionsFound === 0) {
    return {
      message: "No devices are registered for your account. Activate push above, then try again.",
      tone: "error",
    };
  }

  // Every endpoint was gone (404/410) and has just been pruned. This is the one
  // failure a person can fix themselves in ten seconds, so it says how.
  if (r.sent === 0 && r.removedDead > 0) {
    const n = r.removedDead;
    return {
      message: `This device's registration had expired and ${n === 1 ? "was" : "were"} removed. Turn push off and on again above to re-register.`,
      tone: "error",
    };
  }

  if (r.sent === 0) {
    return {
      message: "The push service rejected every send. Nothing was delivered.",
      tone: "error",
    };
  }

  const devices = `${r.sent} device${r.sent === 1 ? "" : "s"}`;
  // Failures alongside successes are worth naming — a two-device account where
  // one endpoint is dead otherwise reads as a clean pass while half of it is
  // broken.
  const partial = r.failed > 0 ? ` ${r.failed} other send${r.failed === 1 ? "" : "s"} failed.` : "";
  return {
    message: `Sent to ${devices}.${partial} If nothing appears on this device within a few seconds, the push is being dropped here — not on the server.`,
    tone: "success",
  };
}
