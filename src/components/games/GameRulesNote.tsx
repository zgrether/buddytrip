"use client";

/**
 * Zone 3 (W-EDITMODAL-01) — the "rules of the day" freeform note, at the bottom of
 * the game-setup page BELOW the checklist. It's notes, not a task: nothing to
 * "resolve", so it is NOT a ChecklistRow — a plain textarea.
 *
 * **Controlled only (#626).** The parent owns the text + persistence: `onChange`
 * reports every keystroke, the parent updates its draft, and the page's single Save
 * persists it — NOTHING commits from here. Read-only surfaces (a member's view) pass
 * `value` with no `onChange`. (The old self-persisting `games.update`-on-blur path and
 * the `flush()` handle are gone — every render site is draft-then-save or read-only.)
 */
export function GameRulesNote({
  canEdit, value, onChange,
}: {
  canEdit: boolean;
  /** The text to show — the parent's draft slice, or a read-only value. */
  value: string;
  /** Every edit — omitted on read-only surfaces. */
  onChange?: (next: string) => void;
}) {
  return (
    <div className="mt-6">
      {/* #512 §5: label + divider rule, matching the SETTINGS / OPTIONS section
          headers (which had a divider; Rules previously had a bare label). */}
      <div className="flex items-center gap-2 pt-2">
        <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
          Rules of the day
        </label>
        <span className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
      </div>
      {/* #512 §8: a bordered card PANEL containing the textarea (surface + border +
          padding) so it reads as a peer of the Matches/Course/Points card-rows, not a
          loose field. The textarea itself is transparent — it's the panel's interior. */}
      <div
        className="mt-2 rounded-xl px-3.5 py-3"
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <textarea
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          readOnly={!canEdit}
          rows={3}
          maxLength={2000}
          placeholder="Tap out the rules of the day — formats, gimmes, mulligans, tiebreakers…"
          className="w-full resize-none bg-transparent text-sm outline-none"
          style={{ color: "var(--color-bt-text)", opacity: canEdit ? 1 : 0.7 }}
          data-testid="game-rules-note"
        />
      </div>
    </div>
  );
}
