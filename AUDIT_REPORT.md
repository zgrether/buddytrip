# CC AUDIT — Trip-Planning Half + Doc Drift Map

**Type:** Read-only reconnaissance. No code/docs/DB changed. This file is uncommitted on `main` (per ground rules — Zach reviews before it lands).
**Date:** 2026-07-19. **Auditor:** Claude (Opus). **Method:** code = ground truth; every claim cites `file:line`; `.md` assertions treated as leads, not facts.

---

## 1 · Phase 0 baseline + STOP flags

**No STOP conditions triggered** — migrations ≈090 and the stack matches; the mental model behind this spec is intact.

| Check | Finding | vs expected |
|-------|---------|-------------|
| Migrations | **93 files**, highest `20260722130000_090_can_score_unit_game_type_rack.sql` (+ `_archive/`) | ✅ ≈090 |
| Stack | Next `15.5.12` (App Router) · React `18.3.1` · tRPC `11.12` · TanStack Query `5.90` · Supabase-js `2.99` · Tailwind `4` · Zod `4.3` · Vitest `4.0` · Playwright `1.58` | ✅ all match |
| Test files | **139** unit/integration (`*.test.ts[x]`, worktrees excluded) + **15** e2e specs under `e2e/` | — |
| tRPC routers | `src/server/routers/` — 20+ routers (inventory below) | ✅ path confirmed |
| Trip tabs | `src/app/trips/[tripId]/tabs/`: `HomeTab, CrewTab, LodgingTab, ScheduleTab, ExpensesTab` (+`ExpensesSection`, `SplitPanel`, modals) | ⚠️ see drift |

**Router inventory (planning-relevant bolded):**

| Router | Purpose (1-line) |
|--------|------|
| **`trips`** | trip CRUD, `resolveSlug`, `lockDestination` |
| **`tripMembers`** | crew roster, `inviteByEmail`, `sendInvitationBlast` |
| **`ghostCrew`** | placeholder (guest) crew create/update/remove |
| **`ideas` / `ideaLodging` / `archivedIdeas`** | destination + lodging ideas, voting, archive |
| **`datePoll`** | date windows, votes, lock→trip dates |
| **`messages`** | trip + team chat (send/list/read/clear) |
| **`expenses`** | expense CRUD, splits, opt-out |
| **`schedule` / `logistics`** | itinerary/agenda + logistics items |
| **`news` / `quickInfoTiles` / `feedback` / `users`** | news feed, home tiles, feedback, profile |
| `competitions, games, teams, teamAssignments, matches, matchOutcomes, scores, playGroups, rackNStack, courses, golfCourses` | **OUT OF SCOPE** (competition/scoring side) |

**Anchor drift caught at Phase 0:** STYLE_GUIDE's cited tab files `CompTab.tsx`, `MoreTab.tsx`, `DatesSection.tsx` **do not exist** — the tab set was refactored (`HomeTab/CrewTab/LodgingTab/ScheduleTab/ExpensesTab`). Also **`PROJECT_STATUS.md` does not exist** — deleted, replaced by `TRACKER.md` (TRACKER:3 says so explicitly). The spec's references to both are stale.

---

## 2 · Planning-half status — 5 feature blocks

Summary: **2 WORKING, 3 PARTIAL, 0 STUBBED/MISSING.** The planning half is materially more built than the spec's assumed baseline (which expected invite/settlement/etc. stubbed). The real gaps are narrower and specific.

| # | Feature | Status | One-line gap |
|---|---------|--------|--------------|
| 1 | Crew invite | **WORKING** | none functional (no e2e for accept page) |
| 2 | Destination voting | **PARTIAL** | votes have no realtime/poll — cross-device lag (~60s staleTime) |
| 3 | Date polling | **WORKING** | doc-referenced "PR #151 grid" doesn't exist (superseded by stacked cards); 2 procs untested |
| 4 | Chat | **PARTIAL** | **team chat has no UI** (backend + RLS complete); trip chat fully working |
| 5 | Expenses | **PARTIAL** | **no settlement / who-owes-who netting** (only per-person balances) |

### 2.1 Crew invite — **WORKING**

- **DB:** `invites` table exists — `supabase/migrations/20260517160000_001_initial_schema.sql:121-131` with all expected columns (`id, trip_id, email, role, token, created_by, created_at, accepted_at, expires_at`); `token = encode(gen_random_bytes(32),'hex')`, `expires_at = now()+7d`. Indexes `:481-482`; RLS `:913-925`; tightened Owner-only INSERT in `029:40-42` + `030_tighten_rls_to_match_trpc.sql:29-31`.
- **Server:** real, no stubs. `tripMembers.inviteByEmail` (`tripMembers.ts:386-545`, Owner-only): existing-user → add member + `sendInviteExistingUser`; new → guest user + `invites` row w/ token (`:502-511`) + `sendInviteNewUser`. `sendInvitationBlast` (`:674-763`).
- **Email:** Resend wired for real — `src/lib/email.ts:1-3` (`new Resend(process.env.RESEND_API_KEY)`); `sendInviteNewUser:226-268` builds `${BASE_URL}/invite?token=${token}` → `resend.emails.send`; `requireFrom()` guards prod (`:22-32`).
- **UI + wiring:** `/invite` route real — `src/app/invite/page.tsx:1-266` reads `?token=`, stores `pendingInviteToken`→`/login` when logged-out (`:52-54`), else validates + stamps `accepted_at` (`:93-96`) + inserts `trip_members` (`:108-113`). Composition UI calls live procs: `CrewSearchInput.tsx:68,101`→`inviteByEmail`; `CrewEmailPanel.tsx:156`→`sendInvitationBlast`; post-signup resume `auth-context.tsx:44-52`.
- **Guest→member merge:** implemented DB-side — `merge_guest_to_real_user()` + `handle_new_user()` trigger (`001:613-654`, marks invites accepted `:647-650`); extended in `023`, `078`.
- **Tests:** `guestMerge.test.ts`, `tripMembers.test.ts`, `ghostCrew.test.ts`, `src/lib/email.test.ts`. **Gap:** no e2e for the `/invite` accept page.

### 2.2 Destination / idea voting — **PARTIAL**

- **DB:** `ideas` (`001:145`), `catalog_ideas` (`:167`), `archived_ideas` (`:191`), `idea_lodging_options` (`:212`), `idea_votes` (`:228`, PK `(idea_id,user_id)`). Lock = `trips.locked_destination_{title,location,at}` (`:79-81`) + `comparison_mode`; **no boolean `locked` column** — lock ⇔ `locked_destination_at IS NOT NULL`.
- **Server:** real. `ideas.vote` (`ideas.ts:207-250`) single-pick-per-trip (deletes prior, inserts new, toggles off). Lock: `trips.lockDestination` (`trips.ts:249-280`, Owner-only, sets locked cols + flips `comparison_mode=false`). Lodging/archive routers real.
- **UI + wiring:** `IdeaZonePanel.tsx` (2112 lines, from `page.tsx:242-407`, gated on `comparison_mode`/no-lock). Vote button `:261-278`; `voteMutation` (`:1812`) optimistic `onMutate`+rollback+invalidate. Lock via `SetDestinationSheet` (`:1341`)→`lockDestination` (`:1386`) + archives losers.
- **⚠️ Gap — no realtime/poll for votes:** `useRealtimeTripData.ts:42-46` subscribes only to `quick_info_tiles, logistics_items, schedule_items` — **not `ideas`/`idea_votes`**. `ideas.list` has no `refetchInterval`. A peer's vote surfaces only via the actor's own invalidate or the global ~60s staleTime/refocus — no cross-device push.
- **Tests:** `ideas.test.ts` (9), `ideaLodging.test.ts` (9), `archivedIdeas.test.ts` (6). (No dedicated `lockDestination` test surfaced.)

### 2.3 Date polling — **WORKING**

- **DB:** `trips.poll_mode` (`001:90`); `date_windows`; `date_polls` (`:246-253`, PK `trip_id`, `locked_window_id`); `date_poll_votes` (`:256-262`, answer ∈ yes/no/maybe). Locked dates land on `trips.start_date/end_date`.
- **Server:** `datePoll.ts` (569 lines) — full loop, all real: `addWindow` (`:71`), `castDateVote` (`:117`), `castVoteForMember` (`:200`, Owner), `lockDateWindow` (`:292` → writes `trips.start/end_date` + `poll_mode=false`), `unlock`/`returnToPoll`/`setPollMode`. No stubs.
- **UI + wiring:** `DatePollStackedCards.tsx` (1365 lines) + `DatePollCard.tsx` (476, runs the mutations), hosted on the **Schedule/Itinerary tab** (`ItineraryPanel.tsx:90` member, `FreshTripGuide.tsx:201` owner). Real tRPC, optimistic. Confirmed live by `e2e/trip-detail.spec.ts:301-310`.
- **⚠️ Doc/PR drift:** the "PR #151 transposed grid + ResizeObserver vote cells" panel **does not exist** — zero `transpos`/`ResizeObserver` in any date component. Superseded by stacked cards (`DatePollCard.tsx:386` comment: "DatePollGrid (Doodle-style table) is superseded"). The surviving `DatePollGrid` is **marketing decoration** (`HeroSection.tsx:96`), unrelated.
- **Tests:** `datePoll.test.ts` (279 lines). **Gap:** `castVoteForMember` and `setPollMode` have no unit test; no full create→vote→lock e2e.

### 2.4 Chat — **PARTIAL** (trip WORKING; team chat has no UI)

- **DB:** `messages` (`001:411-419`) — `channel CHECK IN ('trip','team')` (`:415`), `team_id` (`:416`), `chk_team_channel` (`:419`). `008_chat_visibility_split.sql` adds `visibility ('crew'|'planning')` + per-member floors; `009` composite index; `010_chat_reads.sql` read-state.
- **Server:** `messages.ts` real — `list` (`:59`, requires `teamId` for team channel, filters `.eq("team_id")` `:118-126`), `send` (`:232`, forces team `visibility='crew'` `:269-273`), `markRead`, `clearChannel` (Owner). Distinguishes trip vs team correctly.
- **Realtime:** genuine subscription — `useRealtimeChat.ts:128-146` (`supabase.channel(...).on("postgres_changes",{INSERT,messages}).subscribe()`), prepends on INSERT. Hook supports `"team"` mode (`:70-77`) but is **only ever mounted with `"trip"`** (`FloatingChatPanel.tsx:1090`).
- **⚠️ Gap — team chat has no frontend:** only `FloatingChatPanel.tsx` exists; it hardcodes `channel:"trip"` everywhere (`:230,:407-413`) and renders the two trip sub-channels (Crew/Organizers tabs `:442-476`). **No component passes `channel:"team"`.** Team chat is backend-complete, UI-absent.
- **✅ Team privacy is DB-enforced (not UI-only):** `messages_select` RLS (`001:956-971`, re-created `008:86-107`) gates team rows on a `team_assignments`→`competitions` `EXISTS` check for `auth.uid()`; `messages_insert` has the identical gate (`008:62-84`). A non-team member gets zero rows from a team channel at the DB. Not a security hole — a missing feature.
- **Tests:** `messages.test.ts` (13). **Gap:** only team test is `send`-requires-teamId validation (`:39`); no end-to-end team-member-vs-non-member authorization test.

### 2.5 Expenses — **PARTIAL** (no settlement view)

- **DB:** `expenses` (`001:366-375`: `amount numeric(10,2)`, `paid_by_user_id`, `date`) + `expense_splits` (`:378-384`: PK `(expense_id,user_id)`, `amount` nullable = even, `opted_out`). RLS `:840-868`.
- **Server:** `expenses.ts` (265 lines), real, no stubs — `list` (`:10-49`, batches splits), `create` (`:54-114`, rolls back on split failure), `updateSplits` (`:120-186`, Owner), `optOut` (`:191-235`), `remove` (`:240-264`, Organizer). **No `balances`/`settlement` procedure.**
- **UI + wiring:** `ExpensesTab`→`ExpensesSection`→`AddExpenseModal`/`EditExpenseModal`/`SplitPanel`, mounted `page.tsx:540` (gated `!isIdea`). Real: `expenses.list.useQuery` (`ExpensesSection.tsx:580`), `create`/`optOut` mutations. Not mock.
- **⚠️ Gap — settlement absent:** `ExpensesSection.tsx:612-632` computes a per-person net `Map<userId,number>` → "Balances" panel (`:905-975`, `+$X`/`-$X`, "All settled up 🎉"). **No pairwise minimized-transaction ("Alice pays Bob $20") netting** anywhere in `ExpensesSection`/`SplitPanel`/router. (Marketing copy `FeaturesSection.tsx:22` "No more Excel settlement math" is not backed by code — see §6.) DEFERRED's underlying premise (settlement not built) is **true in code**, though DEFERRED does not actually state it (see §3).
- **Tests:** `expenses.test.ts` (183 lines, 10 cases: create/list/updateSplits perms/optOut/remove). **Gap:** no test asserts the balance reducer math.

---

## 3 · Doc drift map

**Headline:** the fresh docs (README/TRACKER/DEFERRED/CLAUDE, all ≥07-14) are broadly trustworthy; the drift is concentrated in **STYLE_GUIDE** (stale tab anchors) and **dated point-in-time audits** (NAV_AUDIT, COMPETITION_ENGINE). Critically, **the spec's own premises about DEFERRED are stale** — DEFERRED no longer documents planning-half stubs (it's engine/polish-scoped), so "DEFERRED says invite/settlement is stubbed" could not be reproduced.

| Doc | Class | Concrete drift example(s) |
|-----|-------|---------------------------|
| `README.md` | **ACCURATE** | Stack line + quick-start match reality; no stale claims found. |
| `TRACKER.md` | **PARTIALLY DRIFTED** | "NEXT… **no root `README.md` exists**" (line 54-55) — but `README.md` is present (78 lines, committed 07-18). Otherwise self-aware ("code is ground truth"). |
| `DEFERRED.md` | **ACCURATE (but engine-scoped)** | Fresh (07-19) and correct for what it covers — but it covers **only the competition/gaming engine + polish** (headers §L1-701). It contains **no "invite stubbed" and no "expense settlement" entry** (grep: only `circle_settlements`, the betting layer, L541). The spec's attribution of planning-half stub-claims to DEFERRED is unfounded in the current file. |
| `STYLE_GUIDE.md` | **PARTIALLY DRIFTED** | Cites `tabs/CompTab.tsx:916-918` (L476) and `tabs/MoreTab.tsx:772` (L486) — **both files do not exist** (tabs refactored). Token system itself still valid. |
| `CLAUDE.md` | **ACCURATE** *(verification: operated-from, not line-audited)* | Fresh (07-18); patterns match observed code. No stale numeric claims found (grep). |
| `PERMISSIONS.md` | **UNVERIFIED — likely PARTIALLY DRIFTED** | Not line-audited (competition-side, ~out of scope). Open issue **#448** explicitly flags "team procedures drifted looser than the owner-only UI" — a live permissions doc/code drift to assume until reconciled. |
| `CONTRIBUTING.md` | **ACCURATE** *(unverified beyond skim)* | Fresh (07-18), referenced by README; no contradiction surfaced. |
| `NAV_AUDIT.md` | **SUPERSEDED-BUT-PRESENT** | Self-labels "Report-only inventory (2026-06-13)"; a point-in-time nav snapshot pre-dating the panel/app-bar work — read as history, not current tree. |
| `COMPETITION_ENGINE.md` | **UNVERIFIED — likely BADLY DRIFTED** | Dated 06-09; pre-dates ~2 months of heavy engine work (rack/stroke/settings overhaul, migs 062-090). Out of audit scope to verify; treat with suspicion. |
| `W-GAMEPAGE-01_*.md` (×2) | **SUPERSEDED-BUT-PRESENT** | 06-27/28 game-page lifecycle/visual working docs; out of scope, likely partially overtaken. |
| `DOMAIN_AND_EMAIL.md` | **UNVERIFIED** | 06-21 infra doc; not audited (out of scope). Resend wiring it describes is confirmed present (§2.1). |
| `ENVIRONMENT_AUDIT.md` | **ACCURATE (by reference)** | Fresh (07-18); the spec itself defers env/security to it. Not re-audited. |
| `_archive/REPO_AUDIT_2026-07-11.md` | **SUPERSEDED-BUT-PRESENT** | Archived by location + dated name; prior audit snapshot. |
| `design/**` (6 files) | **SUPERSEDED-BUT-PRESENT** | May–June design handoffs (itinerary/tripsettings/ui_kits); pre-date shipped UI. |
| `src/content/legal/{privacy,terms}.md` | **ACCURATE (not content-audited)** | Fresh (07-14); shipped legal copy, not status docs. |

### 3b · `.md` inventory (repo, excl. `node_modules`/`.next`/worktrees)

| Path | ~Lines | Last commit | Claims to be | Keep/Stale/Unsure |
|------|-------:|-------------|--------------|-------------------|
| `CLAUDE.md` | 534 | 2026-07-18 | Patterns/conventions CC must follow | **Keep** |
| `COMPETITION_ENGINE.md` | 615 | 2026-06-09 | Competition engine design/spec | **Stale** (out of scope) |
| `CONTRIBUTING.md` | 83 | 2026-07-18 | Commit/PR/migration/test rules | **Keep** |
| `DEFERRED.md` | 734 | 2026-07-19 | Deferred work backlog (engine/polish) | **Keep** |
| `DOMAIN_AND_EMAIL.md` | 134 | 2026-06-21 | Domain + email/Resend setup | **Unsure** |
| `ENVIRONMENT_AUDIT.md` | 245 | 2026-07-18 | Env/CI/deploy map | **Keep** (out of scope) |
| `NAV_AUDIT.md` | 156 | 2026-06-13 | Point-in-time navigation inventory | **Stale** (snapshot) |
| `PERMISSIONS.md` | 349 | 2026-07-14 | Who-can-do-what matrix | **Unsure** (see #448) |
| `README.md` | 78 | 2026-07-18 | Repo intro + quick start | **Keep** |
| `STYLE_GUIDE.md` | 545 | 2026-07-11 | Visual system + tokens | **Keep w/ fixes** (stale anchors) |
| `TRACKER.md` | 145 | 2026-07-18 | Forward-strategy SoR (repl. PROJECT_STATUS) | **Keep** |
| `W-GAMEPAGE-01_game_page_lifecycle.md` | 419 | 2026-06-27 | Game-page lifecycle working doc | **Stale** (out of scope) |
| `W-GAMEPAGE-01_visual_vocabulary.md` | 302 | 2026-06-28 | Game-page visual vocab | **Stale** (out of scope) |
| `_archive/REPO_AUDIT_2026-07-11.md` | 207 | 2026-07-11 | Prior repo audit | **Stale** (archived) |
| `design/README.md` | 331 | 2026-06-06 | Design-handoff index | **Stale** |
| `design/SKILL.md` | 85 | 2026-05-27 | Design skill notes | **Stale** |
| `design/design_handoff_itinerary/README.md` | 57 | 2026-06-06 | Itinerary handoff | **Stale** |
| `design/design_handoff_itinerary/SPEC-itinerary-home.md` | 95 | 2026-06-06 | Itinerary-home spec | **Stale** |
| `design/design_handoff_tripsettings/README.md` | 87 | 2026-06-07 | Trip-settings handoff | **Stale** |
| `design/ui_kits/app/README.md` | 77 | 2026-05-27 | UI-kit notes | **Stale** |
| `src/content/legal/privacy.md` | 186 | 2026-07-14 | Shipped privacy policy | **Keep** |
| `src/content/legal/terms.md` | 172 | 2026-07-14 | Shipped terms | **Keep** |

*(Not listed: `PROJECT_STATUS.md` — deleted, replaced by TRACKER; the spec's reference to it is stale.)*

---

## 4 · Open GitHub issues (`gh` authed — inventory only, not triaged)

24 open. None are planning-half feature-gaps except #647 (crew/lodging modal shell) — the backlog skews competition/engine + infra.

| # | Title | Age | Labels |
|---|-------|-----|--------|
| 658 | Unify bare team-color dots onto the smart Avatar dot mode | 3h | refactor, polish |
| 647 | Migrate crew/lodging modals onto the extracted SettingsSlideOver shell | 1d | refactor, post-launch |
| 641 | Verify Step 0 in prod (~07-21): egress/Disk-IO flat + trips churn frozen | 1d | chore, pre-launch |
| 634 | Security: Preview holds RLS-bypass service-role key + points at prod Supabase | 1d | chore, pre-launch |
| 630 | Retire test-only per-row game-config mutations (migrate to save_game_config) | 1d | refactor, post-launch |
| 619 | Settings confirm-on-leave: deep-link (?settings=1) back skips prompt | 2d | polish |
| 595 | `game_participants.team_id` has no FK constraint (stale team refs) | 6d | refactor, post-launch |
| 594 | Rack score_entries orphaned when play-groups rebuilt (dangling participant_id) | 6d | bug, polish |
| 558 | Quick Game format→game picker (trip-less/standalone creation) | 11d | feature, post-launch |
| 553 | news.test.ts unreadCount test clock-skew fragile | 12d | chore, polish |
| 550 | Competition-face: context-aware app bar into persistent TopNav | 13d | feature, polish |
| 549 | Vitest collects stale .claude/worktrees/** copies | 13d | chore, polish |
| 517 | Touch-aware DnD: cross-container drag (agenda + roster assign) | 19d | refactor, polish |
| 504 | Non-golf declared-outcome control — full visual refresh | 20d | feature, polish |
| 470 | Silent score-orphan on player reassign/re-pairing | 23d | bug, post-launch |
| 459 | Stroke critical-path E2E: keypad step flakes in CI | 25d | chore, polish |
| 453 | tripStatus.test.ts countdown tests wall-clock/TZ-sensitive | 25d | chore, polish |
| 451 | Alive-face Phase 3: cold-load assembling animation | 26d | feature, pre-launch |
| 448 | Permissions reconciliation: team procedures drifted looser than owner-only UI | 26d | refactor, post-launch |
| 440 | Archive game_type_templates table (readers migrated to code) | 27d | refactor, post-launch |
| 419 | BBMI-replay acceptance E2E — validate scoring on last year's event | 28d | feature, polish |
| 416 | Per-user tee assignment | 29d | feature, post-launch |
| 412 | Add-game modal — show only format-compatible options | 29d | feature, polish |
| 411 | Add-time gate — prevent incompatible-format game | 29d | refactor, polish |

---

## 5 · Incidental findings (parking lot — one line each, NOT chased)

1. **Marketing copy oversells a missing feature:** `src/components/marketing/FeaturesSection.tsx:22` promises "No more Excel settlement math after the trip" — but no settlement/netting exists (§2.5). Claim not backed by code.
2. **Destination votes are not push-synced** — `idea_votes`/`ideas` absent from `useRealtimeTripData.ts:42-46` and unpolled; cross-device vote visibility lags ~60s (§2.2). Below the bar the other planning surfaces set (chat + logistics/schedule are realtime).
3. **Team chat is dead-but-built** — full schema + DB-enforced RLS + router + a `"team"`-capable realtime hook, zero UI to reach it (§2.4). Either wire a surface or note it as intentionally parked.
4. **`STYLE_GUIDE.md` cites deleted tab files** (`CompTab.tsx`, `MoreTab.tsx`) — line-anchored checklist items point at nonexistent paths (§3).
5. **`TRACKER.md` says README doesn't exist; it does** (§3) — the "R2 docs nearly done, only README missing" item is complete-but-unmarked.
6. **Two date-poll procedures untested** — `castVoteForMember` (Owner-votes-for-ghost, a real write path) and `setPollMode` have zero unit coverage (§2.3).
7. **`DatePollGrid` name collision** — a superseded Doodle-grid name survives only as marketing decoration (`HeroSection.tsx:96`); anyone grepping `DatePollGrid` expecting the live feature will be misled (§2.3).
8. **Known score-orphan bugs already filed** (#470, #594) — out of scope (competition side), noted only so they're not re-discovered as "new."
9. **`_archive/` migration copies exist** alongside active ones (idea/invite/expense schema) — audit-noise for anyone grepping migrations; the active definitions all live in `001_initial_schema.sql`.

---

*End of audit. Deliverable is this file, uncommitted. No code, docs, DB, or issues were modified.*
