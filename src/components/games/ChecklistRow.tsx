"use client";

import { useEffect, useRef } from "react";
import { ChevronRight, ChevronDown, Check, X, Lock, type LucideIcon } from "lucide-react";
import { Collapse } from "@/components/games/Collapse";

/**
 * ChecklistRow — the ONE canonical config-checklist row (W-GAMEPAGE visual pass
 * P-A; vocabulary §2–§5/§12). Every config aspect renders as this: a semantic
 * **type-icon** (left) + **title / subtitle** + a trailing chevron / inline slot.
 * Tap to expand the editor IN PLACE (a drop-down panel beneath the row, NOT a
 * modal); **collapse = acknowledge**. The parent owns a single `openRowId` so only
 * one panel is open at a time (which also physically gates dependent rows).
 *
 * Three presentations:
 *   - **accordion** (`onToggle` + `children`) — tap toggles an in-place panel.
 *   - **overlay-tappable** (`onClick`, no children) — opens a separate editor; the
 *     trailing chevron points right.
 *   - **read-only** (neither) — a static summary row.
 *
 * Two states + one error (vocabulary §4 — the old 3-state model collapsed to 2):
 *   - **empty** → dashed border, transparent surface, MUTED icon, no badge. Both
 *     "required-and-unsatisfied" and "optional-and-untouched" land here.
 *   - **resolved** → solid border, `--color-bt-card` surface, WHITE icon, a small
 *     teal **check badge** overlaid on the icon. **The icon never swaps for a check
 *     (§3 keystone) — it persists; the badge is added.**
 *   - **invalid** → the §6.1 hard-block (a match with an empty player slot): danger
 *     border, danger icon + a red-X badge. A separate error treatment, not part of
 *     the empty/resolved pair.
 */
export type ChecklistRowState = "empty" | "resolved" | "invalid";

/** The state→treatment mapping (vocabulary §4), pure so it's unit-testable apart
 *  from render. Returns token-ready CSS values + which badge (if any) overlays the
 *  persistent type-icon. `isOpen` (editing) suppresses the badge and raises the
 *  surface. */
export interface RowVisuals {
  surface: string;
  border: string;
  iconColor: string;
  iconBg: string;
  /** Bottom-right overlay on the icon — never replaces it (§3 keystone). */
  badge: "check" | "x" | null;
}
export function checklistRowVisuals(state: ChecklistRowState, isOpen: boolean): RowVisuals {
  const resolved = state === "resolved";
  // Collapse-boundary validity (readiness rework P2): while the row is OPEN (the
  // user is editing), an `invalid` row reads NEUTRAL — no red verdict. The
  // invalid/resolved verdict resolves on COLLAPSE, so the red border + danger icon
  // + red-X badge only apply when collapsed. (The badge already gated on `!isOpen`
  // since P-A; folding `!isOpen` into `invalid` extends the same rule to the border
  // + icon, killing the mid-build red↔teal flicker. The underlying `allFilled` truth
  // is unchanged and still drives the Enable gate — this is presentation timing only.)
  const invalid = state === "invalid" && !isOpen;
  const active = resolved || isOpen;
  return {
    // The panel is ONE continuous surface open or closed — the body shares the
    // header's token, and an open panel reads identically to a collapsed-resolved
    // one (only the chevron + body presence change). `--color-bt-card` is the
    // panel surface (STYLE_GUIDE Level 1); the inner editor cards sit ON it at
    // card-raised. (Was `card-raised` when open — a tonal jump that made the body
    // read flat/base-like against its own raised inner cards.)
    surface: isOpen || resolved ? "var(--color-bt-card)" : "transparent",
    border: invalid
      ? "1.5px solid var(--color-bt-danger)"
      : state === "empty" && !isOpen
        ? "1.5px dashed var(--color-bt-border)"
        : "1px solid var(--color-bt-border)",
    iconColor: invalid ? "var(--color-bt-danger)" : active ? "var(--color-bt-text)" : "var(--color-bt-text-dim)",
    iconBg: active ? "var(--color-bt-card-raised)" : "transparent",
    badge: (resolved || invalid) && !isOpen ? (invalid ? "x" : "check") : null,
  };
}

export function ChecklistRow({
  icon: Icon,
  title,
  subtitle,
  state,
  onClick,
  expanded,
  onToggle,
  children,
  control,
  headerControl,
  requires,
  locked,
  testId,
}: {
  /** The row's semantic type-icon (lucide). Persists in every state. */
  icon: LucideIcon;
  /** Large title (~16.5px) — the row/game-type name (varies by state for Course). */
  title: string;
  /** Small status line (~12.5px dim). ReactNode so a teal segment can be embedded
   *  (the Points "…: N" live value). */
  subtitle?: React.ReactNode;
  state: ChecklistRowState;
  /** Overlay-tappable row (opens a separate editor). Omit for accordion/read-only. */
  onClick?: () => void;
  /** Accordion: whether this row's in-place panel is open (parent-owned). */
  expanded?: boolean;
  /** Accordion: tap toggles the panel. Omit → not an accordion row. */
  onToggle?: () => void;
  /** Accordion: the dropped-down editor content (rendered beneath when expanded). */
  children?: React.ReactNode;
  /** Inline trailing control (e.g. a `<Stepper inline>`) that the row carries in
   *  place of a chevron — the row does NOT open and is **exempt from the single-open
   *  accordion** (W-GAMEPAGE Phase C: the Points row). Mutually exclusive with
   *  accordion/overlay; the control owns its own taps. */
  control?: React.ReactNode;
  /** An ACCORDION row that ALSO carries a header control (e.g. the A2b Total Points
   *  row: a ± total stepper beside the expand chevron). Rendered in the header,
   *  OUTSIDE the toggle button (so its own buttons don't nest in / trigger the
   *  toggle), before the chevron. Only honored on accordion rows. */
  headerControl?: React.ReactNode;
  /**
   * Prerequisites this row needs before it can be used, named as the user would
   * find them elsewhere in the panel (`["Golf Course", "Matches"]`). Non-empty →
   * the row renders at FULL SIZE behind a scrim reading `Requires: Golf Course,
   * Matches`.
   *
   * This replaced hiding. A hidden row teaches nobody that the setting exists —
   * someone in score entry never learned glorious finishing holes was a thing —
   * and the setting isn't missing, its prerequisite is. Only one of those is worth
   * saying. It also replaced a `disabled` prop that dimmed the row to 0.55 with no
   * reason attached; two treatments for "here and unusable" is the divergence this
   * codebase keeps deleting.
   *
   * ONLY pass a prerequisite the user can satisfy from this panel. A row the
   * format simply doesn't have stays absent — a permanently-dead row is worse
   * than a hidden one.
   */
  requires?: string[];
  /** The row is frozen because scoring has started. Same scrim as `requires`,
   *  different words: a lock icon and the action that unblocks it. Wins over
   *  `requires` when both apply — scores are the first gate you hit, and
   *  satisfying a prerequisite wouldn't help. */
  locked?: boolean;
  testId?: string;
}) {
  // Blocked = covered by the scrim, and therefore NOT interactive in any mode.
  // Expressed by dropping to the static variant rather than by disabling the
  // button, so there is no tap target AND no keyboard path to a control the user
  // has just been told they can't use.
  const blockedBy: null | { kind: "locked" } | { kind: "requires"; list: string[] } = locked
    ? { kind: "locked" }
    : requires && requires.length > 0
      ? { kind: "requires", list: requires }
      : null;
  const accordion = !!onToggle && !blockedBy;
  const overlay = !!onClick && !blockedBy && !accordion;
  // A control row carries an inline control and never toggles (no accordion/overlay).
  const controlRow = !!control && !accordion && !overlay;
  const isOpen = accordion && !!expanded;

  // State → treatment (§4/§12), via the shared pure mapping.
  const { surface, border, iconColor, iconBg, badge } = checklistRowVisuals(state, isOpen);
  // The badge's 2px ring matches the row surface so it reads as an overlay, not a
  // floating dot. (Badge only shows collapsed, so the surface is card/transparent.)
  const ringColor = state === "resolved" ? "var(--color-bt-card)" : "var(--color-bt-base)";

  // Auto-scroll: reveal-don't-relocate. Only scroll if the (now-expanded) panel
  // would otherwise be partly off-screen, and only enough to bring it into view —
  // `block: "nearest"` is a no-op when the panel already fits, and scrolls the
  // minimum otherwise (never a slam-to-top).
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isOpen) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isOpen]);

  const iconBlock = (
    <span
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: 38, height: 38, borderRadius: 10, background: iconBg }}
    >
      <Icon size={18} style={{ color: iconColor }} strokeWidth={1.75} />
      {badge && (
        <span
          className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full"
          style={{
            width: 16,
            height: 16,
            background: badge === "x" ? "var(--color-bt-danger)" : "var(--color-bt-accent)",
            border: `2px solid ${ringColor}`,
          }}
          aria-hidden="true"
        >
          {badge === "x" ? (
            <X size={9} strokeWidth={3} style={{ color: "var(--color-bt-text)" }} />
          ) : (
            <Check size={10} strokeWidth={3} style={{ color: "var(--color-bt-on-accent)" }} />
          )}
        </span>
      )}
    </span>
  );

  const content = (
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate" style={{ fontSize: 16.5, fontWeight: 500, color: "var(--color-bt-text)", lineHeight: 1.25 }}>
        {title}
      </span>
      {subtitle != null && (
        <span className="truncate" style={{ fontSize: 12.5, color: "var(--color-bt-text-dim)", marginTop: 1 }}>
          {subtitle}
        </span>
      )}
    </div>
  );

  const trailing = blockedBy ? (
    // Nothing: the scrim covers this area and carries the state (a lock icon for
    // the locked case). A chevron here would be a false affordance, and the old
    // lock-icon-in-the-row said "frozen" without saying what to do about it.
    null
  ) : controlRow ? (
    // The inline control sits where the chevron would — it owns its own taps.
    <span className="flex shrink-0 items-center">{control}</span>
  ) : (
    <span className="flex shrink-0 items-center">
      {accordion ? (
        <ChevronDown size={16} style={{ color: "var(--color-bt-text-dim)", transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform 120ms" }} />
      ) : overlay ? (
        <ChevronRight size={16} style={{ color: "var(--color-bt-text-dim)" }} />
      ) : null}
    </span>
  );

  const headerInner = (
    <>
      {iconBlock}
      {content}
      {trailing}
    </>
  );
  const headerClass = "flex w-full items-center gap-3 px-3.5 py-3 text-left disabled:opacity-60";
  // No dimming any more. The row keeps its full contrast and the SCRIM carries the
  // state — dimming to 0.55 and saying nothing was the illegible half of this, and
  // STYLE_GUIDE §"Light mode contrast rule" warns against opacity-dimming text at all.
  const containerStyle = { background: surface, border } as React.CSSProperties;

  /**
   * The scrim. Rendered as a SIBLING of the row body inside a relative wrapper,
   * never as a child of a button — a cover nested inside its own button still
   * bubbles the click to it, which is exactly the tappable-but-inert bug #879
   * shipped (a modal painting under the thing it was covering while still taking
   * taps). As a sibling it is topmost, so it receives the tap and stops there.
   *
   * LEFT-JUSTIFIED, not centred: several of these stack in one panel, and
   * centring put "Requires:" at a different x on every row, so the eye had to
   * re-find the label each time. Left-aligned, the scaffolding word lines up and
   * the varying part — the requirement itself — is what moves.
   */
  const scrim = blockedBy && (
    <div
      className="absolute inset-0 z-[2] flex items-center rounded-xl"
      style={{ background: "var(--color-bt-overlay-row)", cursor: "not-allowed" }}
      // Absorb the tap and go no further. There is nothing to do here: the copy
      // has already named where to go.
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      data-testid={testId ? `${testId}-scrim` : "row-scrim"}
    >
      <span
        className="flex items-center gap-1.5 px-3 text-left"
        style={{ fontSize: 11.5, fontWeight: 650, letterSpacing: "0.01em", lineHeight: 1.3 }}
      >
        {blockedBy.kind === "locked" ? (
          <>
            <Lock size={12} style={{ color: "var(--color-bt-overlay-row-label)", flexShrink: 0 }} />
            <span style={{ color: "var(--color-bt-overlay-row-text)", textShadow: "0 1px 3px rgba(0,0,0,.9)" }}>
              Reset scoring to make changes
            </span>
          </>
        ) : (
          <>
            {/* Label and value, not a sentence — "Requires:" is scaffolding; the
                requirement is the thing to read. Comma-separated for multiples, so
                the copy writes itself for a fifth format. */}
            <span style={{ color: "var(--color-bt-overlay-row-label)", fontWeight: 600 }}>Requires:</span>
            <span style={{ color: "var(--color-bt-overlay-row-text)", textShadow: "0 1px 3px rgba(0,0,0,.9)" }}>
              {blockedBy.list.join(", ")}
            </span>
          </>
        )}
      </span>
    </div>
  );

  // Accordion: a header button toggling an in-place panel below (same bordered
  // frame — the row IS the frame; the panel sheds all modal chrome).
  if (accordion) {
    return (
      <div ref={rowRef} className="rounded-xl" style={{ ...containerStyle, scrollMarginTop: 12 }} data-testid={testId}>
        {headerControl ? (
          // A header-control accordion (Total Points): the icon+title toggle the
          // panel; the control (a stepper) sits beside the chevron OUTSIDE that
          // button, owning its own taps. Split so we never nest buttons.
          <div className={headerClass}>
            <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={isOpen}>
              {iconBlock}
              {content}
            </button>
            <span className="flex shrink-0 items-center">{headerControl}</span>
            <button type="button" onClick={onToggle} aria-label="Toggle" aria-expanded={isOpen} className="flex shrink-0 items-center">
              <ChevronDown size={16} style={{ color: "var(--color-bt-text-dim)", transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform 120ms" }} />
            </button>
          </div>
        ) : (
          <button type="button" onClick={onToggle} className={headerClass} aria-expanded={isOpen}>
            {headerInner}
          </button>
        )}
        {/* Smooth height animation (grid-rows) instead of an instant mount/unmount —
            no under-header divider (the body is the SAME surface as the header, so
            there's no seam to mark). */}
        <Collapse open={isOpen}>
          <div className="px-3.5 pb-3.5 pt-1">
            {children}
          </div>
        </Collapse>
      </div>
    );
  }

  // Overlay-tappable — opens a separate editor.
  if (overlay) {
    return (
      <button type="button" onClick={onClick} className={`${headerClass} rounded-xl`} style={containerStyle} data-testid={testId}>
        {headerInner}
      </button>
    );
  }

  // Read-only summary row — and the variant a BLOCKED row falls through to, so the
  // scrim rides here. The wrapper is `relative` for it; the row keeps its exact
  // height either way, which is what stops the panel reflowing as prerequisites are
  // met (rows must not jump while someone is configuring).
  return (
    <div className="relative rounded-xl" data-testid={testId}>
      <div className={`${headerClass} rounded-xl`} style={containerStyle}>
        {headerInner}
      </div>
      {scrim}
    </div>
  );
}
