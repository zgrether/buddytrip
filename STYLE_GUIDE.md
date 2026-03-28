# BuddyTrip Style Guide

Canonical reference for all styling decisions. Based on the token system
defined in `src/app/globals.css`. All future UI work should reference
this document.

**Theme system:** `next-themes` with `attribute="class"`, `.dark` class
toggle, default theme is `dark`.

**Token system:** Single prefix `--color-bt-*`. No other token systems
exist. All color references in component code should use
`var(--color-bt-*)` tokens, never raw hex values.

---

## Section 1: Surface Hierarchy

The app defines 4 surface levels. Each component should use exactly one
of these as its background — never a hardcoded hex.

### Level 0 — Page Background

| Property | Light | Dark |
|----------|-------|------|
| Token | `--color-bt-base` | `--color-bt-base` |
| Value | `#f1f5f9` (slate-100) | `#0f172a` (slate-900) |

**Use:** outermost page/layout background (`body` tag).
**Examples:** trip page bg, dashboard bg, login page bg.

### Level 1 — Panel / Card Surface

| Property | Light | Dark |
|----------|-------|------|
| Token | `--color-bt-card` | `--color-bt-card` |
| Value | `#ffffff` (white) | `#1e293b` (slate-800) |

**Use:** collapsible panels, card containers, modal surfaces, bottom
sheets, any element that "floats" above the page.
**Examples:** PlanningRow panels (Destination, Crew, Dates, Logistics),
TripCard, AddDateSheet, LockConfirmDialog.

### Level 2 — Elevated / Raised Surface

| Property | Light | Dark |
|----------|-------|------|
| Token | `--color-bt-card-raised` | `--color-bt-card-raised` |
| Value | `#f1f5f9` (slate-100) | `#243044` |

**Use:** elements that sit ON a card/panel — inactive buttons, table
zebra rows, input backgrounds.
**Examples:** inactive vote buttons (wide mode), alternating grid rows,
inactive compact chips.

> **Known issue (light mode):** `--color-bt-card-raised` (`#f1f5f9`) is
> identical to `--color-bt-base` (`#f1f5f9`). In light mode, raised
> surfaces look the same as the page background, losing visual hierarchy.
> A future fix should set `--color-bt-card-raised` to `#edf2f7` or
> similar in light mode.

### Level 3 — Float Surface

| Property | Light | Dark |
|----------|-------|------|
| Token | `--color-bt-card-float` | `--color-bt-card-float` |
| Value | `#e8edf5` | `#2a3652` |

**Use:** deeply nested elevated elements, tooltips, popovers.
**Examples:** not yet widely used — reserved for future nesting.

---

## Section 2: Typography Tokens

| Role | Token | Light | Dark | Use |
|------|-------|-------|------|-----|
| Primary text | `--color-bt-text` | `#0f172a` | `#f1f5f9` | Headings, labels, names |
| Secondary text | `--color-bt-text-dim` | `#64748b` | `#94a3b8` | Subtitles, descriptions, timestamps |
| Accent text | `--color-bt-accent` | `#0d9488` | `#2dd4bf` | Links, active states, yes/works |
| Accent dim | `--color-bt-accent-dim` | `#0f766e` | `#14b8a6` | Hover state for accent text |
| Owner text | `--color-bt-owner` | `#d97706` | `#fbbf24` | Owner role badge border/text |
| Warning text | `--color-bt-warning` | `#d97706` | `#fbbf24` | Maybe/caution states |
| Danger text | `--color-bt-danger` | `#dc2626` | `#f87171` | Errors, Can't/declined |
| Planning text | `--color-bt-planning` | `#2563eb` | `#60a5fa` | Blue status indicators |
| Ready text | `--color-bt-ready` | `#7c3aed` | `#a78bfa` | Planner role badge, violet states |

---

## Section 3: Semantic Color Usage

Each semantic state has up to 3 tokens: background, text/icon, and border.

| State | Background token | Text/icon token | Border token |
|-------|-----------------|-----------------|--------------|
| Yes / Works / Confirmed | `--color-bt-accent-faint` | `--color-bt-accent` | `--color-bt-accent-border` |
| Maybe / Pending | `--color-bt-warning-faint` | `--color-bt-warning` | `--color-bt-warning-border` |
| No / Can't / Declined | `--color-bt-danger-faint` | `--color-bt-danger` | `--color-bt-danger-border` |
| Warning / Low crew | `--color-bt-warning-faint` | `--color-bt-warning` | `--color-bt-warning-border` |
| Locked / Done | `--color-bt-tag-bg` | `--color-bt-accent` | `--color-bt-accent-border` |
| Ghost / Unknown | `--color-bt-border` | `--color-bt-text-dim` | `--color-bt-border` |
| Planning / In-progress | `--color-bt-accent-faint` | `--color-bt-accent` | `--color-bt-accent-border` |

### Semantic background values

| Token | Light | Dark |
|-------|-------|------|
| `--color-bt-tag-bg` | `#f0fdfa` (teal-50) | `#134e4a` (teal-900) |
| `--color-bt-accent-faint` | `rgba(13,148,136,0.08)` | `rgba(45,212,191,0.12)` |
| `--color-bt-warning-faint` | `rgba(217,119,6,0.08)` | `rgba(251,191,36,0.08)` |
| `--color-bt-danger-faint` | `rgba(220,38,38,0.08)` | `rgba(248,113,113,0.12)` |
| `--color-bt-danger-bg` | `#fef2f2` | `#450a0a` |
| `--color-bt-blue-bg` | `#eff6ff` | `#1e3a5f` |
| `--color-bt-ready-bg` | `#f5f3ff` | `#2e1065` |

### Semantic border values

| Token | Light | Dark |
|-------|-------|------|
| `--color-bt-accent-border` | `rgba(13,148,136,0.22)` | `rgba(45,212,191,0.25)` |
| `--color-bt-warning-border` | `rgba(217,119,6,0.20)` | `rgba(251,191,36,0.20)` |
| `--color-bt-danger-border` | `rgba(220,38,38,0.20)` | `rgba(248,113,113,0.20)` |
| `--color-bt-planning-border` | `rgba(37,99,235,0.22)` | `rgba(96,165,250,0.25)` |

---

## Section 4: Component Patterns

### Panel (collapsible PlanningRow)

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
Default row background:    transparent (inherits card)
Alternate row background:  var(--color-bt-card-raised)
Row divider:               none (use zebra striping only)
Cell padding:              px-1 py-1.5
Crew column width:         140px fixed
Crew column right border:  1px solid var(--color-bt-border)
```

### Vote button — inactive (wide mode)

```
Background:  var(--color-bt-card-raised)
Border:      0.5px solid var(--color-bt-border)
Text:        var(--color-bt-text-dim)
Font:        11px, weight 500
Height:      28px
Radius:      rounded
Padding:     px-2
```

### Vote button — active (yes)

```
Background:  var(--color-bt-accent)
Border:      none
Text:        white
Font:        11px, weight 700
```

### Vote button — active (maybe)

```
Background:  var(--color-bt-warning)
Border:      none
Text:        var(--color-bt-base-alt)
Font:        11px, weight 700
```

### Vote button — active (no)

```
Background:  var(--color-bt-danger)
Border:      none
Text:        white
Font:        11px, weight 700
```

### Compact chip — unvoted

```
Size:        h-7 w-7
Character:   · (middle dot)
Text:        var(--color-bt-text-dim)
Border:      1px dashed var(--color-bt-border)
Background:  transparent
```

### Compact chip — voted

```
Size:        h-7 w-7
Character:   ✓ / ~ / ✗
Background:  [state]-faint token
Text:        [state] token
Border:      1px solid [state]-border token
```

### Role badge (RoleBadge component)

```
Style:       inline-block rounded border px-1.5 py-0.5
Font:        text-[10px] font-medium
Owner:       borderColor + color = var(--color-bt-owner)
Planner:     borderColor + color = var(--color-bt-accent)
Member:      not rendered (returns null)
```

### Overlay / Modal backdrop

```
Background:  rgba(0,0,0,0.4)
```

### CTA button (primary action)

```
Background:  #00d4aa
Text:        white
Radius:      rounded-xl
Padding:     py-2.5
Font:        text-sm font-semibold
Disabled:    opacity-40
```

> **Note:** `#00d4aa` is hardcoded and does not correspond to any token.
> It is close to but not identical to `--color-bt-accent` (teal-400
> `#2dd4bf` in dark / teal-600 `#0d9488` in light). A future cleanup
> should replace this with a dedicated `--color-bt-cta` token.

---

## Section 5: What NOT to Do

### Hardcoded hex values that should be tokens

- [ ] `#00d4aa` — used as CTA button bg and "Add date option" border in DatesSection, LocationHero pin fill (17+ occurrences). Should be `var(--color-bt-accent)` or a new `--color-bt-cta` token.
- [ ] `#f59e0b` — used for warning icon/text in DatesSection low-crew banner, CompTab submitted status (8+ occurrences). Should be `var(--color-bt-warning)`.
- [ ] `#78350f` — used for warning banner text in DatesSection. Should be a `--color-bt-warning-text` token or use `var(--color-bt-text)`.
- [ ] `#fffbeb` — used for warning banner bg in DatesSection. Should be `var(--color-bt-warning-faint)` or a light-mode warning surface token.
- [ ] `#fde68a` — used for warning banner border in DatesSection. Should be `var(--color-bt-warning-border)`.
- [ ] `#d1d5db` — used for sheet drag handle in DatesSection. Should be `var(--color-bt-border)`.
- [ ] `#fff` / `white` — used for button text on colored backgrounds. Should be a `--color-bt-on-accent` token or kept as `white` if intentional.
- [ ] `#3b82f6`, `#22c55e`, `#a855f7`, `#06b6d4` — team colors in CompTab/setup. These are intentionally distinct from the design system (team identity colors), but their `dim` variants are hardcoded.
- [ ] `#6bc87a` — used for active schedule day text in HomeTab competition tile. No corresponding token.
- [ ] `rgba(255,255,255,0.*)` — 15+ occurrences in HomeTab competition tile and pending actions card. These are used inside a dark image-overlay context where tokens don't apply. Acceptable as-is but should be documented as an exception.
- [ ] `rgba(0,0,0,0.4)` — overlay backdrop in DatesSection, CrewTab. Should be `var(--color-bt-overlay)`.

### Light/dark mode inconsistencies

- [ ] `--color-bt-card-raised` in light mode (`#f1f5f9`) is identical to `--color-bt-base` (`#f1f5f9`). Zebra rows and inactive buttons have no contrast against the page background in light mode.
- [ ] `--color-bt-base-alt` is `#0f172a` in both light and dark modes. In light mode it is used as text color on warning buttons — this is correct but confusing semantically (a dark color on a light page).
- [ ] Warning banner in DatesSection uses hardcoded light-only colors (`#fffbeb` bg, `#78350f` text) that don't adapt to dark mode.
- [ ] `titleColor` in TripCard and TripHeader branches on `isDark` with hardcoded `#ffffff` / `rgba(0,0,0,0.85)` instead of using `--color-bt-text`.

### Token system misuse

- [ ] No Tailwind color utility classes (e.g. `bg-white`, `text-gray-500`) should be used for themeable surfaces. Only 3 minor violations found: `bg-white` (CrewTab toggle knob — acceptable for a literal white element), `bg-black/10` (hover state), `bg-white/50` (compare page input).
- [ ] `var(--color-bt-overlay)` exists (`rgba(0,0,0,0.5)` light / `rgba(0,0,0,0.7)` dark) but is not used — modals hardcode `rgba(0,0,0,0.4)`.

---

## Section 6: Regression Fix

### Light mode surface flattening

**Commit:** `c4f6164` — _Add elevation tokens and fix light mode card/base contrast_

**What happened:** This commit correctly changed `--color-bt-base` from
`#ffffff` to `#f1f5f9` (slate-100) and `--color-bt-card` from `#f8fafc`
to `#ffffff` so cards would float above the page. However, it also set
`--color-bt-card-raised` to `#f1f5f9` — the same value as the new base.

**Result:** In light mode, the surface hierarchy collapses:
- `--color-bt-base` = `#f1f5f9`
- `--color-bt-card` = `#ffffff` (distinct, good)
- `--color-bt-card-raised` = `#f1f5f9` (same as base, bad)

Any component using `card-raised` (zebra rows, inactive vote buttons)
appears to merge with the page background, losing the visual layering
that works correctly in dark mode.

**Fix:** Change light mode `--color-bt-card-raised` to a value between
`--color-bt-base` and `--color-bt-card`, such as `#f6f8fb` or
`#eef2f7`, to restore visible elevation in light mode.

---

## Structural Tokens Reference

These tokens do not affect color theming but are used for layout and
interaction states.

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--color-bt-hover` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.06)` | Hover highlight |
| `--color-bt-overlay` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` | Modal backdrop |
| `--color-bt-subtle-border` | `#e2e8f0` | `#1e293b` | Secondary borders |
| `--color-bt-dim-faint` | `rgba(100,116,139,0.12)` | `rgba(148,163,184,0.12)` | Disabled fill |
| `--color-bt-state-fill` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.06)` | Toggle/state bg |
| `--color-bt-state-stroke` | `rgba(0,0,0,0.15)` | `rgba(255,255,255,0.20)` | Toggle/state border |
| `--color-bt-tile-bg` | `transparent` | `transparent` | Schedule tile bg |
| `--color-bt-past-bg` | `#f8fafc` | `#1e293b` | Past schedule bg |
| `--shadow-card` | light shadow | heavier shadow | Card elevation |
| `--shadow-raised` | medium shadow | heavier shadow | Expanded panel |
| `--shadow-floating` | strong shadow | heavier shadow | Tooltips, popovers |
