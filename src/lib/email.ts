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

// ── Invitation blast — owner sends trip invitation to selected crew ─────

export async function sendInvitationBlast({
  toEmail,
  toName,
  ownerName,
  tripTitle,
  invitationMessage,
  tripId,
}: {
  toEmail: string;
  toName: string;
  ownerName: string;
  tripTitle: string;
  invitationMessage: string;
  tripId: string;
}) {
  const tripUrl = `${BASE_URL}/trips/${tripId}`;

  return resend.emails.send({
    from: FROM,
    to: resolveRecipient(toEmail),
    subject: `${ownerName} invited you to ${tripTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p style="margin:0 0 16px">Hey ${toName},</p>
        <p style="margin:0 0 16px;white-space:pre-wrap">${invitationMessage}</p>
        <p style="margin:0 0 24px">
          Tap below to check it out &mdash; see what&apos;s planned so far.
        </p>
        <a href="${tripUrl}"
           style="display:inline-block;background:#2dd4bf;color:#0d1f1a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          View Trip
        </a>
        <p style="margin:24px 0 0;color:#94a3b8;font-size:14px">
          See you there,<br/>${ownerName}
        </p>
      </div>
    `,
  });
}

// ── Beta feedback — straight to the founder inbox ──────────────────────
//
// Best-effort send: the caller catches and swallows errors so a flaky
// SMTP path never blocks the user. The inbox IS the queue (no DB
// persistence for v1) so the routing to FEEDBACK_TO_EMAIL is the whole
// pipeline. Missing config (no API key, no destination) is reported as a
// thrown error so the caller can decide whether to log it.

const FEEDBACK_TO_EMAIL = process.env.FEEDBACK_TO_EMAIL;

const FEEDBACK_CATEGORY_LABEL: Record<string, string> = {
  bug: "Bug",
  idea: "Idea",
  confusing: "Confusing",
  love: "Love it",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendFeedback({
  category,
  message,
  replyTo,
  screen,
  tripLabel,
  platform,
  build,
  reporterName,
  reporterEmail,
}: {
  category: "bug" | "idea" | "confusing" | "love";
  message: string;
  replyTo?: string | null;
  screen?: string | null;
  tripLabel?: string | null;
  platform?: string | null;
  build?: string | null;
  reporterName?: string | null;
  reporterEmail?: string | null;
}) {
  if (!FEEDBACK_TO_EMAIL) {
    throw new Error("FEEDBACK_TO_EMAIL not configured");
  }

  const label = FEEDBACK_CATEGORY_LABEL[category] ?? category;
  const subject = `[BuddyTrip beta] ${label}: ${message.slice(0, 60).replace(/\s+/g, " ")}`;

  const ctxRows: Array<[string, string]> = [];
  if (reporterName) ctxRows.push(["From", reporterName]);
  if (reporterEmail) ctxRows.push(["Account", reporterEmail]);
  if (replyTo && replyTo !== reporterEmail) ctxRows.push(["Reply-to", replyTo]);
  if (screen) ctxRows.push(["Screen", screen]);
  if (tripLabel) ctxRows.push(["Trip", tripLabel]);
  if (platform) ctxRows.push(["Platform", platform]);
  if (build) ctxRows.push(["Build", build]);

  const ctxHtml = ctxRows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#64748b;font-size:12px">${escapeHtml(k)}</td><td style="padding:2px 0;font-size:12px;color:#0f172a">${escapeHtml(v)}</td></tr>`,
    )
    .join("");

  return resend.emails.send({
    from: FROM,
    to: FEEDBACK_TO_EMAIL,
    // Drop replyTo into the email headers so hitting Reply in the inbox
    // goes straight back to the user (instead of the noreply sender).
    replyTo: replyTo || undefined,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <p style="margin:0 0 4px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em">${escapeHtml(label)}</p>
        <p style="margin:0 0 16px;white-space:pre-wrap;color:#0f172a;font-size:15px;line-height:1.5">${escapeHtml(message)}</p>
        ${ctxRows.length ? `<table style="margin:16px 0 0;border-top:1px solid #e2e8f0;padding-top:12px">${ctxHtml}</table>` : ""}
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

