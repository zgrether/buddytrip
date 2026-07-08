/**
 * SettingsColumn — the ONE spacing home for every game-settings surface
 * (rack/stroke via GameConfigurationView, non-golf via NonGolfConfigurationView,
 * and match 1v1/2v2's inline checklist). A single uniform gap between every
 * section header (ZoneHeader) and every row (ChecklistRow / panel / button), so
 * no section is cramped and no two rows sit flush. `ZoneHeader`'s own `pt-2`
 * gives section breaks a touch more air on top of the gap.
 *
 * This replaces the ad-hoc per-item margins (mt-6 / mt-2.5 / mt-2 / mt-3) that
 * had drifted apart across the layouts and left the reported 0px gaps
 * (Options→Handicaps, Course→Points). Rows carry NO margin of their own — the
 * gap is owned HERE, in one place, so the spacing can't diverge per format again.
 */
export function SettingsColumn({
  className,
  children,
}: {
  /** Extra classes merged onto the column (e.g. a page's bottom padding). */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-2.5${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
