# BuddyTrip Style Guide

Canonical reference for all styling decisions. Read this before making
any styling change. Based on the token system in `src/app/globals.css`.

**Theme system:** `next-themes` with `attribute="class"`, `.dark` class
toggle, default theme `dark`.

**Token system:** Single prefix `--color-bt-*`. No other token systems
exist. All color references must use `var(--color-bt-*)` tokens. Never
use raw hex values.

---

## Section 1: Surface Hierarchy

Four surface levels. Every component background must use exactly one of
these tokens.

### Level 0 — Page Background

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-base` | `--color-bt-base` |
| Value | `#d8e0e8` (cool grey — noticeably grey on any display) | `#0a0e1a` |

**Use:** outermost page/layout background. Applied to `body`.
**Examples:** trip page, dashboard, login page.

### Level 1 — Panel / Card Surface

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-card` | `--color-bt-card` |
| Value | `#ffffff` (white) | `#161e2f` |

**Use:** collapsible panels, card containers, inset form bodies inside
floating dialogs, anything that sits one level above the page but below
a floating dialog.
**Examples:** PlanningRow panels (Destination, Crew, Dates, Logistics),
TripCard, section bodies within modals.

### Level 2 — Elevated / Raised Surface

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-card-raised` | `--color-bt-card-raised` |
| Value | `#f4f7fa` | `#1f2a40` |

**Use:** elements sitting ON a card/panel — inactive buttons, zebra
table rows, input backgrounds, inactive compact chips.
**Examples:** inactive vote buttons (wide mode), alternating grid rows
in the dates response grid, inactive filter chips.

### Level 3 — Float Surface

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-card-float` | `--color-bt-card-float` |
| Value | `#e8edf5` | `#2a3654` |

**Use:** floating dialogs (modals, bottom sheets) and deeply nested
elevated elements (tooltips, popovers). This is the correct token for
any panel that floats above the overlay-darkened page — `card` alone
does not provide enough visual lift in dark mode.
**Examples:** InfoTileModal, FeedbackModal, AboutModal, any centered
dialog or bottom sheet rendered via `createPortal`.

### Chrome Surface (navigation elements)

Chrome elements sit above the page background but are distinct from
content panels. They frame the app — they don't contain content.

**Rule:** all chrome elements share exactly one surface token.

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-card` | `--color-bt-card` |
| Value | `#ffffff` (white) | `#111827` |

**Separation:** border only, no shadow. Content panels use `--shadow-raised`
for elevation; chrome uses `1px solid var(--color-bt-border)` for definition.

**Chrome elements (persistent app frame only):**
- Global top app bar (`TopNav`) — `border-bottom`. At `lg+` this includes
  Trip/Cup (Task 4, shell polish batch) — the same context tabs
  `AppTabBar` shows on mobile, positioned inside the top bar (x-aligned
  to the rail's right edge) rather than in a separate row below it.
- Bottom navigation bar (`AppTabBar`) — `border-top`. Home/Trip/Cup as
  destinations, Chat as an action (Phase 6).

This is a correction, not a new rule: Trip/Cup were always the SAME
items on both widths — the four-tab refactor just classified them
differently by accident of where each width happened to render them
(a separate, page-background-toned strip at `lg+`; the chrome-toned
bottom bar on mobile). One concept, one classification, regardless of
width — chrome, because they're the same tabs `AppTabBar` already was.

**Not chrome — contextual page structure (blend with page background):**
- Page breadcrumb bar (`TripBreadcrumb`) — inherits `--color-bt-base`
- Trip's own SUB-tab bar (`TripTabBar` — Home/Crew/Lodging/Agenda/
  Receipts, one level inside the Trip context tab) — inherits
  `--color-bt-base`. Distinct from the CONTEXT tabs above (Trip/Cup
  themselves, now chrome): sub-tabs are scoped to whichever context
  tab is active and stay page structure regardless of width — only
  the outer Trip/Cup pair was promoted.

### Surface border

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-border` | `--color-bt-border` |
| Value | `#c8d0da` | `rgba(148, 163, 184, 0.15)` |

**Use:** panel outlines, dividers, card edges. Every bordered surface component
uses this token for its `border-color`.

> **Note:** `--color-bt-subtle-border` (`#e2e8f0` light / `rgba(148,163,184,0.08)` dark) is a
> separate token that intentionally diverges from `--color-bt-border`. It is used
> as a **background fill** in scoring-format components (zebra stripes, inactive
> chips), not as a CSS border. Do not replace it with `--color-bt-border`.

---

## Section 2: Typography Tokens

> **Light mode contrast rule:** Light mode text must use darker values than dark mode — not the same values. Muted text in dark mode is light (`#94a3b8`) because it sits on a dark surface. Muted text in light mode must be dark enough (`#64748b` or darker) to read on a light surface. Never use opacity to dim text — use explicit token values. Opacity-based dimming compounds the contrast problem, especially in light mode.

| Role | Token | Light | Dark | Use |
|------|-------|-------|------|-----|
| Primary text | `--color-bt-text` | `#0f172a` | `#f1f5f9` | Headings, labels, names, body text |
| Secondary text | `--color-bt-text-dim` | `#64748b` | `#94a3b8` | Subtitles, descriptions, timestamps, counts |
| Accent text | `--color-bt-accent` | `#0d9488` | `#2dd4bf` | Links, active states, yes/works, teal highlights |
| Accent dim | `--color-bt-accent-dim` | `#0f766e` | `#14b8a6` | Hover state for accent text |
| Owner text | `--color-bt-owner` | `#d97706` | `#fbbf24` | Owner role badge (border + text) |
| Warning text | `--color-bt-warning` | `#d97706` | `#fbbf24` | Maybe/caution states — STATUS DISPLAY ONLY, not buttons |
| Glorious text | `--color-bt-glorious` | `#92720f` | `#c9852f` | Glorious Finishing Holes modifier ONLY (scorecard diamond/bracket/label, score-entry banner) — a deliberately different hue from Owner/Warning so the two are never mistaken on the same card (the scorecard's amber stroke pip already uses `--color-bt-warning`). Dark value verified live side-by-side with the pip + a GolfChip eagle ring (an initial `#e2a437` read too close). NOT a warning/amber substitute; NOT a score-value color (keep out of the eagle/birdie/par/bogey/dbl+ palette) |
| Danger text | `--color-bt-danger` | `#dc2626` | `#f87171` | Errors, Can't/declined, destructive actions |
| Planning text | `--color-bt-planning` | `#2563eb` | `#60a5fa` | Blue status indicators |
| Organizer text | `--color-bt-planning` | `#2563eb` | `#93c5fd` | Organizer role badge (fill/border/text) AND the rail's Organizer edge — one value, `src/lib/roleColor.ts`. Blue, NOT the accent: at the rail's 3px the accent competes with the selected-row treatment and the trophy mark, which are already teal on the same row |
| Ready text | `--color-bt-ready` | `#f97316` | `#fb923c` | Events/lodging tone (ItineraryView stripes, LodgingPanel rental). **Corrected 2026-08-12** — this row read `#7c3aed`/`#a78bfa` "Planner role badge, violet states", which was wrong on both counts: the token has always been orange in `globals.css`, and no role badge has ever used it |

---

## Section 3: Semantic Color Usage

| State | Background | Text/icon | Border |
|-------|-----------|-----------|--------|
| Yes / Works / Confirmed | `--color-bt-accent-faint` | `--color-bt-accent` | `--color-bt-accent-border` |
| Maybe / Pending | `--color-bt-warning-faint` | `--color-bt-warning` | `--color-bt-warning-border` |
| No / Can't / Declined | `--color-bt-danger-faint` | `--color-bt-danger` | `--color-bt-danger-border` |
| Warning / Low crew | `--color-bt-warning-faint` | `--color-bt-warning` | `--color-bt-warning-border` |
| Locked / Done | `--color-bt-tag-bg` | `--color-bt-accent` | `--color-bt-accent-border` |
| Ghost / Unknown | `--color-bt-border` | `--color-bt-text-dim` | `--color-bt-border` |
| Planning / In-progress | `--color-bt-card` | `--color-bt-accent` | `--color-bt-accent-border` |

### Vote answer colors (date poll — solid fills, mode-independent)

These apply in **both light and dark mode** — vote colors are semantic and do not change per theme. Use solid fills only; never opacity-reduced backgrounds on voted cells.

| Answer | Background token | Text token | Value |
|--------|-----------------|-----------|-------|
| Yes / Works | `--color-bt-vote-yes` | `--color-bt-vote-yes-text` | bg `#00d4aa` · text `#0d1f1a` |
| Maybe | `--color-bt-vote-maybe` | `--color-bt-vote-color` | bg `#f59e0b` · text `#ffffff` |
| No / Can't | `--color-bt-vote-no` | `--color-bt-vote-color` | bg `#ef4444` · text `#ffffff` |
| Unvoted | `transparent` | `--color-bt-text-dim` | dashed border, `?` placeholder |

**Implementation rule:** all vote cells — compact chips, wide 3-button rows, member view buttons — must use `VoteCell` with these tokens. No separate component per context.

### Background token values

| Token | Light | Dark |
|-------|-------|------|
| `--color-bt-tag-bg` | `#f0fdfa` (teal-50) | `#134e4a` (teal-900) |
| `--color-bt-accent-faint` | `rgba(13,148,136,0.08)` | `rgba(45,212,191,0.12)` |
| `--color-bt-warning-faint` | `rgba(217,119,6,0.08)` | `rgba(251,191,36,0.08)` |
| `--color-bt-glorious-faint` | `rgba(146,114,15,0.08)` | `rgba(201,133,47,0.10)` |
| `--color-bt-danger-faint` | `rgba(220,38,38,0.08)` | `rgba(248,113,113,0.12)` |
| `--color-bt-planning-faint` | `rgba(37,99,235,0.08)` | `rgba(96,165,250,0.08)` |
| `--color-bt-danger-bg` | `#fef2f2` | `#450a0a` |
| `--color-bt-blue-bg` | `#eff6ff` | `#1e3a5f` |
| `--color-bt-ready-bg` | `#f5f3ff` | `#2e1065` |

### Border token values

| Token | Light | Dark |
|-------|-------|------|
| `--color-bt-accent-border` | `rgba(13,148,136,0.22)` | `rgba(45,212,191,0.25)` |
| `--color-bt-warning-border` | `rgba(217,119,6,0.20)` | `rgba(251,191,36,0.20)` |
| `--color-bt-glorious-border` | `rgba(146,114,15,0.22)` | `rgba(201,133,47,0.35)` |
| `--color-bt-danger-border` | `rgba(220,38,38,0.20)` | `rgba(248,113,113,0.20)` |
| `--color-bt-planning-border` | `rgba(37,99,235,0.22)` | `rgba(96,165,250,0.25)` |

---

## Section 4: Component Patterns

### Invitation panel (empty state CTA)

Used for empty states that invite the user to add content.

```
Background:    var(--color-bt-surface-invitation)
               rgba(255,255,255,0.6) light / rgba(255,255,255,0.03) dark
Border:        1.5px dashed var(--color-bt-border)
Border radius: rounded-xl (same as content panels)
```

**Use for:** "Add a Competition", "Add Quick Info", "Add a Trip Description"
and any future empty-state CTA that signals "content can go here."

**Do NOT use for:** error states, loading states, informational callouts.

---

### Nudge banner (tab-level / form-level alert)

Compact card with an accent-tinted icon square + heading + dim subtitle.
Used at the top of a tab or above a form to flag actionable items
(e.g., "3 items still need confirmation"), heads-ups (e.g., "Arrival is
before the trip starts"), or anything else the user should glance at
without it interrupting flow.

```
Container:
  background:    var(--color-bt-card)
  border:        1px solid var(--color-bt-border)
  border-radius: rounded-xl
  padding:       px-4 py-3
  layout:        flex items-center gap-3

Icon square:
  size:          h-7 w-7 rounded-lg
  flex:          flex-shrink-0 items-center justify-center
  background:    var(--color-bt-accent-faint)   ← action-required tone
              OR var(--color-bt-warning-faint)  ← heads-up / warning tone
  color:         var(--color-bt-accent)         ← matches background
              OR var(--color-bt-warning)
  icon size:     14

Title:
  font:          text-[13px] font-semibold leading-tight
  color:         var(--color-bt-text)

Subtitle (optional):
  font:          text-[11px] leading-snug
  color:         var(--color-bt-text-dim)
  margin:        mt-0.5
```

**Two tones:**
- **Accent-faint** — actionable, drives a tab notification dot. Examples:
  "X items still need confirmation", "X items haven't been assigned to a day".
- **Warning-faint** — heads-up about a possible mistake. Examples:
  "X items fall outside the trip dates", "Arrival is before the trip starts",
  "X properties have dates outside the trip".

**Placement:** at the very top of the tab (above the section header) so
nudges read as tab-level alerts, not section content. Multiple nudges may
stack — order them by priority.

**Do NOT use for:** error states (use danger tokens), success confirmations
(use a toast), or generic info that doesn't need user attention.

---

### Transient system message (app-level strip)

A third surface category: neither **chrome** (the persistent app frame) nor
**page structure** (content panels). A thin, dismissible, app-level strip for
messages about the *app itself* — install prompts, notification permission
state, connectivity. Distinct from the **Nudge banner** above, which is
*tab-level*, about trip **content**, and rendered as a rounded card inside the
content column. A transient system message is full-bleed and chrome-adjacent.

```
Container:
  placement:     in normal document flow, directly below the top app bar and
                 ABOVE all page content — full-bleed width (no side margins,
                 no border radius). It scrolls away with the page: never
                 fixed/sticky, never covers content, never collides with the
                 bottom nav or in-page action bars.
  background:    var(--color-bt-card)               ← chrome surface
  border:        border-bottom 1px solid var(--color-bt-border)
                 (no shadow — chrome-style separation, per Section 1)
  padding:       px-4 py-2.5
  layout:        flex items-center gap-3
  min-height:    44px (single-line touch target)

Icon square (optional):
  size:          h-7 w-7 rounded-lg, flex-shrink-0
  background:    var(--color-bt-accent-faint)   ← informational / action tone
              OR var(--color-bt-warning-faint)  ← blocked / attention tone
  color:         var(--color-bt-accent) OR var(--color-bt-warning) (matches bg)
  icon size:     14

Message:
  font:          text-[13px] leading-snug font-medium
  color:         var(--color-bt-text)
  detail line:   text-[11px] leading-snug, var(--color-bt-text-dim), mt-0.5

Action (optional, ONE max):
  a Small Secondary button (Section 5) or an accent text link.
  NEVER a Primary teal fill — the strip must not outshout page CTAs.

Dismiss (required):
  X icon button, h-7 w-7 rounded-full, var(--color-bt-text-dim),
  right-aligned, aria-label "Dismiss".
```

**Behavior rules (part of the pattern, not per-feature):**
- Every transient system message MUST be dismissible; dismissal MUST persist
  (localStorage) with a **decay window** (suppressed for a period, may return
  once) — never permanently gone by default, never undismissable.
- Never shown on a user's first load — gate on engagement.
- One strip at a time — if multiple qualify, show only the highest-priority.

**Use for:** PWA install prompt, notification-permission state, connectivity
or app-update notices.

**Do NOT use for:** trip-content alerts (Nudge banner), errors (danger
tokens), success confirmations (toast).

---

### Sample callout (empty-state EXAMPLE frame)

Used in tab empty states to show "what this'll look like once populated." Replaces the older dim/ghost-row treatment which read as half-broken data. Implementation lives in [`src/components/SampleSection.tsx`](src/components/SampleSection.tsx) and exports three primitives:

- **`<SampleHeader label="How a property will look" />`** — planning-blue pill (`bt-planning-faint` fill, `bt-planning-border` outline, `bt-planning` text). Uppercase 10px, 0.12em tracking, with a lucide `Info` icon at 11px.
- **`<SampleCard>...</SampleCard>`** — wraps a populated example in a dashed `bt-planning-border` frame with an absolutely-positioned `EXAMPLE` notch tag at top-left. The example inside renders at **full opacity** — do NOT dim or ghost it.
- **`<RailComposer title primary onPrimary boosted hint />`** — the right-rail primary CTA for empty states. `boosted` adds `bt-accent-border` outline, `--shadow-raised`, and a teal eyebrow. The primary button uses `bt-accent` background on `bt-on-accent` text.

**Layout (desktop only):** `lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-5` — main column holds SampleHeader + SampleCard; right rail holds the RailComposer. The header pill `+Property` / `+Receipt` is **suppressed when empty** so the boosted composer is the only primary CTA.

**Mobile fallback:** drop back to the original `<EmptyState>` icon + headline + subtext + the existing `TabFab`. The Sample/Rail pattern is desktop-only.

### Collapsible planning panel (PlanningRow)

```
Container background:
  done:        var(--color-bt-tag-bg)
  in-progress: var(--color-bt-card)
  todo:        var(--color-bt-card)
Header padding:  px-4 py-3.5
Body padding:    px-4 pb-4 pt-3
Border:          1px solid [borderColor based on state]
Border radius:   rounded-xl
Shadow (closed): var(--shadow-card)
Shadow (open):   var(--shadow-raised)
```

### Data table (dates grid, crew list, any future tabular data)

**Borders:**
- Row dividers: `1px solid var(--color-bt-border)` between rows
- Row header right border: `1px solid var(--color-bt-border)` (anchors crew name column)
- Column header bottom border: `1px solid var(--color-bt-border)` separating headers from data
- No vertical borders on data cells

**Alternating rows:**
- Odd: transparent
- Even: `rgba(0,0,0,0.025)` light / `rgba(255,255,255,0.025)` dark — barely perceptible; scanability only

**Voted cells (yes / maybe / no):** fill only, no border
```
Yes:    bg rgba(0, 212, 170, 0.15)   text var(--color-bt-accent)
Maybe:  bg rgba(245, 158, 11, 0.15)  text #d97706  (amber-600, not orange)
No:     bg rgba(239, 68, 68, 0.15)   text #dc2626
```

**Empty/unvoted cells:** no fill, dashed border
```
Border:     1px dashed var(--color-bt-border)
Character:  · (middle dot)
Text:       var(--color-bt-text-dim)
```

Never use a full cell grid (borders on all 4 sides of every cell).
Never increase alternating row opacity above 0.03.

### Role badge (RoleBadge component)

Three role states, two of them marked. Colours come from ONE source —
`src/lib/roleColor.ts` — read by `RoleBadge`, the crew roster's `RolePill`, and
the desktop rail's 3px role edge, so a badge and an edge cannot disagree.

```
Style:      inline-flex rounded-full px-2 py-0.5
Font:       text-[10px] font-bold uppercase tracking-wider
Owner:      var(--color-bt-owner)    on -warning-faint  / -warning-border   (amber)
Organizer:  var(--color-bt-planning) on -planning-faint / -planning-border  (blue)
Member:     not rendered (returns null)
```

Organizer was teal (`--color-bt-accent`) until 2026-08-12. It was never blue
before that despite a widely-held belief otherwise — it was created as a
hardcoded `#00d4aa` and the hex-to-token pass turned that into the accent. It is
blue now because the rail paints the role as a 3px edge, where the accent
collides with the selected-row treatment and the trophy mark. Do not give
Organizer the accent.

### Overlay / Modal backdrop

Three scrim strengths. Pick by surface type — heavier UI gets a heavier backdrop.

```
Full modal:        var(--color-bt-overlay)
                   light rgba(0,0,0,0.5)  ·  dark rgba(0,0,0,0.7)

Mobile sheet:      var(--color-bt-overlay-sheet)
                   light rgba(0,0,0,0.45) ·  dark rgba(0,0,0,0.55)

Desktop drawer:    var(--color-bt-overlay-drawer)
                   light rgba(0,0,0,0.30) ·  dark rgba(0,0,0,0.40)
```

Drawer scrims are intentionally lighter so the underlying page reads as still-present context (you can see the row you tapped), not blacked-out behind a modal.

---

## Section 5: Button System

Five variants. Use exactly these — no custom one-off button styles.

**No reusable Button component exists.** All buttons are styled inline.
Until a shared component is created, copy these patterns exactly.

### Primary

| | |
|---|---|
| **When** | Main CTA on a screen (Lock, Save, Add, Send, Create) |
| **Background** | `var(--color-bt-accent)` |
| **Text** | `var(--color-bt-base)` |
| **Border** | none |
| **Icon** | optional, left of label |
| **Never** | destructive actions |

### Secondary

| | |
|---|---|
| **When** | Supporting actions (Manage crew, Save changes, outlined Cancel) |
| **Background** | `var(--color-bt-card-raised)` |
| **Text** | `var(--color-bt-text)` |
| **Border** | `0.5px solid var(--color-bt-border)` |
| **Icon** | optional |

### Ghost

| | |
|---|---|
| **When** | Low-emphasis actions (Cancel, dismiss, text links) |
| **Background** | transparent |
| **Text** | `var(--color-bt-text-dim)` |
| **Border** | `0.5px solid var(--color-bt-border)` or none for text links |
| **Icon** | optional |

### Danger

| | |
|---|---|
| **When** | Destructive actions only (Remove, Delete) |
| **Background** | `var(--color-bt-danger)` |
| **Text** | white |
| **Border** | none |
| **Always** | requires confirmation dialog before executing |

### Dashed / Add

| | |
|---|---|
| **When** | Create/add affordances (Add date option, Add expense) |
| **Background** | transparent |
| **Text** | `var(--color-bt-accent)` |
| **Border** | `1.5px dashed var(--color-bt-accent)` |
| **Icon** | always `+` on left |

### Three sizes

| Size | Padding | Font size | Use |
|------|---------|-----------|-----|
| Small | `px-3 py-1.5` | `text-xs` (12px) | Table rows, inline actions, compact UI |
| Medium | `px-4 py-2.5` | `text-sm` (14px) | Default for most buttons |
| Large | `px-6 py-3` | `text-sm` (14px) | Primary CTA, full-width actions |

### Icon rules

- **Icon only:** tight spaces, universally understood symbols only
  (`X` close, `+` add, lock icon). Always include `aria-label`.
  Size: `h-8 w-8` or `h-9 w-9` circle with `rounded-full`.
- **Icon + text:** preferred for primary actions where icon reinforces
  meaning. Icon left of label with `gap-2`.
- **Text only:** acceptable for ghost and secondary where icon adds
  nothing.

### Button states (all variants)

| State | Treatment |
|-------|-----------|
| Default | as specified above |
| Hover | `hover:opacity-90` or subtle background tint |
| Active/pressed | `active:scale-[0.98]` |
| Disabled | `opacity-40`, `cursor: not-allowed` — never change color |
| Loading | spinner replaces icon (`Loader2 className="animate-spin"`), text stays, disabled state applies |

### Border radius on buttons

| Shape | Radius | Use |
|-------|--------|-----|
| Standard | `rounded-xl` | Primary, Secondary, Ghost, Danger, modals |
| Pill | `rounded-full` | Filter chips, icon-only circles, send buttons |
| Compact | `rounded-md` | Small inline edit controls |
| None | — | Nav items, tabs |

---

## Section 6: What NOT to Do

- [ ] **Do not hardcode `#00d4aa`** — use `var(--color-bt-accent)`.
      Found in 17+ places. Every instance must be migrated.
- [ ] **Do not use amber/yellow as a button background** — amber is for
      vote status chips and warning banners only, not actions.
- [ ] **Do not use `rgba(0,0,0,0.4)` for overlays** — use
      `var(--color-bt-overlay)` which is already defined.
- [ ] **Do not set background colors ad-hoc** — use the surface
      hierarchy tokens from Section 1.
- [ ] **Do not use light-only or dark-only hardcoded colors** — every
      color must resolve correctly in both modes via the token system.
- [ ] **Do not set `--color-bt-card-raised` and `--color-bt-base` to
      the same value** — they must be visibly distinct in both modes.
- [ ] **Do not set custom padding per-button** — use the three sizes
      defined in Section 5.
- [ ] **Do not use teal for anything other than Primary variant** — if
      something is teal-filled and clickable, it must be a Primary button.
- [ ] **Do not create new button styles** without adding them to this
      guide first.
- [ ] **Do not use icon-only buttons for ambiguous actions** — reserve
      for universally understood symbols only.
- [ ] **Do not vary `border-radius` arbitrarily** — use the four shapes
      from the button system (`rounded-xl`, `rounded-full`, `rounded-md`,
      or none for nav).
- [ ] **Do not use Tailwind color utilities** (`bg-white`, `text-gray-*`)
      for themeable surfaces. Use `var(--color-bt-*)` tokens.

---

## Section 7: Token migration — status, and how to re-check it

**Status: essentially done.** Of the five patterns the original audit listed,
three have shipped, one was withdrawn as incorrect, and one remains — plus a
second that needs a design decision rather than a find-and-replace. This is no
longer a backlog you work through; it is two known items.

**This section no longer lists file paths and line numbers, deliberately.**
The version it replaces did, and by Aug 2026 it named three files that no longer
existed, said a colour was hardcoded "in 17+ places" when it was in two, listed
two whole patterns that were already finished, and — the part that matters —
*missed* new instances of a pattern it did list. A hand-maintained path list
decays in both directions at once, and a reader cannot tell which entries are
still true without re-checking every one, at which point the list has cost more
than it saved. (Established by `RULES_AUDIT.md`, whose own finding was that
counts and paths are the two things that decay fastest and that a reader cannot
verify.)

**Re-derive it instead**, which takes a second and is always current:

```bash
grep -rEn "#[0-9a-fA-F]{6}\b" src --include=*.tsx --include=*.ts | grep -v "\.test\."
```

Read the results against the *deliberate exceptions* table below — most hits are
in it. Note this rule is **not enforced by anything**: ESLint runs in CI but has
no raw-colour rule, so the grep is the only check that exists.

### Still open

**1. The city-pin fill.** The teal accent is hardcoded as an SVG `fill` on the
location map pin, in the two components that draw it. Should be
`var(--color-bt-accent)` — SVG `fill` accepts a CSS custom property, so there is
no technical blocker here, it just never got done.

**2. The title colour over photographic headers.** A conditional picking white
or near-black for a title sitting on a background *photo*. **Not a simple swap:**
the correct colour depends on the image behind it, not on light/dark mode, so
`var(--color-bt-text)` would be wrong roughly half the time. This needs a
decision about how text over imagery is themed — a scrim, a computed luminance
(the `teamTextColor` approach), or an explicit pair of tokens for the case.
Until that decision exists, the hardcoded pair is the honest implementation.

### Withdrawn — this entry was not just stale, it was wrong

**White text on Danger buttons is CORRECT. Do not migrate it.** The old entry
asked for `#fff` on danger fills to move to `--color-bt-on-accent`. That token is
`#0d1f1a` — a near-black chosen to sit on the **teal** accent fill. Putting it on
a red danger fill produces dark-on-red. Meanwhile **Section 5 of this very guide
specifies the Danger button's text as `white`**, and the code follows Section 5.
There is no `--color-bt-on-danger` token and nothing needs one unless the danger
fill changes. The entry contradicted Section 5 of the document it lived in, and
following it would have made contrast worse.

### Deliberate exceptions — not migrations, and not violations

Named by **where they live**, never by value, so this table cannot rot the way
the checklist did. The previous version listed team colours by hex and had
already drifted: it named four of the eight, and six "dim variants" that are not
in the palette at all — so anyone auditing raw colours against it would have
flagged half the real team palette as violations.

| What | Lives in | Why it is outside the token system |
|---|---|---|
| Team identity colours + their dim variants | `src/lib/teamColors.ts` | A team's colour is an identity choice made by users, not a theme value. The module is the palette — read it there. |
| Per-player chart colours | `src/lib/strokePlayConfig.ts` | Needs N visually distinct series colours, which the semantic tokens don't provide. |
| Golf tee-marker colours | `src/lib/courseService.ts`, `src/lib/golfCourseApi.ts` | **Real-world data, not styling.** A gold tee is gold on the actual course; theming it would make it wrong. |
| Score colours (eagle/birdie/par/bogey/dbl+) | `src/components/games/golfScore.ts` | Deliberately outside the button-token system — the file explains why, and requires they never read as interactive. |
| Transactional email styling | `src/lib/email.ts` | Email clients do not support CSS custom properties. Tokens cannot work here. |
| PWA theme colour + manifest | `src/app/manifest.ts`, `src/app/layout.tsx` | The browser reads these before any stylesheet; they must be literal values. |
| Image-overlay `rgba(255,255,255,*)` | competition/lodging image tiles | Sits on a dark photo, not on a theme surface. |
| The marketing page | `src/components/marketing/` | ⚠️ **OPEN QUESTION.** `design/README.md` says the marketing page keeps raw hex on purpose and must NOT be unified with the product token system. That instruction and this guide's "migrate every raw colour" have been in direct conflict; nothing is broken, but whoever gets there first will follow one and be wrong. Tracked as `RULES_AUDIT.md` §7 Q5 — **do not migrate these until it is answered.** |

### `--color-bt-subtle-border` diverges from `--color-bt-border` (intentional)

After the light-mode contrast pass (`fix/light-mode-contrast`), `--color-bt-border`
moved from `#e2e8f0` to `#c8d0da`. `--color-bt-subtle-border` remains `#e2e8f0`
because it is used as a **background fill** (zebra rows, inactive chip backgrounds)
in scoring components — not as a CSS border. The two tokens now serve different
purposes and should not be unified.

---

## Widths — the supported mobile floor, and what may stretch

**412px is the supported mobile floor** — the Pixel 7 Pro viewport. It was the
only device named anywhere in this repo before now, and only as a *failure case*
(the bottom-CTA-below-the-fold bug that produced the anchoring rule, CLAUDE.md
#14). Writing it down as the floor makes it a target rather than a postmortem.

| Constant | Value | Meaning |
|----------|-------|---------|
| `ENTRY_COL_PX` | **412** | Score entry's width. A DESIGNED interface — it does not stretch at any viewport. |
| `CUP_MAIN_MIN_PX` | 380 | Floor for the scoreboard column beside entry. |
| `CUP_MAIN_MAX_PX` | 560 | Cap for any single content column. |
| `CUP_COL_GAP_PX` | 16 | Gap between columns. |
| `CUP_TWO_COL_PX` | **808** | `380 + 16 + 412` — the CONTENT width two columns need. |

All five live in `src/components/shell/breakpoints.ts` as the one numeric source;
CSS and JS both derive from there. Do not restate any of them in a component.

**Two rules that follow, and they are the point:**

1. **Score entry never stretches.** It is 412 wherever it renders in a column.
   Below the two-column fit it takes the whole surface, as on mobile — it does not
   get narrower either.
2. **Nothing grows to fill.** Leftover space is MARGIN. A solo column caps at 560
   and centres, so a 1760px viewport is a 1440px viewport with more margin and
   there is no width at which any surface keeps widening.

**Threshold is measured on CONTENT width, not viewport.** A viewport breakpoint
would have to bake in the rail (246) and the stage padding (32), and would then be
silently wrong the moment either changed. Express it as a container query on the
stage. (Evidence it matters: the design mockup's own viewport figure assumed a
206px rail and was 40px optimistic against this codebase — the content-width
threshold is immune to that class of drift.)

---

## Structural Tokens Reference

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--color-bt-hover` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.06)` | Hover highlight |
| `--color-bt-overlay` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` | Modal backdrop (full screen) |
| `--color-bt-overlay-sheet` | `rgba(0,0,0,0.45)` | `rgba(0,0,0,0.55)` | Mobile bottom sheet backdrop |
| `--color-bt-overlay-drawer` | `rgba(0,0,0,0.30)` | `rgba(0,0,0,0.40)` | Desktop side drawer backdrop |
| `--color-bt-on-accent` | `#0d1f1a` | `#0d1f1a` | Dark text on teal accent fills (badges, primary buttons). Mode-independent. |
| `--color-bt-subtle-border` | `#e2e8f0` | `rgba(148,163,184,0.08)` | Secondary borders |
| `--color-bt-dim-faint` | `rgba(100,116,139,0.12)` | `rgba(148,163,184,0.12)` | Disabled/inactive fill |
| `--color-bt-state-fill` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.13)` | State silhouette watermark fill (LocationHero) |
| `--color-bt-state-stroke` | `rgba(0,0,0,0.15)` | `rgba(255,255,255,0.20)` | Toggle/state border |
| `--color-bt-tile-bg` | `transparent` | `transparent` | Schedule tile bg |
| `--color-bt-past-bg` | `#f8fafc` | `#161c2b` | Past schedule bg |
| `--color-bt-nav-bg` | `rgba(244,247,250,0.85)` | `rgba(10,14,26,0.85)` | Sticky top nav bg (use with `backdrop-filter: blur(14px)`) |
| `--shadow-card` | light shadow | heavier shadow | Card elevation |
| `--shadow-raised` | medium shadow | heavier shadow | Expanded panels |
| `--shadow-floating` | strong shadow | heavier shadow | Tooltips, popovers |

---

## Addendum (2026-03-31) — Status Review

**Status: STILL RELEVANT — keep as living reference.**

This is the active style guide. The `--color-bt-*` token system is fully implemented in `src/app/globals.css` with light/dark mode support. CLAUDE.md references this document ("Before making any styling change, read STYLE_GUIDE.md").

**Migration checklist (Section 7): re-audited 2026-08-08 — this request is now closed.** The checklist asked to be re-audited against current code, and it has been: three of five patterns had already shipped, one was withdrawn as incorrect (it contradicted Section 5), and the remaining two are described in Section 7. The per-file checklist was replaced with a re-derivation command, because a hand-maintained list of paths and counts is what went stale in the first place — it should not be rebuilt.

**Note:** The vote answer color tokens (`--color-bt-vote-yes`, `--color-bt-vote-maybe`, `--color-bt-vote-no`) were added after the initial guide was written and are now documented in Section 3. These are the authoritative vote colors.
