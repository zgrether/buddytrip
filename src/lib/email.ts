import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const DEV_TO_EMAIL = process.env.RESEND_DEV_TO_EMAIL;

// Canonical site origin (https://bbmi.app in prod). Drives invite/trip links in
// emails — must be the real public domain, not the ephemeral per-deployment
// VERCEL_URL (which previously left these links pointing at localhost in prod).
const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Resolves the FROM address at send time — not at import time — so a missing
 * var fails the send, not the module load (any feature that doesn't touch email
 * keeps working in dev even without RESEND_FROM set).
 *
 * - prod / preview (NODE_ENV !== "development"): throws. There is no safe
 *   fallback — the Resend sandbox sender (onboarding@resend.dev) only delivers
 *   to the account owner, so silently using it is worse than failing loudly.
 * - dev: warns and returns null → caller skips the send gracefully.
 */
function requireFrom(): string | null {
  const from = process.env.RESEND_FROM;
  if (from) return from;
  if (process.env.NODE_ENV !== "development") {
    throw new Error(
      "RESEND_FROM is not set — refusing to send mail to avoid silent misroute"
    );
  }
  console.warn("[email] RESEND_FROM is not set; email send skipped in development");
  return null;
}

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
  const from = requireFrom();
  if (from === null) return;
  const tripUrl = `${BASE_URL}/trips/${tripId}`;

  return resend.emails.send({
    from,
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
  token,
}: {
  toEmail: string;
  toName: string;
  ownerName: string;
  tripTitle: string;
  invitationMessage: string;
  tripId: string;
  /**
   * Present ONLY for a recipient with no account (`users.is_guest = true`).
   * Swaps the link from the raw trip URL to the `/invite` capability link, so
   * the person reaches the auth-aware router (#988) instead of a bare sign-in
   * wall. Omitted for real accounts, who can simply be sent to the trip.
   *
   * The token is what makes it safe to name the trip to a signed-out reader:
   * an unguessable bearer capability distinguishes "you were sent this" from
   * "you found this". That is why the fix is a token link and NOT teaching
   * `/trips/{uuid}` to render trip context for strangers — the latter would
   * leak trip titles to anyone holding or guessing a UUID.
   */
  token?: string | null;
}) {
  const from = requireFrom();
  if (from === null) return;

  // Per-RECIPIENT, not per-send: one blast to sixteen people legitimately
  // produces both link types, because the split is on whether THAT person has
  // an account.
  const hasToken = typeof token === "string" && token.length > 0;
  const tripUrl = hasToken
    ? `${BASE_URL}/invite?token=${encodeURIComponent(token!)}`
    : `${BASE_URL}/trips/${tripId}`;
  const ctaLabel = hasToken ? "Join the Trip" : "View Trip";
  /**
   * "once that's done" is doing real work — do not trim it back (#1035).
   *
   * This read "you'll land straight on the trip", which is FALSE for
   * email/password signup: they confirm their address first, which is several
   * steps and a second inbox visit. It is TRUE for Continue with Google, which
   * skips confirmation entirely — so one sentence was right on one branch and
   * wrong on the other.
   *
   * The obvious fix — branch the sentence — is NOT AVAILABLE HERE, and that is
   * the whole reason this is worded rather than forked: the email is sent
   * before the person has chosen an auth method, so at send time there is
   * nothing to branch on. Softening for both is the only option the send
   * boundary permits.
   *
   * What survives is the part that is true either way and is the useful half:
   * finishing signup lands you on THIS trip, not on a generic home screen.
   * The invite link's `next` parameter survives the confirmation round trip
   * (verified on device), so the destination promise still holds — only the
   * implied immediacy was wrong.
   */
  const ctaLead = hasToken
    ? "Tap below to create your free account &mdash; once that&apos;s done, you&apos;ll land straight on the trip."
    : "Tap below to check it out &mdash; see what&apos;s planned so far.";

  return resend.emails.send({
    from,
    to: resolveRecipient(toEmail),
    subject: `${ownerName} invited you to ${tripTitle}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <p style="margin:0 0 16px">Hey ${toName},</p>
        <p style="margin:0 0 16px;white-space:pre-wrap">${invitationMessage}</p>
        <p style="margin:0 0 24px">${ctaLead}</p>
        <a href="${tripUrl}"
           style="display:inline-block;background:#2dd4bf;color:#0d1f1a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          ${ctaLabel}
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
  url,
  tripLabel,
  platform,
  build,
  reporterName,
  reporterEmail,
}: {
  category: "bug" | "idea" | "confusing" | "love";
  message: string;
  replyTo?: string | null;
  /** Human-friendly page label, e.g. "Trip · Crew" */
  screen?: string | null;
  /** Full relative URL including query string, e.g. "/trips/abc?tab=crew" */
  url?: string | null;
  tripLabel?: string | null;
  platform?: string | null;
  build?: string | null;
  reporterName?: string | null;
  reporterEmail?: string | null;
}) {
  if (!FEEDBACK_TO_EMAIL) {
    throw new Error("FEEDBACK_TO_EMAIL not configured");
  }

  const from = requireFrom();
  if (from === null) return;

  const label = FEEDBACK_CATEGORY_LABEL[category] ?? category;
  const subject = `[BuddyTrip beta] ${label}: ${message.slice(0, 60).replace(/\s+/g, " ")}`;

  const ctxRows: Array<[string, string]> = [];
  if (reporterName) ctxRows.push(["From", reporterName]);
  if (reporterEmail) ctxRows.push(["Account", reporterEmail]);
  if (replyTo && replyTo !== reporterEmail) ctxRows.push(["Reply-to", replyTo]);
  if (screen) ctxRows.push(["Page", screen]);
  if (url) ctxRows.push(["URL", url]);
  if (tripLabel) ctxRows.push(["Trip", tripLabel]);
  if (platform) ctxRows.push(["Platform", platform]);
  if (build) ctxRows.push(["Build", build]);

  const ctxHtml = ctxRows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#64748b;font-size:12px;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:2px 0;font-size:12px;color:#0f172a;font-family:${k === "URL" ? "ui-monospace,monospace" : "inherit"}">${escapeHtml(v)}</td></tr>`,
    )
    .join("");

  return resend.emails.send({
    from,
    to: FEEDBACK_TO_EMAIL,
    // Drop replyTo into the email headers so hitting Reply in the inbox
    // goes straight back to the user (instead of the noreply sender).
    replyTo: replyTo || undefined,
    subject,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
        <p style="margin:0 0 4px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.08em">${escapeHtml(label)}</p>
        <p style="margin:0 0 16px;white-space:pre-wrap;color:#0f172a;font-size:15px;line-height:1.5">${escapeHtml(message)}</p>
        ${ctxRows.length ? `<table style="margin:16px 0 0;border-top:1px solid #e2e8f0;padding-top:12px;border-spacing:0">${ctxHtml}</table>` : ""}
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
  const from = requireFrom();
  if (from === null) return;
  const inviteUrl = `${BASE_URL}/invite?token=${token}`;

  return resend.emails.send({
    from,
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
          <!-- Same correction as the crew-invite lead above, and for the same
               reason: "you'll land straight on the trip" is true for OAuth and
               false for email/password, which confirms first. See the ctaLead
               comment — the sentence cannot be branched at send time, because
               the auth method isn't chosen yet. -->
          Tap below to create your free account &mdash; once that's done, you'll land straight on the trip.
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
