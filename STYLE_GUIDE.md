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
| Value | `#d8e0e8` (cool grey — noticeably grey on any display) | `#0f172a` (slate-900) |

**Use:** outermost page/layout background. Applied to `body`.
**Examples:** trip page, dashboard, login page.

### Level 1 — Panel / Card Surface

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-card` | `--color-bt-card` |
| Value | `#ffffff` (white) | `#1e293b` (slate-800) |

**Use:** collapsible panels, card containers, modals, bottom sheets —
anything that floats above the page.
**Examples:** PlanningRow panels (Destination, Crew, Dates, Logistics),
TripCard, AddDateSheet, LockConfirmDialog, TripSettingsModal.

### Level 2 — Elevated / Raised Surface

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-card-raised` | `--color-bt-card-raised` |
| Value | `#f4f7fa` | `#243044` |

**Use:** elements sitting ON a card/panel — inactive buttons, zebra
table rows, input backgrounds, inactive compact chips.
**Examples:** inactive vote buttons (wide mode), alternating grid rows
in the dates response grid, inactive filter chips.

### Level 3 — Float Surface

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-card-float` | `--color-bt-card-float` |
| Value | `#e8edf5` | `#2a3652` |

**Use:** deeply nested elevated elements, tooltips, popovers.
**Examples:** reserved for future nesting needs.

### Chrome Surface (navigation elements)

Chrome elements sit above the page background but are distinct from
content panels. They frame the app — they don't contain content.

**Rule:** all chrome elements share exactly one surface token.

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-card` | `--color-bt-card` |
| Value | `#ffffff` (white) | `#1e293b` (slate-800) |

**Separation:** border only, no shadow. Content panels use `--shadow-raised`
for elevation; chrome uses `1px solid var(--color-bt-border)` for definition.

**Chrome elements (persistent app frame only):**
- Global top app bar (`TopNav`) — `border-bottom`
- Bottom navigation bar (`BottomNav`) — `border-top`

**Not chrome — contextual page structure (blend with page background):**
- Page breadcrumb bar (`TripBreadcrumb`) — inherits `--color-bt-base`
- Trip tab bar (`TripTabBar`) — inherits `--color-bt-base`

### Surface border

| | Light | Dark |
|-------|-------|------|
| Token | `--color-bt-border` | `--color-bt-border` |
| Value | `#c8d0da` | `#334155` (slate-700) |

**Use:** panel outlines, dividers, card edges. Every bordered surface component
uses this token for its `border-color`.

> **Note:** `--color-bt-subtle-border` (`#e2e8f0` light / `#1e293b` dark) is a
> separate token that intentionally diverges from `--color-bt-border`. It is used
> as a **background fill** in scoring-format components (zebra stripes, inactive
> chips), not as a CSS border. Do not replace it with `--color-bt-border`.

---

## Section 2: Typography Tokens

| Role | Token | Light | Dark | Use |
|------|-------|-------|------|-----|
| Primary text | `--color-bt-text` | `#0f172a` | `#f1f5f9` | Headings, labels, names, body text |
| Secondary text | `--color-bt-text-dim` | `#64748b` | `#94a3b8` | Subtitles, descriptions, timestamps, counts |
| Accent text | `--color-bt-accent` | `#0d9488` | `#2dd4bf` | Links, active states, yes/works, teal highlights |
| Accent dim | `--color-bt-accent-dim` | `#0f766e` | `#14b8a6` | Hover state for accent text |
| Owner text | `--color-bt-owner` | `#d97706` | `#fbbf24` | Owner role badge (border + text) |
| Warning text | `--color-bt-warning` | `#d97706` | `#fbbf24` | Maybe/caution states — STATUS DISPLAY ONLY, not buttons |
| Danger text | `--color-bt-danger` | `#dc2626` | `#f87171` | Errors, Can't/declined, destructive actions |
| Planning text | `--color-bt-planning` | `#2563eb` | `#60a5fa` | Blue status indicators |
| Ready text | `--color-bt-ready` | `#7c3aed` | `#a78bfa` | Planner role badge, violet states |

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

### Background token values

| Token | Light | Dark |
|-------|-------|------|
| `--color-bt-tag-bg` | `#f0fdfa` (teal-50) | `#134e4a` (teal-900) |
| `--color-bt-accent-faint` | `rgba(13,148,136,0.08)` | `rgba(45,212,191,0.12)` |
| `--color-bt-warning-faint` | `rgba(217,119,6,0.08)` | `rgba(251,191,36,0.08)` |
| `--color-bt-danger-faint` | `rgba(220,38,38,0.08)` | `rgba(248,113,113,0.12)` |
| `--color-bt-danger-bg` | `#fef2f2` | `#450a0a` |
| `--color-bt-blue-bg` | `#eff6ff` | `#1e3a5f` |
| `--color-bt-ready-bg` | `#f5f3ff` | `#2e1065` |

### Border token values

| Token | Light | Dark |
|-------|-------|------|
| `--color-bt-accent-border` | `rgba(13,148,136,0.22)` | `rgba(45,212,191,0.25)` |
| `--color-bt-warning-border` | `rgba(217,119,6,0.20)` | `rgba(251,191,36,0.20)` |
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

### Table row (dates response grid)

```
Default row bg:      transparent (inherits card)
Alternate row bg:    var(--color-bt-card-raised)
Row divider:         none (zebra striping only)
Cell padding:        px-1 py-1.5
Crew column width:   140px fixed
Crew column border:  1px solid var(--color-bt-border) (right edge)
```

### Vote button — inactive (wide mode, 3-button row)

```
Background:    var(--color-bt-card-raised)
Border:        0.5px solid var(--color-bt-border)
Text:          var(--color-bt-text-dim)
Font:          11px, weight 500
Height:        28px
Radius:        rounded
Padding:       px-2
```

### Vote button — active (yes / maybe / no)

```
Yes:    bg var(--color-bt-accent),   text white,           weight 700
Maybe:  bg var(--color-bt-warning),  text var(--color-bt-base-alt), weight 700
No:     bg var(--color-bt-danger),   text white,           weight 700
Border: none (all active states)
```

### Compact chip — unvoted

```
Size:       h-7 w-7
Character:  · (middle dot)
Text:       var(--color-bt-text-dim)
Border:     1px dashed var(--color-bt-border)
Background: transparent
```

### Compact chip — voted

```
Size:       h-7 w-7
Character:  ✓ / ~ / ✗
Background: [state]-faint token
Text:       [state] token
Border:     1px solid [state]-border token
```

### Role badge (RoleBadge component)

```
Style:    inline-block rounded border px-1.5 py-0.5
Font:     text-[10px] font-medium
Owner:    borderColor + color = var(--color-bt-owner)
Planner:  borderColor + color = var(--color-bt-accent)
Member:   not rendered (returns null)
```

### Overlay / Modal backdrop

```
Token:     var(--color-bt-overlay)
Light:     rgba(0,0,0,0.5)
Dark:      rgba(0,0,0,0.7)
```

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
      The warning banner in DatesSection uses `#fffbeb` bg and `#78350f`
      text which only work in light mode.
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

## Section 7: Migration Checklist

Every hardcoded value found in the audit. This is the backlog — fix
incrementally in follow-up PRs.

### `#00d4aa` (hardcoded teal CTA) → `var(--color-bt-accent)`

- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:522` — Add date option border/text
- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:952` — Add Option button bg
- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:997` — Lock It In button bg
- [ ] `src/components/LocationHero.tsx:91` — city pin fill
- [ ] `src/components/TripCard.tsx:114` — city pin fill

### `#f59e0b` (hardcoded amber) → `var(--color-bt-warning)`

- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:500` — AlertCircle icon color
- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:509` — "Go to Crew tab" link color
- [ ] `src/app/trips/[tripId]/tabs/HomeTab.tsx:883` — PlanningRow noteWarn icon
- [ ] `src/app/trips/[tripId]/tabs/HomeTab.tsx:893` — PlanningRow noteWarn text
- [ ] `src/app/trips/[tripId]/tabs/CompTab.tsx:916-918` — submitted status badge

### `#fffbeb` / `#fde68a` / `#78350f` (light-only warning banner) → tokens

- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:498` — `#fffbeb` bg → `var(--color-bt-warning-faint)`
- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:498` — `#fde68a` border → `var(--color-bt-warning-border)`
- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:502` — `#78350f` text → needs a `--color-bt-warning-text` token or `var(--color-bt-text)`

### `#d1d5db` (sheet drag handle) → `var(--color-bt-border)`

- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:906`

### `rgba(0,0,0,0.4)` (modal overlay) → `var(--color-bt-overlay)`

- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:899`
- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:973`
- [ ] `src/app/trips/[tripId]/tabs/CrewTab.tsx:431`

### `#fff` / `white` on colored buttons → consider `--color-bt-on-accent` token

- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:952` — "white" on teal
- [ ] `src/app/trips/[tripId]/tabs/DatesSection.tsx:997` — "white" on teal
- [ ] `src/app/trips/[tripId]/compare/page.tsx:890` — `#fff` on danger
- [ ] `src/app/trips/[tripId]/compare/page.tsx:1593` — `#fff` on warning
- [ ] `src/app/trips/[tripId]/tabs/MoreTab.tsx:772` — `#fff` on danger
- [ ] `src/components/TripSettingsModal.tsx:78` — `#fff` on danger

### `#ffffff` / `rgba(0,0,0,0.85)` (conditional title color) → `var(--color-bt-text)`

- [ ] `src/components/TripCard.tsx:63` — isDark branch
- [ ] `src/components/TripHeader.tsx:185` — isDark branch

### `--color-bt-subtle-border` diverges from `--color-bt-border` (intentional — no migration needed)

After the light-mode contrast pass (`fix/light-mode-contrast`), `--color-bt-border`
moved from `#e2e8f0` to `#c8d0da`. `--color-bt-subtle-border` remains `#e2e8f0`
because it is used as a **background fill** (zebra rows, inactive chip backgrounds)
in scoring components — not as a CSS border. The two tokens now serve different
purposes and should not be unified.

### Team/competition colors (intentional — no migration needed)

These are team identity colors, intentionally outside the design system:
`#3b82f6` (blue), `#22c55e` (green), `#a855f7` (purple), `#06b6d4` (cyan),
`#7f1d1d`, `#1e3a8a`, `#14532d`, `#78350f`, `#581c87`, `#164e63` (dim variants).

### Image overlay rgba values (acceptable exception)

`rgba(255,255,255,0.*)` values in HomeTab competition tile and
PendingActionsCard are inside dark image-overlay contexts where tokens
don't apply. No migration needed.

---

## Structural Tokens Reference

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--color-bt-hover` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.06)` | Hover highlight |
| `--color-bt-overlay` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` | Modal backdrop |
| `--color-bt-subtle-border` | `#e2e8f0` | `#1e293b` | Secondary borders |
| `--color-bt-dim-faint` | `rgba(100,116,139,0.12)` | `rgba(148,163,184,0.12)` | Disabled/inactive fill |
| `--color-bt-state-fill` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.06)` | Toggle/state bg |
| `--color-bt-state-stroke` | `rgba(0,0,0,0.15)` | `rgba(255,255,255,0.20)` | Toggle/state border |
| `--color-bt-tile-bg` | `transparent` | `transparent` | Schedule tile bg |
| `--color-bt-past-bg` | `#f8fafc` | `#1e293b` | Past schedule bg |
| `--shadow-card` | light shadow | heavier shadow | Card elevation |
| `--shadow-raised` | medium shadow | heavier shadow | Expanded panels |
| `--shadow-floating` | strong shadow | heavier shadow | Tooltips, popovers |
