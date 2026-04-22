import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Swap to noreply@buddytrip.app once domain is purchased and verified
const FROM = "BuddyTrip <onboarding@resend.dev>";

const DEV_TO_EMAIL = process.env.RESEND_DEV_TO_EMAIL;

const BASE_URL =
  process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : "http://localhost:3000";

function resolveRecipient(toEmail: string): string {
  if (process.env.NODE_ENV === "development" && DEV_TO_EMAIL) {
    return DEV_TO_EMAIL;
  }
  return toEmail;
}

// ── Email for existing BuddyTrip users (already have an account) ────────

export async function sendInviteExistingUser({
  toEmail,
  toName,
  inviterName,
  tripName,
  tripId,
}: {
  toEmail: string;
  toName: string;
  inviterName: string;
  tripName: string;
  tripId: string;
}) {
  const tripUrl = `${BASE_URL}/trips/${tripId}`;

  return resend.emails.send({
    from: FROM,
    to: resolveRecipient(toEmail),
    subject: `${inviterName} added you to ${tripName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p style="margin:0 0 16px">Hey ${toName},</p>
        <p style="margin:0 0 16px">
          <strong>${inviterName}</strong> just added you to <strong>${tripName}</strong> on BuddyTrip.
        </p>
        <p style="margin:0 0 24px">
          Tap below to check it out &mdash; plans are already taking shape.
        </p>
        <a href="${tripUrl}"
           style="display:inline-block;background:#2dd4bf;color:#0d1f1a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          View Trip
        </a>
        <p style="margin:24px 0 0;color:#94a3b8;font-size:14px">
          See you there,<br/>The BuddyTrip crew
        </p>
      </div>
    `,
  });
}

// ── Email for new users (no BuddyTrip account yet) ─────────────────────

export async function sendInviteNewUser({
  toEmail,
  inviterName,
  tripName,
  token,
}: {
  toEmail: string;
  inviterName: string;
  tripName: string;
  token: string;
}) {
  const inviteUrl = `${BASE_URL}/invite?token=${token}`;

  return resend.emails.send({
    from: FROM,
    to: resolveRecipient(toEmail),
    subject: `${inviterName} invited you to join ${tripName} on BuddyTrip`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p style="margin:0 0 16px">Hey,</p>
        <p style="margin:0 0 16px">
          <strong>${inviterName}</strong> invited you to join <strong>${tripName}</strong>
          on BuddyTrip &mdash; where your crew plans the whole trip in one place.
        </p>
        <p style="margin:0 0 24px">
          Tap below to create your free account and you'll land straight on the trip.
        </p>
        <a href="${inviteUrl}"
           style="display:inline-block;background:#2dd4bf;color:#0d1f1a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          Accept Invite &amp; Sign Up
        </a>
        <p style="margin:24px 0 8px;color:#94a3b8;font-size:14px">
          BuddyTrip is free to join.
        </p>
        <p style="margin:0;color:#94a3b8;font-size:14px">
          See you there,<br/>The BuddyTrip crew
        </p>
      </div>
    `,
  });
}

