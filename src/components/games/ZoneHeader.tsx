/**
 * ZoneHeader — a labeled section divider on the game-settings surfaces (W-GAMEPAGE
 * §5): the groups are LABELS, not panes (one scrolling column). A quiet uppercase
 * caption with a hairline rule to its right, token-styled.
 *
 * Shared so non-golf settings inherit the SAME grouping treatment golf uses (the
 * match-page checklist has an identical local copy predating this extraction — it
 * can migrate to this one later; kept untouched here to leave golf settings alone).
 */
export function ZoneHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--color-bt-text-dim)" }}
      >
        {children}
      </span>
      <span className="h-px flex-1" style={{ background: "var(--color-bt-border)" }} />
    </div>
  );
}
