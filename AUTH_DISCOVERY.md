# Auth System Discovery Report

*Generated: 2026-04-03*

---

## 1. Current Auth Flow

### Signup

**Location:** `src/app/login/LoginClient.tsx`

Signup is integrated into the login page as a mode toggle (not a separate route). Users switch between "Sign In" and "Sign Up" modes on the same form.

**Fields collected at signup:**
- Email (required)
- Password (required, min 6 characters)
- Full Name (required)
- Nickname (required)

```tsx
// LoginClient.tsx lines 26-33
const { error: signUpError } = await supabase.auth.signUp({
  email,
  password,
  options: {
    data: { name, nickname },
  },
});
```

**Post-signup:** Redirect to `/` which redirects to `/dashboard`. No onboarding step, no email verification required (user is immediately logged in). Dashboard shows an empty state with "No trips yet."

### Login

**Location:** `src/app/login/LoginClient.tsx`

Email/password only. No social login buttons, no magic link option.

```tsx
// LoginClient.tsx lines 36-40
const { error: signInError } = await supabase.auth.signInWithPassword({
  email,
  password,
});
```

Post-login: `router.push("/")` then `router.refresh()` -> redirects to `/dashboard`.

### Forgot Password / Reset

**Status: Not implemented.**

- No "Forgot Password" link exists in the login form
- No password recovery page exists anywhere in `src/app/`
- No references to `auth.resetPasswordForEmail()` in the codebase
- Users who forget their password have no self-service recovery path

### Auth State

Auth state lives in a React context backed by the Supabase session.

**Provider:** `src/lib/auth-context.tsx`

```tsx
// auth-context.tsx — simplified
export function AuthProvider({ children }) {
  const [user, setUser] = useState<User | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    // Read from localStorage (instant, no network call)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoaded(true);
    });
    // Subscribe to auth changes (token refresh, sign out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setLoaded(true);
      }
    );
    return () => subscription.unsubscribe();
  }, []);
  // ...renders AuthContext.Provider + AuthLoadedContext.Provider
}
```

Consumed via `useAuthUser()` and `useAuthLoaded()` hooks. Components typically use `useCurrentUser()` from `src/hooks/useCurrentUser.ts`.

### Middleware

**Location:** `src/middleware.ts`

**Public routes (no auth required):**
- `/login`
- `/auth/*` (callback, signout)
- `/scoreboard/*`

**All other routes:** Redirect unauthenticated users to `/login`.

```typescript
// middleware.ts — key logic
const { data: { session } } = await supabase.auth.getSession();
const user = session?.user ?? null;

if (!user && !isPublicRoute) {
  return NextResponse.redirect(new URL("/login", request.url));
}
if (user && request.nextUrl.pathname === "/login") {
  return NextResponse.redirect(new URL("/", request.url));
}
```

JWT is verified locally in middleware (no network roundtrip). Actual authorization is enforced by RLS on every tRPC query.

---

## 2. User Profile

### Users Table Schema

Defined across migrations `001_initial_schema.sql` and `013_guest_user_identity.sql`.

| Column | Type | Nullable | Default | Source |
|--------|------|----------|---------|--------|
| `id` | text | NO | — | PK, synced from `auth.users.id` |
| `name` | text | YES | — | Set from auth metadata at signup |
| `nickname` | text | YES | — | Set from auth metadata at signup |
| `email` | text | YES | — | Unique (nullable for guests) |
| `created_at` | timestamptz | NO | `now()` | Auto |
| `is_guest` | boolean | NO | `false` | Added in migration 013 |
| `created_by` | text (FK) | YES | — | FK to `users(id)`, ON DELETE SET NULL. Added in migration 013 |

`name`, `nickname`, and `email` were originally NOT NULL but changed to nullable in migration 013 to support guest users.

No `display_name` column exists. No `avatar_url` or `photo` column exists.

### Profile Edit Screen

**Location:** `src/app/profile/page.tsx`

**Editable fields:**
1. **Full Name** (required, 1-200 chars)
2. **Nickname** (optional, max 100 chars)

No ability to change email, password, or upload an avatar.

**Avatar display:** Programmatically generated circle showing the first character of the user's name. No file upload, no Supabase Storage integration.

```tsx
// profile/page.tsx line 57
const initial = ((me?.name ?? me?.email) || "?").charAt(0).toUpperCase();
```

### Display Name Lifecycle

| Stage | How Set |
|-------|---------|
| Signup | `name` and `nickname` passed as auth metadata, extracted by `handle_new_user()` trigger |
| Profile Edit | User edits via `/profile` form, calls `trpc.users.updateMe` |

---

## 3. Invite Flow — Current State

### DEFERRED.md Context

Per DEFERRED.md: The invite flow creates a guest user and `trip_members` row, shows an "Invited" badge, and copies a link to clipboard — but **no email is sent** and the **`/invite` route doesn't exist**.

### `inviteByEmail` Procedure

**Location:** `src/server/routers/tripMembers.ts` (lines 202-280)

```
Input: { tripId, email, role: "Planner" | "Member" }
Auth: requireTripRole("Planner")
```

**Logic:**
1. Normalize email (trim, lowercase)
2. Check if real account exists (`is_guest = false`) -> return `{ status: "real_account_exists" }`
3. If existing guest with same email -> reuse that guest user row
4. If no user exists -> create new guest user:
   ```typescript
   {
     id: crypto.randomUUID(),
     name: email.split("@")[0],   // derive name from email prefix
     email: input.email,
     is_guest: true
   }
   ```
5. Check if already a trip member -> return `{ status: "already_member" }`
6. Insert `trip_members` row with `status: "invited"`, assigned role
7. Return `{ status: "invited", userId: guestUserId }`

**No email is sent.** The mutation only creates database rows.

### "Invited" Badge

**Location:** `src/app/trips/[tripId]/tabs/CrewTab.tsx` (lines 176-195)

```tsx
m.status === "invited" ? (
  <span className="flex-shrink-0 text-xs" style={{ color: "var(--color-bt-ready)" }}>
    Invited
  </span>
)
```

Shown in crew member row, right-aligned. Green text (`--color-bt-ready`).

### Invite Link Format

**Location:** `src/app/trips/[tripId]/tabs/CrewTab.tsx` (lines 461-472)

```
${window.location.origin}/invite?trip=${tripId}
```

Example: `https://buddytrip-app.vercel.app/invite?trip=550e8400-e29b-41d4-a716-446655440000`

Copied to clipboard via `navigator.clipboard.writeText()` with a fallback to `document.execCommand("copy")`. **The `/invite` route does not exist** — following this link returns a 404.

### `invites` Table

**Does not exist.** No migration creates an `invites` table. DEFERRED.md specifies the planned schema:

```sql
CREATE TABLE invites (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES trips (id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('Planner', 'Member')),
  token text NOT NULL UNIQUE,
  created_by text NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  expires_at timestamptz
);
```

### `trip_members.status` Enum

All 6 values, in order of addition:

| Value | Added In | Meaning |
|-------|----------|---------|
| `in` | 001 (initial) | RSVP: confirmed attending |
| `likely` | 001 (initial) | RSVP: probably attending |
| `maybe` | 001 (initial, default) | RSVP: uncertain |
| `out` | 001 (initial) | RSVP: not attending |
| `invited` | 017 | Pending BuddyTrip account creation |
| `draft` | 019 | Staging before invite/ghost creation |

---

## 4. Guest User System

### How Guests Are Created

Two paths:

**Path A — `tripMembers.inviteByEmail`** (email invite stub)
- Creates user with `id: crypto.randomUUID()`, `is_guest: true`
- Name derived from email prefix
- `trip_members.status = 'invited'`

**Path B — `ghostCrew.create`** (manual ghost crew)

**Location:** `src/server/routers/ghostCrew.ts` (lines 61-184)

- Creates user with `id: ghost-${crypto.randomUUID()}`, `is_guest: true`
- Name provided by user, email optional
- `created_by` set to the planner who created them
- `trip_members.status = 'in'` (automatically in)

Both paths are also triggered from `CrewTab.tsx` inline add: checks if real user exists by email, if not -> calls `ghostCrew.create`.

### FK References to `users.id` — Complete List

Every foreign key referencing `users(id)` across all migrations:

| # | Table | Column | ON DELETE | Migration |
|---|-------|--------|-----------|-----------|
| 1 | `trips` | `owner_id` | NO ACTION | 001, 010 |
| 2 | `trip_members` | `user_id` | CASCADE | 001, 010 |
| 3 | `team_assignments` | `user_id` | CASCADE | 001, 010 |
| 4 | `players` | `user_id` | CASCADE | 001, 010 |
| 5 | `rounds` | `closed_by` | SET NULL | 001, 004 |
| 6 | `group_results` | `submitted_by` | SET NULL | 001, 010 |
| 7 | `player_hole_scores` | `player_id` | CASCADE | 001, 010 |
| 8 | `idea_votes` | `user_id` | CASCADE | 001, 010 |
| 9 | `idea_comments` | `user_id` | CASCADE | 001, 010 |
| 10 | `date_poll_votes` | `user_id` | CASCADE | 001, 010 |
| 11 | `expenses` | `paid_by_user_id` | SET NULL | 001, 010 |
| 12 | `expense_splits` | `user_id` | CASCADE | 001, 010 |
| 13 | `messages` | `user_id` | SET NULL | 001, 010 |
| 14 | `notification_events` | `actor_id` | SET NULL | 001, 010 |
| 15 | `notification_reads` | `user_id` | CASCADE | 001, 010 |
| 16 | `quick_info_tiles` | `created_by` | SET NULL | 001, 010 |
| 17 | `scoreboard_shares` | `created_by` | SET NULL | 007, 010 |
| 18 | `series` | `owner_id` | NO ACTION | 001, 010 |
| 19 | `users` (self-ref) | `created_by` | SET NULL | 013 |

**Total: 19 FK references across 18 tables (+ 1 self-reference).**

### Ghost Merge Trigger — Partial Implementation

**Location:** `supabase/migrations/20260325120000_020_fix_signup_trigger_ghost_conflict.sql`

The `handle_new_user()` trigger (fired on `auth.users` INSERT) already handles ghost-to-real merge for the **email conflict case**:

```sql
-- If ghost row exists with same email:
-- 1. Clear ghost's email (avoid UNIQUE conflict)
-- 2. Insert real user row
-- 3. Migrate FK references from ghost ID -> new auth ID
-- 4. Delete the ghost row
```

**Tables covered by migration 020:**

| Table | Column | Covered? |
|-------|--------|----------|
| `trip_members` | `user_id` | YES |
| `team_assignments` | `user_id` | YES |
| `players` | `user_id` | YES |
| `expense_splits` | `user_id` | YES |
| `expenses` | `paid_by_user_id` | YES |
| `idea_votes` | `user_id` | YES |
| `scoreboard_shares` | `created_by` | YES |
| `series` | `owner_id` | YES |
| `users` | `created_by` | YES |

**Tables MISSING from migration 020 (not migrated during merge):**

| Table | Column | Risk |
|-------|--------|------|
| `rounds` | `closed_by` | Audit attribution lost |
| `group_results` | `submitted_by` | Audit attribution lost |
| `player_hole_scores` | `player_id` | **Scores orphaned from real user** |
| `idea_comments` | `user_id` | **Comments orphaned from real user** |
| `date_poll_votes` | `user_id` | **Votes orphaned from real user** |
| `messages` | `user_id` | Chat messages orphaned |
| `notification_events` | `actor_id` | Notification attribution lost |
| `notification_reads` | `user_id` | Read state orphaned |
| `quick_info_tiles` | `created_by` | Attribution lost |
| `trips` | `owner_id` | Unlikely for ghosts, but not impossible |

**Note:** DEFERRED.md lists this as "not yet implemented," but migration 020 does implement it partially. The trigger handles the email-match case but misses 10 tables. DEFERRED.md's table list is also incomplete compared to the actual FK references.

---

## 5. Magic Link / OAuth

**Status: Not implemented.**

- No `signInWithOtp()` or `signInWithOAuth()` calls anywhere in the codebase
- No magic link UI
- No social login buttons

**Supabase config** (`supabase/config.toml`): All OAuth providers are explicitly disabled:

```toml
# Apple, Azure, Bitbucket, Discord, Facebook, Figma, GitHub, GitLab,
# Google, Kakao, Keycloak, LinkedIn, Notion, Spotify, Slack, Twitter,
# Twitch, WorkOS — all have enabled = false
```

Email confirmations are also disabled (`enable_confirmations = false`), meaning signup is instant with no verify step.

**Auth callback route exists** (`src/app/auth/callback/route.ts`) and handles code exchange — this is wired up and ready to support OAuth or magic link flows if enabled, but nothing currently triggers it for those purposes.

---

## 6. Email Infrastructure

**Status: Not implemented.**

- **No email service SDK installed.** `package.json` has no Resend, SendGrid, Nodemailer, or any other email dependency.
- **No email templates** exist anywhere in the codebase.
- **Local dev uses Inbucket** (test email server) via Supabase's built-in config:
  ```toml
  # supabase/config.toml
  [inbucket]
  enabled = true
  port = 54324
  ```
- **SMTP is not configured** for production. The SMTP section in config.toml is at defaults (no custom host/credentials).
- **Supabase's built-in auth emails** (confirmation, recovery, etc.) use default Supabase templates — no customization applied.
- The crew invite UI explicitly shows a stub message:
  ```
  "Email sending will be available once the invite system is set up.
   For now, copy the invite link to share manually."
  ```

---

## 7. Post-Signup Hooks

### `handle_new_user()` Trigger

**Migration:** `20260301000005_005_sync_auth_users.sql` (original), **replaced by** `20260325120000_020_fix_signup_trigger_ghost_conflict.sql` (current version)

**Trigger:** `on_auth_user_created` — fires `AFTER INSERT ON auth.users`

**Current behavior (migration 020):**

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  _ghost_id text;
BEGIN
  -- Check if a ghost user already exists with this email
  SELECT id INTO _ghost_id
  FROM public.users
  WHERE email = NEW.email
    AND is_guest = true;

  IF _ghost_id IS NOT NULL THEN
    -- 1. Clear ghost's email (avoid UNIQUE conflict)
    UPDATE public.users SET email = NULL WHERE id = _ghost_id;
    -- 2. Insert real user row
    INSERT INTO public.users (id, name, nickname, email)
    VALUES (NEW.id::text, COALESCE(...), COALESCE(...), NEW.email);
    -- 3. Migrate FK references (9 tables covered)
    UPDATE public.trip_members       SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.team_assignments   SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.players            SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.expense_splits     SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.expenses           SET paid_by_user_id = NEW.id::text WHERE paid_by_user_id = _ghost_id;
    UPDATE public.idea_votes         SET user_id         = NEW.id::text WHERE user_id         = _ghost_id;
    UPDATE public.scoreboard_shares  SET created_by      = NEW.id::text WHERE created_by      = _ghost_id;
    UPDATE public.series             SET owner_id        = NEW.id::text WHERE owner_id        = _ghost_id;
    UPDATE public.users              SET created_by      = NEW.id::text WHERE created_by      = _ghost_id;
    -- 4. Delete the ghost row
    DELETE FROM public.users WHERE id = _ghost_id;
  ELSE
    -- Normal signup — no ghost conflict
    INSERT INTO public.users (id, name, nickname, email)
    VALUES (NEW.id::text, COALESCE(...), COALESCE(...), NEW.email);
  END IF;
  RETURN NEW;
END;
$$;
```

### Pending Invite Check After Signup

**Not implemented.** After signup, user lands on `/dashboard`. There is no logic that:
- Checks for `trip_members` rows with `status = 'invited'` matching the new user's email
- Auto-updates `trip_members.status` from `'invited'` to a confirmed state
- Shows a "you've been invited to X" prompt

The ghost merge trigger (020) does migrate FK references including `trip_members`, so the new user inherits the ghost's trip membership — but the `status` remains `'invited'` unless manually changed.

---

## 8. Session and Token Handling

### Supabase Client Instantiation

**Two clients:**

| Client | File | Used By |
|--------|------|---------|
| Browser client | `src/lib/supabase.ts` | Client components, auth context |
| Server client | `src/lib/supabase-server.ts` | tRPC context, middleware, server components |

```typescript
// supabase.ts — browser client
import { createBrowserClient } from "@supabase/ssr";
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

```typescript
// supabase-server.ts — server client
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(cookiesToSet) { /* sets on cookieStore, catch for Server Components */ },
    },
  });
}
```

### Session Refresh

- **Middleware** (`src/middleware.ts`): Runs on every non-static request. Calls `getSession()` which verifies JWT locally and triggers cookie refresh if tokens are near expiry.
- **Auth context** (`src/lib/auth-context.tsx`): `onAuthStateChange` listener updates React state when tokens refresh or user signs out.
- **tRPC context** (`src/server/trpc.ts`): Uses `supabase.auth.getUser()` (server-side, reads from cookies) to get the authenticated user for each request.

### Server-Side Session Access

- **tRPC context creation** reads the session via server client (`getUser()`)
- **Auth callback route** (`src/app/auth/callback/route.ts`) exchanges code for session
- **Signout route** (`src/app/auth/signout/route.ts`) calls `signOut()` server-side
- **Middleware** reads session for route protection

### Signout

Two locations call signout:
1. `src/components/UserMenu.tsx` — calls `supabase.auth.signOut()` client-side then `router.push("/login")`
2. `src/app/profile/page.tsx` — same pattern
3. `src/app/auth/signout/route.ts` — server-side POST endpoint, signs out and redirects to `/login`

---

## Summary: What's Working, What's Stubbed, What's Missing

| Feature | State | Notes |
|---------|-------|-------|
| Email/password signup | Working | Collects name, nickname, email, password |
| Email/password login | Working | Standard Supabase auth |
| Post-signup trigger | Working | Creates `public.users` row from auth metadata |
| Ghost merge on signup | Partial | Migration 020 covers 9/19 FK references |
| Auth context (React) | Working | `AuthProvider` with `onAuthStateChange` |
| Middleware route protection | Working | Redirects unauthenticated to `/login` |
| tRPC auth guard | Working | `authedProcedure` + `requireTripRole` |
| RLS policies | Working | Enforced on all Supabase queries |
| Profile edit (name/nickname) | Working | `/profile` page |
| Sign out | Working | Client-side + server-side route |
| Auth callback route | Working | Ready for OAuth/magic link |
| Guest user creation | Working | Two paths: inviteByEmail + ghostCrew.create |
| Invited badge (UI) | Working | Shows in crew tab |
| Invite link copy (stub URL) | Stubbed | URL copied but `/invite` route doesn't exist |
| `inviteByEmail` mutation | Stubbed | Creates DB rows but sends no email |
| Forgot password / reset | Missing | No UI, no `resetPasswordForEmail()` call |
| Email verification | Missing/Disabled | `enable_confirmations = false` in config |
| Magic link auth | Missing | No code, no config |
| OAuth (Google, Apple, etc.) | Missing | All providers disabled |
| Email sending (invites) | Missing | No email SDK, no templates |
| `/invite` route | Missing | Not implemented |
| `invites` table | Missing | Not created |
| Pending invite check on signup | Missing | No auto-prompt after signup |
| Avatar/photo upload | Missing | Generated initial only |
| Password change (in-app) | Missing | No UI for changing password |
| Account deletion | Missing | No UI or API |

---

## Open Questions for Zach

1. **Ghost merge coverage gap:** Migration 020 migrates 9 of 19 FK references during ghost-to-real merge. The missing 10 tables include `player_hole_scores`, `idea_comments`, `date_poll_votes`, `messages`, `notification_events`, `notification_reads`, `quick_info_tiles`, `group_results`, `rounds`, and `trips`. Was this intentional (ghosts never have data in those tables) or an oversight that needs fixing?

2. **`trip_members.status` after merge:** When a ghost is merged at signup via the trigger, the `trip_members.status` stays as `'invited'`. Should the trigger also flip it to `'in'` (or `'maybe'`)? Or should the user explicitly RSVP after signup?

3. **Email verification before launch:** Currently `enable_confirmations = false` — anyone can sign up with any email without verifying it. Is this acceptable for launch, or should email verification be required? (This affects the invite flow since unverified emails can't be trusted for matching.)

4. **Forgot password priority:** There's no password reset flow at all. Is this a launch blocker? If magic link auth is planned (per DEFERRED.md), does that reduce the urgency of building a dedicated reset flow?

5. **Email provider decision:** DEFERRED.md recommends Resend. Has this been decided, or is it still open? The invite flow, password reset, and email verification all depend on this choice.

6. **Avatar upload:** The profile page only shows a generated initial. Is avatar upload planned for launch, or is the generated initial sufficient?

7. **Ghost user IDs — `ghost-` prefix:** Ghosts created via `ghostCrew.create` use IDs like `ghost-${uuid}`, but ghosts created via `inviteByEmail` use plain UUIDs. This inconsistency means you can't reliably identify ghost-created users by ID prefix alone (only via `is_guest` column). Is the `ghost-` prefix convention still desired?

8. **Multiple ghosts per email:** If `inviteByEmail` is called twice with the same email for different trips, it reuses the same guest row. But `ghostCrew.create` can create multiple ghost rows for the same person (by name, no email dedup). When a real user signs up, the merge trigger only finds ghosts by email match — name-only ghosts won't be merged. Is there a plan for reconciling name-only ghosts?

9. **Invite link security:** The stub invite link format is `?trip=${tripId}` — this uses the raw trip UUID with no token or expiry. The planned `invites` table has a `token` column. Should the link format be `?token=xxx` (requiring token lookup) or `?trip=xxx` (allowing anyone with the UUID to join)?

10. **`expense_splits` CASCADE danger:** DEFERRED.md flags that `expense_splits.user_id ON DELETE CASCADE` silently destroys expense data if a user is deleted. This applies to ghost deletion during merge (migration 020 deletes the ghost row after migrating splits). If any splits are missed in the migration, they'll be silently deleted. Has this been evaluated?

---

## 9. Functional Smoke Test Results

*Tested: 2026-04-03 against cloud Supabase (`nezhuwyfirrbmyojpiyx`), dev server on `localhost:3000`*

**Note:** Docker Desktop was not installed on this machine, so local Supabase (`supabase start`) could not be used. Tests ran against the cloud Supabase instance. This means Inbucket (local email testing) was unavailable — email behavior reflects cloud configuration.

---

### Flow 1 — New user signup

**Attempted:** Navigated to `/login`, toggled to "Sign up" mode. Filled in Full Name ("Smoke Test User"), Nickname ("smokey"), Email, Password. Clicked "Create Account".

**Result:** PARTIAL FAILURE — silent redirect loop.

**Details:**
- Signup form has 4 fields: Full Name (required), Nickname (required), Email (required), Password (required, min 6 chars).
- First attempt with `@example.com` email returned HTTP 400 from Supabase: `{"code":"email_address_invalid","message":"Email address \"...@example.com\" is invalid"}`. Error displayed correctly in the UI.
- Second attempt with `@buddytrip.app` email returned HTTP 200. Supabase created the `auth.users` row with `email_confirmed_at: NULL` and `confirmation_sent_at` set. The `handle_new_user()` trigger successfully created a `public.users` row with correct `name`, `nickname`, `email`, `is_guest: false`.
- **Bug:** The signup handler (`LoginClient.tsx` line 27-43) does not check whether a session was returned. On cloud Supabase with email confirmation enabled, `signUp()` returns 200 but **no session** (user must confirm email). The code unconditionally calls `router.push("/")`, middleware detects no session, and redirects back to `/login`. The user sees no success message, no error, and no indication that they need to check their email. It appears as if nothing happened.
- **Root cause:** `LoginClient.tsx` line 42 — `router.push("/")` fires regardless of whether signup produced a session. No check for `data.session === null` (which indicates email confirmation is required).

**Errors/output:**
- First attempt: `POST /auth/v1/signup → 400` with `email_address_invalid`
- Second attempt: `POST /auth/v1/signup → 200` (no session in response body — `email_verified: false`)
- No console errors. No error displayed in UI for the successful-but-unconfirmed signup.

---

### Flow 2 — Email confirmation

**Attempted:** Checked whether a confirmation email was sent for the signup in Flow 1.

**Result:** NOT TESTABLE (no local Inbucket).

**Details:**
- Cloud Supabase has `enable_confirmations` enabled (proven by `email_confirmed_at: NULL` and `confirmation_sent_at` being set in `auth.users`).
- Local Supabase config (`supabase/config.toml`) has `enable_confirmations = false` — meaning local dev skips confirmation entirely.
- The auth callback route (`/auth/callback/route.ts`) exists and handles code exchange, so the confirmation link *should* work if Supabase's built-in email reaches the user. No custom email templates exist.
- **Config mismatch:** Local dev (no confirmation) behaves differently from cloud (requires confirmation). Signup works seamlessly locally but silently fails on cloud.

**Errors/output:** None — the confirmation email was sent by Supabase's built-in email service to `@buddytrip.app`, which is not a real domain, so the email was undeliverable.

---

### Flow 3 — Login with existing credentials

**Attempted:** Navigated to `/login`. Entered `test-owner@buddytrip.app` / `BuddyTripTest2026!`. Clicked "Sign In".

**Result:** PASS.

**Details:**
- Login form shows Email and Password fields in sign-in mode. No "Forgot password" link.
- `POST /auth/v1/token?grant_type=password → 200` — session returned with `access_token`.
- Redirected to `/` → middleware redirected to `/dashboard`.
- Dashboard loaded showing "Welcome back, New" (test-owner's display name is "New Name" from a prior profile edit test) and a list of trips with correct "Owner" role badges.
- User avatar shows "N" (first letter of "New Name").
- No console errors.

**Errors/output:** None.

---

### Flow 4 — Logout

**Attempted:** Clicked user avatar "N" to open user menu. Clicked "Sign Out".

**Result:** PASS.

**Details:**
- User menu dropdown shows: user name ("New Name"), email, "Profile & Settings" link, "Sign Out" button.
- After clicking "Sign Out", `supabase.auth.signOut()` was called client-side.
- Redirected to `/login` within ~1 second.
- No console errors. Session fully cleared.

**Errors/output:** None.

---

### Flow 5 — Password reset

**Attempted:** Looked for "Forgot password" link or reset flow on the login page.

**Result:** NOT BUILT.

**Details:**
- Login page has no "Forgot password" link, no reset route, no `resetPasswordForEmail()` call anywhere in the codebase.
- Users who forget their password have no self-service recovery path.
- The only recovery option would be through Supabase's admin API or dashboard.

**Errors/output:** N/A — no UI exists.

---

### Flow 6 — Protected route without auth

**Attempted:** While logged out, navigated directly to `/trips/some-fake-trip-id`.

**Result:** PASS.

**Details:**
- Middleware detected no session and redirected to `/login` within ~1 second.
- No flash of protected content visible.
- No console errors.

**Errors/output:** None.

---

### Flow 7 — Session persistence

**Attempted:** Logged in as test-owner, navigated to `/dashboard` (confirmed loaded). Then navigated away to `/` to simulate reopening.

**Result:** PASS.

**Details:**
- Navigating to `/` (which middleware treats as authenticated-only) redirected to `/dashboard` — confirming the session was still valid.
- Session cookies persist across navigation. Supabase SSR cookie-based session management is working.
- Note: Could not fully test browser close/reopen (preview tool limitation), but same-session navigation confirms cookie persistence.

**Errors/output:** None.

---

### Flow 8 — Invite stub flow

**Attempted:** As test-owner, navigated to trip "Coplanners Trip" → Crew tab. Clicked "Send email" button. Then added a crew member via the name+email inline form.

**Result:** PARTIAL — UI works but invite link is dead.

**Details:**

**"Send email" modal:**
- Opens a panel showing: "Email sending will be available once the invite system is set up. For now, copy the invite link to share manually."
- "Copy invite link" button copies `http://localhost:3000/invite?trip=test-trip-coplan-1773680405369` to clipboard.
- **The `/invite` route does not exist.** Navigating to it returns a custom 404 page: "Page not found — The page you're looking for doesn't exist or has been moved."

**Inline add with name + email:**
- Entered "Invite Test Person" in Name field, `invite-smoke-test@buddytrip.app` in Email field, clicked "Add".
- A `ghostCrew.create` mutation was called (not `inviteByEmail`). DB row created:
  - `users` row: `id: ghost-98834488-...`, `name: "Invite Test Person"`, `email: invite-smoke-test@buddytrip.app`, `is_guest: true`, `created_by: [test-owner-id]`
  - `trip_members` row: `status: 'in'`, `role: 'Member'`
- UI badge shows "Unknown" (not "Invited") — because the add form uses the ghost crew path which sets `status: 'in'`, not the invite path which sets `status: 'invited'`.
- **Finding:** The inline add form always creates ghost crew members (status `'in'`), never triggers `inviteByEmail` (status `'invited'`). The `inviteByEmail` mutation exists in the code but is not wired to any UI action in the crew add form.

**Errors/output:** No console errors.

---

### Flow 9 — Guest user creation

**Attempted:** As test-owner, on Crew tab, entered "Ghost Buddy" in Name field, left Email field empty, clicked "Add".

**Result:** PASS.

**Details:**
- `ghostCrew.create` mutation created:
  - `users` row: `id: ghost-86333558-...`, `name: "Ghost Buddy"`, `email: null`, `is_guest: true`, `created_by: [test-owner-id]`
  - `trip_members` row: `status: 'in'`, `role: 'Member'`
- UI shows "Ghost Buddy" in crew list with "Unknown" badge (no email shown since email is null).
- No console errors.
- Ghost user with `ghost-` prefixed ID, `is_guest: true`, `created_by` set correctly.

**Errors/output:** None.

---

### Flow 10 — Caching behavior on user switch

**Attempted:** Logged in as test-owner (confirmed dashboard shows owner's trips). Signed out. Immediately logged in as test-member. Checked dashboard without page reload.

**Result:** FAIL — stale cache from previous user shown.

**Details:**

**Before switch (test-owner):** Dashboard shows "Welcome back, New" (from name "New Name"), 7+ trips all with "Owner" badge, avatar "N".

**After switch to test-member (no reload):** Dashboard shows "Welcome back, New" — **still test-owner's name**. Trip list shows test-owner's trips with "Owner" badges. Avatar still shows "N". This is entirely test-owner's data being displayed to test-member.

**Expected for test-member:** "Welcome back, Test" (from name "Test Member"), 3 trips (Walkthrough Golf Trip, Assign Test, Results Test) all with "Member" role, avatar "T".

**After manual page reload:** Dashboard correctly shows "Welcome back, Test", 3 trips with correct roles, avatar "T". Full page reload clears the stale cache.

**Root cause:** TanStack Query cache is not invalidated on user switch. When the `onAuthStateChange` listener fires with the new user's session, existing cached queries (trip list, user profile) are not refetched. The stale data from the previous user persists until the cache expires or a hard navigation occurs.

**Security impact:** This is a data leakage issue — user B sees user A's trip names, roles, and membership data after switching accounts. The data is display-only (RLS prevents mutations), but trip names and crew details are visible.

**Errors/output:** No console errors — the stale data is displayed silently with no indication that it belongs to a different user.

---

## Smoke Test Summary

| Flow | Result | Key Finding |
|------|--------|-------------|
| 1. New user signup | Partial | Signup succeeds but silent redirect loop — no "check your email" message when confirmation is required |
| 2. Email confirmation | Not testable | Cloud requires confirmation; local skips it. Config mismatch means dev/prod behavior differs |
| 3. Login | Pass | Email/password login works, redirects to dashboard correctly |
| 4. Logout | Pass | Clean signout, redirects to login, session cleared |
| 5. Password reset | Not built | No UI, no link, no API call. Zero recovery path for forgotten passwords |
| 6. Protected route (unauthed) | Pass | Middleware correctly redirects to /login |
| 7. Session persistence | Pass | Session survives navigation, cookies persist |
| 8. Invite stub flow | Partial | "Copy invite link" works but link is 404. Inline add uses ghostCrew, not inviteByEmail. `inviteByEmail` has no UI trigger. |
| 9. Guest user creation | Pass | Name-only ghost creation works. Correct DB state created. |
| 10. Caching on user switch | Fail | Previous user's data (trips, name, avatar) persists after logout/login until hard reload. Silent data leakage. |

### Critical issues found

1. **Signup silent failure (Flow 1):** On cloud Supabase, signup creates the account but doesn't log the user in (email confirmation required). No user feedback — appears broken. Fix: check for `data.session === null` after `signUp()` and show "Check your email" message.

2. **Stale cache on user switch (Flow 10):** After logout → login as different user, TanStack Query cache shows previous user's data. Security concern (data leakage) and UX bug. Fix: call `queryClient.clear()` on sign-out or on `onAuthStateChange` `SIGNED_OUT` event.

3. **Dev/prod email confirmation mismatch (Flow 2):** Local config has `enable_confirmations = false`, cloud has it enabled. Developers won't encounter the signup bug during local development.
