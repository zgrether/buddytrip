# Claude Code handoff — BuddyTrip UI refresh
# 2026-05-25

> **Read this entire document before touching any code.** The plan below is
> the product of dozens of design iterations with the founder; deviating
> from it without justification will produce work that has to be redone.
> When in doubt, ask, don't guess.

> **Path convention.** Every design-system file referenced in this doc
> lives under `design/` at the repo root. If a path in this document
> doesn't have that prefix, prepend it. The only exceptions are paths
> starting with `src/` or `public/` — those are your actual production
> code under `github.com/zgrether/buddytrip`.

---

## 0. Rules of engagement

These rules are non-negotiable. Re-read them whenever you find yourself
inventing instead of implementing.

1. **The design system in this repo is the source of truth.** Files
   that matter (all paths relative to repo root, under `design/`):
   - `design/colors_and_type.css` — the new token values
   - `design/README.md` — voice, visuals, **field-naming standards**, secondary-color rules, iconography
   - `design/explorations.html` + its companion `.jsx` partials — the actual
     spec for every screen you're building. Open it in a browser before
     starting any task and look at the relevant artboard.
   - `design/preview/*.html` — canonical per-component specs
   - `design/ui_kits/app/` — hi-fi React recreations of core screens, useful
     when the spec needs more visual reference than the artboards provide

2. **Do not redesign.** If the spec shows a 320px left rail with two
   sections, build a 320px left rail with two sections. If a button is
   teal with `#0d1f1a` text on a 12px radius, build that. The visual
   decisions are settled — your job is implementation fidelity, not
   creative direction.

3. **If you genuinely believe a deviation is necessary**, you must:
   - Stop before writing code.
   - Write a short "Proposed deviation" note: *what* the spec says, *what*
     you want to do instead, *why* you think the spec is wrong, *what
     ships if you're wrong*.
   - Ask the user to approve it before proceeding.
   - Acceptable reasons: an unfixable accessibility issue, an existing
     constraint in the codebase that the design literally can't honor,
     or a token/component the spec references that doesn't exist.
   - Unacceptable reasons: "I think it looks cleaner this way",
     "Tailwind has a class that's close enough", "I'd prefer to use
     shadcn", "this is a more standard pattern".

4. **Token-first. Never hardcode hex.** Every color in your output
   should resolve to a `var(--color-bt-*)` reference. If you find
   yourself writing `#0a0e1a` directly, you missed a token. The only
   exceptions are values that explicitly appear in `colors_and_type.css`
   inside a gradient definition.

5. **Don't introduce new dependencies.** No `shadcn`, no `radix`, no
   alternative icon packs. The project uses lucide-react and (sparingly)
   @tabler/icons-react. Don't add a new modal lib; the existing
   pattern in the codebase is fine.

6. **Don't refactor adjacent code.** If you're updating the receipt
   row, don't also rewrite the receipts page state management because
   it "looks weird". Stay in scope; flag refactors in your commit
   message and ask before doing them.

7. **Match the existing component naming and file structure** in
   `src/components/`. New components go alongside their siblings, not
   in a new `ui/` or `system/` folder.

8. **Commit each task in this document as its own PR/commit.** Don't
   batch unrelated changes.

---

## 1. Sequence

Do these in order. Each task builds on the previous one and is small
enough to ship independently.

| # | Task | Scope | Risk |
|---|---|---|---|
| 1 | Push lifted-surface tokens to `globals.css` | 4 lines | Low |
| 2 | Standardize form labels across all add/edit affordances | Find-and-replace + label component | Low |
| 3 | Lodging — "confirm" replaces "lock/winner" | Copy + component prop renames | Low |
| 4 | Rebuild the three empty-state desktop layouts (Lodging / Agenda / Receipts) | New shared components + page rewrites | Medium |
| 5 | Crew tab rewrite (data model + drawer/sheet editor) | Model + editor + permissions UI | High |
| 6 | Agenda rewrite (variable-length day list + drag sources) | Page rewrite + drag-drop wiring | High |

Open `explorations.html` in a browser as you go. Each section in the
canvas maps to one of these tasks.

---

## 2. Task details

### Task 1 — Push the new tokens

**Goal:** Surfaces stop reading mushy. Cards have real elevation against
the base.

**Change** the dark-mode block in `src/app/globals.css`:

```css
.dark {
  --color-bt-card:        #161e2f;  /* was #111827 */
  --color-bt-card-raised: #1f2a40;  /* was #1a2130 */
  --color-bt-card-float:  #2a3654;  /* was #222b3d */
  --color-bt-border:      rgba(148, 163, 184, 0.18);  /* was 0.15 */
}
```

**Do not** touch the `:root` (light-mode) values. The app ships dark-only
but the light tokens are spec'd for parity.

**Acceptance:** Open the dashboard and a trip. Surfaces should look
visibly stepped — page → card → input. Borders should feel slightly
more present without becoming heavy. If the change looks subtle to you,
that's correct.

**Where to look in the design system:**
- `design/colors_and_type.css` lines 113–120 — the exact target values
- `design/preview/02-surfaces-dark.html` — visual reference of the lifted surfaces
- `design/README.md` "Visual foundations" → "2026 update — Lifted surfaces"

---

### Task 2 — Form field naming consistency

**Goal:** Every add/edit affordance uses the same vocabulary so a user
who learns one form has learned all of them.

**Canonical labels** (full table is in `README.md` "Add / edit form field standards"):

| Concept | Label | Notes |
|---|---|---|
| Human-readable label of a thing | **Title** | Property, agenda item, receipt — all "Title" |
| Label for a person | **Name** | Crew only |
| Money | **Cost** | Right-aligned, `var(--font-mono)`, leading `$` |
| Single-day timing | **Date** | Singular — never "Day" |
| Multi-day range | **Check-in** + **Check-out** | Properties only — never "Dates" |
| Time of day | **Time** | Mono, `(optional)` hint where relevant |
| Web URL | **Link** | Mono, hint `(opens externally)` on edit |
| Free-form description | **Detail** or **Notes** | Multi-line, always optional |

**Do** a focused find/replace across `src/components/` and
`src/app/`:
- "What was it for?" → "Title"
- "Listing link" → "Link"
- "Total cost" → "Cost"
- "Amount" → "Cost"
- "Day" (as a form label) → "Date"
- Strip "(optional)" suffixes that don't follow the standard, add them
  where they're missing.

**Do not** rename props or database columns — only user-visible labels.

**Acceptance:** Every form across Lodging, Agenda, Receipts, and Crew
uses these exact labels. Money fields right-align with mono. Date
fields are singular for single-day items, paired for ranges.

**Where to look:**
- `design/README.md` "Add / edit form field standards" — the canonical table
- `design/explorations-edit-drawers.jsx` and `design/explorations-mobile-modals.jsx` —
  every label appears in its correct form

---

### Task 3 — Lodging confirm/confirmed (not lock/winner)

**Goal:** Multi-property and multi-leg trips are first-class. There's no
"winner" — there are confirmed properties (potentially more than one).

**Changes:**
1. Rename the `winner` / `locked` prop or boolean on `Property` rows to
   `confirmed`. Update the badge label to `✓ CONFIRMED` (check icon, teal
   fill `var(--color-bt-accent)` on `#0d1f1a` text, 4px radius, 10px font,
   `0.08em` letter-spacing, uppercase).
2. Allow multiple confirmed properties per trip. Whatever check prevents
   confirming more than one — remove it.
3. Copy edits:
   - Anywhere that says "Lock the winner" → "Confirm what you book"
   - Anywhere that says "Confirm the winner" → "Confirm any once they're booked"
   - Page header copy: *"Drop in the places you're considering so the
     crew can compare — links, prices, sleep counts. Confirm the one(s)
     you book, and they're locked in as official trip details.
     Multi-property and multi-leg trips are fine — confirm as many as
     you need."*

**Do not** remove the underlying "this is the official lodging" concept
— just allow more than one and rename the surface label.

**Where to look:**
- The "Empty states" section in `design/explorations.html`, "Lodging · after"
  artboard — the populated example shows the `✓ CONFIRMED` pill style
- `design/explorations-edit-drawers.jsx` → `PropertyEditDrawer` — the photo
  overlay pill is the canonical example

---

### Task 4 — Rebuild empty states for Lodging, Agenda, Receipts (desktop)

**Goal:** Stop being barren. Each empty tab teaches the user what the
populated state will look like and gives them an obvious primary action.

**The pattern is identical across all three tabs:**

```
┌─────────────────────────────────────────────────────┬─────────────┐
│ TAB EYEBROW                                         │             │
│ Tab title                                           │  [Boosted   │
│ One-line description of what the tab is for.       │   composer  │
│                                                     │   for       │
│ ┌─[ⓘ HOW A ___ WILL LOOK]──────────────────────┐  │   adding    │
│ │ ┌─[EXAMPLE]──────────────────────────────────┐│  │   the first │
│ │ │ (a populated example at full opacity)      ││  │   item]     │
│ │ └────────────────────────────────────────────┘│  │             │
│ └────────────────────────────────────────────────┘  │             │
└─────────────────────────────────────────────────────┴─────────────┘
```

**Build these shared components first** (one new file, e.g.
`src/components/SampleSection.tsx`):

```jsx
<SampleHeader label="How a property will look" />
```
Renders a teal-info pill with an `ⓘ` icon (size 11) and the label in
the `bt-planning` color, on `rgba(96,165,250,0.08)` fill with a
matching border.

```jsx
<SampleCard>{children}</SampleCard>
```
Renders a card with a `1px dashed rgba(96,165,250,0.30)` border and a
tiny `EXAMPLE` notch tag absolutely-positioned at top-left.

**Then update the three empty-state pages.** Each needs:
- The Sample callout containing one realistic populated example at
  **full opacity** (not dimmed)
- A boosted right-rail composer (`bt-accent-border` outline + `shadow-raised` + accent-color eyebrow + "Add your first ___" title)
- Body copy explaining the tab

**Do not** use the dim/faded ghost-row treatment for the example —
that's what we replaced because it reads as half-broken data. Render
the example at full opacity, framed as `EXAMPLE`.

**Do not** invent additional sections, illustrations, or onboarding
flows. The empty state is exactly: header + Sample callout + right-rail
composer. Nothing else.

**Where to look:**
- `design/explorations.html` → "Empty states — Lodging, Agenda, Receipts (desktop)"
- `design/explorations-empty.jsx` — full implementations of
  `LodgingAfter`, `ReceiptsAfter`, and the `SampleHeader` / `SampleCard` /
  `RailComposer` shared components

---

### Task 5 — Crew tab rewrite

**Goal:** A unified crew system that handles three lifecycle states
(Active / Invited / Placeholder) and two roles (Organizer / Member) on
top of the Owner.

**Data model. NO RSVP STATES.** The "Can't" / "Maybe" / "Going" /
"Pending" pattern is gone. Status is derived from the data:

- `status: 'active'` — has an email that matches a BuddyTrip account
- `status: 'invited'` — has an email, no account yet, invite sent
- `status: 'placeholder'` — name only, no email

Role is independent:
- `role: 'Owner'` — created the trip, single owner per trip
- `role: 'Organizer'` — promoted by the Owner, 95% of owner permissions
- `role: 'Member'` — default, no special permissions

**A user has two names:**
- `name` — the trip nickname the owner gives them ("Llama")
- `accountName` — their actual BT account name ("Jason Doherty"), read-only,
  only present for `status: 'active'` users

**Crew page (Organizer view, desktop):**

```
┌────────────────────────────────────────────┬─────────────────────┐
│ BBMI 2026 · Pinehurst, NC                  │  [Add a person]     │
│ Crew · N                                   │  composer (always   │
│ One-line description                       │  visible right rail)│
│                                            │                     │
│ ┌─Organizers·N───────────────────────────┐ │                     │
│ │ rows                                    │ │  [Status legend]    │
│ └────────────────────────────────────────┘ │  three rows:        │
│                                            │  Active / Invited / │
│ ┌─Crew·N─────────────────────────────────┐ │  Placeholder        │
│ │ rows                                    │ │                     │
│ └────────────────────────────────────────┘ │                     │
└────────────────────────────────────────────┴─────────────────────┘
```

**A row:**
- Avatar (team color circle with initials; placeholder = neutral
  `bt-card-raised` background with dim initials and a standard border;
  invited = team color + small amber ✉ corner badge)
- Trip nickname (`Llama`)
- Role pill if non-Member (Owner = amber border + faint amber fill;
  Organizer = teal border + faint teal fill)
- Subline: email in mono, plus an amber "· invited Xd ago" suffix when
  invited. **Placeholder rows have no subline.**

**Editor — drawer on desktop, bottom sheet on mobile.** Tap a row to
open it. Fields:
- **Trip nickname** (editable)
- **Account name** (read-only, only shown for Active users)
- **Email** with live validation:
  - `checking` → amber border + spinner + "Checking BuddyTrip…"
  - `match` → teal border + check icon + "Already on BuddyTrip — they'll
    be in the trip the moment you save"
  - `invite` → amber border + send icon + "We'll send an invite when
    you save"
  - `invalid` → red border + x icon + "That email doesn't look right.
    Or leave it blank — they'll be a placeholder."
- **Permissions** — a contextual control (NOT a segmented toggle):
  - Owner → amber-tinted explainer: "Created the trip. Change ownership
    from Trip settings."
  - Active Member → single "Make organizer" button + helper text
  - Active Organizer → teal-tinted card describing what an organizer
    can do + a danger-tinted "Remove organizer status" button below
  - Non-Active (Invited / Placeholder) → dashed explainer: "Only Active
    BuddyTrip users can be promoted."

**Member view of the Crew page** is read-only:
- No section banners, no Add button, no edit affordance
- One sorted list: Owner → Organizers → Active members → Invited → Placeholders
- Role pills still visible (so members know who to ask)
- Header copy: "Everyone on the trip. Tag {Owner} or {Organizers} with any planning questions."

**Do not** add drag-and-drop for status. Status is derived from data.

**Do not** add an RSVP system. That's not what this is.

**Where to look:**
- `design/explorations.html` → "Crew · editing & promotion" section — all four
  reference artboards (validation states, desktop drawer, mobile sheet,
  member view)
- `design/explorations-screens.jsx` → `CrewDesktop`, `CrewMobile`, `CrewMemberView`,
  `CrewEmpty`, `StatusLegend`, `CrewRow`, `CrewAvatar`, `RolePill`
- `design/explorations-crew-edit.jsx` → `MemberEditor`, `RoleControl`,
  `ValidationFeedback`

---

### Task 6 — Agenda rewrite

**Goal:** Variable-length day list (not a fixed 4-day grid) with a
left rail that holds two drag sources: ON DECK (unscheduled items) and
COMPETITION EVENTS (when competition mode is enabled).

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ AGENDA                                                          │
│ What you're actually doing                          [Add CTA]   │
│ Two-line description of what agenda is for                      │
├──────────────┬──────────────────────────────────────────────────┤
│ ON DECK      │ DAY-BY-DAY                                       │
│ ───────────  │ Drop an item onto a day to schedule it           │
│ [item]       │                                                  │
│ [item]       │ Day 1 — Wednesday, May 20                        │
│ [Plan more]  │ ┌────────────────────────────────────┐           │
│              │ │ 2:00p · Arrive · check in   [DRAFT]│           │
│ COMPETITION  │ └────────────────────────────────────┘           │
│ EVENTS       │                                                  │
│ ───────────  │ Day 2 — Thursday, May 21                         │
│ [chip]       │ ┌────────────────────────────────────┐           │
│ [chip]       │ │ 7:30a · Pinehurst No. 2     [DRAFT]│           │
│              │ └────────────────────────────────────┘           │
│              │                                                  │
│              │ Day 3 — ...                                      │
└──────────────┴──────────────────────────────────────────────────┘
```

**Day list scales with the trip dates.** If the trip is Sep 12–17,
render 6 day rows. If the trip is Sep 12–22, render 11. Days are not a
fixed grid.

**Agenda items have a status:** `DRAFT` (dashed border, dim text) or
`CONFIRMED` (teal pill, accent border). Same `DRAFT` / `CONFIRMED`
pattern as Lodging.

**Activity item kinds** are tagged by an icon-tile color:
- `travel` — blue (`#60a5fa`)
- `dining` — orange (`#fb923c`)
- `golf` — teal (`var(--color-bt-accent)`)
- `side-game` — amber (`#fbbf24`)

If a competition event is linked to the agenda item, show a small
teal `🏆 Scramble` reference link below the title.

**Add/edit drawer has two tabs: Activity / Golf Round** — matches your
existing modal in production. Don't change that. Golf Round fields:
golf course search (with "Verified" pill when matched to BuddyTrip's
DB), tee times list (times only — no player names), walk-on toggle.
Player pairings get set later from the Competition tab.

**Competition Events panel** is only visible if competition mode is on
for the trip. If off, render a dashed-border explainer in its place
with an "Enable competition →" link.

**Do not** invent new agenda categories beyond the four kinds above
without asking.

**Do not** force users to define competition events twice (once here
and once in the competition tab). Agenda items either reference an
existing competition event (via drag-drop from the COMPETITION EVENTS
rail) or are plain Activities.

**Where to look:**
- `design/explorations.html` → Empty states section → "Agenda · empty" and
  "Agenda · populated" artboards
- `design/explorations-empty.jsx` → `AgendaEmpty`, `AgendaAfter`, `AgendaDay`,
  `AgendaItemRow`, `AgendaDragSection`, `DraggableAgendaItem`,
  `CompetitionChip`

---

## 3. Things to double-check before opening a PR

For every task, before you submit:

- [ ] **No hardcoded hex** in the code you wrote. All colors are
      `var(--color-bt-*)` references.
- [ ] **Every form label** matches the table in `README.md`.
- [ ] **Money fields** are right-aligned and mono.
- [ ] **No team colors** anywhere outside the Competition tab and
      Scoreboard / Leaderboard. The main trip tabs don't use team colors.
- [ ] **No new dependencies.**
- [ ] **Match the spec** — open `explorations.html` next to your running
      app and visually compare. Spot the differences. Fix them.
- [ ] **The placeholder state** (no email crew members) doesn't use a
      dashed avatar or any "Placeholder" subline. Plain neutral avatar +
      name + role pill.
- [ ] **Status legend** lives in the right rail on the Crew page and is
      always visible — it's not behind a disclosure.

---

## 4. Things that are intentionally NOT in scope

So you don't go invent them:

- **Competition tab redesign.** Out of scope. Don't touch.
- **Live scoreboard / score-entry mobile UI.** Out of scope.
- **Marketing page.** Out of scope — it has its own raw-CSS world.
- **Brand mark replacement.** Not happening this round.
- **Light mode.** Spec'd in tokens; not in production. Don't ship light-mode UI.
- **Webfonts.** Not introducing any.
- **Notifications.** Dropped from the surface. Don't reference notifications in copy.
- **Crew RSVP states.** No "Going / Maybe / Can't". Status is derived
  from email validity, not chosen.
- **Phone numbers on crew rows.** Dropped — too intrusive for now.

---

## 5. If you hit something unspecified

Stop. Open a question in the PR or ask the user directly. The design
system is opinionated; if you're guessing, you're probably guessing
wrong. Listed in priority order, here's what to do:

1. Check `design/explorations.html` first — most things have an artboard.
2. Check `design/README.md` second — the field naming, secondary-color rules,
   and iconography section answer a lot.
3. Check the `design/*.jsx` partials — every component used in `explorations.html`
   has a working implementation.
4. Only then ask. And when you do, propose a specific solution rather
   than asking "what should I do?"
