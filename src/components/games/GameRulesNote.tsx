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
  canEdit, value, onChange, starterText, bare = false,
}: {
  canEdit: boolean;
  /** The text to show — the parent's draft slice, or a read-only value. */
  value: string;
  /** Every edit — omitted on read-only surfaces. */
  onChange?: (next: string) => void;
  /**
   * The format explanation ("how you compete"), used as STARTER TEXT when the
   * game has no rules of its own yet.
   *
   * This replaces the separate "How you compete" block that used to sit at the
   * top of the settings page. Two blocks describing how the game is played, one
   * of them editable and one not, was a distinction nobody needed to make: the
   * format explanation is simply where the rules start, and the crew's own
   * additions ("gimmes inside the leather, one mulligan a side") continue it.
   *
   * ── Not written until it's touched ──────────────────────────────────────────
   * The starter is DISPLAYED, not seeded into the parent's draft. Seeding on
   * mount would mark the page dirty the moment it opened and light up the Save
   * bar before anyone did anything. Because the textarea's `value` IS the
   * starter while the stored value is empty, the first keystroke naturally
   * produces "starter + your edit" and reports that up — so it's adopted by
   * being edited, which is exactly when it should be.
   *
   * Clearing the box entirely returns it to the starter rather than to a blank:
   * "no rules at all" isn't a state this game can be in, since the format
   * explanation is always true of it.
   */
  starterText?: string;
  /**
   * Drop the section label + divider and the top margin — for a host that
   * already titles this, i.e. `GameRulesSheet`, whose sheet header says "Rules
   * of the day" one line above. Two headings for one field reads as two fields.
   */
  bare?: boolean;
}) {
  // Empty stored value → show the starter. See the prop's note for why this is
  // display-only and how the first edit adopts it.
  const showingStarter = !value.trim() && !!starterText;
  const displayed = showingStarter ? (starterText as string) : value;
  return (
    <div className={bare ? undefined : "mt-6"}>
      {/* #512 §5: label + divider rule, matching the SETTINGS / OPTIONS section
          headers (which had a divider; Rules previously had a bare label).
          Suppressed in `bare` — the sheet's own header already says this. */}
      {!bare && (
        <div className="flex items-center gap-2 pt-2">
          <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--color-bt-text-dim)" }}>
            Rules of the day
          </label>
          <span className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
        </div>
      )}
      {/* #512 §8: a bordered card PANEL containing the textarea (surface + border +
          padding) so it reads as a peer of the Matches/Course/Points card-rows, not a
          loose field. The textarea itself is transparent — it's the panel's interior. */}
      <div
        className={bare ? "rounded-xl px-3.5 py-3" : "mt-2 rounded-xl px-3.5 py-3"}
        style={{ background: "var(--color-bt-card)", border: "1px solid var(--color-bt-border)" }}
      >
        <textarea
          value={displayed}
          onChange={(e) => onChange?.(e.target.value)}
          readOnly={!canEdit}
          rows={showingStarter ? 4 : 3}
          maxLength={2000}
          placeholder="Tap out the rules of the day — formats, gimmes, mulligans, tiebreakers…"
          className="w-full resize-none bg-transparent text-sm outline-none"
          style={{
            color: "var(--color-bt-text)",
            // The starter is dimmed until adopted, so it reads as the given
            // baseline rather than as something someone typed — the one visual
            // trace of where it came from. It's real, editable content either
            // way, not a placeholder.
            opacity: canEdit ? (showingStarter ? 0.72 : 1) : 0.7,
          }}
          data-testid="game-rules-note"
        />
      </div>
    </div>
  );
}
