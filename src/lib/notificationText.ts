/**
 * Notification display text and labels.
 *
 * Maps notification_events.type → human-readable label and rich text
 * derived from the notification payload.
 */

export interface NotificationEvent {
  id: string;
  type: string;
  trip_id: string;
  created_at: string;
  read: boolean;
  payload?: Record<string, unknown>;
}

/** Short labels shown as notification category text */
export const NOTIFICATION_LABELS: Record<string, string> = {
  rsvp_response: "RSVP update",
  about_update: "Trip info updated",
  destination_locked: "Destination set",
  destination_changed: "Destination changed",
  dates_locked: "Dates confirmed",
  date_poll_started: "Availability poll",
  crew_added: "Added to trip",
  stage_advanced: "Trip is official",
  idea_voted: "Destination votes",
  date_poll_voted: "Date votes",
};

/** Fallback for any unmapped type */
export function getLabel(type: string): string {
  return NOTIFICATION_LABELS[type] ?? "Trip update";
}

/** Rich notification text derived from the payload */
export function getNotificationText(notification: NotificationEvent): string {
  const p = (notification.payload ?? {}) as Record<string, string>;

  switch (notification.type) {
    case "rsvp_response": {
      const statusText: Record<string, string> = {
        in: `${p.responder_name} is in for ${p.trip_name} 🎉`,
        maybe: `${p.responder_name} is a maybe for ${p.trip_name}`,
        out: `${p.responder_name} can't make ${p.trip_name}`,
      };
      return (
        statusText[p.rsvp_status] ??
        `${p.responder_name} responded to ${p.trip_name}`
      );
    }
    case "about_update":
      return `${p.updater_name} updated the trip info for ${p.trip_name}`;
    case "destination_locked":
      return `${p.trip_name} destination is set — ${p.destination_name}!`;
    case "destination_changed":
      return `${p.trip_name} destination changed to ${p.destination_name}`;
    case "dates_locked":
      return `${p.trip_name} dates are locked — ${p.date_range}. Time to book!`;
    case "date_poll_started":
      return `${p.owner_name} wants your availability for ${p.trip_name}`;
    case "crew_added":
      return p.is_self === "true"
        ? `You've been added to ${p.trip_name} by ${p.adder_name}`
        : `${p.member_name} joined ${p.trip_name}`;
    case "stage_advanced":
      return `${p.trip_name} is a go — check the Home tab for the latest`;
    case "idea_voted":
      return `${p.voter_name} and others voted on destination ideas for ${p.trip_name}`;
    case "date_poll_voted":
      return `${p.voter_name} and others voted on dates for ${p.trip_name}`;
    default:
      return "Trip update";
  }
}

/** Relative time string — no external deps */
export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
