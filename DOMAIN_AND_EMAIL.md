# Domain & Email Configuration

How BuddyTrip's public domain, auth redirects, and email sending are wired —
and **exactly what to change to move to a new domain.**

The guiding principle: **everything is env-driven.** The codebase has no
hardcoded domain. A domain migration is dashboard + DNS config plus a couple of
doc edits — **no application code changes required.**

Current canonical domain: **`bbmi.app`** · Email provider: **Resend** · DNS host:
**Squarespace** · Auth/DB: **Supabase**.

---

## 1. The one env var that drives everything: `NEXT_PUBLIC_SITE_URL`

Set to the canonical origin (no trailing slash). Consumed by:

| File | Use |
|------|-----|
| `src/lib/email.ts` | `BASE_URL` for invite/trip links in emails |
| `src/lib/providers.tsx` | tRPC server base URL (SSR) |
| `src/lib/trpc.ts` | tRPC server base URL |
| `src/app/layout.tsx` | `metadataBase` for OG/social tags |

Resolution order in the tRPC helpers: `NEXT_PUBLIC_SITE_URL` → `VERCEL_URL`
(preview fallback) → `http://localhost:3000`. `email.ts` and `layout.tsx` use
`NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"`.

Values:
- **Production / Preview (Vercel):** `https://bbmi.app`
- **Local (`.env.local`):** `http://localhost:3000`

> The auth callback (`src/app/auth/callback/route.ts`) and signup
> (`src/app/login/LoginClient.tsx`) use `window.location.origin` / the request
> origin, so they follow whatever domain is serving the request automatically —
> no env needed.

---

## 2. Email (Resend)

Two **separate** email paths share one Resend account + one verified domain:

| Path | Sent by | Emails | Sender controlled by |
|------|---------|--------|----------------------|
| **A. Auth** | **Supabase** (not app code) | signup confirmation, password reset, magic link | **Supabase → Auth → SMTP → Sender email** |
| **B. App** | `src/lib/email.ts` (Resend API) | trip invites, beta feedback | `RESEND_FROM` env var |

### Env vars (app path B)
| Var | Value | Notes |
|-----|-------|-------|
| `RESEND_API_KEY` | (secret) | Resend key `buddytrip-prod` (Sending access, scoped to `bbmi.app`). App only ever sends, so it must NOT be a Full-access key. |
| `RESEND_FROM` | `BuddyTrip <noreply@bbmi.app>` | Falls back to Resend's sandbox sender (`onboarding@resend.dev`) if unset. |
| `RESEND_DEV_TO_EMAIL` | your inbox | **Dev guardrail:** in `NODE_ENV=development`, ALL app email is rerouted here so local testing never reaches real users. Ignored in prod. |
| `FEEDBACK_TO_EMAIL` | founder inbox | Destination for in-app beta feedback. |

> **API key hygiene:** each consumer gets its own **Sending-access-only** key
> (never Full access — a Full key can delete the domain or revoke other keys, so
> a leak from app env vars would be account-wide). App → `buddytrip-prod`,
> Supabase SMTP → `buddytrip-smtp`. Separate keys let you rotate/revoke one
> without breaking the other.

### Supabase custom SMTP (auth path A)
Supabase → Project Settings → Authentication → SMTP Settings:
- Host `smtp.resend.com` · Port `465` (SSL) or `587`
- Username `resend` · Password = a Resend API key (Sending access — key `buddytrip-smtp`)
- **Sender email** `noreply@bbmi.app` · **Sender name** `BuddyTrip`
- Also bump **Auth → Rate Limits** email cap (the built-in default is ~3–4/hr).

### Resend domain verification
`bbmi.app` is **Verified** in Resend (region us-east-1). Verification = DNS
records at the DNS host (Squarespace): an MX + SPF `TXT` on the `send` subdomain,
a DKIM `TXT` on `resend._domainkey`, and an optional DMARC `TXT` on `_dmarc`.
**Until a domain is Verified, Resend only delivers to the account owner** — that's
the classic "email only reaches me" symptom.

> Squarespace gotcha: the Host field auto-appends the domain, so enter `send`
> (not `send.bbmi.app`) and `resend._domainkey` (not the full host).

---

## 3. Supabase Auth URL configuration

Supabase → Project Settings → Authentication → URL Configuration:
- **Site URL:** `https://bbmi.app`
- **Redirect URLs (allowlist):**
  - `https://bbmi.app/auth/callback`
  - `http://localhost:3000/auth/callback`

If the callback URL isn't on the allowlist, Supabase silently falls back to the
Site URL after email confirmation and the user lands signed-out on the marketing
page (the bug fixed in the auth-callback work).

---

## 4. Migrating to a NEW domain (e.g. `newdomain.com`)

Do these in order. Steps 1–5 are dashboards/DNS; step 6 is docs only.

1. **Resend → Domains → Add Domain** `newdomain.com`. Copy the DNS records it shows.
2. **DNS host** (Squarespace or wherever `newdomain.com`'s nameservers live): add
   those records (MX + SPF on `send`, DKIM on `resend._domainkey`, optional DMARC
   on `_dmarc`). Back in Resend, click **Verify** and wait for green.
3. **Vercel:**
   - Add `newdomain.com` to the project's Domains.
   - Set `NEXT_PUBLIC_SITE_URL=https://newdomain.com` for **Production + Preview**.
   - Set `RESEND_FROM=BuddyTrip <noreply@newdomain.com>`.
   - **Redeploy** (env changes only apply to new deployments).
4. **Supabase → Auth → URL Configuration:**
   - Site URL → `https://newdomain.com`
   - Add `https://newdomain.com/auth/callback` to Redirect URLs (keep localhost; keep
     the old domain's entry until cutover is done).
5. **Supabase → Auth → SMTP:** Sender email → `noreply@newdomain.com`
   (the API key/host stay the same).
6. **Docs (code, this repo):** update the deployment-URL references:
   `CLAUDE.md`, `PROJECT_STATUS.md`, `design/README.md`, and the example values in
   `.env.example` (`NEXT_PUBLIC_SITE_URL`, `RESEND_FROM`). **No application code
   changes** — the domain is never hardcoded.
7. **Test** (use a non-owner address to prove real delivery):
   - Sign up fresh → confirmation arrives **to that address** from
     `noreply@newdomain.com` → link lands on `/dashboard`, signed in.
   - Send an invite → link points at `newdomain.com`.
   - Check inbox-not-spam (SPF/DKIM passing).
8. **Optional:** keep the old domain pointed at the app (Vercel redirect) so old
   links/emails still resolve during the transition.

---

## 5. Quick "where is X" index

| Thing | Lives in |
|-------|----------|
| Canonical origin | `NEXT_PUBLIC_SITE_URL` (Vercel env + `.env.local`) |
| App-email sender | `RESEND_FROM` (Vercel env) |
| Auth-email sender | Supabase → Auth → SMTP → Sender email |
| Auth redirect allowlist + Site URL | Supabase → Auth → URL Configuration |
| Domain verification + DNS records | Resend → Domains, applied at the DNS host |
| Dev email safety redirect | `RESEND_DEV_TO_EMAIL` (`.env.local`) |
| Code that reads the origin | `email.ts`, `providers.tsx`, `trpc.ts`, `layout.tsx`; callback + login use the request origin |
